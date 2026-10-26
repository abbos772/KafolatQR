import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient } from '../api/supabase'
import { AuthContext, type AuthContextValue } from './AuthContext'
import { classifyAuthError, toAuthActionError } from '../lib/auth-errors'

/**
 * Owns the Supabase session.
 *
 * SECURITY: this provider never invents or validates authorization itself - it
 * only exposes the session. Row Level Security is what actually decides which
 * rows the caller may touch.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const client = getSupabaseClient()

    let active = true

    // Restore a persisted session before the first paint, so a page refresh does
    // not bounce an already signed-in user to /login.
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        console.warn('Session restore failed', error.message)
      }
      setSession(error ? null : (data.session ?? null))
      setLoading(false)
    })

    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const client = getSupabaseClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) {
      throw toAuthActionError(error)
    }
    setSession(data.session)
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const client = getSupabaseClient()
    const { data, error } = await client.auth.signUp({ email, password })
    if (error) {
      throw toAuthActionError(error)
    }

    setSession(data.session ?? null)

    // With email confirmation enabled, Supabase returns a user but no session.
    return { needsEmailConfirmation: data.session === null }
  }, [])

  const signOut = useCallback(async () => {
    const client = getSupabaseClient()
    const { error } = await client.auth.signOut()
    // A missing session while signing out is not worth surfacing to the user.
    if (error) {
      const info = classifyAuthError(error)
      if (info.kind !== 'session_expired') {
        throw toAuthActionError(error)
      }
    }    setSession(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signUp,
      signIn,
      signOut,
    }),
    [session, loading, signUp, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider
