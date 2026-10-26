import { z } from 'zod'
import type { WarrantyLifecycleStatus } from '../types/db'

/**
 * Warranty form validation.
 *
 * This validates the *shape* of input only. Authorization and referential
 * integrity are enforced by the database: the RLS policies, the
 * `warranty_cards_product_same_store` composite FK, and the CHECK constraints.
 */
export const WARRANTY_STATUSES = ['active', 'cancelled', 'returned', 'archived'] as const

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana YYYY-MM-DD formatida bo‘lishi kerak.')

const optionalText = (max: number) =>
  z.string().max(max, `Ko‘pi bilan ${max} belgi.`).optional()

export const warrantyFormSchema = z.object({
  product_id: z.string().min(1, 'Mahsulotni tanlang.'),
  serial_number: optionalText(128),
  customer_name: optionalText(120),
  customer_phone: optionalText(40),
  customer_email: z
    .string()
    .email('Email manzil noto‘g‘ri.')
    .optional()
    .or(z.literal('')),
  purchase_date: isoDate,
  store_warranty_months: z
    .number()
    .int('Butun son kiriting.')
    .positive('Kafolat muddati 0 dan katta bo‘lishi kerak.'),
  manufacturer_warranty_months: z
    .number()
    .int('Butun son kiriting.')
    .positive('Muddat musbat son bo‘lishi kerak.')
    .or(z.literal('')),
  manufacturer_warranty_start: isoDate.or(z.literal('')),
  manufacturer_claim_url: z
    .string()
    .url('To‘g‘ri URL kiriting (https:// bilan).')
    .refine((value) => value.startsWith('https://'), 'Faqat https:// havolalar qabul qilinadi.')
    .optional()
    .or(z.literal('')),
  status: z.enum(WARRANTY_STATUSES),
  is_qr_visible: z.boolean(),
  notes: optionalText(2000),
})

export type WarrantyFormSchemaValues = z.infer<typeof warrantyFormSchema>

/** Cross-field rule: a manufacturer warranty needs both a start and a duration. */
export function validateManufacturerPair(values: {
  manufacturer_warranty_months: unknown
  manufacturer_warranty_start: unknown
}): string | null {
  const hasMonths = typeof values.manufacturer_warranty_months === 'number'
  const hasStart =
    typeof values.manufacturer_warranty_start === 'string' &&
    values.manufacturer_warranty_start !== ''

  if (hasMonths !== hasStart) {
    return 'Ishlab chiqaruvchi kafolati uchun ham boshlanish sanasi, ham muddat kerak (ikkisi ham bo‘sh bo‘lsa, holat “noma’lum” bo‘ladi).'
  }
  return null
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function toWarrantyFields(values: WarrantyFormSchemaValues) {
  const months = values.manufacturer_warranty_months

  return {
    product_id: values.product_id,
    serial_number: emptyToNull(values.serial_number),
    customer_name: emptyToNull(values.customer_name),
    customer_phone: emptyToNull(values.customer_phone),
    customer_email: emptyToNull(values.customer_email),
    purchase_date: values.purchase_date,
    store_warranty_months: values.store_warranty_months,
    manufacturer_warranty_months: typeof months === 'number' ? months : null,
    manufacturer_warranty_start: emptyToNull(values.manufacturer_warranty_start),
    manufacturer_claim_url: emptyToNull(values.manufacturer_claim_url),
    status: values.status as WarrantyLifecycleStatus,
    is_qr_visible: values.is_qr_visible,
    notes: emptyToNull(values.notes),
  }
}

export type WarrantyFields = ReturnType<typeof toWarrantyFields>

/**
 * Converts validated form output into the row the migration expects, mapping each
 * empty string to SQL NULL so optional columns stay NULL rather than ''.
 */
export function toWarrantyInsert(
  values: WarrantyFormSchemaValues,
  storeId: string,
): WarrantyFields & { store_id: string } {
  return { store_id: storeId, ...toWarrantyFields(values) }
}

/**
 * Patch for an existing row. Deliberately has no `store_id`: RLS already pins the
 * row to stores the caller owns, so sending one would only invite a cross-store
 * write attempt that the policy then has to reject.
 */
export function toWarrantyPatch(values: WarrantyFormSchemaValues): WarrantyFields {
  return toWarrantyFields(values)
}
