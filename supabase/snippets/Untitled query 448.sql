SELECT
  has_table_privilege(
    'authenticated',
    'public.stores',
    'INSERT'
  ) AS authenticated_can_insert;