import { getSupabaseClient } from './supabase'
import type { Product } from '../types/db'

/**
 * Product catalog access. A product is a MODEL (e.g. "iPhone 15 128GB"); an
 * individual sold device is a warranty card.
 *
 * RLS on `products` is `FOR ALL` scoped to stores where the caller holds an owner
 * membership, so a `store_id` sent from the client is still authorized by the
 * database rather than by the UI.
 */
export async function listProducts(storeId: string): Promise<Product[]> {
  const { data, error } = await getSupabaseClient()
    .from('products')
    .select('*')
    .eq('store_id', storeId)
    .order('name', { ascending: true })

  if (error) throw error
  return data
}

export async function createProduct(input: {
  store_id: string
  sku: string
  name: string
  manufacturer: string
}): Promise<Product> {
  const trimmedManufacturer = input.manufacturer.trim()

  const { data, error } = await getSupabaseClient()
    .from('products')
    .insert({
      store_id: input.store_id,
      sku: input.sku.trim(),
      name: input.name.trim(),
      manufacturer: trimmedManufacturer === '' ? null : trimmedManufacturer,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}
