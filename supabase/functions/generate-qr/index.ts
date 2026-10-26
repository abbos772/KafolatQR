import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      },
    )

    // Verify the user is authenticated
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { warranty_card_id } = await req.json()
    if (!warranty_card_id) {
      return new Response(JSON.stringify({ error: 'warranty_card_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify ownership before generating token
    const { data: ownership, error: ownershipError } = await supabaseClient.rpc('verify_warranty_ownership', {
      p_warranty_card_id: warranty_card_id,
    })

    if (ownershipError || !ownership) {
      return new Response(JSON.stringify({ error: 'Forbidden: not your warranty card' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Generate cryptographically secure random token (base64url, 43 chars = 256 bits)
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    // Convert to base64url: btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
    const base64 = btoa(String.fromCharCode(...array))
    const rawToken = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    // Compute SHA-256 hash
    const encoder = new TextEncoder()
    const data = encoder.encode(rawToken)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const tokenHash = Array.from(new Uint8Array(hashBuffer), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')

    // Store only the hash
    const { error: insertError } = await supabaseClient.rpc('issue_warranty_token', {
      p_warranty_card_id: warranty_card_id,
      p_token_hash: tokenHash,
    })

    if (insertError) {
      return new Response(JSON.stringify({ error: 'Failed to issue token' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Return the raw token (only time it's exposed)
    return new Response(
      JSON.stringify({ token: rawToken, warranty_card_id }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
