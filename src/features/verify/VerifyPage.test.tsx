import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VerifyPage } from './VerifyPage'

/**
 * Regression tests for the public QR verification flow.
 *
 * Root cause fixed here: VerifyPage used to re-read `window.location.hash` on
 * every render, but its own effect erased the hash with history.replaceState.
 * Any re-render after the fetch (result/loading state updates) re-derived
 * `missingToken = true` and hid a successfully verified result behind the
 * "Token topilmadi" screen. The token is now extracted once per navigation
 * from the stable router location.
 *
 * The tests never print or assert on the raw token value itself — only its
 * shape (43-char base64url) and equality with the generated value.
 */

// Replicates the generate-qr Edge Function token generation exactly:
// 32 random bytes → base64 → base64url alphabet → strip padding (43 chars).
function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const bin = Array.from(array, (b) => String.fromCharCode(b)).join('')
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

const fetchMock = vi.fn()
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
  fetchMock.mockReset()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const VERIFY_RESPONSE = {
  product_name: 'iPhone 15',
  manufacturer: 'Apple',
  purchase_date: '2025-01-15',
  store_warranty_expiry: '2026-01-15',
  store_warranty_status: 'active',
  manufacturer_warranty_status: 'not_known',
  manufacturer_warranty_expiry: null,
  manufacturer_claim_url: null,
}

function mockFetchResolved() {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(VERIFY_RESPONSE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }) as unknown as Response,
  )
}

describe('VerifyPage (QR token verification)', () => {
  it('sends the fragment token in the POST body and shows the verified result', async () => {
    const rawToken = generateToken()
    expect(rawToken).toMatch(TOKEN_PATTERN)

    mockFetchResolved()

    render(
      <MemoryRouter initialEntries={[`/verify#token=${encodeURIComponent(rawToken)}`]}>
        <VerifyPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.queryByText('iPhone 15')).not.toBeNull())

    // Exactly one verification request, hitting the public endpoint over POST.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0]
    expect(String(calledUrl)).toContain('/functions/v1/verify-warranty')
    expect(init.method).toBe('POST')

    // The body carries the exact token that was generated — the server-side
    // handler (`TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/`) accepts this shape.
    const body = JSON.parse(init.body as string) as { token: string }
    expect(body).toEqual({ token: rawToken })
    expect(body.token).toMatch(TOKEN_PATTERN)

    // The fragment is stripped from the visible URL as soon as verification
    // starts; the browser does not receive a later copy of the token.
    expect(window.location.hash).toBe('')
  })

  it('keeps showing the verified result after the hash is removed from the URL', async () => {
    const rawToken = generateToken()
    mockFetchResolved()

    const { rerender } = render(
      <MemoryRouter initialEntries={[`/verify#token=${encodeURIComponent(rawToken)}`]}>
        <VerifyPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.queryByText('iPhone 15')).not.toBeNull())

    // Regression: the effect wiped the hash; any state-driven re-render must
    // not flip the page back to the missing-token screen.
    rerender(<MemoryRouter initialEntries={['/verify']}>{<VerifyPage />}</MemoryRouter>)
    await waitFor(() => {
      expect(screen.queryByText('Token topilmadi.')).toBeNull()
      expect(screen.queryByText('iPhone 15')).not.toBeNull()
    })
  })

  it('renders the missing-token screen when the fragment carries no token', () => {
    render(
      <MemoryRouter initialEntries={['/verify']}>
        <VerifyPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Kafolat kartasi topilmadi')).not.toBeNull()
    // No request without a token.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the failure screen when verification is rejected', async () => {
    const rawToken = generateToken()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Warranty not found or expired' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }) as unknown as Response,
    )

    render(
      <MemoryRouter initialEntries={[`/verify#token=${encodeURIComponent(rawToken)}`]}>
        <VerifyPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByText('Warranty not found or expired')).not.toBeNull()
    })
  })
})
