BEGIN;

SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"8ff500d0-76d1-48a4-a1be-fd75c56a546f","role":"authenticated"}',
  true
);

SELECT
  current_user AS database_role,
  auth.uid() AS simulated_user_id;

INSERT INTO public.stores (owner_id, name)
VALUES (
  '8ff500d0-76d1-48a4-a1be-fd75c56a546f',
  'RLS diagnostic test'
)
RETURNING id, owner_id, name;

ROLLBACK;