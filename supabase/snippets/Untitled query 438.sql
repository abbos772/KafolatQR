BEGIN;

SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claim.sub',
  '2a877c86-0df7-4e48-af7a-f5af2f7914f9',
  true
);

SELECT set_config(
  'request.jwt.claim.role',
  'authenticated',
  true
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"2a877c86-0df7-4e48-af7a-f5af2f7914f9","role":"authenticated"}',
  true
);

INSERT INTO public.stores (owner_id, name)
VALUES (
  '2a877c86-0df7-4e48-af7a-f5af2f7914f9',
  'Store A'
)
RETURNING id, owner_id, name;
COMMIT;