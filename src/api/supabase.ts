import { createClient } from '@supabase/supabase-js'
import { getEnv } from '../lib/env'
import type { Database } from '../types/database'

type TypedSupabaseClient = ReturnType<typeof createClient<Database>>

let cachedClient: TypedSupabaseClient | null = null

export function getSupabaseClient(): TypedSupabaseClient {
  if (cachedClient) return cachedClient

  const env = getEnv()

  // Only the anon/publishable key is used here. The service-role key must never
  // reach the browser: it lives solely in Edge Function secrets.
  cachedClient = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })

  return cachedClient
}
