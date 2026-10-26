-- =============================================================================
-- KafolatQR — Initial Schema + Row Level Security (Phase 2)
--
-- Source of truth: docs/implementation-plan.md (Draft — awaiting owner approval)
--
-- Scope of this migration:
--   * All application tables (public schema)
--   * private.warranty_tokens (never exposed to anon/authenticated)
--   * Primary keys, foreign keys, composite foreign keys, CHECK constraints
--   * Indexes and unique constraints
--   * Row Level Security on every exposed table
--   * Phase 2 triggers: auto-owner-membership + warranty audit trail
--   * Helper/AUTHORIZATION function get_user_owner_store_ids()
--
-- Explicitly NOT in this migration (later phases, per approved plan):
--   * Token RPCs (issue/rotate/revoke/verify)      -> Phase 5 / Phase 7
--   * process_payment_webhook()                    -> Phase 9
--   * Storage bucket + storage.objects policies    -> Phase 8
--   * Seed/demo data
--
-- Run as: postgres  (Supabase SQL editor or `supabase db push`)
-- Idempotency: DROP ... IF EXISTS + CREATE for policies/triggers/functions, so those
-- objects are re-runnable. NOTE: `CREATE TABLE IF NOT EXISTS` does NOT repair schema
-- drift -- if a table already exists with different columns/constraints, this migration
-- silently keeps the old definition. Review the table before re-running.
--
-- NOTE ON FORCE RLS: `ALTER TABLE ... FORCE ROW LEVEL SECURITY` is deliberately
-- NOT used. SECURITY DEFINER functions below are owned by `postgres` and must be
-- able to read/write their tables while bypassing RLS (that is what prevents the
-- infinite recursion that helper-based policies would otherwise cause).
--
-- NOTE ON TRUNCATE: Row Level Security DOES NOT apply to TRUNCATE. Authorization
-- therefore relies on TWO layers: RLS policies AND explicit table GRANTs (section 8),
-- which strip TRUNCATE/REFERENCES/TRIGGER from anon and authenticated.
-- =============================================================================

-- =============================================================================
-- 1. private schema (token material only)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;

COMMENT ON SCHEMA private IS
  'KafolatQR internal schema. Holds QR token hashes only. Never granted to anon/authenticated.';

-- A new schema grants nothing to PUBLIC by default; these are explicit guardrails.
GRANT USAGE ON SCHEMA private TO service_role;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- =============================================================================
-- 2. tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1 stores — one row per store; multiple stores per account are supported
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
                                    -- RESTRICT (not CASCADE): deleting an auth user must never
                                    -- silently wipe stores, warranty cards, or documents.
  name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  logo_url    text        NULL,
  is_archived boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stores IS
  'One store per row. owner_id references auth.users; ownership transfer is unsupported in MVP.';

CREATE INDEX IF NOT EXISTS stores_owner_id_idx ON public.stores (owner_id);

-- -----------------------------------------------------------------------------
-- 2.2 store_members — authorization join table (owner now, staff later)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid        NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users (id)   ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_members_store_user_key UNIQUE (store_id, user_id)
);

COMMENT ON TABLE public.store_members IS
  'RLS join table. role: owner = full access (MVP), staff = schema reserved, no grants in this phase.';

-- Optimizes get_user_owner_store_ids() for every RLS policy evaluation.
CREATE INDEX IF NOT EXISTS store_members_owner_lookup_idx
  ON public.store_members (user_id)
  WHERE role = 'owner';

-- -----------------------------------------------------------------------------
-- 2.3 products — product CATALOG (model level), not an individual device
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  sku         text        NOT NULL CHECK (char_length(btrim(sku)) BETWEEN 1 AND 100),
  name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  category    text        NULL,
  manufacturer text       NULL,
  image_url   text        NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_store_sku_key UNIQUE (store_id, sku),
  CONSTRAINT products_store_id_key    UNIQUE (store_id, id)  -- composite-FK target
);

COMMENT ON COLUMN public.products.sku IS
  'Seller SKU within one store. A product is a catalog MODEL (e.g. "iPhone 15 128GB"), never a sold unit.';

CREATE INDEX IF NOT EXISTS products_store_id_idx ON public.products (store_id);

-- -----------------------------------------------------------------------------
-- 2.4 warranty_cards — ONE INDIVIDUAL SOLD DEVICE + its warranty terms
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warranty_cards (
  id                           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                     uuid        NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  product_id                   uuid        NOT NULL,
  serial_number                text        NULL CHECK (serial_number IS NULL OR char_length(btrim(serial_number)) BETWEEN 1 AND 128),
  customer_name                text        NULL CHECK (customer_name IS NULL OR char_length(customer_name) BETWEEN 1 AND 120),
  customer_phone               text        NULL CHECK (customer_phone IS NULL OR char_length(customer_phone) BETWEEN 1 AND 40),
  customer_email               text        NULL,
  purchase_date                date        NOT NULL CHECK (purchase_date <= current_date),
  store_warranty_months        integer     NOT NULL CHECK (store_warranty_months > 0),
  manufacturer_warranty_months integer     NULL CHECK (manufacturer_warranty_months > 0),
  manufacturer_warranty_start  date        NULL,
  manufacturer_claim_url       text        NULL CHECK (
                                        manufacturer_claim_url IS NULL
                                        OR manufacturer_claim_url ~* '^https://'
                                      ),
  status                       text        NOT NULL DEFAULT 'active'
                                         CHECK (status IN ('active', 'cancelled', 'returned', 'archived')),
  is_qr_visible                boolean     NOT NULL DEFAULT true,
  notes                        text        NULL,           -- PRIVATE (seller-only), never audited
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warranty_cards_store_id_key UNIQUE (store_id, id),  -- composite-FK target
  -- Tenant isolation: the referenced product must live in the SAME store.
  CONSTRAINT warranty_cards_product_same_store
    FOREIGN KEY (store_id, product_id)
    REFERENCES public.products (store_id, id)
    ON DELETE RESTRICT
);

COMMENT ON COLUMN public.warranty_cards.serial_number      IS 'PRIVATE PII-ish. Never returned by public QR verification.';
COMMENT ON COLUMN public.warranty_cards.customer_name      IS 'PRIVATE PII. Optional (privacy minimization). Never public.';
COMMENT ON COLUMN public.warranty_cards.customer_phone     IS 'PRIVATE PII. Optional. Never public.';
COMMENT ON COLUMN public.warranty_cards.customer_email     IS 'PRIVATE PII. Optional. Never public.';
COMMENT ON COLUMN public.warranty_cards.notes              IS 'PRIVATE seller notes. Excluded from the audit allowlist.';
COMMENT ON COLUMN public.warranty_cards.status             IS 'Record lifecycle: active|cancelled|returned|archived. Independent of computed warranty expiry.';
COMMENT ON COLUMN public.warranty_cards.is_qr_visible      IS 'QR visibility switch. Independent of record lifecycle.';
COMMENT ON COLUMN public.warranty_cards.manufacturer_warranty_start IS
  'Explicit start date. Never assumed to equal purchase_date. Null => manufacturer status "not_known".';

CREATE INDEX IF NOT EXISTS warranty_cards_store_purchase_idx ON public.warranty_cards (store_id, purchase_date);
CREATE INDEX IF NOT EXISTS warranty_cards_store_status_idx   ON public.warranty_cards (store_id, status);
-- Supports the composite FK enforcement above.
CREATE INDEX IF NOT EXISTS warranty_cards_store_product_idx  ON public.warranty_cards (store_id, product_id);

-- -----------------------------------------------------------------------------
-- 2.5 warranty_documents — private seller uploads (Storage holds the bytes)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warranty_documents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_card_id   uuid        NOT NULL,
  store_id           uuid        NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  file_name          text        NOT NULL CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 200),
  storage_path       text        NOT NULL UNIQUE
                         CHECK (storage_path ~ ('^'
                              || store_id::text
                              || '/' || warranty_card_id::text
                              || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                              || '/[^/]+$')),
                              -- Required path shape: {store_id}/{warranty_card_id}/{uuid}/{sanitized_filename}
                              -- Each '$' terminates the pattern, so extra path segments are rejected.
                              -- The final segment requires at least one non-slash character => no empty filename.
  mime_type          text        NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes         integer     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  is_archived        boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Tenant isolation: a document row must match the store of its warranty card.
  CONSTRAINT warranty_documents_store_match_card
    FOREIGN KEY (store_id, warranty_card_id)
    REFERENCES public.warranty_cards (store_id, id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.warranty_documents IS
  'Metadata rows only. Files live in the private Storage bucket. No hard delete - archive instead.';

-- Supports the composite FK enforcement above.
CREATE INDEX IF NOT EXISTS warranty_documents_store_card_idx
  ON public.warranty_documents (store_id, warranty_card_id);

-- -----------------------------------------------------------------------------
-- 2.6 subscription — one row per store, provider-neutral
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                  uuid        NOT NULL UNIQUE REFERENCES public.stores (id) ON DELETE RESTRICT,
  provider                  text        NOT NULL CHECK (char_length(btrim(provider)) BETWEEN 1 AND 50),
  provider_customer_id      text        NOT NULL,
  provider_subscription_id  text        NOT NULL,
  status                    text        NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'unpaid')),
  current_period_end        timestamptz NOT NULL,
  cancel_at_period_end      boolean     NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.subscription IS
  'One row per store (store_id UNIQUE). provider_customer_id is stable across '
  're-subscriptions, so it is deliberately NOT unique - a re-subscribe updates this row. '
  'Provider is chosen AFTER formal evaluation; no provider capability is assumed here.';

-- -----------------------------------------------------------------------------
-- 2.7 payment_transactions — every payment attempt and confirmed result
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             uuid        NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  subscription_id      uuid        NOT NULL REFERENCES public.subscription (id) ON DELETE RESTRICT,
  provider             text        NOT NULL,
  provider_payment_id  text        NOT NULL,
  amount_minor_units   bigint      NOT NULL CHECK (amount_minor_units > 0),
  currency             char(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status               text        NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  failure_reason       text        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_transactions_provider_payment_key UNIQUE (provider, provider_payment_id)
);

COMMENT ON COLUMN public.payment_transactions.amount_minor_units IS
  'Integer amount in the currency''s minor units. Provider-specific normalization happens in the matching '
  'provider adapter BEFORE this row is written; not every currency uses two decimal places.';

CREATE INDEX IF NOT EXISTS payment_transactions_store_created_idx
  ON public.payment_transactions (store_id, created_at);

-- -----------------------------------------------------------------------------
-- 2.8 billing_events — webhook idempotency ledger (metadata only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             text        NOT NULL,
  provider_event_id    text        NOT NULL,
  store_id             uuid        NOT NULL REFERENCES public.stores (id) ON DELETE RESTRICT,
  subscription_id      uuid        NULL REFERENCES public.subscription (id) ON DELETE SET NULL,
                                  -- NULL for a first-time subscription event, backfilled in the same
                                  -- transaction once the subscription row is created.
  event_type           text        NOT NULL,
  received_at          timestamptz NOT NULL DEFAULT now(),  -- when the webhook ARRIVED, not "processed"
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_events_provider_event_key UNIQUE (provider, provider_event_id)
);

COMMENT ON TABLE public.billing_events IS
  'Idempotency ledger. Stores metadata only; raw webhook bodies are never persisted here.';

-- -----------------------------------------------------------------------------
-- 2.9 audit_events — append-only trail (no SELECT/UPDATE/DELETE policies)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id       uuid        NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  store_id       uuid        NULL REFERENCES public.stores (id) ON DELETE SET NULL,
  action         text        NOT NULL,
  entity_type    text        NOT NULL,
  entity_id      uuid        NOT NULL,
  changed_fields jsonb        NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_events IS
  'Written only by the audit_log() SECURITY DEFINER trigger. Allowlisted, non-sensitive fields only.';

CREATE INDEX IF NOT EXISTS audit_events_store_created_idx
  ON public.audit_events (store_id, created_at);

-- -----------------------------------------------------------------------------
-- 2.10 private.warranty_tokens — token HASHES only, service_role access
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.warranty_tokens (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_card_id  uuid        NOT NULL REFERENCES public.warranty_cards (id) ON DELETE RESTRICT,
                                   -- RESTRICT, not CASCADE: a card must be archived, never hard-deleted,
                                   -- so token history can never be silently erased.
  token_hash        text        NOT NULL UNIQUE
                        CHECK (token_hash ~ '^[0-9a-f]{64}$'),   -- lowercase hex SHA-256
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  rotated_at        timestamptz NULL
  -- No UNIQUE(warranty_card_id) here: an inactive (rotated) token must be preserved,
  -- so several rows per warranty card are legal. "One ACTIVE token" is enforced by the
  -- partial unique index created below.
);

COMMENT ON TABLE private.warranty_tokens IS
  'SHA-256 hashes ONLY. Raw QR tokens are never stored. No RLS policies exist for anon/authenticated.';

-- Pin the search_path so every unqualified object below is created in the right schema.
SET search_path = public, private;

-- At most ONE active token per warranty card (inactive history is preserved).
-- The index is explicitly created in the `private` schema (no reliance on search_path).
CREATE UNIQUE INDEX IF NOT EXISTS warranty_tokens_one_active
  ON private.warranty_tokens (warranty_card_id)
  WHERE is_active = true;

-- Table privileges for private.warranty_tokens are set in section 8 (revoke-all,
-- then service_role gets SELECT/INSERT/UPDATE only -- no DELETE).

-- =============================================================================
-- 3. helper function — authorized store IDs for the current caller
--
-- Created AFTER the tables because PostgreSQL validates SQL function bodies at
-- CREATE time (check_function_bodies = on).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_user_owner_store_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT sm.store_id
  FROM public.store_members sm
  WHERE sm.user_id = auth.uid()
    AND sm.role = 'owner';
$$;

COMMENT ON FUNCTION public.get_user_owner_store_ids() IS
  'RLS helper. Returns only the stores owned by the JWT-authenticated caller. '
  'Takes no arguments, so a caller cannot request another user''s stores. '
  'SECURITY DEFINER + owned by postgres => reads store_members without triggering RLS recursion.';

ALTER FUNCTION public.get_user_owner_store_ids() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.get_user_owner_store_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_owner_store_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_owner_store_ids() TO service_role;

-- -----------------------------------------------------------------------------
-- SECURITY NOTE (documented, accepted):
-- PostgREST exposes `public` functions as RPC endpoints, so authenticated callers
-- can POST /rest/v1/rpc/get_user_owner_store_ids. This is safe by design: the
-- function reads no input and returns only the caller's OWN owner store IDs.
-- If we later prefer zero RPC exposure, move this helper into a dedicated
-- non-exposed schema (e.g. authz) and update the policies to match.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 4. updated_at maintenance trigger
--
-- Small addition beyond the plan text so the planned updated_at columns stay
-- accurate (otherwise the application would have to remember every time).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Sets updated_at = now() on UPDATE. Trigger-invoked only; no EXECUTE grant needed.';

ALTER FUNCTION public.set_updated_at() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS stores_set_updated_at          ON public.stores;
DROP TRIGGER IF EXISTS products_set_updated_at        ON public.products;
DROP TRIGGER IF EXISTS warranty_cards_set_updated_at  ON public.warranty_cards;
DROP TRIGGER IF EXISTS subscription_set_updated_at    ON public.subscription;

CREATE TRIGGER stores_set_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER warranty_cards_set_updated_at
  BEFORE UPDATE ON public.warranty_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER subscription_set_updated_at
  BEFORE UPDATE ON public.subscription
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 5. Phase 2 trigger — auto owner membership on store creation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.store_members (store_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner');
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_store() IS
  'SECURITY DEFINER (owner postgres): creates the owner membership on store insert. '
  'It does NOT "run as service_role" - it runs with the privileges of its OWNER (postgres), '
  'which is why it bypasses RLS on store_members and cannot be blocked by the staff-only INSERT policy.';

ALTER FUNCTION public.handle_new_store() OWNER TO postgres;
-- No direct EXECUTE grant: this is a trigger function, invoked by `on_store_created`,
-- which does not require EXECUTE privilege (triggers run as their owner). Granting
-- EXECUTE would only invite someone to call it directly.
REVOKE EXECUTE ON FUNCTION public.handle_new_store() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS on_store_created ON public.stores;
CREATE TRIGGER on_store_created
  AFTER INSERT ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_store();

-- =============================================================================
-- 6. Phase 2 trigger — warranty audit trail (allowlisted fields only)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed jsonb := '{}';
BEGIN
  -- ---- INSERT: only NEW is available; never touch OLD here ----
  IF TG_OP = 'INSERT' THEN
    changed := jsonb_build_object(
      'status',                    jsonb_build_object('new', NEW.status),
      'is_qr_visible',             jsonb_build_object('new', NEW.is_qr_visible),
      'purchase_date',             jsonb_build_object('new', NEW.purchase_date),
      'store_warranty_months',     jsonb_build_object('new', NEW.store_warranty_months),
      'manufacturer_warranty_months', jsonb_build_object('new', NEW.manufacturer_warranty_months),
      'manufacturer_warranty_start',  jsonb_build_object('new', NEW.manufacturer_warranty_start),
      'manufacturer_claim_url',    jsonb_build_object('changed', true)
    );

    INSERT INTO public.audit_events (actor_id, store_id, action, entity_type, entity_id, changed_fields)
    VALUES (auth.uid(), NEW.store_id, 'insert', TG_TABLE_NAME, NEW.id, changed);

    RETURN NEW;

  -- ---- UPDATE: compare OLD vs NEW, only allowlisted fields ----
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      changed := changed || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
    END IF;
    IF NEW.is_qr_visible IS DISTINCT FROM OLD.is_qr_visible THEN
      changed := changed || jsonb_build_object('is_qr_visible', jsonb_build_object('old', OLD.is_qr_visible, 'new', NEW.is_qr_visible));
    END IF;
    IF NEW.purchase_date IS DISTINCT FROM OLD.purchase_date THEN
      changed := changed || jsonb_build_object('purchase_date', jsonb_build_object('old', OLD.purchase_date, 'new', NEW.purchase_date));
    END IF;
    IF NEW.store_warranty_months IS DISTINCT FROM OLD.store_warranty_months THEN
      changed := changed || jsonb_build_object('store_warranty_months', jsonb_build_object('old', OLD.store_warranty_months, 'new', NEW.store_warranty_months));
    END IF;
    IF NEW.manufacturer_warranty_months IS DISTINCT FROM OLD.manufacturer_warranty_months THEN
      changed := changed || jsonb_build_object('manufacturer_warranty_months', jsonb_build_object('old', OLD.manufacturer_warranty_months, 'new', NEW.manufacturer_warranty_months));
    END IF;
    IF NEW.manufacturer_warranty_start IS DISTINCT FROM OLD.manufacturer_warranty_start THEN
      changed := changed || jsonb_build_object('manufacturer_warranty_start', jsonb_build_object('old', OLD.manufacturer_warranty_start, 'new', NEW.manufacturer_warranty_start));
    END IF;
    IF NEW.manufacturer_claim_url IS DISTINCT FROM OLD.manufacturer_claim_url THEN
      changed := changed || jsonb_build_object('manufacturer_claim_url', jsonb_build_object('changed', true));
    END IF;

    -- No allowlisted field changed => write nothing (avoid misleading audit noise).
    IF changed = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.audit_events (actor_id, store_id, action, entity_type, entity_id, changed_fields)
    VALUES (auth.uid(), NEW.store_id, 'update', TG_TABLE_NAME, NEW.id, changed);

    RETURN NEW;
  ELSE
    -- Only INSERT/UPDATE triggers exist; anything else is a wiring mistake, so fail loudly
    -- instead of silently writing nothing.
    RAISE EXCEPTION 'audit_log(): unexpected TG_OP "%" for table %', TG_OP, TG_TABLE_NAME;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.audit_log() IS
  'EXCLUDED from the audit trail (by design): serial_number, customer_name, customer_phone, '
  'customer_email, notes, token hashes, secrets, and full URL values.';

ALTER FUNCTION public.audit_log() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.audit_log() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS warranty_cards_audit_insert ON public.warranty_cards;
DROP TRIGGER IF EXISTS warranty_cards_audit_update ON public.warranty_cards;

CREATE TRIGGER warranty_cards_audit_insert
  AFTER INSERT ON public.warranty_cards
  FOR EACH ROW EXECUTE FUNCTION public.audit_log();

CREATE TRIGGER warranty_cards_audit_update
  AFTER UPDATE ON public.warranty_cards
  FOR EACH ROW EXECUTE FUNCTION public.audit_log();

-- =============================================================================
-- 7. RLS
--
-- Two independent layers protect every table:
--   (a) RLS policies below (default-deny when no policy matches)
--   (b) table GRANTs restricted to the minimum required columns/commands
-- FORCE RLS is intentionally NOT used (see header note).
-- =============================================================================

-- ---- stores -----------------------------------------------------------------
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_select  ON public.stores;
DROP POLICY IF EXISTS stores_insert  ON public.stores;
DROP POLICY IF EXISTS stores_update  ON public.stores;
DROP POLICY IF EXISTS stores_archive ON public.stores;

CREATE POLICY stores_select ON public.stores
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY stores_insert ON public.stores
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY stores_update ON public.stores
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.get_user_owner_store_ids()))
  WITH CHECK (id IN (SELECT public.get_user_owner_store_ids()) AND owner_id = auth.uid());

CREATE POLICY stores_archive ON public.stores
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.get_user_owner_store_ids()) AND is_archived = false)
  WITH CHECK (is_archived = true AND owner_id = auth.uid() AND id IN (SELECT public.get_user_owner_store_ids()));

-- Protective: two UPDATE policies exist above (stores_update, stores_archive).
-- BOTH require owner_id = auth.uid() in WITH CHECK, so PostgreSQL's permissive-policy
-- OR semantics can never combine them into an ownership change. Note that an owner may
-- un-archive their own store (restore) - owner_id still cannot change.

-- ---- store_members ---------------------------------------------------------
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_members_select ON public.store_members;
DROP POLICY IF EXISTS store_members_insert ON public.store_members;
DROP POLICY IF EXISTS store_members_delete ON public.store_members;

CREATE POLICY store_members_select ON public.store_members
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY store_members_insert ON public.store_members
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid())
    AND role = 'staff'   -- an owner can never be created by a client
  );

CREATE POLICY store_members_delete ON public.store_members
  FOR DELETE TO authenticated
  USING (
    store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid())
    AND role = 'staff'   -- owner memberships are undeletable; prevents store orphaning
  );

-- Deliberately NO UPDATE policy: a member can never be promoted/staff-upgraded by a client.

-- ---- products ---------------------------------------------------------------
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_all ON public.products;

CREATE POLICY products_all ON public.products
  FOR ALL TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()))
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));

-- DELETE is permitted (catalog rows are disposable), but FK ON DELETE RESTRICT on
-- warranty_cards.product_id guarantees warranty history is never cascade-deleted.

-- ---- warranty_cards ---------------------------------------------------------
ALTER TABLE public.warranty_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warranty_cards_select  ON public.warranty_cards;
DROP POLICY IF EXISTS warranty_cards_insert  ON public.warranty_cards;
DROP POLICY IF EXISTS warranty_cards_update  ON public.warranty_cards;
DROP POLICY IF EXISTS warranty_cards_no_delete ON public.warranty_cards;

CREATE POLICY warranty_cards_select ON public.warranty_cards
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY warranty_cards_insert ON public.warranty_cards
  FOR INSERT TO authenticated
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY warranty_cards_update ON public.warranty_cards
  FOR UPDATE TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()))
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY warranty_cards_no_delete ON public.warranty_cards
  FOR DELETE TO authenticated
  USING (false);   -- no hard delete; archive via status instead

-- ---- warranty_documents -----------------------------------------------------
ALTER TABLE public.warranty_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warranty_documents_select ON public.warranty_documents;
DROP POLICY IF EXISTS warranty_documents_insert ON public.warranty_documents;
DROP POLICY IF EXISTS warranty_documents_update ON public.warranty_documents;

CREATE POLICY warranty_documents_select ON public.warranty_documents
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY warranty_documents_insert ON public.warranty_documents
  FOR INSERT TO authenticated
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY warranty_documents_update ON public.warranty_documents
  FOR UPDATE TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()))
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));

-- No DELETE policy: archival is the only user-facing removal operation.

-- ---- subscription ------------------------------------------------------------
ALTER TABLE public.subscription ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_select ON public.subscription;

CREATE POLICY subscription_select ON public.subscription
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()));

-- ---- payment_transactions ----------------------------------------------------
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
-- No policies: default deny. Written only by the service_role webhook handler.

-- ---- billing_events ----------------------------------------------------------
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
-- No policies: default deny. Written only by the service_role webhook handler.

-- ---- audit_events ------------------------------------------------------------
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
-- No policies: default deny. Written only by the audit_log() trigger (as postgres).

-- ---- private.warranty_tokens -------------------------------------------------
ALTER TABLE private.warranty_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: default deny, PLUS the schema/table are not granted to anon or
-- authenticated. Access is service_role only (later phases' token RPCs).

-- =============================================================================
-- 8. table privileges (independent second layer; RLS alone is NOT enough)
--
-- TRUNCATE IS NOT SUBJECT TO ROW LEVEL SECURITY in PostgreSQL. RLS policies therefore
-- cannot block TRUNCATE -- only GRANT/REVOKE can. Supabase's default privileges grant
-- ALL (which includes TRUNCATE, REFERENCES, TRIGGER) to anon/authenticated on tables
-- created in `public`, so we must explicitly REVOKE everything before granting the
-- minimum required by the authorization matrix in the approved plan.
-- =============================================================================

-- 8.1 Wipe every existing table privilege for the browser-facing roles.
--     (anon and authenticated must end up with NO TRUNCATE, REFERENCES or TRIGGER.)
REVOKE ALL ON TABLE public.stores               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.store_members        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.products              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.warranty_cards       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.warranty_documents    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.subscription          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payment_transactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.billing_events        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.audit_events         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.warranty_tokens     FROM PUBLIC, anon, authenticated;

-- 8.2 Minimum grants required by the authorization matrix in the approved plan.
--     Column sets chosen so `authenticated` never receives TRUNCATE, REFERENCES or TRIGGER.
GRANT SELECT, INSERT, UPDATE ON public.stores              TO authenticated;  -- rename + archive; no DELETE
GRANT SELECT, INSERT, DELETE ON public.store_members        TO authenticated;  -- staff rows only; no UPDATE
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products     TO authenticated;  -- catalog CRUD (FK RESTRICT protects history)
GRANT SELECT, INSERT, UPDATE ON public.warranty_cards       TO authenticated;  -- no hard delete
GRANT SELECT, INSERT, UPDATE ON public.warranty_documents   TO authenticated;  -- archive only
GRANT SELECT ON public.subscription                         TO authenticated;  -- read-only

-- 8.3 anon has no access to any application table (RLS also denies every row).
GRANT USAGE ON SCHEMA public TO anon;   -- keeps the schema reachable; privileges stay empty

-- 8.4 service_role keeps full control (webhooks, Edge Functions, token RPCs).
--     Token rows can be de-activated but never deleted -> no DELETE grant.
GRANT ALL ON TABLE public.stores                TO service_role;
GRANT ALL ON TABLE public.store_members          TO service_role;
GRANT ALL ON TABLE public.products               TO service_role;
GRANT ALL ON TABLE public.warranty_cards         TO service_role;
GRANT ALL ON TABLE public.warranty_documents     TO service_role;
GRANT ALL ON TABLE public.subscription           TO service_role;
GRANT ALL ON TABLE public.payment_transactions   TO service_role;
GRANT ALL ON TABLE public.billing_events         TO service_role;
GRANT ALL ON TABLE public.audit_events           TO service_role;
GRANT SELECT, INSERT, UPDATE ON private.warranty_tokens TO service_role;

-- =============================================================================
-- End of migration
-- =============================================================================
