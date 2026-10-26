/**
 * Maps Supabase Auth errors to messages the seller can act on.
 *
 * The goal is to tell the user *what to do next* without leaking whether an
 * account exists. Supabase already returns a generic "Invalid login credentials"
 * for a wrong password, and we keep that behaviour rather than distinguishing
 * "no such user" from "wrong password".
 */

export type AuthErrorKind =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'network'
  | 'weak_password'
  | 'email_taken'
  | 'session_expired'
  | 'unknown'

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_credentials: 'Email yoki parol noto‘g‘ri.',
  email_not_confirmed:
    'Email tasdiqlanmagan. Email manzilingizdagi tasdiqlash havolasini bosing, so‘ng qayta kiring.',
  rate_limited: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.',
  network: 'Tarmoq xatosi. Internet aloqasini tekshirib qayta urinib ko‘ring.',
  weak_password: 'Parol kamida 8 ta belgidan iborat bo‘lishi kerak.',
  email_taken: 'Bu email allaqachon ro‘yxatdan o‘tgan. Tizimga kiring.',
  session_expired: 'Sessiya muddati tugagan. Qayta kiring.',
  unknown: 'Kutilmagan xatolik yuz berdi. Qayta urinib ko‘ring.',
}

interface ErrorLike {
  message?: string
  code?: string | number
  status?: number
  name?: string
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const { message, code, status, name } = error as ErrorLike
    return [name, message, code, status].filter(Boolean).join(' ')
  }
  return String(error)
}

export interface AuthErrorInfo {
  kind: AuthErrorKind
  /** Safe, user-facing message in Uzbek. */
  message: string
}

export function classifyAuthError(error: unknown): AuthErrorInfo {
  const text = describe(error).toLowerCase()

  if (text.includes('email_not_confirmed') || text.includes('email not confirmed')) {
    return { kind: 'email_not_confirmed', message: MESSAGES.email_not_confirmed }
  }
  if (text.includes('invalid login credentials') || text.includes('invalid_credentials')) {
    return { kind: 'invalid_credentials', message: MESSAGES.invalid_credentials }
  }
  if (text.includes('user already registered') || text.includes('already been registered')) {
    return { kind: 'email_taken', message: MESSAGES.email_taken }
  }
  if (
    text.includes('password should be') ||
    text.includes('weak_password') ||
    text.includes('at least')
  ) {
    return { kind: 'weak_password', message: MESSAGES.weak_password }
  }
  if (text.includes('rate limit') || text.includes('too many requests') || text.includes('429')) {
    return { kind: 'rate_limited', message: MESSAGES.rate_limited }
  }
  if (text.includes('jwt expired') || text.includes('session_expired') || text.includes('session expired')) {
    return { kind: 'session_expired', message: MESSAGES.session_expired }
  }
  if (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('load failed') ||
    text.includes('fetch failed') ||
    text.includes('timeout')
  ) {
    return { kind: 'network', message: MESSAGES.network }
  }

  return { kind: 'unknown', message: MESSAGES.unknown }
}

/** An auth failure carrying a safe, classified reason for UI display. */
export class AuthActionError extends Error {
  readonly kind: AuthErrorKind

  constructor(kind: AuthErrorKind, message: string) {
    super(message)
    this.name = 'AuthActionError'
    this.kind = kind
  }
}

/** Wraps any thrown value into an `AuthActionError` for the UI to render. */
export function toAuthActionError(error: unknown): AuthActionError {
  const info = classifyAuthError(error)
  return new AuthActionError(info.kind, info.message)
}

/** Generic, non-enumerating message for any non-auth failure. */
export function friendlyErrorMessage(error: unknown, fallback: string): string {
  const info = classifyAuthError(error)
  // For database/RPC failures we prefer an explicit caller-provided message over
  // guessing, but still surface the network case because it is actionable.
  if (info.kind === 'network') return info.message
  return fallback
}
