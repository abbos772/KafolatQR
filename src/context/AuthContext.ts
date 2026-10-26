import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

/**
 * Auth state shared with the UI.
 *
 * Deliberately free of React components so `react-refresh/only-export-components`
 * does not flag the provider file. `AuthProvider` lives in `./AuthProvider.tsx`.
 */

export interface SignUpResult {
  /** True when the provider requires email confirmation, so no session exists yet. */
  needsEmailConfirmation: boolean
}

export interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  signUp: (email: string, password: string) => Promise<SignUpResult>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return context
}
