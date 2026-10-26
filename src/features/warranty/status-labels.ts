import type { LifecycleBadgeTone } from '../../components/ui'
import type { WarrantyLifecycleStatus } from '../../types/db'
import type { ComputedManufacturerStatus, ComputedWarrantyStatus } from '../../lib/warranty'

/**
 * Single source of truth for status wording.
 *
 * Lifecycle (`warranty_cards.status`) and computed expiry are deliberately kept
 * apart: a card whose warranty period has expired is still `active` as a record.
 */

export const LIFECYCLE_LABELS: Record<WarrantyLifecycleStatus, string> = {
  active: 'Faol',
  cancelled: 'Bekor qilingan',
  returned: 'Qaytarilgan',
  archived: 'Arxivlangan',
}

export const LIFECYCLE_TONES: Record<WarrantyLifecycleStatus, LifecycleBadgeTone> = {
  active: 'active',
  cancelled: 'cancelled',
  returned: 'returned',
  archived: 'archived',
}

export const STORE_STATUS_LABELS: Record<ComputedWarrantyStatus, string> = {
  active: 'Kafolat faol',
  expired: 'Muddati o‘tgan',
}

export const STORE_STATUS_TONES: Record<ComputedWarrantyStatus, LifecycleBadgeTone> = {
  active: 'active',
  expired: 'expired',
}

export const MANUFACTURER_STATUS_LABELS: Record<ComputedManufacturerStatus, string> = {
  active: 'Ishlab chiqaruvchi: faol',
  expired: 'Ishlab chiqaruvchi: o‘tgan',
  not_known: 'Ishlab chiqaruvchi: noma’lum',
}

export const MANUFACTURER_STATUS_TONES: Record<ComputedManufacturerStatus, LifecycleBadgeTone> = {
  active: 'active',
  expired: 'expired',
  not_known: 'not_known',
}
