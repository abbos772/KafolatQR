import { createClient } from '@supabase/supabase-js'
import { getEnv } from '../lib/env'

let cachedClient: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (cachedClient) return cachedClient

  const env = getEnv()

  cachedClient = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })

  return cachedClient
}
