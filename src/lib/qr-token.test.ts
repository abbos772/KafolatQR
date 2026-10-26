import { describe, expect, it } from 'vitest'

/**
 * Tests for QR token generation and validation logic.
 * These test the pure functions that would run inside Edge Functions.
 *
 * Token contract (see docs/implementation-plan.md): 32 random bytes,
 * base64url-encoded, no padding — 43 characters. The legacy 64-char hex
 * format was superseded; tokens are validated server-side against
 * `^[A-Za-z0-9_-]{43}$` in supabase/functions/verify-warranty.
 */

// Token generation uses crypto.getRandomValues which is available in Node 19+
function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const bin = Array.from(array, (b) => String.fromCharCode(b)).join('')
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Mirrors the server-side validation in
// supabase/functions/verify-warranty/verify-warranty-handler.ts
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

describe('QR Token Generation', () => {
  it('generates a 43-character base64url string', () => {
    const token = generateToken()
    expect(token).toMatch(TOKEN_PATTERN)
    expect(token.length).toBe(43)
  })

  it('generates cryptographically random tokens (never hex)', () => {
    const token = generateToken()
    // 256 bits of entropy must not be collapsible to the old 64-char hex form
    expect(token).not.toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
    expect(tokens.size).toBe(100)
  })

  it('produces SHA-256 hash that matches expected format', async () => {
    const token = generateToken()
    const hash = await sha256Hex(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hash is deterministic', async () => {
    const token = generateToken()
    const hash1 = await sha256Hex(token)
    const hash2 = await sha256Hex(token)
    expect(hash1).toBe(hash2)
  })

  it('different tokens produce different hashes', async () => {
    const token1 = generateToken()
    const token2 = generateToken()
    const hash1 = await sha256Hex(token1)
    const hash2 = await sha256Hex(token2)
    expect(hash1).not.toBe(hash2)
  })
})

describe('Token Format Validation', () => {
  // Acceptance criteria for tokens sent to verify-warranty:
  // cryptographically random, Base64URL-encoded, exactly 43 characters.
  it('accepts a generated 43-char base64url token', () => {
    expect(TOKEN_PATTERN.test(generateToken())).toBe(true)
  })

  it('accepts tokens containing - and _', () => {
    expect(TOKEN_PATTERN.test('ab_-'.repeat(10) + 'abc')).toBe(true) // 43 chars
  })

  it('rejects the legacy 64-char hex format', () => {
    expect(TOKEN_PATTERN.test('a'.repeat(64))).toBe(false)
  })

  it('rejects too short', () => {
    expect(TOKEN_PATTERN.test('a'.repeat(42))).toBe(false)
  })

  it('rejects too long', () => {
    expect(TOKEN_PATTERN.test('a'.repeat(44))).toBe(false)
  })

  it('rejects standard-base64 padding and alphabet', () => {
    // '=' padding and '+'/'/' must never survive into a raw token
    expect(TOKEN_PATTERN.test('a'.repeat(42) + '=')).toBe(false)
    expect(TOKEN_PATTERN.test('+'.repeat(42) + '/aa')).toBe(false)
  })

  it('rejects non-base64url characters', () => {
    expect(TOKEN_PATTERN.test('!'.repeat(43))).toBe(false)
  })

  it('rejects empty string', () => {
    expect(TOKEN_PATTERN.test('')).toBe(false)
  })
})

describe('Token Custody (generate → QR fragment → extraction → POST body)', () => {
  const APP_URL = 'https://app.kafolatqr.uz'

  it('survives URL-encoding in the QR fragment and URLSearchParams extraction', () => {
    const rawToken = generateToken()

    // WarrantyDetailPage.handleGenerateQr
    const verifyUrl = `${APP_URL}/verify#token=${encodeURIComponent(rawToken)}`
    expect(verifyUrl.includes('#token=')).toBe(true)

    // VerifyPage.extractTokenFromHash (router location hash)
    const hash = new URL(verifyUrl).hash
    const extracted = extractTokenFromHash(hash)

    expect(extracted).toBe(rawToken)
    expect(TOKEN_PATTERN.test(extracted as string)).toBe(true)
  })

  it('places the token only in the URL fragment — never path or query', () => {
    const rawToken = generateToken()
    const verifyUrl = `${APP_URL}/verify#token=${encodeURIComponent(rawToken)}`

    const url = new URL(verifyUrl)
    expect(url.pathname).toBe('/verify')
    expect(url.search).toBe('')
    expect(url.searchParams.has('token')).toBe(false)
    expect(url.hash.startsWith('#token=')).toBe(true)
  })
})

function extractTokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return params.get('token')
}

describe('Allowlist Response Construction', () => {
  it('includes only allowed fields', () => {
    const dbRow = {
      id: 'internal-id-123',
      store_id: 'store-456',
      product_id: 'product-789',
      customer_name: 'John Doe',
      customer_phone: '+1234567890',
      customer_email: 'john@example.com',
      serial_number: 'SN12345',
      notes: 'private notes',
      token_hash: 'abc123...',
      product_name: 'iPhone 15',
      manufacturer: 'Apple',
      purchase_date: '2025-01-15',
      store_warranty_expiry: '2026-01-15',
      store_warranty_status: 'active',
      manufacturer_warranty_status: 'not_known',
      manufacturer_warranty_expiry: null,
      manufacturer_claim_url: null,
    }

    // Simulate the allowlist construction from verify-warranty Edge Function
    const response = {
      product_name: dbRow.product_name,
      manufacturer: dbRow.manufacturer,
      purchase_date: dbRow.purchase_date,
      store_warranty_expiry: dbRow.store_warranty_expiry,
      store_warranty_status: dbRow.store_warranty_status,
      manufacturer_warranty_status: dbRow.manufacturer_warranty_status,
      manufacturer_warranty_expiry: dbRow.manufacturer_warranty_expiry,
      manufacturer_claim_url: dbRow.manufacturer_claim_url,
    }

    // Verify allowed fields are present
    expect(response).toHaveProperty('product_name')
    expect(response).toHaveProperty('manufacturer')
    expect(response).toHaveProperty('purchase_date')
    expect(response).toHaveProperty('store_warranty_expiry')
    expect(response).toHaveProperty('store_warranty_status')
    expect(response).toHaveProperty('manufacturer_warranty_status')
    expect(response).toHaveProperty('manufacturer_warranty_expiry')
    expect(response).toHaveProperty('manufacturer_claim_url')

    // Verify forbidden fields are NOT present
    expect(response).not.toHaveProperty('id')
    expect(response).not.toHaveProperty('store_id')
    expect(response).not.toHaveProperty('product_id')
    expect(response).not.toHaveProperty('customer_name')
    expect(response).not.toHaveProperty('customer_phone')
    expect(response).not.toHaveProperty('customer_email')
    expect(response).not.toHaveProperty('serial_number')
    expect(response).not.toHaveProperty('notes')
    expect(response).not.toHaveProperty('token_hash')
  })
})

describe('Token Hash Validation', () => {
  // The stored token_hash is SHA-256 hex — 64 lowercase chars.
  it('accepts valid 64-char lowercase hex', () => {
    expect(/^[0-9a-f]{64}$/.test('a'.repeat(64))).toBe(true)
  })

  it('rejects uppercase hex', () => {
    expect(/^[0-9a-f]{64}$/.test('A'.repeat(64))).toBe(false)
  })

  it('rejects too short', () => {
    expect(/^[0-9a-f]{64}$/.test('a'.repeat(63))).toBe(false)
  })

  it('rejects too long', () => {
    expect(/^[0-9a-f]{64}$/.test('a'.repeat(65))).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(/^[0-9a-f]{64}$/.test('g'.repeat(64))).toBe(false)
  })

  it('rejects empty string', () => {
    expect(/^[0-9a-f]{64}$/.test('')).toBe(false)
  })
})

describe('Expiry Calculation Consistency', () => {
  // These tests verify the SQL logic that runs in the Edge Function.
  // The Edge Function uses PostgreSQL's interval arithmetic, not JavaScript's Date object.
  // PostgreSQL's `date + interval 'N months'` clamps to the last day of the month.

  it('computes store warranty expiry correctly', () => {
    // SQL: purchase_date + (months || ' months')::interval
    // For '2025-01-15' + 12 months = '2026-01-15'
    const purchaseDate = '2025-01-15'
    const months = 12
    // Simulate PostgreSQL interval arithmetic
    const expiry = new Date(purchaseDate)
    expiry.setFullYear(expiry.getFullYear() + Math.floor(months / 12))
    expiry.setMonth(expiry.getMonth() + (months % 12))
    expect(expiry.toISOString().split('T')[0]).toBe('2026-01-15')
  })

  it('active when today equals expiry', () => {
    const today = '2026-01-15'
    const expiry = '2026-01-15'
    expect(today <= expiry).toBe(true)
  })

  it('expired when today exceeds expiry', () => {
    const today = '2026-01-16'
    const expiry = '2026-01-15'
    expect(today <= expiry).toBe(false)
  })

  it('manufacturer warranty is not_known when start or months missing', () => {
    // SQL: CASE WHEN manufacturer_warranty_months IS NULL OR manufacturer_warranty_start IS NULL THEN 'not_known'
    const months = null
    const start = '2025-01-01'
    const status = months === null || start === null ? 'not_known' : 'active'
    expect(status).toBe('not_known')
  })
})
