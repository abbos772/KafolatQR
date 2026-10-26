/**
 * Row types mirroring `supabase/migrations/20251014120000_initial_schema.sql`.
 *
 * These are hand-maintained shapes for the columns the frontend uses. They are NOT
 * generated from the database, so keep them in sync when the migration changes.
 */

export type WarrantyLifecycleStatus = 'active' | 'cancelled' | 'returned' | 'archived'

export interface Store {
  id: string
  owner_id: string
  name: string
  logo_url: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  store_id: string
  sku: string
  name: string
  category: string | null
  manufacturer: string | null
  image_url: string | null
  created_at: string
  updated_at: string
}

export interface WarrantyCard {
  id: string
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
  status: WarrantyLifecycleStatus
  is_qr_visible: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

/** Payload accepted by the warranty form. */
export interface WarrantyFormValues {
  product_id: string
  serial_number: string
  customer_name: string
  customer_phone: string
  customer_email: string
  purchase_date: string
  store_warranty_months: number
  manufacturer_warranty_months: number | ''
  manufacturer_warranty_start: string
  manufacturer_claim_url: string
  status: WarrantyLifecycleStatus
  is_qr_visible: boolean
  notes: string
}
