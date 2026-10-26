BEGIN;

SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claim.sub',
  '8ff500d0-76d1-48a4-a1be-fd75c56a546f',
  true
);

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"8ff500d0-76d1-48a4-a1be-fd75c56a546f","role":"authenticated"}',
  true
);

INSERT INTO public.stores (owner_id, name)
VALUES (auth.uid(), 'RLS diagnostic test')
RETURNING
  id,
  owner_id,
  owner_id = auth.uid() AS owner_matches;

ROLLBACK;