import { getSupabaseClient } from './supabase'
import type { Store } from '../types/db'

/**
 * Store data access.
 *
 * SECURITY: `owner_id` always comes from the authenticated session, never from
 * caller-supplied input. The `stores_insert` RLS policy independently requires
 * `owner_id = auth.uid()`, and the `on_store_created` trigger creates the owner
 * membership server-side. This module must never insert into `store_members`.
 */
export async function listMyStores(): Promise<Store[]> {
  const { data, error } = await getSupabaseClient()
    .from('stores')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}

/**
 * Creates a store owned by the signed-in user.
 *
 * SECURITY: `owner_id` always comes from the authenticated session, never from
 * caller-supplied input. The `stores_insert` RLS policy independently requires
 * `owner_id = auth.uid()`, and the `on_store_created` trigger creates the owner
 * membership server-side. This module must never insert into `store_members`.
 *
 * NOTE: We intentionally do NOT use `.select('*')` or `.single()` on the insert.
 * The SELECT policy depends on `get_user_owner_store_ids()`, which reads
 * `store_members` — but the owner membership is created by an AFTER INSERT trigger,
 * so it is not visible when the SELECT policy is evaluated in the same statement.
 * Requesting the representation in the same request causes a 403. Instead, we
 * insert first, then fetch the created store in a separate authorized request.
 */
export async function createStore(name: string): Promise<Store> {
  const client = getSupabaseClient()
  const { data: sessionData, error: sessionError } = await client.auth.getUser()
  if (sessionError) throw sessionError

  const user = sessionData.user
  if (!user) {
    throw new Error('Sessiya topilmadi. Qayta kiring.')
  }

  // Insert without requesting a representation — see NOTE above.
  const { error } = await client.from('stores').insert({ owner_id: user.id, name })

  if (error) throw error

  // Fetch the created store in a separate authorized request. The trigger has
  // now committed the owner membership, so the SELECT policy will pass.
  const stores = await listMyStores()
  const created = stores.find((store) => store.name === name)

  if (!created) {
    // This should not happen if the insert succeeded, but we handle it defensively.
    throw new Error('Do‘kon yaratildi, lekin qayta o‘qib bo‘lmadi. Sahifani yangilang.')
  }

  return created
}
