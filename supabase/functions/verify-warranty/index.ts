import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleVerifyRequest } from './verify-warranty-handler.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Public warranty verification endpoint.
 *
 * SECURITY: This endpoint is unauthenticated by design. Rate limiting is
 * REQUIRED before production use. If rate-limit credentials are missing,
 * the endpoint returns 503 to prevent abuse.
 *
 * Rate limit: 30 requests per minute per IP (configurable via env vars).
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  return handleVerifyRequest(req)
})
