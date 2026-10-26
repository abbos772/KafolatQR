import { describe, expect, it } from 'vitest'
import {
  addMonthsToIsoDate,
  formatIsoDate,
  isQrVisibleByLifecycle,
  manufacturerWarrantyExpiry,
  manufacturerWarrantyStatus,
  storeWarrantyExpiry,
  storeWarrantyStatus,
  todayIso,
} from './warranty'

describe('addMonthsToIsoDate', () => {
  it('adds whole months', () => {
    expect(addMonthsToIsoDate('2026-01-15', 12)).toBe('2027-01-15')
    expect(addMonthsToIsoDate('2026-03-15', 9)).toBe('2026-12-15')
  })

  it('clamps the day to the end of a shorter month like PostgreSQL does', () => {
    expect(addMonthsToIsoDate('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsToIsoDate('2026-01-31', 3)).toBe('2026-04-30')
    expect(addMonthsToIsoDate('2026-08-31', 6)).toBe('2027-02-28')
  })

  it('keeps 29 February in a leap year', () => {
    expect(addMonthsToIsoDate('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonthsToIsoDate('2024-02-29', 12)).toBe('2025-02-28')
  })

  it('rolls years forward and backwards', () => {
    expect(addMonthsToIsoDate('2026-11-10', 3)).toBe('2027-02-10')
    expect(addMonthsToIsoDate('2026-02-10', -3)).toBe('2025-11-10')
    expect(addMonthsToIsoDate('2026-12-31', 1)).toBe('2027-01-31')
  })

  it('returns the same day for a zero-month change', () => {
    expect(addMonthsToIsoDate('2026-01-31', 0)).toBe('2026-01-31')
  })

  it('rejects malformed dates and non-integer months', () => {
    expect(() => addMonthsToIsoDate('2026-02-30', 1)).toThrow(/Invalid ISO date/)
    expect(() => addMonthsToIsoDate('not-a-date', 1)).toThrow(/Invalid ISO date/)
    expect(() => addMonthsToIsoDate('2026-01-15', 1.5)).toThrow(/integer/)
  })
})

describe('storeWarrantyStatus', () => {
  it('is active on and before the expiry day', () => {
    // purchased 2026-01-15 for 12 months -> expires 2027-01-15
    expect(storeWarrantyStatus('2026-01-15', 12, '2026-06-01')).toBe('active')
    expect(storeWarrantyStatus('2026-01-15', 12, '2027-01-14')).toBe('active')
    expect(storeWarrantyStatus('2026-01-15', 12, '2027-01-15')).toBe('active')
  })

  it('is expired the day after expiry', () => {
    expect(storeWarrantyStatus('2026-01-15', 12, '2027-01-16')).toBe('expired')
  })

  it('matches the SQL date + interval rule on month boundaries', () => {
    // PostgreSQL: 2026-01-31 + 1 month = 2026-02-28
    expect(storeWarrantyExpiry('2026-01-31', 1)).toBe('2026-02-28')
    expect(storeWarrantyStatus('2026-01-31', 1, '2026-02-28')).toBe('active')
    expect(storeWarrantyStatus('2026-01-31', 1, '2026-03-01')).toBe('expired')
  })
})

describe('manufacturerWarrantyStatus', () => {
  it('is not_known when either input is missing', () => {
    expect(manufacturerWarrantyStatus(null, 12, '2026-01-01')).toBe('not_known')
    expect(manufacturerWarrantyStatus('2026-01-01', null, '2026-01-01')).toBe('not_known')
  })

  it('is never assumed to start on the purchase date', () => {
    // Start is later than purchase, so a warranty that "looks expired" by
    // purchase date is still active.
    expect(manufacturerWarrantyStatus('2026-01-01', 12, '2026-06-01')).toBe('active')
  })

  it('computes active/expired from the explicit start date', () => {
    expect(manufacturerWarrantyStatus('2026-01-01', 12, '2026-12-31')).toBe('active')
    expect(manufacturerWarrantyStatus('2026-01-01', 12, '2027-01-01')).toBe('active')
    expect(manufacturerWarrantyStatus('2026-01-01', 12, '2027-01-02')).toBe('expired')
  })

  it('exposes the same expiry value used for the status', () => {
    expect(manufacturerWarrantyExpiry('2026-01-01', 12)).toBe('2027-01-01')
    expect(manufacturerWarrantyExpiry(null, 12)).toBeNull()
    expect(manufacturerWarrantyExpiry('2026-01-01', null)).toBeNull()
  })
})

describe('lifecycle vs QR visibility', () => {
  it('only the active lifecycle may verify', () => {
    expect(isQrVisibleByLifecycle('active')).toBe(true)
    expect(isQrVisibleByLifecycle('cancelled')).toBe(false)
    expect(isQrVisibleByLifecycle('returned')).toBe(false)
    expect(isQrVisibleByLifecycle('archived')).toBe(false)
  })
})

describe('date helpers', () => {
  it('todayIso uses the local calendar day', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(todayIso(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })

  it('formatIsoDate passes through an ISO date and blanks null', () => {
    expect(formatIsoDate('2026-01-15')).toBe('2026-01-15')
    expect(formatIsoDate(null)).toBe('')
  })
})
