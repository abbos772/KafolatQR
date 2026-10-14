import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
vi.stubEnv('VITE_APP_URL', 'http://localhost:5173')

describe('getEnv', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns validated env vars when all are valid', async () => {
    const { getEnv } = await import('./env')
    const env = getEnv()
    expect(env.VITE_SUPABASE_URL).toBe('https://test.supabase.co')
    expect(env.VITE_SUPABASE_ANON_KEY).toBe('test-anon-key')
    expect(env.VITE_APP_URL).toBe('http://localhost:5173')
  })

  it('throws with descriptive error when VITE_SUPABASE_URL is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubEnv('VITE_APP_URL', 'http://localhost:5173')
    const { getEnv } = await import('./env')
    expect(() => getEnv()).toThrow(/VITE_SUPABASE_URL/)
  })

  it('throws with descriptive error when VITE_SUPABASE_ANON_KEY is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    vi.stubEnv('VITE_APP_URL', 'http://localhost:5173')
    const { getEnv } = await import('./env')
    expect(() => getEnv()).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })
})
