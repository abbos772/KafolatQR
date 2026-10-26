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

SELECT
  current_user AS database_role,
  auth.uid() AS database_user_id,
  auth.uid() = '8ff500d0-76d1-48a4-a1be-fd75c56a546f'::uuid
    AS user_id_matches,
  has_table_privilege(
    'authenticated',
    'public.stores',
    'INSERT'
  ) AS can_insert_store;

ROLLBACK;