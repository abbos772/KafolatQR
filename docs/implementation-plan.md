# KafolatQR — Technical Implementation Plan

**Status:** Draft — awaiting explicit owner approval  
**Last updated:** 2026-10-13  
**Tech stack:** React 19, Vite 8, TypeScript 6, Supabase (Auth + PostgreSQL + Edge Functions + Storage)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Authorization and RLS](#3-authorization-and-rls)
4. [Store and Manufacturer Warranties](#4-store-and-manufacturer-warranties)
5. [QR Token Lifecycle and Public Verification](#5-qr-token-lifecycle-and-public-verification)
6. [Private Document Uploads](#6-private-document-uploads)
7. [Subscriptions and Billing](#7-subscriptions-and-billing)
8. [Environment Variables and Secret Handling](#8-environment-variables-and-secret-handling)
9. [Dependencies](#9-dependencies)
10. [Routes and Components](#10-routes-and-components)
11. [Test Strategy](#11-test-strategy)
12. [Security Risks and Mitigations](#12-security-risks-and-mitigations)
13. [Implementation Phases](#13-implementation-phases)
14. [Open Questions](#14-open-questions)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        React SPA (Vite)                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ Auth     │  │Dashboard │  │ Warranty │  │ Print / QR    │  │
│  │ Pages    │  │ Page     │  │ CRUD+List │  │ Pages         │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └──────┬────────┘  │
│       │              │              │               │            │
│       └──────────────┴──────────────┴───────────────┘            │
│                           │                                      │
│                  Supabase Client (anon JWT)                      │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────┼──────────────────────────────────────┐
│                     Supabase Platform                            │
│  ┌────────────┐  ┌────────┴───────┐  ┌─────────────────────┐    │
│  │ Auth       │  │ PostgreSQL     │  │ Edge Functions      │    │
│  │ (JWT)      │  │ (RLS enforced) │  │ verify-warranty     │    │
│  └────────────┘  │ + private schema│  │ (service-role key) │    │
│                  │ + Storage      │  └─────────────────────┘    │
│                  │ + Audit triggers│                              │
│                  └────────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
```

**Key principles:**
- RLS enforces tenant isolation at the database level — no application-level trust.
- Public QR verification bypasses the client entirely: QR → Edge Function (service-role) → allowlisted JSON.
- No anonymous access to private tables.
- No PII in public responses.
- Service-role key exists only in Edge Function secrets — never in `VITE_` variables, source code, or Git.
- Multiple stores per account supported from the initial schema.
- Multi-store UI included in MVP.
- Staff role schema exists but staff functionality deferred to a later phase.

---

## 2. Database Schema

### 2.1 Entity-Relationship

```
auth.users ─┬─< stores ──< store_members >── auth.users
            │    ├─< products ──< warranty_cards (composite FK enforces same store)
            │    ├─< warranty_documents (composite FK enforces same store via card)
            │    ├─< subscription
            │    ├─< payment_transactions
            │    ├─< billing_events
            │    └─< audit_events
            └─< audit_events (actor_id, nullable)

private schema:
  warranty_cards >── warranty_tokens (id, warranty_card_id, token_hash, is_active)
```

### 2.2 `stores`

Multiple stores per account supported from the initial schema.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Internal ID |
| `owner_id` | `uuid` | FK → `auth.users(id)`, NOT NULL | Account that owns this store |
| `name` | `text` | NOT NULL | Display name |
| `logo_url` | `text` | NULL | Optional branding |
| `is_archived` | `boolean` | NOT NULL, default `false` | Soft-delete; archived stores hidden from UI |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | |

### 2.3 `store_members`

Provides the authorization join table for RLS. Owner membership auto-created via trigger on store insert.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK | |
| `store_id` | `uuid` | FK → `stores(id)`, NOT NULL, ON DELETE CASCADE | |
| `user_id` | `uuid` | FK → `auth.users(id)`, NOT NULL, ON DELETE CASCADE | |
| `role` | `text` | NOT NULL, CHECK in (`owner`, `staff`) | `owner` has full access; `staff` deferred to later phase |
| `created_at` | `timestamptz` | default `now()` | |

UNIQUE(`store_id`, `user_id`).

**MVP policy:** Only `owner` role has RLS policies. `staff` role exists in schema but no policies grant staff access — staff UI and permissions deferred to a later phase.

### 2.4 `products`

Catalog entry — a product model, not an individual device.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK |
| `store_id` | `uuid` | FK → `stores(id)`, NOT NULL |
| `sku` | `text` | NOT NULL |
| `name` | `text` | NOT NULL |
| `category` | `text` | NULL |
| `manufacturer` | `text` | NULL |
| `image_url` | `text` | NULL |
| `created_at` / `updated_at` | `timestamptz` | |

UNIQUE(`store_id`, `sku`).  
UNIQUE(`store_id`, `id`) — required for composite FK tenant isolation.

### 2.5 `warranty_cards`

One sold device with its warranty terms. Core table.

| Column | Type | Constraints | Visibility | Notes |
|--------|------|-------------|------------|-------|
| `id` | `uuid` | PK | Private | |
| `store_id` | `uuid` | FK → `stores(id)`, NOT NULL | Private | |
| `product_id` | `uuid` | FK → `products(id)`, NOT NULL | Private | Composite FK enforces same-store |
| `serial_number` | `text` | NULL | **Private** | Optional — not all devices have readable serials |
| `customer_name` | `text` | NULL | **Private** | Optional — minimal PII collection |
| `customer_phone` | `text` | NULL | **Private** | Optional |
| `customer_email` | `text` | NULL | **Private** | Optional |
| `purchase_date` | `date` | NOT NULL, CHECK ≤ `current_date` | Public | Displayed on verification page |
| `store_warranty_months` | `int` | NOT NULL, CHECK > 0 | Public | |
| `manufacturer_warranty_months` | `int` | NULL, CHECK > 0 | Public | Seller-provided |
| `manufacturer_warranty_start` | `date` | NULL | Public | Explicit start — not assumed to be purchase_date |
| `manufacturer_claim_url` | `text` | NULL | Public | Seller-provided; validated server-side for safe URL schemes (`https:` only; rejects `javascript:`, `data:`, etc.) |
| `status` | `text` | NOT NULL, default `'active'`, CHECK in (`active`, `cancelled`, `returned`, `archived`) | Public | Record lifecycle |
| `is_qr_visible` | `boolean` | NOT NULL, default `true` | Public | QR visibility control |
| `notes` | `text` | NULL | **Private** | Internal only |
| `created_at` / `updated_at` | `timestamptz` | | Private | |

UNIQUE(`store_id`, `id`) — required for composite FK tenant isolation on warranty_documents.

Indexes: (`store_id`, `purchase_date`), (`store_id`, `status`).

**Privacy note:** `customer_name`, `customer_phone`, `customer_email`, and `serial_number` are all optional. The MVP collects only the minimum data needed to issue and verify a warranty. No PII is exposed via public QR verification.

**Composite FK (tenant isolation):**

```sql
ALTER TABLE warranty_cards
  ADD CONSTRAINT warranty_cards_product_same_store
  FOREIGN KEY (store_id, product_id)
  REFERENCES products (store_id, id)
  ON DELETE RESTRICT;
```

Requires `UNIQUE(store_id, id)` on `products` (defined above). Guarantees at the database level that a warranty card's product belongs to the same store. `ON DELETE RESTRICT` prevents deletion of products that have warranty history.

### 2.6 `private.warranty_tokens`

Token hashes stored in a `private` schema — no direct browser or anon access. Only the Edge Function (service-role) can read this table.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Separate token ID |
| `warranty_card_id` | `uuid` | FK → `public.warranty_cards(id)`, ON DELETE CASCADE | |
| `token_hash` | `text` | NOT NULL, UNIQUE | SHA-256 of raw token |
| `is_active` | `boolean` | NOT NULL, default `true` | Set `false` on revocation |
| `created_at` | `timestamptz` | default `now()` | |
| `rotated_at` | `timestamptz` | NULL | When token was last rotated |

**One active token per warranty card:**
```sql
CREATE UNIQUE INDEX warranty_tokens_one_active
  ON private.warranty_tokens (warranty_card_id)
  WHERE is_active = true;
```

**Token rotation:** Insert new hash, set old `is_active = false`. Old inactive hashes are preserved (not deleted) for audit purposes. Old tokens return generic 404.

**Access rules:**
- No RLS policies for `authenticated` or `anon` roles.
- Only `service_role` (Edge Function) can SELECT/INSERT/UPDATE.
- Raw tokens never stored — only SHA-256 hashes.

### 2.7 `warranty_documents`

Private documents uploaded by sellers (e.g., manufacturer warranty PDF, receipt).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK | |
| `warranty_card_id` | `uuid` | FK → `warranty_cards(id)`, NOT NULL, ON DELETE RESTRICT | No cascade — documents retained even if card is archived |
| `store_id` | `uuid` | FK → `stores(id)`, NOT NULL | Denormalized for RLS simplicity |
| `file_name` | `text` | NOT NULL | Original filename |
| `storage_path` | `text` | NOT NULL, UNIQUE | Path in Supabase Storage |
| `mime_type` | `text` | NOT NULL | Validated against allowlist |
| `size_bytes` | `int` | NOT NULL, CHECK > 0, CHECK ≤ 10485760 | Max 10 MB (proposal) |
| `is_archived` | `boolean` | NOT NULL, default `false` | Soft-delete instead of hard delete |
| `created_at` | `timestamptz` | default `now()` | |

**Composite FK (document tenant isolation):**
```sql
ALTER TABLE warranty_documents
  ADD CONSTRAINT warranty_documents_store_match_card
  FOREIGN KEY (store_id, warranty_card_id)
  REFERENCES warranty_cards (store_id, id)
  ON DELETE RESTRICT;
```

Guarantees at the database level that a document's `store_id` matches the `store_id` of its parent warranty card. Prevents cross-store document attachment.

**No hard deletion.** Warranty history and documents are never hard-deleted. Use `status = 'archived'` on warranty cards and `is_archived = true` on documents. Documents are retained during archival — `ON DELETE RESTRICT` prevents deletion of a card that has documents.

### 2.8 `subscription`

One row per store. Provider-neutral schema — supports any payment provider.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK |
| `store_id` | `uuid` | FK → `stores(id)`, NOT NULL, UNIQUE |
| `provider` | `text` | NOT NULL — provider identifier (selected after evaluation) |
| `provider_customer_id` | `text` | NOT NULL |
| `provider_subscription_id` | `text` | NOT NULL |
| `status` | `text` | NOT NULL, CHECK in (`trialing`, `active`, `past_due`, `cancelled`, `unpaid`) |
| `current_period_end` | `timestamptz` | NOT NULL |
| `cancel_at_period_end` | `boolean` | NOT NULL, default `false` |
| `created_at` / `updated_at` | `timestamptz` | |

### 2.9 `payment_transactions`

Records all payment attempts and confirmed results. Users cannot insert/update/delete — rows created only by service-role webhook handler.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK |
| `store_id` | `uuid` | FK → `stores(id)`, NOT NULL |
| `subscription_id` | `uuid` | FK → `subscription(id)`, NOT NULL |
| `provider` | `text` | NOT NULL |
| `provider_payment_id` | `text` | NOT NULL — charge/payment ID from provider |
| `amount_minor_units` | `bigint` | NOT NULL, CHECK > 0 — integer amount in currency's minor units (e.g., cents) |
| `currency` | `char(3)` | NOT NULL — ISO 4217 code (e.g., `'USD'`, `'UZS'`) |
| `status` | `text` | NOT NULL, CHECK in (`pending`, `succeeded`, `failed`, `refunded`) |
| `failure_reason` | `text` | NULL |
| `created_at` | `timestamptz` | default `now()` |

Index on (`store_id`, `created_at`). No RLS policies for authenticated users — write-only via service-role.

### 2.10 `billing_events`

Webhook idempotency — unique `provider_event_id` prevents duplicate processing.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK |
| `provider` | `text` | NOT NULL — provider namespace for multi-provider support |
| `provider_event_id` | `text` | NOT NULL — provider-specific event identifier |
| `store_id` | `uuid` | FK → `stores(id)`, NOT NULL |
| `subscription_id` | `uuid` | FK → `subscription(id)`, NULL — nullable for first-time creation before subscription row exists |
| `event_type` | `text` | NOT NULL — e.g., `subscription.created`, `payment.succeeded` |
| `received_at` | `timestamptz` | NOT NULL, default `now()` — when webhook was received, NOT when it was processed |
| `created_at` | `timestamptz` | default `now()` |

UNIQUE(`provider`, `provider_event_id`) — prevents duplicate webhook processing across providers.

**No raw payload storage:** Only event metadata is retained. Raw webhook payloads are logged to the Edge Function's log sink (with PII redacted) and not stored in the database by default. This minimizes data retention and PII exposure.

No RLS policies for authenticated users — write-only via service-role.

### 2.11 `audit_events`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK |
| `actor_id` | `uuid` | FK → `auth.users(id)`, nullable |
| `store_id` | `uuid` | FK → `stores(id)`, nullable |
| `action` | `text` | NOT NULL |
| `entity_type` | `text` | NOT NULL |
| `entity_id` | `uuid` | NOT NULL |
| `changed_fields` | `jsonb` | NULL — allowlist of non-sensitive field changes only |
| `created_at` | `timestamptz` | default `now()` |

Index on (`store_id`, `created_at`). No SELECT/UPDATE/DELETE policies. Written only via SECURITY DEFINER trigger function.

**Audit field allowlist:** Only non-sensitive fields are recorded: `status`, `is_qr_visible`, `purchase_date`, `store_warranty_months`, `manufacturer_warranty_months`, `manufacturer_warranty_start`, `manufacturer_claim_url`. Never record: `serial_number`, `customer_name`, `customer_phone`, `customer_email`, `token_hash`, `notes`, or any PII.

---

## 3. Authorization and RLS

### 3.1 Authorization Matrix

| Role | stores | store_members | products | warranty_cards | warranty_documents | subscription | payment_transactions | billing_events | audit_events |
|------|--------|---------------|----------|----------------|---------------------|--------------|---------------------|----------------|--------------|
| Anon | None | None | None | None | None | None | None | None | None |
| Store owner (authenticated) | CRUD own | CRUD own store's | CRUD own store's | CRUD own store's | CRUD own store's | Read own | None | None | None |
| Platform admin (service-role) | Full | Full | Full | Full | Full | Full | Full | Full | Full |

**MVP simplification:** Only `owner` role has RLS policies. `staff` role exists in schema but no policies grant staff access. Staff functionality deferred to a later phase.

### 3.2 RLS Policies

All policies use `store_members` with `role = 'owner'` for authorization — a user can only access stores where they have an owner membership row.

**Helper function for RLS (owner-only):**
```sql
CREATE OR REPLACE FUNCTION public.get_user_owner_store_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT sm.store_id FROM public.store_members sm WHERE sm.user_id = auth.uid() AND sm.role = 'owner';
$$;

ALTER FUNCTION public.get_user_owner_store_ids() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_user_owner_store_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_owner_store_ids() TO authenticated;
```

**Security properties:**
- `search_path = ''` with schema-qualified references (`public.store_members`) prevents search_path manipulation.
- Uses `auth.uid()` — caller cannot supply an arbitrary user ID.
- `STABLE` — no writes, safe for RLS subqueries.
- `SECURITY DEFINER` — runs as `postgres` to read `store_members` without triggering RLS recursion.
- Owned by `postgres` — trusted superuser, not modifiable by `authenticated` or `service_role`.
- Granted to `authenticated` so RLS policies can call it; `service_role` already has full table access.

**Recursion avoidance:** The function reads `store_members` as `postgres` (bypassing RLS on that table). RLS policies on `store_members` do not call this function — they check membership directly. No recursive loop.

**`stores`**
```sql
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_select ON stores
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY stores_insert ON stores
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY stores_update ON stores
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.get_user_owner_store_ids()))
  WITH CHECK (id IN (SELECT public.get_user_owner_store_ids()) AND owner_id = auth.uid());

CREATE POLICY stores_archive ON stores
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.get_user_owner_store_ids()) AND is_archived = false)
  WITH CHECK (is_archived = true AND owner_id = auth.uid() AND id IN (SELECT public.get_user_owner_store_ids()));
```

**Archive policy safety:** Both `stores_update` and `stores_archive` policies require `owner_id = auth.uid()` in `WITH CHECK` — prevents changing `owner_id` to another user through any code path. The `stores_update` policy also requires the store to remain in the caller's authorized set. Ownership transfer is unsupported in MVP.

**`store_members`**
```sql
ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY store_members_select ON store_members
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY store_members_insert ON store_members
  FOR INSERT TO authenticated
  WITH CHECK (
    store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid())
    AND role = 'staff'  -- Only owner can add staff; cannot add another owner
  );

CREATE POLICY store_members_delete ON store_members
  FOR DELETE TO authenticated
  USING (
    store_id IN (SELECT id FROM public.stores WHERE owner_id = auth.uid())
    AND role = 'staff'  -- Cannot delete owner memberships; only staff can be removed
  );
```

**Membership integrity rules:**
- Owner memberships are created exclusively by the `handle_new_store()` trigger (runs as service-role on store insert).
- `store_members_insert` policy only allows inserting `role = 'staff'` — users cannot create owner memberships for themselves or others.
- `store_members_delete` policy only allows deleting `role = 'staff'` rows — owners cannot delete their own owner membership or other owners' memberships. This prevents store orphaning.
- To transfer store ownership, the current owner must update `stores.owner_id` directly (enforced by `stores_update` policy requiring `owner_id = auth.uid()`), which should be done via a dedicated admin operation, not through membership manipulation.

**`products`**
```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_all ON products
  FOR ALL TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()))
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));
```

**`warranty_cards`**
```sql
ALTER TABLE warranty_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY warranty_cards_select ON warranty_cards
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY warranty_cards_insert ON warranty_cards
  FOR INSERT TO authenticated
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY warranty_cards_update ON warranty_cards
  FOR UPDATE TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()))
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));

CREATE POLICY warranty_cards_no_delete ON warranty_cards
  FOR DELETE TO authenticated
  USING (false);  -- No hard delete; use status = 'archived'
```

**`warranty_documents`**
```sql
ALTER TABLE warranty_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY warranty_documents_all ON warranty_documents
  FOR ALL TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()))
  WITH CHECK (store_id IN (SELECT public.get_user_owner_store_ids()));
```

**`private.warranty_tokens`**
- ENABLE RLS. No policies for `authenticated` or `anon`. Only `service_role` (Edge Function) can access.

**`subscription`**
```sql
ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_select ON subscription
  FOR SELECT TO authenticated
  USING (store_id IN (SELECT public.get_user_owner_store_ids()));
```

**`payment_transactions` and `billing_events`**
- ENABLE RLS. No policies for authenticated users. Write-only via service-role webhook handler.

**`audit_events`**
- ENABLE RLS. No policies. No anon, no authenticated access.

### 3.3 Store Creation Trigger — Auto Owner Membership

Ensures every newly created store automatically receives a valid owner membership. The function is `SECURITY DEFINER` owned by `postgres` — it executes with the owner's privileges, not the caller's. Users cannot bypass it.

```sql
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

REVOKE EXECUTE ON FUNCTION public.handle_new_store() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_store() TO service_role;

CREATE TRIGGER on_store_created
  AFTER INSERT ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_store();
```

### 3.4 SECURITY DEFINER — Audit Trigger Function

Uses an allowlist of non-sensitive fields only. All objects schema-qualified. `search_path = ''` prevents search_path manipulation.

```sql
CREATE OR REPLACE FUNCTION public.audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed jsonb := '{}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed := jsonb_build_object(
      'status', jsonb_build_object('new', NEW.status),
      'is_qr_visible', jsonb_build_object('new', NEW.is_qr_visible),
      'purchase_date', jsonb_build_object('new', NEW.purchase_date),
      'store_warranty_months', jsonb_build_object('new', NEW.store_warranty_months),
      'manufacturer_warranty_months', jsonb_build_object('new', NEW.manufacturer_warranty_months),
      'manufacturer_warranty_start', jsonb_build_object('new', NEW.manufacturer_warranty_start),
      'manufacturer_claim_url', jsonb_build_object('new', NEW.manufacturer_claim_url)
    );

    INSERT INTO public.audit_events (actor_id, store_id, action, entity_type, entity_id, changed_fields)
    VALUES (auth.uid(), NEW.store_id, 'insert', TG_TABLE_NAME, NEW.id, changed);

    RETURN NEW;
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
      changed := changed || jsonb_build_object('manufacturer_claim_url', jsonb_build_object('old', OLD.manufacturer_claim_url, 'new', NEW.manufacturer_claim_url));
    END IF;

    INSERT INTO public.audit_events (actor_id, store_id, action, entity_type, entity_id, changed_fields)
    VALUES (auth.uid(), NEW.store_id, 'update', TG_TABLE_NAME, NEW.id, changed);

    RETURN NEW;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_log() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_log() TO service_role;

CREATE TRIGGER warranty_cards_audit_insert
  AFTER INSERT ON public.warranty_cards
  FOR EACH ROW EXECUTE FUNCTION public.audit_log();

CREATE TRIGGER warranty_cards_audit_update
  AFTER UPDATE ON public.warranty_cards
  FOR EACH ROW EXECUTE FUNCTION public.audit_log();
```

### 3.5 Cross-Store Isolation

- Every RLS policy scopes to `store_id IN (SELECT public.get_user_owner_store_ids())` — only stores where the user has an owner membership row.
- A forged UUID in a direct API request returns zero rows — the subquery only resolves the caller's own stores.
- The composite FK (`store_id`, `product_id`) prevents cross-store product references at the database level.
- The composite FK (`store_id`, `warranty_card_id`) on `warranty_documents` prevents cross-store document attachment at the database level.
- No hard delete on `warranty_cards` — `DELETE` policy returns `false`. Use `status = 'archived'` instead.
- The Edge Function uses service-role (bypasses RLS) but only returns allowlisted fields from `private.warranty_tokens`.
- All RLS helper functions use `search_path = ''` with schema-qualified references.
- SECURITY DEFINER functions that access sensitive data (`audit_log`, `handle_new_store`, `verify_warranty_by_hash`) are granted only to `service_role`. The RLS helper `get_user_owner_store_ids` is granted to `authenticated` because it only returns the caller's own store IDs and cannot be used to access other users' data.

---

## 4. Store and Manufacturer Warranties

### 4.1 Conceptual Separation

| Aspect | Store Warranty | Manufacturer Warranty |
|--------|---------------|----------------------|
| Issued by | Seller (KafolatQR user) | Device manufacturer |
| Managed by | KafolatQR | External (not managed) |
| Verified via QR | No — displayed as seller-entered info | No |
| Data source | Seller creates in app | Seller provides manually |
| Status | Computed from dates | Computed from dates |
| Authenticity | Seller-entered, not independently verified | Seller-provided, unverified |

### 4.2 Computed Status (Not Stored)

**Store warranty:**
- `expiry = purchase_date + store_warranty_months * interval '1 month'`
- Status: `active` if `current_date ≤ expiry`, else `expired`.

**Manufacturer warranty:**
- If `manufacturer_warranty_months IS NULL` OR `manufacturer_warranty_start IS NULL` → `not_known`.
- Else: `expiry = manufacturer_warranty_start + manufacturer_warranty_months * interval '1 month'`
- Status: `active` / `expired` / `not_known`.
- **Never assume** manufacturer warranty starts on `purchase_date` — always require explicit `manufacturer_warranty_start`.
- **Never claim** official manufacturer verification — display as "seller-provided, unverified" unless a real manufacturer API integration exists.

### 4.3 Record Lifecycle (`status` column)

| Status | Meaning | QR Visible? |
|--------|---------|-------------|
| `active` | Warranty card is live | Yes (unless `is_qr_visible = false`) |
| `cancelled` | Seller voided this warranty | No |
| `returned` | Device returned by customer | No |
| `archived` | Soft-deleted — retained for history | No |

When `status` changes to `cancelled`, `returned`, or `archived`, the application also sets `is_qr_visible = false`.

**No hard deletion.** Warranty cards are never hard-deleted. The `DELETE` RLS policy returns `false`. Use `status = 'archived'` for removal from active views.

### 4.4 Edit Behavior

- Editing `purchase_date` or `store_warranty_months` recomputes store warranty expiry.
- Editing `manufacturer_warranty_*` fields updates manufacturer status.
- All edits are captured in `audit_events` (allowlisted fields only).
- `serial_number` is editable only if it was set at creation; it cannot be added after creation if left blank.

### 4.5 Return Flow

1. Seller marks warranty as `returned`.
2. `status = 'returned'`, `is_qr_visible = false`.
3. QR verification returns 404.
4. Warranty remains in the system for audit/history.

---

## 5. QR Token Lifecycle and Public Verification

### 5.1 Token Generation

- `crypto.getRandomValues(new Uint8Array(32))` → base64url-encode → 43-character token (256 bits entropy).
- Store only `SHA-256(token)` in `private.warranty_tokens.token_hash`.
- Raw token exists only in the QR payload URL: `${VITE_APP_URL}/verify#<raw_token>`
- Token is placed in the URL **hash fragment** (`#`) — browsers do not send fragments to the initial page request. However, the frontend subsequently sends the token in a POST request body to the Edge Function. Standard request logging at the CDN/load balancer level may capture POST body metadata but not body contents when TLS is properly configured. Tokens are never placed in URL query parameters or path segments.

### 5.2 Token Rotation

Token rotation is atomic — both operations run in a single transaction:

```sql
BEGIN;
  -- Revoke old token
  UPDATE private.warranty_tokens SET is_active = false, rotated_at = now()
  WHERE warranty_card_id = $1 AND is_active = true;

  -- Activate new token
  INSERT INTO private.warranty_tokens (warranty_card_id, token_hash, is_active)
  VALUES ($1, $2, true);
COMMIT;
```

- If either operation fails, the entire transaction rolls back — the prior valid token remains active.
- Partial unique index (`WHERE is_active = true`) ensures at most one active token per warranty card.
- Concurrent rotation attempts are serialized by the unique index — one succeeds, the other fails with a constraint violation and rolls back.
- Old inactive hashes are preserved (not deleted) for audit purposes.
- Old token becomes unknown → returns generic 404.

### 5.3 Revocation

- Seller sets `is_qr_visible = false` on warranty card AND `is_active = false` on token → Edge Function returns 404 (same as unknown).
- `status` set to `cancelled`, `returned`, or `archived` → application also sets `is_qr_visible = false` and `is_active = false`.
- Revoked, inactive, and unknown tokens all return the same generic 404 — no distinction leaked.

### 5.4 Edge Function: `verify-warranty`

**Location:** `supabase/functions/verify-warranty/index.ts`

**Request:** `POST /verify-warranty` with JSON body `{ "token": "<base64url>" }`

**Logic:**
1. Validate token against `^[A-Za-z0-9_-]{43}$`. Invalid → 400.
2. Compute SHA-256 hash.
3. Call `public.verify_warranty_by_hash(p_token_hash := hash)` — a narrowly scoped SECURITY DEFINER RPC that returns only the allowlisted verification data (see below).
4. Function returns `NULL` if token is unknown, inactive, or warranty card is not QR-visible → Edge Function returns **404**.
5. Match found → Edge Function computes warranty status from dates, returns allowlisted fields.

**Why POST:** Token is sent in the request body, not in URL query parameters. Prevents token leakage through server logs, browser history, and referer headers.

**Server-only RPC for token lookup:**
```sql
CREATE OR REPLACE FUNCTION public.verify_warranty_by_hash(p_token_hash text)
RETURNS TABLE (
  product_name text,
  manufacturer text,
  purchase_date date,
  store_warranty_expiry date,
  store_warranty_status text,
  manufacturer_warranty_status text,
  manufacturer_warranty_expiry date,
  manufacturer_claim_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.name,
    p.manufacturer,
    wc.purchase_date,
    (wc.purchase_date + (wc.store_warranty_months || ' months')::interval)::date,
    CASE WHEN current_date <= (wc.purchase_date + (wc.store_warranty_months || ' months')::interval)::date
         THEN 'active' ELSE 'expired' END,
    CASE WHEN wc.manufacturer_warranty_months IS NULL OR wc.manufacturer_warranty_start IS NULL
         THEN 'not_known'
         WHEN current_date <= (wc.manufacturer_warranty_start + (wc.manufacturer_warranty_months || ' months')::interval)::date
         THEN 'active' ELSE 'expired' END,
    (wc.manufacturer_warranty_start + (wc.manufacturer_warranty_months || ' months')::interval)::date,
    wc.manufacturer_claim_url
  FROM private.warranty_tokens t
  JOIN public.warranty_cards wc ON wc.id = t.warranty_card_id
  JOIN public.products p ON p.id = wc.product_id
  WHERE t.token_hash = p_token_hash
    AND t.is_active = true
    AND wc.is_qr_visible = true
    AND wc.status = 'active';
END;
$$;

ALTER FUNCTION public.verify_warranty_by_hash(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.verify_warranty_by_hash(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_warranty_by_hash(text) TO service_role;
```

**Security properties:**
- Returns only allowlisted fields — never exposes `id`, `serial_number`, `customer_name`, `token_hash`, or any PII.
- `search_path = ''` with schema-qualified references throughout.
- Owned by `postgres` — not modifiable by `authenticated` or `service_role`.
- `EXECUTE` granted only to `service_role` — Edge Function calls it with service-role key; anon and authenticated clients cannot call it directly.
- Never returns token hashes to clients.

### 5.5 Allowlisted Response

```json
{
  "product_name": "iPhone 15 Pro",
  "manufacturer": "Apple",
  "purchase_date": "2026-01-15",
  "store_warranty_expiry": "2027-01-15",
  "store_warranty_status": "active | expired",
  "manufacturer_warranty_status": "active | expired | not_known",
  "manufacturer_warranty_expiry": "2027-06-15 | null",
  "manufacturer_claim_url": null,
  "disclaimer": "This warranty information was entered by the seller and has not been independently verified by KafolatQR. Manufacturer warranty details, if shown, are seller-provided and unverified."
}
```

**Never returned:** `id`, `serial_number`, `customer_name`, `customer_phone`, `customer_email`, `store_id`, `product_id`, `token_hash`, `notes`, `status`, `is_qr_visible`, `warranty_card_id`.

### 5.6 Rate Limiting

- **Production:** Upstash Ratelimit (`@upstash/ratelimit` + `@upstash/redis`) — shared across Edge Function instances.
- **Limit:** 30 requests/minute per IP (proposal).
- **Dev fallback:** In-memory Map with TTL (local development only).
- **Headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### 5.7 CORS

- CORS headers restrict browser-based access to the function. **CORS is not authorization** — non-browser clients ignore it. Authorization is enforced by token validation and rate limiting.

### 5.8 Logging

- Never log raw tokens or full request bodies.
- Log only: timestamp, IP hash, token hash prefix (first 8 chars), response status.
- Tokens are in POST body, not URL — standard request logging will not capture them.

### 5.9 SECURITY DEFINER Constraints

- `search_path = ''` — prevents search_path manipulation.
- All objects schema-qualified (e.g., `public.store_members`, `private.warranty_tokens`).
- `EXECUTE` revoked from `PUBLIC` and `authenticated`; granted only to `service_role`.

---

## 6. Private Document Uploads

### 6.1 Use Case

Sellers upload manufacturer warranty documents (PDFs, images) or purchase receipts as private attachments to a warranty card.

### 6.2 Storage Design

- **Supabase Storage bucket:** `warranty-documents` (private, not public).
- **Path structure:** `{store_id}/{warranty_card_id}/{file_name}`
- **Access:** Only via signed URLs generated by the backend (service-role) for authenticated owner. Never public URLs.

### 6.3 Upload Flow

1. Client requests signed upload URL from a backend Edge Function.
2. Edge Function verifies caller's JWT + confirms ownership of the target warranty card.
3. Client uploads file directly to Supabase Storage at verified path.
4. Client creates `warranty_documents` row with `storage_path`.
5. RLS + composite FK on `warranty_documents` ensures store ownership and cross-store attachment prevention.

### 6.4 Download Flow

1. Client requests signed download URL via Edge Function.
2. Edge Function verifies caller's JWT + RLS ownership of the warranty card.
3. Returns time-limited signed URL (5-minute expiry — proposal).

### 6.5 Validation

- MIME type allowlist: `application/pdf`, `image/png`, `image/jpeg` (proposal).
- Max file size: 10 MB (proposal).
- Filename sanitized — no path traversal characters.

### 6.6 Storage RLS

```sql
-- Storage policies for warranty-documents bucket
CREATE POLICY "Store owners can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'warranty-documents'
    AND (storage.foldername(name))[1] IN (SELECT store_id::text FROM public.store_members WHERE user_id = auth.uid() AND role = 'owner'));

CREATE POLICY "Store owners can read own"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'warranty-documents'
    AND (storage.foldername(name))[1] IN (SELECT store_id::text FROM public.store_members WHERE user_id = auth.uid() AND role = 'owner'));

CREATE POLICY "Store owners can delete own"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'warranty-documents'
    AND (storage.foldername(name))[1] IN (SELECT store_id::text FROM public.store_members WHERE user_id = auth.uid() AND role = 'owner'));
```

---

## 7. Subscriptions and Billing

### 7.1 Subscription Model

- Monthly subscription per store (proposal).
- Free trial: 14 days (proposal — confirm duration).
- Paid plan: unlimited warranty cards, document uploads, QR generation (proposal — confirm limits).
- Automatic monthly billing via payment provider (provider TBD after evaluation).

### 7.2 Payment Provider Evaluation

**Note:** No payment provider has been selected. Stripe's availability for businesses registered in Uzbekistan is unconfirmed. The following evaluation is preliminary.

| Criteria | Stripe | Payme Business | Click | Humo |
|----------|--------|----------------|-------|------|
| Uzbekistan availability | Unconfirmed — may require international entity | Yes (local) | Yes (local) | Yes (local) |
| Subscription billing API | Native (Stripe Billing) | Payme Business Subscribe API (recurring payments) | Limited / manual | Limited |
| Auto-renewal | Native | Via Subscribe API | Requires custom logic | Requires custom logic |
| Webhooks | Native | Yes (payment notifications) | Yes | Yes |
| USD/UZS pricing | Both | UZS primarily | UZS primarily | UZS primarily |
| Developer experience | Excellent | Moderate | Moderate | Moderate |
| Supabase integration | Official Stripe Extension | None (custom) | None (custom) | None (custom) |
| PCI compliance | Handled by Stripe | Handled by Payme | Handled by Click | Handled by Humo |

**Provider-neutral billing schema:** The `subscription` table uses generic `provider`, `provider_customer_id`, and `provider_subscription_id` columns. No provider-specific fields. Provider selection will happen after evaluating Payme Business Subscribe API, Click, Humo, and confirming Stripe availability for Uzbekistan-registered businesses.

**Integration pattern (provider-agnostic):**
```
Supabase Tables (subscription, payment_transactions, billing_events)
       ↑
       │ Provider Webhook (idempotent via billing_events.provider_event_id)
       │
Provider Dashboard ← Customer subscribes via Provider Checkout
```

### 7.3 Webhook Processing (Atomic & Idempotent)

**Signature verification:** All webhook payloads verified using provider-specific webhook secret before processing. Invalid signatures → 401.

**Duplicate event handling:**
1. Webhook received → verify signature.
2. Extract `provider_event_id` from payload.
3. `INSERT INTO billing_events (provider, provider_event_id, store_id, subscription_id, event_type) VALUES (...) ON CONFLICT (provider, provider_event_id) DO NOTHING`.
4. If row already exists (no row returned from INSERT) → return 200 (idempotent — event already processed).
5. If new row was inserted → proceed with subscription status update in same transaction.
6. If `subscription_id` is NULL (first-time creation before subscription row exists), look up or create the subscription from provider customer data.
7. Update `subscription` table with new status.

**Atomic processing:** Steps 3-7 run in a single database transaction. If any step fails, entire transaction rolled back. Concurrent duplicate webhooks are serialized by the unique constraint — one wins, the other returns 200 without processing.

**Event receipt vs. processing:** `billing_events.received_at` records when the webhook was received, NOT when it was processed. This prevents false claims about processing status. Processing status is inferred from whether the `subscription` table was updated, not from a timestamp on the event row.

### 7.4 Subscription Lifecycle

1. Seller signs up → Provider Checkout Session created → customer subscribes.
2. Provider sends webhook → `billing_events` row created (idempotent) → `subscription` row created.
3. Payment confirmed → `payment_transactions` row created with `status = 'succeeded'`.
4. Seller has full access during trial and active period.
5. If `past_due` or `unpaid`: restrict warranty creation (read-only mode).
6. If `cancelled`: access revoked at period end.

### 7.5 Failed Payment Retries

- Provider retries failed payments per its schedule.
- Each retry attempt recorded in `payment_transactions`.
- `subscription.status` set to `past_due` on failure.
- If all retries fail → `status = 'unpaid'` → read-only mode.

### 7.6 Cancellation and Refunds

- Cancellation requested via provider API or webhook.
- `subscription.cancel_at_period_end = true` → access continues until period end.
- After period end → `status = 'cancelled'` → access revoked.
- Refunds processed via provider API → `payment_transactions.status = 'refunded'`.

### 7.7 Access Control

- `SubscriptionGate` component checks subscription status before allowing warranty creation.
- Server-side check also enforced — never trust client alone.
- Users cannot modify their own `subscription`, `payment_transactions`, or `billing_events` rows directly (no INSERT/UPDATE/DELETE policies for authenticated users).

---

## 8. Environment Variables and Secret Handling

### 8.1 Vite Public Variables (frontend-safe)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SUPABASE_URL` | Project URL | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Anon/publishable key | `eyJhbGciOi...` |
| `VITE_APP_URL` | App base URL for QR payloads | `https://app.kafolatqr.uz` |

### 8.2 Edge Function Secrets (server-side only)

| Variable | Description |
|----------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — **never** in VITE_ vars, source code, or Git |
| `SUPABASE_URL` | Project URL (Edge Function context) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `PAYMENT_PROVIDER_SECRET_KEY` | Payment provider secret key (provider TBD) |
| `PAYMENT_WEBHOOK_SECRET` | Payment provider webhook signing secret |

### 8.3 Secret Configuration

- Edge Function secrets: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...`
- Payment provider secret: set in provider dashboard + Supabase secrets.
- `.env.example` (root): only `VITE_*` placeholders.
- `supabase/functions/.env.example`: documents Edge Function secrets (no real values).
- CI check: grep for `SUPABASE_SERVICE_ROLE_KEY` and any live secret patterns in `src/` and `*.tsx` files — fail if found.
- `.gitignore` includes `.env`, `.env.local`, `.env.production`.

### 8.4 Secret Handling Rules

- Never log secrets.
- Never commit secrets.
- Never put secrets in VITE_ variables.
- Never put secrets in client-side error messages.
- Service-role key only in Edge Function secrets.
- Payment provider secret key only in Edge Function secrets.

---

## 9. Dependencies

### 9.1 Runtime Dependencies

| Package | Justification |
|---------|---------------|
| `@supabase/supabase-js` | Auth + PostgREST + Storage client |
| `react-router-dom` | Client-side routing |
| `zod` | Input validation (forms + Edge Function) |
| `qrcode` | Client-side QR generation for printing |
| `date-fns` | Date arithmetic for warranty expiry |

### 9.2 Edge Function Dependencies

| Package | Justification |
|---------|---------------|
| `@supabase/functions` | Edge Function framework |
| `@upstash/ratelimit` | Shared rate limiting |
| `@upstash/redis` | Redis backend for rate limiter |

Payment provider SDK (e.g., `stripe`, `payme` SDK) added after provider selection.

### 9.3 Dev/Test Dependencies

| Package | Justification |
|---------|---------------|
| `vitest` | Unit + integration testing |
| `@testing-library/react` | React component testing |
| `@testing-library/jest-dom` | DOM assertions |
| `@testing-library/user-event` | User interaction simulation |
| `jsdom` | DOM environment for Vitest |
| `msw` | Mock Service Worker for API mocking |
| `playwright` | End-to-end testing |
| `eslint-plugin-react-hooks` | React hooks linting |
| `eslint-plugin-react-refresh` | React refresh linting |

---

## 10. Routes and Components

### 10.1 Routes

| Path | Component | Auth | Description |
|------|-----------|------|-------------|
| `/login` | `LoginPage` | Public | Email/password sign-in |
| `/signup` | `SignupPage` | Public | Email/password sign-up |
| `/` | `DashboardPage` | Protected | Store stats overview (store selector for multi-store) |
| `/warranties` | `WarrantyListPage` | Protected | List + search warranties |
| `/warranties/new` | `WarrantyCreatePage` | Protected | Create warranty card |
| `/warranties/:id` | `WarrantyDetailPage` | Protected | View single warranty |
| `/warranties/:id/edit` | `WarrantyEditPage` | Protected | Edit warranty |
| `/warranties/:id/documents` | `DocumentListPage` | Protected | Manage uploaded documents |
| `/warranty/print/:id` | `PrintCardPage` | Protected | Printable warranty card |
| `/qr/print/:id` | `PrintQrPage` | Protected | QR sticker printing |
| `/store/settings` | `StoreSettingsPage` | Protected | Store profile + subscription + store management |
| `/verify` | `VerifyPage` | Public | QR verification landing (token in URL hash fragment `#TOKEN`) |

### 10.2 Component Tree

```
App
├── AuthLayout
│   ├── LoginPage
│   └── SignupPage
├── ProtectedRoute (redirects to /login if unauthenticated)
└── AppLayout (sidebar + header + store selector)
    ├── DashboardPage
    │   └── StatsCards (total products, active, expired)
    ├── WarrantyListPage
    │   ├── SearchBar
    │   └── WarrantyTable / WarrantyCard[]
    ├── WarrantyCreatePage
    │   └── WarrantyForm (create mode)
    ├── WarrantyDetailPage
    │   ├── WarrantyInfo
    │   ├── QrCodeDisplay
    │   ├── DocumentList
    │   └── PrintButtons
    ├── WarrantyEditPage
    │   └── WarrantyForm (edit mode)
    ├── DocumentListPage
    │   └── DocumentUpload / DocumentPreview
    ├── PrintCardPage
    │   └── PrintableCard
    ├── PrintQrPage
    │   └── QrSticker
    └── StoreSettingsPage
        ├── StoreForm
        ├── StoreManagement (multi-store UI)
        └── SubscriptionPanel

Standalone (no layout):
    VerifyPage
        ├── VerificationResult (active/expired/not-found)
        └── Disclaimer
```

### 10.3 Shared Components

- `Button`, `Input`, `Select`, `Card`, `Modal`, `Spinner`
- `ProtectedRoute` — checks auth state, redirects to `/login`
- `QrCodeDisplay` — renders QR from a string
- `WarrantyStatusBadge` — active/expired/not_known indicator
- `SubscriptionGate` — checks subscription status, blocks creation if not active
- `StoreSelector` — dropdown to switch between stores (multi-store UI)

---

## 11. Test Strategy

### 11.1 Unit Tests (Vitest)

| Test | Requirement |
|------|-------------|
| Zod schema validation — invalid dates, negative months, future purchase | Form input validation |
| Warranty expiry calculation | Correct status determination |
| Token generation — correct length, character set | Token format compliance |
| QR payload URL format | Correct verify URL |
| Manufacturer warranty status computation | Separate from store warranty |
| Manufacturer warranty — missing start or duration returns `not_known` | Correct null handling |
| Store creation trigger — auto owner membership created | Membership integrity |
| Owner-role escalation attempt — inserting owner role for another user fails | Privilege escalation prevention |
| Owner membership deletion — owner cannot delete own owner membership | Store orphaning prevention |
| Archive with owner_id change — attempting to change owner_id while archiving fails | Ownership escalation prevention |
| RLS helper — `get_user_owner_store_ids()` only returns caller's own stores | Tenant isolation enforcement |
| RLS helper — caller cannot supply arbitrary user ID | Helper function security |

### 11.2 Integration Tests (Vitest + MSW)

| Test | Security/Product Requirement |
|------|------------------------------|
| RLS — cross-store isolation | Tenant isolation: two stores cannot access each other's data |
| RLS — anonymous access denial | No anon access to private tables |
| RLS — owner CRUD | Seller can manage own data |
| Composite FK — cross-store product reference | DB-level tenant isolation |
| Composite FK — cross-store document attachment | Document cannot reference card from different store |
| Audit events written on CRUD | Audit trail integrity |
| Edge Function — valid token returns allowlisted fields | Privacy: no PII leakage |
| Edge Function — tampered token returns 404 | Token security |
| Edge Function — revoked token returns 404 | Revocation works |
| Edge Function — expired warranty status | Correct computed status |
| Edge Function — missing manufacturer data | Graceful null handling |
| Edge Function — rate limit exceeded returns 429 | Abuse prevention |
| Document upload — ownership validation | Private file access control |
| Document upload — MIME type validation | Input validation |
| QR token rotation — old token returns 404, new token works | Token lifecycle |
| QR token — partial unique index prevents two active tokens | Token constraint enforcement |
| Duplicate webhook event — idempotent processing | Billing webhook integrity |
| Webhook signature verification — invalid signature rejected | Payment webhook security |
| Staff role — no RLS policies grant staff access | Staff deferred to later phase |
| Token rotation — atomic transaction, old token revoked, new token active | Rotation integrity |
| Token rotation rollback — failed rotation preserves prior valid token | Transaction safety |
| Date boundary — expiry on Feb 29, month-end (Jan 31 + 1 month = Feb 28/29) | Expiry calculation consistency |
| Subscription bypass — user cannot modify own subscription status | Billing access control |
| First webhook creation — subscription_id nullable allows initial creation | Webhook processing order |
| Manufacturer claim URL — rejects `javascript:`, `data:`, non-HTTP schemes | URL validation |
| Document archival — file access revoked but file retained | Archive workflow |

### 11.3 End-to-End Tests (Playwright)

| Test | Requirement |
|------|-------------|
| Sign-up → create warranty → verify via public page | Core product flow |
| Login as store A, access store B's warranty → blocked | Authorization boundary |
| Anonymous user navigates to `/` → redirected to `/login` | Protected route enforcement |
| Search warranties by customer name, product, date | Search functionality |
| Print warranty card and QR sticker render | Print layout |
| Subscription expired → warranty creation blocked | Billing gate |
| Document upload → preview → archive | Document management |
| Multi-store: create second store, switch between stores, verify isolation | Multi-store MVP feature |
| Store creation → owner membership auto-created | Store membership trigger |

### 11.4 Test Fixtures

- Two test stores with different owners (same account can have multiple stores).
- Warranty cards: active, expired, revoked, archived, missing manufacturer data, edge-case dates (Feb 29, month boundaries).
- Pre-generated token hashes in `private.warranty_tokens` for Edge Function tests.
- Mock subscription in various states (provider-agnostic).
- Mock webhook payloads with valid and invalid signatures.

### 11.5 Test Environment Requirements

| Test Category | Required Environment |
|---------------|----------------------|
| Unit tests (Vitest) | Node.js + jsdom; no external services needed |
| RLS integration tests | Real PostgreSQL or Supabase local CLI with RLS enabled; authenticated test users with JWTs |
| Storage integration tests | Supabase Storage with test bucket; authenticated test users |
| Edge Function integration tests | Supabase Edge Function runtime; service-role key; Upstash Redis (or dev fallback) |
| E2E tests (Playwright) | Full application stack; Supabase project; test auth accounts; test domain |

**Important:** Unit tests with MSW mocks alone do NOT prove real PostgreSQL RLS enforcement. RLS policies must be validated against a real PostgreSQL instance with actual JWTs and RLS enabled.

---

## 12. Security Risks and Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | **Authorization bypass via forged UUID** | Critical | RLS scopes all queries to `store_id IN (SELECT public.get_user_owner_store_ids())`. Forge attempt returns empty set. Planned integration test — requires real PostgreSQL with RLS enabled. |
| 2 | **Service-role key leakage** | Critical | Key only in Edge Function secrets. Never in VITE_ vars, client code, Git, or logs. CI check prevents commit. |
| 3 | **Token enumeration / brute force** | High | 256-bit random token. Rate limiting (Upstash). SHA-256 hash stored in `private.warranty_tokens`. |
| 4 | **Anonymous access to private tables** | High | RLS enabled, no anon policies on any private table. Only Edge Function (service-role) reads `private.warranty_tokens`. |
| 5 | **PII leakage via Edge Function** | High | Strict allowlist of response fields. Planned integration test asserts no PII fields in response. |
| 6 | **XSS via customer name / product name** | Medium | React escapes by default. No `dangerouslySetInnerHTML`. Sanitize all rendered user input. |
| 7 | **Audit log tampering** | Medium | `audit_events` has no SELECT/UPDATE/DELETE policies. Written only via SECURITY DEFINER trigger with `search_path = ''` and schema-qualified objects. Only allowlisted non-sensitive fields recorded. |
| 8 | **QR code phishing** | Medium | Verify page shows store name and domain. Token is single-purpose (read-only). Disclaimer clarifies warranty info is seller-entered and unverified. |
| 9 | **Date manipulation** | Medium | Expiry computed server-side (Edge Function) from `purchase_date`. Both client and server use same logic. Boundary date tests. |
| 10 | **Document upload abuse** | Medium | MIME type allowlist, max file size (10 MB — proposal), path traversal prevention, signed URLs with expiry, composite FK prevents cross-store attachment. |
| 11 | **Payment webhook spoofing** | Medium | Webhook signature verification using provider-specific secret. Reject invalid signatures. Duplicate events prevented via unique `provider_event_id`. |
| 12 | **Subscription bypass** | High | `SubscriptionGate` component + server-side check before warranty creation. Never trust client alone. Users cannot modify their own subscription status. |
| 13 | **Rate limiting bypass** | Low | Upstash shared rate limiting (not in-memory). Per-IP tracking. |
| 14 | **Hard deletion of warranty history** | Medium | `DELETE` RLS policy returns `false` on `warranty_cards`. No `ON DELETE CASCADE` on documents. Archive workflow instead. |
| 15 | **Privilege escalation (owner role)** | High | `store_members_insert` policy only allows `role = 'staff'`. Owner memberships created exclusively by `handle_new_store()` trigger (service-role). |
| 16 | **Cross-store document attachment** | High | Composite FK `warranty_documents(store_id, warranty_card_id)` → `warranty_cards(store_id, id)` prevents attachment to cards from different stores. |
| 17 | **SECURITY DEFINER abuse** | Critical | All SECURITY DEFINER functions use `search_path = ''`, schema-qualified objects, and `EXECUTE` restricted to `service_role` only. |

---

## 13. Implementation Phases

### Phase 1 — Project Foundation
- **Files:** `package.json`, `vite.config.ts`, `.env.example`, `src/lib/env.ts`, `src/api/supabase.ts`, `src/main.tsx`, `src/App.tsx`, `src/styles/global.css`
- **Deliverables:** Supabase client, router, base layout, env validation, lint+build green
- **Tests:** Env var validation unit test
- **Prerequisites:** Supabase project created

### Phase 2 — Database Schema + RLS
- **Files:** `supabase/migrations/001_init.sql` (all tables + composite FKs + RLS + triggers + store creation trigger)
- **Deliverables:** All tables, RLS policies, composite FKs, audit trigger, store creation trigger, private schema for tokens
- **Tests:** Integration — cross-store isolation, anon access denial, composite FK enforcement, store creation trigger
- **Prerequisites:** Phase 1

### Phase 3 — Auth
- **Files:** `src/features/auth/`, `src/components/ProtectedRoute.tsx`, `src/context/AuthContext.tsx`
- **Deliverables:** Login/signup, auth context, protected routes
- **Tests:** E2E — redirect, login, signup
- **Prerequisites:** Phase 2

### Phase 4 — Dashboard + Multi-Store UI
- **Files:** `src/features/dashboard/`, `src/components/StoreSelector.tsx`
- **Deliverables:** Total products, active warranties, expired warranties, store selector for multi-store
- **Tests:** Unit test for count queries, E2E for store switching
- **Prerequisites:** Phase 3

### Phase 5 — Warranty CRUD + Search
- **Files:** `src/features/warranty/`, `src/components/WarrantyForm.tsx`, zod schemas
- **Deliverables:** Create/edit/list/search, validation, serial uniqueness (when provided)
- **Tests:** Form validation unit tests, CRUD integration tests
- **Prerequisites:** Phase 4

### Phase 6 — QR Generation + Print
- **Files:** `src/components/QrCodeDisplay.tsx`, `PrintCardPage`, `PrintQrPage`, print CSS
- **Deliverables:** QR per warranty, printable card, QR sticker
- **Tests:** E2E — print page renders, QR payload correct
- **Prerequisites:** Phase 5

### Phase 7 — Public Verification (Edge Function)
- **Files:** `supabase/functions/verify-warranty/index.ts`, `src/features/verify/VerifyPage.tsx`
- **Deliverables:** Edge Function with Upstash rate limiting, verify page, allowlisted response, POST-based token delivery
- **Tests:** Integration — valid token, tampered token, revoked (404), expired, anon field assertion, rate limit
- **Prerequisites:** Phase 2, Phase 5

### Phase 8 — Document Uploads
- **Files:** `supabase/functions/document-upload/index.ts`, `src/features/documents/`
- **Deliverables:** Upload via signed URL, document list, preview, delete, composite FK enforcement
- **Tests:** Integration — ownership validation, MIME type validation, cross-store attachment prevention
- **Prerequisites:** Phase 5

### Phase 9 — Subscriptions and Billing
- **Files:** `src/features/subscription/`, `src/components/SubscriptionGate.tsx`, `supabase/functions/payment-webhook/index.ts`, `supabase/functions/payment-checkout/index.ts`
- **Deliverables:** Provider checkout, webhook handler with idempotency, subscription gate, trial period, payment_transactions + billing_events
- **Tests:** Integration — webhook signature verification, duplicate event handling, subscription status transitions
- **Prerequisites:** Phase 3, payment provider selected and account created

### Phase 10 — i18n
- **Files:** `src/i18n/uz.json`, `src/i18n/ru.json`, `src/i18n/index.ts`
- **Deliverables:** String extraction, language switcher, Uzbek default
- **Tests:** Snapshot tests
- **Prerequisites:** Phase 9

### Phase 11 — Polish
- **Files:** Error boundaries, loading/empty states, responsive, accessibility
- **Deliverables:** Production-ready UX
- **Tests:** E2E regression
- **Prerequisites:** Phase 10

---

## 14. Open Questions

All items below are **proposals** pending explicit owner confirmation. Items marked as [CONFIRMED] are settled.

1. **[CONFIRMED] Multi-store:** Multiple stores per account supported from initial schema. Multi-store UI included in MVP.

2. **[CONFIRMED] Serial number:** Optional — not all devices have readable serials.

3. **[CONFIRMED] Purchase date:** Public on verification page.

4. **[CONFIRMED] Manufacturer warranty documents:** Private uploads in scope for MVP.

5. **[CONFIRMED] Automatic monthly billing:** In scope for MVP. Provider selection pending evaluation.

6. **QR code generation:** Client-side (`qrcode` npm) or server-side image API? Client-side is simpler and works offline.

7. **Manufacturer warranty:** Any manufacturer verification API in scope, or always show unverified disclaimer?

8. **Token delivery:** Beyond QR printing, need "copy link" / "send via SMS" in MVP?

9. **Email confirmation:** Enable Supabase email confirmation or skip for MVP speed?

10. **Domain + deployment:** What domain for QR payload URLs and CORS?

11. **Payment provider:** Evaluate Payme Business Subscribe API, Click, Humo, and confirm Stripe availability for Uzbekistan-registered businesses. Provider selection required before Phase 9.

12. **Subscription pricing:** Monthly price point? Trial duration (14 days proposed)?

13. **Document upload scope:** MIME types and 10 MB limit are proposals. Confirm allowed file types and size.

14. **Product archival:** Products with existing warranty cards cannot be deleted (`ON DELETE RESTRICT`). Acceptable, or need archive functionality for products?

15. **Store members — staff role:** Schema supports `staff` role but no RLS policies grant staff access in MVP. Confirm staff UI is deferred to a later phase.

16. **Warranty card limits:** "Unlimited" warranty cards on paid plan is a proposal. Confirm actual limits per plan tier.

---

## Appendix A — First Files Changed After Implementation Approval

1. `package.json` — add dependencies
2. `.env.example` — Vite public vars only
3. `supabase/functions/.env.example` — Edge Function secrets
4. `vite.config.ts` — env validation
5. `src/lib/env.ts` — typed env access
6. `src/api/supabase.ts` — Supabase client
7. `src/main.tsx` — router setup
8. `src/App.tsx` — route definitions
9. `supabase/migrations/001_init.sql` — all tables + composite FKs + RLS + triggers + private schema

---

*End of document.*
