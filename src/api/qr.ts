import { FunctionsHttpError } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabase'

/**
 * Turns an Edge Function error into a user-facing Error.
 *
 * `functions.invoke` does not throw on non-2xx responses; it returns the
 * `FunctionsHttpError` in `error`. The Edge Functions return `{ error }` JSON,
 * so prefer that message and fall back to the caller-supplied Uzbek message.
 */
async function toFunctionError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const body: unknown = await error.context.json().catch(() => null)

    if (
      body !== null &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
    ) {
      return new Error((body as { error: string }).error)
    }
  }

  return new Error(fallback)
}

/**
 * Calls the generate-qr Edge Function to create a new QR token.
 * The Edge Function verifies ownership and returns the raw token.
 *
 * The call goes through the configured Supabase client so it always targets
 * the same project (URL + anon/publishable key + session JWT) as auth and
 * database requests.
 */
export async function generateQrToken(warrantyCardId: string): Promise<string> {
  const client = getSupabaseClient()
  const { data: { session } } = await client.auth.getSession()

  if (!session) {
    throw new Error('Sessiya topilmadi. Qayta kiring.')
  }

  const { data, error } = await client.functions.invoke<{ token?: string }>('generate-qr', {
    body: { warranty_card_id: warrantyCardId },
  })

  if (error) throw await toFunctionError(error, 'QR token yaratib bo‘lmadi.')

  if (!data || typeof data.token !== 'string' || data.token.length === 0) {
    throw new Error('QR token yaratib bo‘lmadi.')
  }

  return data.token
}

/**
 * Calls the revoke-qr Edge Function to deactivate the QR token.
 */
export async function revokeQrToken(warrantyCardId: string): Promise<void> {
  const client = getSupabaseClient()
  const { data: { session } } = await client.auth.getSession()

  if (!session) {
    throw new Error('Sessiya topilmadi. Qayta kiring.')
  }

  const { error } = await client.functions.invoke('revoke-qr', {
    body: { warranty_card_id: warrantyCardId },
  })

  if (error) throw await toFunctionError(error, 'QR token bekor qilinmadi.')
}

export interface WarrantyVerification {
  product_name: string
  manufacturer: string
  purchase_date: string
  store_warranty_expiry: string
  store_warranty_status: string
  manufacturer_warranty_status: string
  manufacturer_warranty_expiry: string | null
  manufacturer_claim_url: string | null
}

/**
 * Calls the verify-warranty Edge Function for public verification.
 * Sends the raw token in the POST body — the Edge Function hashes it server-side.
 * No session is required; the configured client still supplies the project URL
 * and API key so the request reaches the correct Supabase project.
 */
export async function verifyWarrantyByToken(rawToken: string): Promise<WarrantyVerification> {
  const { data, error } = await getSupabaseClient().functions.invoke<WarrantyVerification>(
    'verify-warranty',
    { body: { token: rawToken } },
  )

  if (error) throw await toFunctionError(error, 'Tekshiruv amalga oshmadi.')
  if (!data) throw new Error('Tekshiruv amalga oshmadi.')

  return data
}
