import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { verifyWarrantyByToken } from '../../api/qr'
import { Alert, Spinner, StatusBadge } from '../../components/ui'
import {
  MANUFACTURER_STATUS_LABELS,
  MANUFACTURER_STATUS_TONES,
  STORE_STATUS_LABELS,
  STORE_STATUS_TONES,
} from '../warranty/status-labels'
import styles from './verify.module.css'

interface VerificationResult {
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
 * Reads the raw token from a URL fragment of the shape `#token=...`.
 *
 * The token is never stored, logged, or displayed.
 */
function extractTokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return params.get('token')
}

/**
 * Public warranty verification page.
 *
 * Reads the raw token from the URL fragment (`#token=...`), immediately removes
 * it from the visible URL, and sends it to the Edge Function in a POST body.
 */
export function VerifyPage() {
  const location = useLocation()

  // Extract the token from the router location once per navigation — not once
  // per render. The verification effect erases the URL hash with
  // history.replaceState as soon as verification starts, so re-reading
  // `window.location.hash` on every render would flip a successfully verified
  // result back to the missing-token screen (regression: scanning a QR always
  // showed "Kafolat kartasi topilmadi" despite a 200 response).
  // The router location object is stable between navigations, so this value
  // survives the re-renders caused by result/loading state updates.
  const verifyToken = useMemo(() => extractTokenFromHash(location.hash), [location])

  if (!verifyToken) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Kafolat kartasi topilmadi</h1>
          <Alert kind="error">Token topilmadi.</Alert>
        </div>
      </div>
    )
  }

  return <VerificationResultCard key={verifyToken} rawToken={verifyToken} />
}

/**
 * Fetches and renders one verification. Remounts (via `key` in VerifyPage)
 * whenever the fragment token changes, so each token starts from clean state
 * and loading is true from the first commit.
 */
function VerificationResultCard({ rawToken }: { rawToken: string }) {
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Immediately remove the token from the visible URL
    window.history.replaceState(null, '', window.location.pathname)

    let cancelled = false

    // State updates live after the await, i.e. in an async callback rather than
    // synchronously inside the effect body (which would cascade renders).
    void (async () => {
      try {
        const data = await verifyWarrantyByToken(rawToken)
        if (cancelled) return
        setResult(data)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Tekshiruv amalga oshmadi.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    // Guards against setState after unmount or after the token changes.
    return () => {
      cancelled = true
    }
  }, [rawToken])

  if (loading) return <Spinner label="Tekshirilmoqda…" />

  if (error || !result) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Kafolat kartasi topilmadi</h1>
          <Alert kind="error">
            {error ?? 'Bu kafolat kartasi mavjud emas yoki muddati o‘tgan.'}
          </Alert>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Kafolat kartasi</h1>
        <p className={styles.subtitle}>Quyidagi ma’lumotlar sotuvchi tomonidan kiritilgan.</p>

        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Mahsulot</span>
            <span className={styles.detailValue}>{result.product_name}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Ishlab chiqaruvchi</span>
            <span className={styles.detailValue}>{result.manufacturer ?? '—'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Xarid sanasi</span>
            <span className={styles.detailValue}>{result.purchase_date}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Do‘kon kafolati</span>
            <span className={styles.detailValue}>
              {result.store_warranty_expiry} ({STORE_STATUS_LABELS[result.store_warranty_status as keyof typeof STORE_STATUS_LABELS]})
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Ishlab chiqaruvchi kafolati</span>
            <span className={styles.detailValue}>
              {result.manufacturer_warranty_status === 'not_known'
                ? 'Noma’lum'
                : result.manufacturer_warranty_expiry}
            </span>
          </div>
        </div>

        <div className={styles.badgeRow}>
          <StatusBadge
            tone={STORE_STATUS_TONES[result.store_warranty_status as keyof typeof STORE_STATUS_TONES]}
            label={STORE_STATUS_LABELS[result.store_warranty_status as keyof typeof STORE_STATUS_LABELS]}
          />
          <StatusBadge
            tone={MANUFACTURER_STATUS_TONES[result.manufacturer_warranty_status as keyof typeof MANUFACTURER_STATUS_TONES]}
            label={MANUFACTURER_STATUS_LABELS[result.manufacturer_warranty_status as keyof typeof MANUFACTURER_STATUS_LABELS]}
          />
        </div>

        {result.manufacturer_warranty_status !== 'not_known' ? (
          <Alert kind="info">
            Ishlab chiqaruvchi kafolati ma’lumotlari sotuvchi tomonidan kiritilgan va KafolatQR
            tomonidan mustaqil tasdiqlanmagan.
          </Alert>
        ) : null}
      </div>
    </div>
  )
}

export default VerifyPage
