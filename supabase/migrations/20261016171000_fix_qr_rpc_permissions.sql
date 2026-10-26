BEGIN;

REVOKE EXECUTE ON FUNCTION public.verify_warranty_ownership(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.verify_warranty_ownership(uuid)
TO authenticated;

REVOKE EXECUTE ON FUNCTION public.issue_warranty_token(uuid, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.issue_warranty_token(uuid, text)
TO authenticated;

REVOKE EXECUTE ON FUNCTION public.revoke_warranty_token(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.revoke_warranty_token(uuid)
TO authenticated;

COMMIT;
