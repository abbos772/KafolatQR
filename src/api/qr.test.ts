import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({
    auth: { getSession: mocks.getSession },
    functions: { invoke: mocks.invoke },
  }),
}))

import { generateQrToken, revokeQrToken, verifyWarrantyByToken } from './qr'

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const VERIFIED_WARRANTY = {
  product_name: 'iPhone 15',
  manufacturer: 'Apple',
  purchase_date: '2025-01-15',
  store_warranty_expiry: '2026-01-15',
  store_warranty_status: 'active',
  manufacturer_warranty_status: 'not_known',
  manufacturer_warranty_expiry: null,
  manufacturer_claim_url: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'test-session-token' } },
    error: null,
  })
})

describe('generateQrToken', () => {
  it('invokes generate-qr through the configured Supabase client', async () => {
    mocks.invoke.mockResolvedValue({ data: { token: 'raw-token' }, error: null })

    await expect(generateQrToken('card-1')).resolves.toBe('raw-token')

    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('generate-qr', {
      body: { warranty_card_id: 'card-1' },
    })
  })

  it('does not call the Edge Function without a session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })

    await expect(generateQrToken('card-1')).rejects.toThrow(
      'Sessiya topilmadi. Qayta kiring.',
    )
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('surfaces the Edge Function error message', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: httpError(403, { error: 'Forbidden: not your warranty card' }),
    })

    await expect(generateQrToken('card-1')).rejects.toThrow(
      'Forbidden: not your warranty card',
    )
  })

  it('uses the fallback message when the error body has no message', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: httpError(503, { message: 'upstream unavailable' }),
    })

    await expect(generateQrToken('card-1')).rejects.toThrow(
      'QR token yaratib bo‘lmadi.',
    )
  })

  it('rejects a malformed success response instead of returning an invalid token', async () => {
    mocks.invoke.mockResolvedValue({ data: {}, error: null })

    await expect(generateQrToken('card-1')).rejects.toThrow(
      'QR token yaratib bo‘lmadi.',
    )
  })
})

describe('revokeQrToken', () => {
  it('invokes revoke-qr through the configured Supabase client', async () => {
    mocks.invoke.mockResolvedValue({ data: { success: true }, error: null })

    await expect(revokeQrToken('card-1')).resolves.toBeUndefined()

    expect(mocks.getSession).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('revoke-qr', {
      body: { warranty_card_id: 'card-1' },
    })
  })

  it('does not call the Edge Function without a session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })

    await expect(revokeQrToken('card-1')).rejects.toThrow(
      'Sessiya topilmadi. Qayta kiring.',
    )
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('surfaces the Edge Function error message', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: httpError(403, { error: 'Forbidden: not your warranty card' }),
    })

    await expect(revokeQrToken('card-1')).rejects.toThrow(
      'Forbidden: not your warranty card',
    )
  })
})

describe('verifyWarrantyByToken', () => {
  it('invokes the public verify-warranty function without requiring a session', async () => {
    mocks.invoke.mockResolvedValue({ data: VERIFIED_WARRANTY, error: null })

    await expect(verifyWarrantyByToken('raw-token')).resolves.toEqual(VERIFIED_WARRANTY)

    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('verify-warranty', {
      body: { token: 'raw-token' },
    })
  })

  it('surfaces the Edge Function error message', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: httpError(404, { error: 'Warranty not found or expired' }),
    })

    await expect(verifyWarrantyByToken('raw-token')).rejects.toThrow(
      'Warranty not found or expired',
    )
  })

  it('rejects an empty success response', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: null })

    await expect(verifyWarrantyByToken('raw-token')).rejects.toThrow(
      'Tekshiruv amalga oshmadi.',
    )
  })
})
