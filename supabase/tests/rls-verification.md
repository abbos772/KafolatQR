# RLS Verification Checklist — Phase 2

**Status:** PARTIALLY EXECUTED locally. **No result is recorded as PASS.**

A local Supabase stack has been started and the migration applied, and six SQL
scripts preserved under `supabase/snippets/` show that a subset of these checks was
run from Supabase Studio. However:

- **No output was captured.** The snippets are the scripts, not the results. Whether
  each one raised the expected `PASS` NOTICE is not recorded anywhere in the repo.
- Therefore **zero checks may be marked as passed.** They are recorded below as
  `executed — result unrecorded`, which is a different thing from passing.
- Everything not covered by a snippet is `not run`.
- The migration is applied to the **local development stack only**. No production
  database has been contacted.

Run these checks against a **local Supabase stack or a throw-away scratch project**.
Never run them against production data.

---

## 1. Prerequisites

1. A Supabase project you are allowed to destroy (local `supabase start`, or a scratch cloud project).
2. `supabase/migrations/20251014120000_initial_schema.sql` applied **as `postgres`**:
   ```bash
   supabase db reset          # local stack: drops and re-applies migrations
   # or, once, on a scratch project:
   # supabase db push
   ```
3. Two test users that own nothing yet (see §2).

---

## 2. Test setup

### 2.1 Credentials (never committed)

Get them from the running local stack:

```bash
supabase status          # prints API URL, anon key, service_role key
```

Use them only as shell placeholders for this session. No real secret belongs in this
file, in Git, or in any `VITE_` variable.

```bash
export API_URL=http://127.0.0.1:54321          # from `supabase status`
export SERVICE_KEY=<paste-local-service_role-key>   # LOCAL ONLY; never committed
```

### 2.2 Create the two test users via the Auth Admin API

Direct `INSERT INTO auth.users` is brittle: recent Supabase releases have NOT NULL
columns (`raw_app_meta_data`, `raw_user_meta_data`, `is_anonymous`, `is_sso_user`,
`email_change`, `recovery_token`, ...) and `auth.identities` expectations, so the
insert usually aborts. Use the Admin API instead — it needs the service-role key,
which is why this is a local-only step.

```bash
curl -sS -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"owner-a@rls.test","password":"test-only-password","email_confirm":true}'

curl -sS -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"owner-b@rls.test","password":"test-only-password","email_confirm":true}'
```

Record the two returned user `id` values. If you must seed from SQL, list every NOT
NULL column for your exact Supabase version and insert into `auth.identities` as well.

### 2.3 Create Store A and Store B

Run as each authenticated owner, so the `on_store_created` trigger fires and the
`stores_insert` `WITH CHECK (owner_id = auth.uid())` policy can pass:

```sql
BEGIN;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '<owner-a id>',
                    'role', 'authenticated')::text, true);
INSERT INTO public.stores (owner_id, name) VALUES ('<owner-a id>', 'Store A');
COMMIT;

BEGIN;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '<owner-b id>',
                    'role', 'authenticated')::text, true);
INSERT INTO public.stores (owner_id, name) VALUES ('<owner-b id>', 'Store B');
COMMIT;
```

Snippet to run any check "as" a user:

```sql
BEGIN;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '<owner-a id>',
                    'role', 'authenticated')::text, true);
-- ... put the tested statement here ...
ROLLBACK;
```

Snippet to run any check as anonymous:

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
-- ... put the tested statement here ...
ROLLBACK;
```

---

## 3. Checks

Legend: **Expected** = result that means the design is correct.

### S — Schema state (run as `postgres`)

| ID | Check | Expected |
|----|-------|----------|
| S1 | `SELECT tablename FROM pg_tables WHERE schemaname IN ('public','private') ORDER BY 1;` | All 10 tables present, including `warranty_tokens` inside schema `private` |
| S2 | `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('stores','store_members','products','warranty_cards','warranty_documents','subscription','payment_transactions','billing_events','audit_events','warranty_tokens');` | `relrowsecurity = true` for every table |
| S3 | `SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.warranty_cards'::regclass;` | `warranty_cards_product_same_store` (composite FK, type `f`) |
| S4 | Same query on `public.warranty_documents` | `warranty_documents_store_match_card` present |
| S4b | `SELECT confdeltype FROM pg_constraint WHERE conname = 'warranty_tokens_warranty_card_id_fkey';` | `R` = `ON DELETE RESTRICT` (not `C`/cascade) |
| S5 | `SELECT schemaname, indexname FROM pg_indexes WHERE tablename='warranty_tokens';` | Partial unique index named `warranty_tokens_one_active` in schema `private` |
| S5b | `SELECT indexdef FROM pg_indexes WHERE schemaname='private' AND indexname='warranty_tokens_one_active';` | Partial unique index `... (warranty_card_id) WHERE is_active` |
| S6 | `SELECT conname FROM pg_constraint WHERE conrelid='public.payment_transactions'::regclass AND contype='u';` | Unique on `(provider, provider_payment_id)` |
| S7 | `SELECT conname FROM pg_constraint WHERE conrelid='public.billing_events'::regclass AND contype='u';` | Unique on `(provider, provider_event_id)` |
| S8 | `SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('handle_new_store','audit_log','set_updated_at','get_user_owner_store_ids');` | `prosecdef = true` for all four (`SECURITY DEFINER`) |
| S9 | `SELECT proname, pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname IN ('handle_new_store','audit_log','set_updated_at','get_user_owner_store_ids');` | `owner = postgres` for all four |
| S10 | `SELECT DISTINCT grantee FROM aclexplode((SELECT proacl FROM pg_proc WHERE proname='handle_new_store'));` | No `authenticated` and no `PUBLIC` entry for EXECUTE (the empty/default ACL also passes) |
| S11 | `SELECT DISTINCT grantee FROM aclexplode((SELECT proacl FROM pg_proc WHERE proname='audit_log'));` | No `authenticated` and no `PUBLIC` entry for EXECUTE |
| S11b | `SELECT DISTINCT grantee FROM aclexplode((SELECT proacl FROM pg_proc WHERE proname='get_user_owner_store_ids'));` | `authenticated` IS present (intentional: policies must call it), and no `PUBLIC` entry |
| S12 | `SELECT has_table_privilege('authenticated','public.warranty_cards','TRUNCATE') AS anon_truncate;` | `false` — RLS does not cover TRUNCATE, only the missing GRANT blocks it |
| S13 | `SELECT has_table_privilege('authenticated','public.warranty_cards','REFERENCES'), has_table_privilege('authenticated','public.warranty_cards','TRIGGER');` | `false`, `false` |
| S14 | `SELECT has_table_privilege('anon','public.warranty_cards','SELECT'), has_table_privilege('anon','public.warranty_cards','TRUNCATE');` | `false`, `false` |
| S15 | `SELECT proname, pg_get_functiondef(oid) FROM pg_proc WHERE proname='audit_log';` | Body contains `RAISE EXCEPTION` for unexpected `TG_OP` and no trailing `RETURN NULL` |

### A — Owner access (run as `owner-a@rls.test`)

| ID | Check | Expected |
|----|-------|----------|
| A1 | `SELECT id, name FROM public.stores;` | Returns Store A only |
| A2 | `SELECT id FROM public.products WHERE store_id = <store A>;` | Empty is fine; no error (owner may read own) |
| A3 | `UPDATE public.stores SET name='Store A renamed' WHERE id = <store A>;` | 1 row updated |
| A4 | `SELECT id FROM public.subscription WHERE store_id = <store A>;` | No error (read-only, no rows yet) |

### C — Cross-store isolation (run as `owner-a@rls.test`)

| ID | Check | Expected |
|----|-------|----------|
| C1 | `SELECT id FROM public.stores WHERE id = <store B>;` | 0 rows |
| C2 | `UPDATE public.stores SET name='hacked' WHERE id = <store B>;` | 0 rows updated |
| C3 | Insert a product for Store A, then run as owner-a: <br>`INSERT INTO public.warranty_cards (store_id, product_id, purchase_date, store_warranty_months) VALUES (<store B id>, <product of store A>, current_date, 12);` | **Error** — composite FK `warranty_cards_product_same_store` violated |
| C4 | `INSERT INTO public.store_members (store_id, user_id, role) VALUES (<store B id>, <owner-a id>, 'staff');` | **Error** — RLS policy `store_members_insert` denied |
| C5 | With a card + document row created for Store A, run as owner-b: <br>`SELECT count(*) FROM public.warranty_documents;` | Counts only Store B rows (0 for A's document) |
| C6 | `DELETE FROM public.warranty_cards WHERE id = <card owned by A>;` (run as owner-a) | **Error** — `permission denied for table warranty_cards` (no DELETE *grant*); the RLS `warranty_cards_no_delete` policy is a second, independent layer |
| C7 | Traversal by ID only, e.g. `SELECT * FROM public.warranty_cards WHERE id = '<some other store card id>';` | 0 rows |

### N — Anonymous access (run as `anon`, no JWT claims)

| ID | Check | Expected |
|----|-------|----------|
| N1 | `SELECT * FROM public.stores;` | 0 rows |
| N2 | `SELECT * FROM public.products;` | 0 rows |
| N3 | `SELECT * FROM public.warranty_cards;` | 0 rows |
| N4 | `SELECT * FROM public.warranty_documents;` | 0 rows |
| N5 | `SELECT * FROM public.subscription;` | 0 rows |
| N6 | `SELECT * FROM public.payment_transactions;` | **Error** — permission denied (no grants at all) |
| N7 | `SELECT * FROM public.billing_events;` | **Error** — permission denied |
| N8 | `SELECT * FROM public.audit_events;` | **Error** — permission denied |
| N9 | `SELECT * FROM private.warranty_tokens;` | **Error** — permission denied for schema/table |
| N10 | `SELECT public.get_user_owner_store_ids();` | 0 rows (function exists but returns nothing without a JWT) |

### F — Composite foreign keys (run as `owner-a@rls.test`)

| ID | Check | Expected |
|----|-------|----------|
| F1 | Insert product P1 for Store A, then `INSERT INTO public.warranty_cards (store_id, product_id, purchase_date, store_warranty_months) VALUES (<store B id>, <P1 id>, current_date, 12);` | **Error** — `warranty_cards_product_same_store` |
| F2 | After a valid card exists for Store A: `INSERT INTO public.warranty_documents (warranty_card_id, store_id, file_name, storage_path, mime_type, size_bytes) VALUES (<card A id>, <store B id>, 'x.pdf', '<store B id>/x.pdf', 'application/pdf', 100);` | **Error** — `warranty_documents_store_match_card` |
| F3 | `INSERT INTO public.warranty_documents (warranty_card_id, store_id, file_name, storage_path, mime_type, size_bytes) VALUES (<card A id>, <store A id>, 'x.pdf', '<store B id>/x.pdf', 'application/pdf', 100);` | **Error** — `storage_path` CHECK (path must begin with this row's own `store_id`) |
| F3b | Same but path `'<store A id>/<card B id>/<uuid>/x.pdf'` | **Error** — `storage_path` CHECK (second segment must equal this row's own `warranty_card_id`) |
| F3c | Same but path `'<store A id>/<card A id>/x.pdf'` (no uuid segment) | **Error** — `storage_path` CHECK (third segment must be a UUID) |
| F3d | Same but path `'<store A id>/<card A id>/<uuid>/'` (empty filename) | **Error** — `storage_path` CHECK (filename segment must be non-empty) |
| F3e | Same but path `'<store A id>/<card A id>/<uuid>/sub/dir/x.pdf'` (extra segments) | **Error** — `storage_path` CHECK (no extra path segments allowed) |
| F3f | Correct path `'<store A id>/<card A id>/<uuid>/x.pdf'` | 1 row inserted (the documented upload flow's shape) |
| F4 | `INSERT INTO public.warranty_documents (..., mime_type='application/zip', ...);` | **Error** — MIME allowlist CHECK |
| F5 | `INSERT INTO public.warranty_documents (..., size_bytes=99999999, ...);` | **Error** — size CHECK |
| F6 | `INSERT INTO public.products (store_id, sku, name) VALUES (<store A id>, 'DUP', 'X');` twice | Second insert **errors** — `UNIQUE(store_id, sku)` |
| F7 | `DELETE FROM public.products WHERE id = <P1 with warranty history>;` | **Error** — `ON DELETE RESTRICT` on `warranty_cards.product_id` |

### M — Membership integrity (run as `owner-a@rls.test`)

| ID | Check | Expected |
|----|-------|----------|
| M1 | `INSERT INTO public.stores (owner_id, name) VALUES (<owner-a id>, 'A #2');` then `SELECT store_id, role FROM public.store_members WHERE store_id = (SELECT id FROM stores WHERE name='A #2');` | Exactly one row, `role = 'owner'` (created by trigger, not by the client) |
| M2 | `SELECT count(*) FROM public.store_members WHERE role='owner' AND store_id = <store A>;` after M1 and original store | Exactly 1 per store |
| M3 | `INSERT INTO public.store_members (store_id, user_id, role) VALUES (<store A id>, <owner-b id>, 'owner');` | **Error** — RLS policy requires `role = 'staff'` |
| M4 | `INSERT INTO public.store_members (store_id, user_id, role) VALUES (<store A id>, <owner-a id>, 'owner');` | **Error** — same policy (self-escalation blocked) |
| M5 | `UPDATE public.store_members SET role='owner' WHERE store_id = <store A>;` | **Error** — `permission denied for table store_members` (no UPDATE *grant*). No UPDATE policy exists either; either layer alone is sufficient |
| M6 | `DELETE FROM public.store_members WHERE store_id = <store A> AND role = 'owner';` | 0 rows deleted — the DELETE *grant* exists, but the `store_members_delete` RLS policy requires `role = 'staff'`, so owner rows are not visible to the DELETE |
| M7 | `INSERT INTO public.store_members (store_id, user_id, role) VALUES (<store A id>, <owner-b id>, 'staff');` then `DELETE` the same row | Insert allowed (owner adds staff), delete allowed (staff removable) |
| M8 | After M7, run as `owner-b` and query Store A data | 0 rows (staff grants nothing in this phase) |

### O — Ownership escalation (run as `owner-a@rls.test`)

| ID | Check | Expected |
|----|-------|----------|
| O1 | `UPDATE public.stores SET owner_id = <owner-b id> WHERE id = <store A>;` | **Error** — `stores_update` WITH CHECK requires `owner_id = auth.uid()` |
| O2 | `UPDATE public.stores SET owner_id = <owner-b id>, is_archived = true WHERE id = <store A>;` | **Error** — `stores_archive` WITH CHECK also requires `owner_id = auth.uid()` (PostgreSQL OR-ing of the two permissive UPDATE policies cannot bypass this) |
| O3 | `UPDATE public.stores SET is_archived = true WHERE id = <store A>;` | 1 row updated (archival is allowed for the owner) |
| O4 | `UPDATE public.stores SET is_archived = false WHERE id = <store A>;` (restore) | 1 row updated, still owned by owner-a |
| O5 | `INSERT INTO public.stores (owner_id, name) VALUES (<owner-b id>, 'fake');` | **Error** — `stores_insert` WITH CHECK requires `owner_id = auth.uid()` |

### T — Tokens, subscriptions, billing (run as `owner-a@rls.test`)

| ID | Check | Expected |
|----|-------|----------|
| T1 | `SELECT * FROM private.warranty_tokens;` | **Error** — permission denied (schema/table not granted) |
| T2 | `INSERT INTO private.warranty_tokens (warranty_card_id, token_hash) VALUES (<card A id>, repeat('a',64));` | **Error** — permission denied |
| T3 | Call a not-yet-existing RPC, e.g. `SELECT public.verify_warranty_by_hash(repeat('a',64));` | **Error** — function does not exist yet (expected until Phase 5/7) |
| T4 | `INSERT INTO public.payment_transactions (store_id, subscription_id, provider, provider_payment_id, amount_minor_units, currency, status) VALUES (...);` | **Error** — `permission denied for table payment_transactions` (no INSERT grant for authenticated) |
| T5 | As `owner-a`, after inserting a subscription row as `postgres`: <br>`UPDATE public.subscription SET status='active' WHERE store_id = <store A>;` | **Error** — `permission denied for table subscription` (no UPDATE grant); the RLS SELECT-only policy is a second layer |
| T6 | As `owner-a`: <br>`TRUNCATE public.warranty_cards;` | **Error** — `permission denied for table warranty_cards`. Proves the point that RLS does **not** cover TRUNCATE: only the missing GRANT blocks this |

### D — Warranty constraints (run as `owner-a@rls.test`)

| ID | Check | Expected |
|----|-------|----------|
| D1 | `INSERT INTO public.warranty_cards (store_id, product_id, purchase_date, store_warranty_months) VALUES (<store A>, <P1>, (current_date + 1), 12);` | **Error** — `purchase_date <= current_date` CHECK |
| D2 | Same with `store_warranty_months = 0` | **Error** — positive-months CHECK |
| D3 | Same with `status = 'deleted'` | **Error** — status CHECK |
| D4 | Same with `manufacturer_claim_url = 'javascript:alert(1)'` | **Error** — https-only CHECK |
| D5 | Valid minimal insert (serial, customer fields all NULL) | 1 row inserted (minimum data still works) |

### AU — Audit trail (run as `owner-a@rls.test`)

| ID | Check | Expected |
|----|-------|----------|
| AU1 | Insert a valid card, then as `postgres`: `SELECT action, changed_fields FROM public.audit_events ORDER BY created_at DESC LIMIT 1;` | One row, `action='insert'`, allowlist only |
| AU2 | Inspect the `changed_fields` JSON of that row | Contains `status`, `is_qr_visible`, `purchase_date`, `store_warranty_months`, `manufacturer_*`; **no** `serial_number`, `customer_name`, `customer_phone`, `customer_email`, `notes`, `token_hash` |
| AU3 | Insert card with `serial_number='SN-SECRET'`, `customer_email='pii@example.com'`, `notes='confidential'` | `changed_fields` must **not** contain any of those three values anywhere |
| AU4 | `UPDATE` the card changing only `notes` | `SELECT count(*) FROM public.audit_events WHERE entity_id = <card> AND action='update';` → 0 (no misleading audit noise) |
| AU5 | `UPDATE` the card changing only `status` | Exactly 1 audit row, `changed_fields` = `{"status":{"old":..,"new":..}}` |
| AU6 | `UPDATE` card `manufacturer_claim_url` to another https URL | 1 audit row; the JSON contains `{"changed": true}` and **not** the URL strings |
| AU7 | `SELECT * FROM public.audit_events;` as authenticated | **Error** — permission denied (readable only as postgres) |

---

## 3A. Execution status (what has actually been run)

Evidence = the SQL scripts saved by Supabase Studio under `supabase/snippets/`.

| Check(s) | What the script does | Status | Evidence |
|---|---|---|---|
| C3, F1 | Asserts `warranty_cards_product_same_store` rejects a warranty card whose product belongs to another store (expects `foreign_key_violation`) | **executed — result unrecorded** | snippets 362, 500 |
| M1 (partial) | Inserts a store **as `authenticated`** with simulated JWT claims, so the `stores_insert` WITH CHECK and the `on_store_created` trigger both fire | **executed — result unrecorded** | snippet 438 |
| (setup sanity) | Confirms `auth.uid()` / `auth.role()` resolve under the simulated JWT claims | **executed — result unrecorded** | snippet 692 |
| M2, T3 | Counts owner memberships per store where `user_id = owner_id`, and asserts `verify_warranty_by_hash` is **not** created yet (expected until Phase 5/7) | **executed — result unrecorded** | snippet 773 |
| T4 | Asserts `authenticated` cannot INSERT into `payment_transactions` (expects `insufficient_privilege`) | **executed — result unrecorded** | snippet 994 |

**Everything else is NOT RUN:** S1–S2, S4–S15, A1–A4, C1, C2, C4–C7, N1–N10,
F2, F3–F3f, F4–F7, M3–M8, O1–O5, T1, T2, T5, T6, D1–D5, AU1–AU7.

### Why these are not marked passed

Each script raises a `PASS` NOTICE only if the expected exception fires, so a *silent*
success would have printed nothing and looked like a pass. Without the captured
NOTICE output, "the script exists" is not evidence that the guard held. Re-run each
one and paste the NOTICE/pgAdmin-visible output into the table below.

### To turn them into recorded results

Run in Supabase Studio SQL editor against the **local** stack, then paste the output:

```sql
-- M1 + M2 (rerun; snippet 438 + 773 combined)
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"2a877c86-0df7-4e48-af7a-f5af2f7914f9","role":"authenticated"}', true);
INSERT INTO public.stores (owner_id, name)
VALUES ('2a877c86-0df7-4e48-af7a-f5af2f7914f9', 'Store A (rerun)')
RETURNING id AS store_id, owner_id, name;
COMMIT;

-- then, as postgres, confirm exactly one owner membership for that store:
-- SELECT store_id, role, user_id FROM public.store_members
--  WHERE store_id = '<id returned above>';
```

| Check | Date | Recorded NOTICE / output | Recorded by | Verdict |
|---|---|---|---|---|
| C3 / F1 | | | | ☐ pass ☐ fail |
| M1 | | | | ☐ pass ☐ fail |
| M2 | | | | ☐ pass ☐ fail |
| T3 | | | | ☐ pass ☐ fail |
| T4 | | | | ☐ pass ☐ fail |

### Local fixtures observed in the snippets

Recorded so the re-runs can reuse the same data (local dev values, not secrets):

- Owner A `auth.users.id` = `2a877c86-0df7-4e48-af7a-f5af2f7914f9`
- Store id used in the cross-store test = `1d583bae-8d53-4124-9c72-b12c409fa0bd`
- Product id used in the cross-store test = `e58de6d1-30f1-419a-8924-c26f0770f2a7`

If the local database is ever rebuilt (`supabase db reset`), these ids change and the
scripts above must be re-derived. This author deliberately does **not** run
`db reset` as part of a verification step.

---

## 4. Result template

**Nothing in this template is set. Every row must stay `not run` until output exists.**

| ID | Status | Executed by | Date | Evidence |
|----|--------|-------------|------|----------|
| S1–S15 | ☐ not run ☐ pass ☐ fail — (S1–S2, S4–S15 not run) | | | |
| A1–A4 | ☐ not run ☐ pass ☐ fail | | | |
| C1–C7 | ☐ not run ☐ pass ☐ fail — (C3 executed, result unrecorded) | | | |
| N1–N10 | ☐ not run ☐ pass ☐ fail | | | |
| F1–F3f | ☐ not run ☐ pass ☐ fail — (F1 executed, result unrecorded) | | | |
| M1–M8 | ☐ not run ☐ pass ☐ fail — (M1 partial, M2 executed, results unrecorded) | | | |
| O1–O5 | ☐ not run ☐ pass ☐ fail | | | |
| T1–T6 | ☐ not run ☐ pass ☐ fail — (T3, T4 executed, results unrecorded) | | | |
| D1–D5 | ☐ not run ☐ pass ☐ fail | | | |
| AU1–AU7 | ☐ not run ☐ pass ☐ fail | | | |

Set a row to `pass`/`fail` only with a link or pasted output proving it.

---

## 5. Notes for reviewers

- **Evidence location:** the executed scripts live in `supabase/snippets/*.sql`
  (Supabase Studio auto-saves). They are currently **untracked and not gitignored**,
  so `git add -A` would commit them. Decide deliberately: either commit them as
  Phase 2 verification evidence, or add `snippets/` to `supabase/.gitignore` and keep
  evidence outside Git. Do not leave the choice implicit.
- **Local-only execution:** the scripts ran against a local Supabase stack.
  Nothing was run against a production database, and `db reset` was not used as
  part of verification (it would destroy the fixtures the scripts depend on).
- **What is *not* covered here:** token RPCs, `verify_warranty_by_hash`,
  `process_payment_webhook`, Storage policies, and any seeded/demo data —
  these belong to later phases of the approved plan.
- **`private` schema reachability:** the `private` schema is not exposed by
   PostgREST by default, and `20251014120000_initial_schema.sql` additionally grants nothing on it to
  `anon`/`authenticated`. If a future project setting exposes `private` via
  PostgREST, T1/T2 must be re-run.
- **`get_user_owner_store_ids` RPC exposure:** PostgREST exposes `public`
  function as an RPC endpoint for `authenticated`. This is intentional and safe
  (it takes no argument and returns only the caller's own store IDs). Noted in
  the plan as an accepted design point.
- **Expected-by-design permissions note:** two permissive UPDATE policies exist
  on `stores` (`stores_update`, `stores_archive`). Both require
  `owner_id = auth.uid()` in `WITH CHECK`, so their OR-ing cannot enable an
  ownership change (checks O1 and O2).
- **RLS vs. TRUNCATE (checks S12–S14, T6):** PostgreSQL's `CREATE POLICY`
  documentation states that **TRUNCATE is not subject to row-level security**.
  An RLS policy of `USING (false)` therefore does *not* stop TRUNCATE. The
   `REVOKE ALL ... FROM PUBLIC, anon, authenticated` block in `20251014120000_initial_schema.sql`
  is what actually removes that capability, so those checks are the ones that
  must never be dropped.
- **Two-layer expectation:** several checks expect `permission denied` because
  the GRANT is the first gate, with the RLS policy as a second independent
  layer. Both must stay; a single layer is not a defense, it is a single point
  of failure.
