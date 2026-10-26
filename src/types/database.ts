/**
 * Minimal `Database` type for `createClient<Database>()`.
 *
 * Hand-maintained (not generated) and covering only the columns this app uses.
 * The payoff is real compile-time errors when writing to the wrong column.
 * `private.warranty_tokens` is intentionally absent: that schema is not exposed to
 * PostgREST, so the typed client must never reach it.
 */

type Timestamps = {
  created_at: string
  updated_at: string
}

type StoreRow = Timestamps & {
  id: string
  owner_id: string
  name: string
  logo_url: string | null
  is_archived: boolean
}

type StoreMemberRow = {
  id: string
  store_id: string
  user_id: string
  role: 'owner' | 'staff'
  created_at: string
}

type ProductRow = Timestamps & {
  id: string
  store_id: string
  sku: string
  name: string
  category: string | null
  manufacturer: string | null
  image_url: string | null
}

type WarrantyStatusRow = 'active' | 'cancelled' | 'returned' | 'archived'

type WarrantyCardRow = Timestamps & {
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
  status: WarrantyStatusRow
  is_qr_visible: boolean
  notes: string | null
}

type WarrantyDocumentRow = {
  id: string
  warranty_card_id: string
  store_id: string
  file_name: string
  storage_path: string
  mime_type: string
  size_bytes: number
  is_archived: boolean
  created_at: string
}

type SubscriptionRow = Timestamps & {
  id: string
  store_id: string
  provider: string
  provider_customer_id: string
  provider_subscription_id: string
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'unpaid'
  current_period_end: string
  cancel_at_period_end: boolean
}

type PaymentTransactionRow = {
  id: string
  store_id: string
  subscription_id: string
  provider: string
  provider_payment_id: string
  amount_minor_units: number
  currency: string
  status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  failure_reason: string | null
  created_at: string
}

type BillingEventRow = {
  id: string
  provider: string
  provider_event_id: string
  store_id: string
  subscription_id: string | null
  event_type: string
  received_at: string
  created_at: string
}

type AuditEventRow = {
  id: string
  actor_id: string | null
  store_id: string | null
  action: string
  entity_type: string
  entity_id: string
  changed_fields: Record<string, unknown> | null
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      stores: { Row: StoreRow; Insert: Partial<StoreRow>; Update: Partial<StoreRow>; Relationships: [] }
      store_members: {
        Row: StoreMemberRow
        Insert: Partial<StoreMemberRow>
        Update: Partial<StoreMemberRow>
        Relationships: []
      }
      products: { Row: ProductRow; Insert: Partial<ProductRow>; Update: Partial<ProductRow>; Relationships: [] }
      warranty_cards: {
        Row: WarrantyCardRow
        Insert: Partial<WarrantyCardRow>
        Update: Partial<WarrantyCardRow>
        Relationships: []
      }
      warranty_documents: {
        Row: WarrantyDocumentRow
        Insert: Partial<WarrantyDocumentRow>
        Update: Partial<WarrantyDocumentRow>
        Relationships: []
      }
      subscription: {
        Row: SubscriptionRow
        Insert: Partial<SubscriptionRow>
        Update: Partial<SubscriptionRow>
        Relationships: []
      }
      payment_transactions: {
        Row: PaymentTransactionRow
        Insert: Partial<PaymentTransactionRow>
        Update: Partial<PaymentTransactionRow>
        Relationships: []
      }
      billing_events: {
        Row: BillingEventRow
        Insert: Partial<BillingEventRow>
        Update: Partial<BillingEventRow>
        Relationships: []
      }
      audit_events: {
        Row: AuditEventRow
        Insert: Partial<AuditEventRow>
        Update: Partial<AuditEventRow>
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: Record<never, never>
    Enums: Record<never, never>
  }
}
