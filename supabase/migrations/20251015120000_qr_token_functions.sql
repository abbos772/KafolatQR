-- =============================================================================
-- KafolatQR — QR Token Functions (Phase 5/7)
--
-- These are SECURITY DEFINER functions that operate on private.warranty_tokens.
-- They are called by Supabase Edge Functions with the service-role key.
-- Raw tokens are NEVER stored — only SHA-256 hashes.
-- =============================================================================

-- Pin search_path for security
SET search_path = public, private;

-- -----------------------------------------------------------------------------
-- verify_warranty_ownership: Checks if the caller owns the warranty card's store.
-- Used by Edge Functions before token operations.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_warranty_ownership(
  p_warranty_card_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.warranty_cards wc
    JOIN public.stores s ON s.id = wc.store_id
    JOIN public.store_members sm ON sm.store_id = s.id
    WHERE wc.id = p_warranty_card_id
      AND sm.user_id = auth.uid()
      AND sm.role = 'owner'
  );
END;
$$;

ALTER FUNCTION public.verify_warranty_ownership(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.verify_warranty_ownership(uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_warranty_ownership(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- issue_warranty_token: Stores a token hash for a warranty card.
-- Called by the generate-qr Edge Function after verifying ownership.
-- The Edge Function generates the raw token; we only store its hash.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_warranty_token(
  p_warranty_card_id uuid,
  p_token_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Verify the caller owns the store that owns this warranty card
  IF NOT EXISTS (
    SELECT 1
    FROM public.warranty_cards wc
    JOIN public.stores s ON s.id = wc.store_id
    JOIN public.store_members sm ON sm.store_id = s.id
    WHERE wc.id = p_warranty_card_id
      AND sm.user_id = auth.uid()
      AND sm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: warranty card not owned by caller';
  END IF;

  -- Validate token hash format (64-char lowercase hex = SHA-256)
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid token hash format';
  END IF;

  -- Deactivate any existing active token for this card
  UPDATE private.warranty_tokens
  SET is_active = false, rotated_at = now()
  WHERE warranty_card_id = p_warranty_card_id AND is_active = true;

  -- Insert the new token hash
  INSERT INTO private.warranty_tokens (warranty_card_id, token_hash, is_active)
  VALUES (p_warranty_card_id, p_token_hash, true);
END;
$$;

ALTER FUNCTION public.issue_warranty_token(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.issue_warranty_token(uuid, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_warranty_token(uuid, text) TO service_role;

-- -----------------------------------------------------------------------------
-- revoke_warranty_token: Deactivates the active token for a warranty card.
-- Called by the revoke-qr Edge Function after verifying ownership.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_warranty_token(
  p_warranty_card_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1
    FROM public.warranty_cards wc
    JOIN public.stores s ON s.id = wc.store_id
    JOIN public.store_members sm ON sm.store_id = s.id
    WHERE wc.id = p_warranty_card_id
      AND sm.user_id = auth.uid()
      AND sm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: warranty card not owned by caller';
  END IF;

  -- Deactivate the active token
  UPDATE private.warranty_tokens
  SET is_active = false, rotated_at = now()
  WHERE warranty_card_id = p_warranty_card_id AND is_active = true;
END;
$$;

ALTER FUNCTION public.revoke_warranty_token(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.revoke_warranty_token(uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_warranty_token(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- verify_warranty_by_hash: Public verification lookup.
-- Returns ONLY explicitly allowlisted fields. Never exposes:
--   - internal IDs (warranty_card_id, store_id, product_id)
--   - customer PII (name, phone, email)
--   - serial numbers
--   - token hashes
--   - private notes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_warranty_by_hash(
  p_token_hash text
)
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
    CASE
      WHEN current_date <= (wc.purchase_date + (wc.store_warranty_months || ' months')::interval)::date
      THEN 'active'
      ELSE 'expired'
    END,
    CASE
      WHEN wc.manufacturer_warranty_months IS NULL OR wc.manufacturer_warranty_start IS NULL
      THEN 'not_known'
      WHEN current_date <= (wc.manufacturer_warranty_start + (wc.manufacturer_warranty_months || ' months')::interval)::date
      THEN 'active'
      ELSE 'expired'
    END,
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

-- -----------------------------------------------------------------------------
-- get_warranty_token_status: Check if a warranty card has an active token.
-- Used by the frontend to show QR status without exposing the token.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_warranty_token_status(
  p_warranty_card_id uuid
)
RETURNS TABLE (
  has_active_token boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1
    FROM public.warranty_cards wc
    JOIN public.stores s ON s.id = wc.store_id
    JOIN public.store_members sm ON sm.store_id = s.id
    WHERE wc.id = p_warranty_card_id
      AND sm.user_id = auth.uid()
      AND sm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: warranty card not owned by caller';
  END IF;

  RETURN QUERY
  SELECT EXISTS (
    SELECT 1 FROM private.warranty_tokens
    WHERE warranty_card_id = p_warranty_card_id AND is_active = true
  );
END;
$$;

ALTER FUNCTION public.get_warranty_token_status(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.get_warranty_token_status(uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_warranty_token_status(uuid) TO service_role;
