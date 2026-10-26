SELECT
  policyname,
  roles,
  cmd,
  qual AS using_condition,
  with_check AS insert_condition
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'stores'
ORDER BY policyname;