/**
 * Warranty date arithmetic and status computation.
 *
 * IMPORTANT: these rules must stay identical to the SQL used for public
 * verification (`verify_warranty_by_hash`), which computes:
 *
 *   expiry = purchase_date + (months || ' months')::interval
 *   active WHEN current_date <= expiry
 *
 * PostgreSQL's `date + interval 'N months'` clamps the day to the last valid day
 * of the target month (Jan 31 + 1 month => Feb 28/29). The helpers below
 * reproduce exactly that behaviour so the UI, the tests and the database agree.
 *
 * All dates are ISO `YYYY-MM-DD` strings. ISO date strings compare correctly as
 * plain strings, which avoids all timezone surprises.
 */

export type ComputedWarrantyStatus = 'active' | 'expired'
export type ComputedManufacturerStatus = 'active' | 'expired' | 'not_known'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toIsoDate(year: number, month1Based: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month1Based)}-${pad2(day)}`
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= daysInMonth
}

/** Number of days in a month (month is 1-based). Uses UTC so it never drifts. */
function daysInMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate()
}

/**
 * Adds `months` calendar months to an ISO date, clamping the day to the last
 * valid day of the target month. Matches PostgreSQL `date + interval`.
 */
export function addMonthsToIsoDate(isoDate: string, months: number): string {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`Invalid ISO date: ${isoDate}`)
  }
  if (!Number.isInteger(months)) {
    throw new Error(`Months must be an integer: ${months}`)
  }

  const [year, month, day] = isoDate.split('-').map(Number)
  const zeroBasedTarget = month - 1 + months
  const targetYear = year + Math.floor(zeroBasedTarget / 12)
  const targetMonth1Based = ((zeroBasedTarget % 12) + 12) % 12 + 1
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth1Based))

  return toIsoDate(targetYear, targetMonth1Based, targetDay)
}

/** Expiry date of the store warranty (the warranty KafolatQR manages). */
export function storeWarrantyExpiry(purchaseDate: string, months: number): string {
  return addMonthsToIsoDate(purchaseDate, months)
}

/**
 * Store warranty status: `active` while today <= expiry (inclusive), `expired`
 * afterwards. Mirrors the SQL `current_date <= expiry` comparison.
 */
export function storeWarrantyStatus(
  purchaseDate: string,
  months: number,
  todayIso: string,
): ComputedWarrantyStatus {
  return todayIso <= storeWarrantyExpiry(purchaseDate, months) ? 'active' : 'expired'
}

/**
 * Manufacturer warranty status. Deliberately `not_known` unless BOTH an
 * explicit start date and a duration are present - the app must never assume the
 * manufacturer warranty starts on the purchase date, and must never imply
 * official verification.
 */
export function manufacturerWarrantyStatus(
  startIso: string | null,
  months: number | null,
  todayIso: string,
): ComputedManufacturerStatus {
  if (startIso === null || months === null) return 'not_known'
  return todayIso <= addMonthsToIsoDate(startIso, months) ? 'active' : 'expired'
}

/** Expiry date for the manufacturer warranty, or null when it cannot be known. */
export function manufacturerWarrantyExpiry(
  startIso: string | null,
  months: number | null,
): string | null {
  if (startIso === null || months === null) return null
  return addMonthsToIsoDate(startIso, months)
}

/**
 * True when a lifecycle value still permits QR verification.
 * `cancelled`, `returned` and `archived` must never verify, regardless of dates.
 */
export function isQrVisibleByLifecycle(status: string): boolean {
  return status === 'active'
}

/** Today as an ISO date string, using the local calendar day. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Formats an ISO date for display. Returns '' for null/empty input. */
export function formatIsoDate(isoDate: string | null): string {
  if (!isoDate) return ''
  return isoDate
}
