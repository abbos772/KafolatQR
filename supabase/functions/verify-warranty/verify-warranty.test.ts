import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleVerifyRequest, type HandlerDeps } from './verify-warranty-handler'

/**
 * Unit tests for the verify-warranty Edge Function handler.
 *
 * These inject mock dependencies, so they need no Deno runtime, Redis, or
 * database. They verify control flow: rate limiting happens first, missing
 * configuration fails closed, tokens are validated, and the response is
 * projected onto an explicit allowlist.
 *
 * They do NOT prove that PostgreSQL enforces the RLS policies or that the
 * deployed Edge Function works — those need a real local Supabase stack.
 */

const VALID_TOKEN = 'A'.repeat(43)

function makeDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  const env: Record<string, string> = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
  }

  return {
    env: (key) => env[key],
    rateLimiter: () => ({
      limit: vi.fn().mockResolvedValue({ success: true, limit: 30, remaining: 29, reset: 0 }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...overrides,
  }
}

function post(body: unknown): Request {
  return new Request('http://localhost/functions/v1/verify-warranty', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('verify-warranty handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('method handling', () => {
    it('rejects non-POST methods with 405', async () => {
      const req = new Request('http://localhost/f', { method: 'GET' })
      const res = await handleVerifyRequest(req, makeDeps())
      expect(res.status).toBe(405)
    })

    it('answers CORS preflight', async () => {
      const req = new Request('http://localhost/f', { method: 'OPTIONS' })
      const res = await handleVerifyRequest(req, makeDeps())
      expect(res.status).toBe(200)
    })
  })

  describe('rate limiting', () => {
    it('fails closed with 503 when rate-limit credentials are missing', async () => {
      const deps = makeDeps({ env: () => undefined })
      const res = await handleVerifyRequest(post({ token: VALID_TOKEN }), deps)
      expect(res.status).toBe(503)
    })

    it('returns 429 when the limiter reports the limit exceeded', async () => {
      const deps = makeDeps({
        rateLimiter: () => ({
          limit: vi.fn().mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: 0 }),
        }),
      })

      const res = await handleVerifyRequest(post({ token: VALID_TOKEN }), deps)
      expect(res.status).toBe(429)
    })

    it('does not call the database when the rate limit is exceeded', async () => {
      const rpc = vi.fn()
      const deps = makeDeps({
        env: (key) =>
          key === 'UPSTASH_REDIS_REST_URL'
            ? 'https://test.upstash.io'
            : key === 'UPSTASH_REDIS_REST_TOKEN'
              ? 'token'
              : undefined,
        rateLimiter: () => ({
          limit: vi.fn().mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: 0 }),
        }),
        rpc,
      })

      await handleVerifyRequest(post({ token: VALID_TOKEN }), deps)
      expect(rpc).not.toHaveBeenCalled()
    })
  })

  describe('dependency resolution', () => {
    it('resolves async default deps when none are provided', async () => {
      // Regression: defaultDeps() is async. Previously the default parameter
      // received the unresolved Promise, so deps.env was undefined and the
      // handler threw "deps.env is not a function".
      //
      // We can't call the real defaultDeps() under Node (it imports remote
      // modules), so we assert the handler no longer throws that specific error.
      const req = post({ token: VALID_TOKEN })

      // Calling without deps should attempt defaultDeps() and fail with a
      // module-resolution error (not "deps.env is not a function").
      await expect(handleVerifyRequest(req)).rejects.not.toThrow(
        'deps.env is not a function',
      )
    })
  })

  describe('token validation', () => {
    it('returns 400 when the token is missing', async () => {
      const res = await handleVerifyRequest(post({}), makeDeps())
      expect(res.status).toBe(400)
    })

    it('returns 400 when the token is not a string', async () => {
      const res = await handleVerifyRequest(post({ token: 42 }), makeDeps())
      expect(res.status).toBe(400)
    })

    it('returns 400 for a malformed token', async () => {
      const res = await handleVerifyRequest(post({ token: 'too-short' }), makeDeps())
      expect(res.status).toBe(400)
    })

    it('returns 400 for a token with invalid characters', async () => {
      const res = await handleVerifyRequest(post({ token: '!'.repeat(43) }), makeDeps())
      expect(res.status).toBe(400)
    })
  })

  describe('verification outcomes', () => {
    const activeWarranty = {
      product_name: 'iPhone 15',
      manufacturer: 'Apple',
      purchase_date: '2025-01-15',
      store_warranty_expiry: '2026-01-15',
      store_warranty_status: 'active',
      manufacturer_warranty_status: 'not_known',
      manufacturer_warranty_expiry: null,
      manufacturer_claim_url: null,
    }

    it('returns 404 when no warranty matches (unknown/revoked/expired/hidden)', async () => {
      const deps = makeDeps({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) })
      const res = await handleVerifyRequest(post({ token: VALID_TOKEN }), deps)
      expect(res.status).toBe(404)
    })

    it('returns 404 when the database reports an error', async () => {
      const deps = makeDeps({ rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('boom') }) })
      const res = await handleVerifyRequest(post({ token: VALID_TOKEN }), deps)
      expect(res.status).toBe(404)
    })

    it('returns 200 with the allowlisted fields for a valid token', async () => {
      const deps = makeDeps({
        rpc: vi.fn().mockResolvedValue({ data: [activeWarranty], error: null }),
      })
      const res = await handleVerifyRequest(post({ token: VALID_TOKEN }), deps)
      expect(res.status).toBe(200)

      const body = (await res.json()) as Record<string, unknown>
      expect(body).toEqual({
        product_name: 'iPhone 15',
        manufacturer: 'Apple',
        purchase_date: '2025-01-15',
        store_warranty_expiry: '2026-01-15',
        store_warranty_status: 'active',
        manufacturer_warranty_status: 'not_known',
        manufacturer_warranty_expiry: null,
        manufacturer_claim_url: null,
      })
    })

    it('never returns the raw token or its hash', async () => {
      const deps = makeDeps({
        rpc: vi.fn().mockResolvedValue({ data: [activeWarranty], error: null }),
      })
      const res = await handleVerifyRequest(post({ token: VALID_TOKEN }), deps)
      const text = await res.text()
      expect(text).not.toContain(VALID_TOKEN)
    })
  })

  describe('response allowlist', () => {
    it('omits every internal identifier and customer field', async () => {
      const row = {
        product_name: 'iPhone 15',
        manufacturer: 'Apple',
        purchase_date: '2025-01-15',
        store_warranty_expiry: '2026-01-15',
        store_warranty_status: 'active',
        manufacturer_warranty_status: 'not_known',
        manufacturer_warranty_expiry: null,
        manufacturer_claim_url: null,
        // Must never leak:
        id: 'warranty-id',
        store_id: 'store-id',
        product_id: 'product-id',
        customer_name: 'Jane Doe',
        customer_phone: '+15550000000',
        customer_email: 'jane@example.com',
        serial_number: 'SN-SECRET',
        notes: 'private',
        token_hash: 'deadbeef',
      }

      const deps = makeDeps({ rpc: vi.fn().mockResolvedValue({ data: [row], error: null }) })
      const res = await handleVerifyRequest(post({ token: VALID_TOKEN }), deps)
      const body = (await res.json()) as Record<string, unknown>

      for (const forbidden of [
        'id',
        'store_id',
        'product_id',
        'customer_name',
        'customer_phone',
        'customer_email',
        'serial_number',
        'notes',
        'token_hash',
      ]) {
        expect(body).not.toHaveProperty(forbidden)
      }
    })
  })
})
