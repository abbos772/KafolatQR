/**
 * Handler logic for the verify-warranty Edge Function.
 *
 * The rate limiter and Supabase client are injected so the handler can be unit
 * tested without a Deno runtime, a real Redis, or a real database.
 *
 * In production these come from the module-level imports below.
 */

export interface RateLimiter {
  limit(identifier: string): Promise<{ success: boolean; limit: number; remaining: number; reset: number }>
}

export interface VerifyRpc {
  (name: string, args: Record<string, unknown>): Promise<{ data: unknown[] | null; error: unknown }>
}

export interface VerifyWarrantyResponse {
  product_name: string
  manufacturer: string
  purchase_date: string
  store_warranty_expiry: string
  store_warranty_status: string
  manufacturer_warranty_status: string
  manufacturer_warranty_expiry: string | null
  manufacturer_claim_url: string | null
}

export interface HandlerDeps {
  env: (key: string) => string | undefined
  rateLimiter: () => RateLimiter
  rpc: VerifyRpc
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Builds the default dependencies from the real Edge Function environment.
 * Kept separate so tests never need a Deno runtime.
 *
 * Uses dynamic imports so the module can also be loaded under Node's ESM
 * loader (for unit tests) without resolving the remote URLs.
 */
export async function defaultDeps(): Promise<HandlerDeps> {
  const [{ Ratelimit }, { Redis }, { createClient }] = await Promise.all([
    import('https://esm.sh/@upstash/ratelimit@1'),
    import('https://esm.sh/@upstash/redis@1'),
    import('https://esm.sh/@supabase/supabase-js@2'),
  ])

  return {
    env: (key) => Deno.env.get(key),
    rateLimiter: () => {
      const redis = new Redis({
        url: Deno.env.get('UPSTASH_REDIS_REST_URL') ?? '',
        token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN') ?? '',
      })
      return new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(Number(Deno.env.get('RATE_LIMIT_PER_MINUTE') ?? '30'), '1 m'),
        analytics: true,
      })
    },
    rpc: async (name, args) => {
      const client = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      )
      return client.rpc(name, args)
    },
  }
}

/**
 * Processes one verification request.
 *
 * Order of operations is deliberate: rate limiting runs BEFORE any database
 * work, and a missing rate-limit configuration fails closed with 503.
 */
export async function handleVerifyRequest(
  req: Request,
  deps?: HandlerDeps,
): Promise<Response> {
  // Resolve the async default here, not as a default parameter value.
  // `defaultDeps()` returns a Promise; using it as a default would hand the
  // handler an unresolved Promise and `deps.env` would be undefined.
  const resolvedDeps = deps ?? (await defaultDeps())

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // 1. Rate limiting — before anything expensive
  if (!resolvedDeps.env('UPSTASH_REDIS_REST_URL') || !resolvedDeps.env('UPSTASH_REDIS_REST_TOKEN')) {
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // 2. Identify the caller for the limiter key
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const { success, limit, remaining, reset } = await resolvedDeps.rateLimiter().limit(clientIp)

    if (!success) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(reset),
        },
      })
    }

    // 3. Parse and shape-check the raw token
    const { token } = await req.json()
    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'Token required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!TOKEN_PATTERN.test(token)) {
      return new Response(JSON.stringify({ error: 'Invalid token format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Hash the raw token — it is never stored, logged, or returned
    const tokenHash = await sha256Hex(token)

    // 5. Authorized lookup. The RPC enforces is_active / is_qr_visible / status.
    const { data: result, error } = await resolvedDeps.rpc('verify_warranty_by_hash', {
      p_token_hash: tokenHash,
    })

    if (error || !result || result.length === 0) {
      // Same shape whether unknown, revoked, expired, or hidden.
      return new Response(JSON.stringify({ error: 'Warranty not found or expired' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 6. Project onto an explicit allowlist — never spread the database row.
    const warranty = result[0] as Record<string, unknown>
    const response: VerifyWarrantyResponse = {
      product_name: warranty.product_name as string,
      manufacturer: warranty.manufacturer as string,
      purchase_date: warranty.purchase_date as string,
      store_warranty_expiry: warranty.store_warranty_expiry as string,
      store_warranty_status: warranty.store_warranty_status as string,
      manufacturer_warranty_status: warranty.manufacturer_warranty_status as string,
      manufacturer_warranty_expiry: warranty.manufacturer_warranty_expiry as string | null,
      manufacturer_claim_url: warranty.manufacturer_claim_url as string | null,
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Verification failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}
