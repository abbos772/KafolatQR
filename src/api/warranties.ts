import { getSupabaseClient } from './supabase'
import type { WarrantyCard } from '../types/db'

/**
 * Warranty card data access.
 *
 * SECURITY: every query is scoped by RLS to stores the caller owns. A `store_id`
 * from someone who does not own that store yields zero rows (SELECT) or a policy
 * violation (INSERT/UPDATE) - it is never silently applied.
 *
 * There is intentionally no `deleteWarrantyCard`: the migration grants no DELETE
 * privilege on `warranty_cards` and `warranty_cards_no_delete` is `USING (false)`.
 * Removal is an archive (a status change) handled by `updateWarranty`.
 */
export async function listWarranties(storeId: string): Promise<WarrantyCard[]> {
  const { data, error } = await getSupabaseClient()
    .from('warranty_cards')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getWarranty(id: string): Promise<WarrantyCard> {
  const { data, error } = await getSupabaseClient()
    .from('warranty_cards')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export interface WarrantyInsert {
  store_id: string
  product_id: string
  serial_number: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  purchase_date: string
  store_warranty_months: number
  manufacturer_warranty_months: number | null
  manufacturer_warranty_start: string | null
  manufacturer_claim_url: string | null
  status: WarrantyCard['status']
  is_qr_visible: boolean
  notes: string | null
}

export async function createWarranty(input: WarrantyInsert): Promise<WarrantyCard> {
  const { data, error } = await getSupabaseClient()
    .from('warranty_cards')
    .insert(input)
    .select('*')
    .single()

  if (error) throw error
  return data
}

/** Never includes `store_id`: RLS pins the row to the caller's stores already. */
export type WarrantyUpdate = Omit<Partial<WarrantyInsert>, 'store_id'>

export async function updateWarranty(id: string, patch: WarrantyUpdate): Promise<WarrantyCard> {
  const { data, error } = await getSupabaseClient()
    .from('warranty_cards')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data
}

/** Client-side search over records the caller is authorized to see. */
export function filterWarranties(
  cards: WarrantyCard[],
  term: string,
  productNameById: Map<string, string>,
): WarrantyCard[] {
  const needle = term.trim().toLowerCase()
  if (needle === '') return cards

  return cards.filter((card) => {
    const haystack = [
      card.serial_number ?? '',
      card.customer_name ?? '',
      card.customer_phone ?? '',
      card.customer_email ?? '',
      card.status,
      productNameById.get(card.product_id) ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}
