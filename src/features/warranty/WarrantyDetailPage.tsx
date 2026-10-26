import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { useStores } from '../../context/StoreContext'
import { listProducts } from '../../api/products'
import { getWarranty } from '../../api/warranties'
import { generateQrToken, revokeQrToken } from '../../api/qr'
import { getEnv } from '../../lib/env'
import {
  manufacturerWarrantyStatus,
  manufacturerWarrantyExpiry,
  storeWarrantyExpiry,
  storeWarrantyStatus,
  todayIso,
} from '../../lib/warranty'
import { Alert, Button, EmptyState, Spinner, StatusBadge } from '../../components/ui'
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_TONES,
  MANUFACTURER_STATUS_LABELS,
  MANUFACTURER_STATUS_TONES,
  STORE_STATUS_LABELS,
  STORE_STATUS_TONES,
} from './status-labels'
import type { Product, WarrantyCard } from '../../types/db'
import styles from './warranty.module.css'

export function WarrantyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { currentStoreId } = useStores()

  const [card, setCard] = useState<WarrantyCard | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    let cancelled = false

    // State updates live after the await, i.e. in an async callback rather than
    // synchronously inside the effect body (which would cascade renders).
    void (async () => {
      try {
        const [nextCard, nextProducts] = await Promise.all([
          getWarranty(id),
          currentStoreId ? listProducts(currentStoreId) : Promise.resolve([]),
        ])
        if (cancelled) return

        setCard(nextCard)
        setProducts(nextProducts)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Kafolat kartasini yuklab bo‘lmadi.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    // Prevents setState after unmount or after the record/store changes.
    return () => {
      cancelled = true
    }
  }, [id, currentStoreId])

  if (loading) return <Spinner label="Yuklanmoqda…" />

  if (error || !card) {
    return (
      <div className={styles.container}>
        <EmptyState title="Kafolat kartasi topilmadi">
          {/* A missing or unauthorized record is indistinguishable here on purpose. */}
          <p>Yozuv mavjud emas yoki sizda uni ko‘rish uchun ruxsat yo‘q.</p>
          <p style={{ marginTop: '1rem' }}>
            <Link className={styles.rowLink} to="/warranties">
              Ro‘yxatga qaytish
            </Link>
          </p>
        </EmptyState>
      </div>
    )
  }

  const today = todayIso()
  const storeStatus = storeWarrantyStatus(card.purchase_date, card.store_warranty_months, today)
  const mfrStatus = manufacturerWarrantyStatus(
    card.manufacturer_warranty_start,
    card.manufacturer_warranty_months,
    today,
  )
  const productName = products.find((p) => p.id === card.product_id)?.name ?? '—'

  async function handleGenerateQr() {
    if (!card) return
    setQrLoading(true)
    setQrError(null)
    try {
      const token = await generateQrToken(card.id)
      setQrToken(token)

      // Construct the public verification URL with the token in the fragment.
      // The fragment is not sent to the web server in the initial page request.
      const verifyUrl = `${getEnv().VITE_APP_URL}/verify#token=${encodeURIComponent(token)}`
      const dataUrl = await QRCode.toDataURL(verifyUrl, { width: 256, margin: 2 })
      setQrDataUrl(dataUrl)
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'QR token yaratib bo‘lmadi.')
    } finally {
      setQrLoading(false)
    }
  }

  async function handleRevokeQr() {
    if (!card) return
    setQrLoading(true)
    setQrError(null)
    try {
      await revokeQrToken(card.id)
      setQrToken(null)
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'QR token bekor qilinmadi.')
    } finally {
      setQrLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{productName}</h1>
          <p className={styles.subtitle}>Kafolat kartasi tafsilotlari</p>
        </div>
        <div className={styles.badgeRow}>
          <StatusBadge tone={LIFECYCLE_TONES[card.status]} label={LIFECYCLE_LABELS[card.status]} />
          <StatusBadge tone={STORE_STATUS_TONES[storeStatus]} label={STORE_STATUS_LABELS[storeStatus]} />
          <StatusBadge
            tone={MANUFACTURER_STATUS_TONES[mfrStatus]}
            label={MANUFACTURER_STATUS_LABELS[mfrStatus]}
          />
        </div>
      </div>

      {mfrStatus !== 'not_known' ? (
        <Alert kind="info">
          Ishlab chiqaruvchi kafolati ma’lumotlari sotuvchi tomonidan kiritilgan va KafolatQR
          tomonidan mustaqil tasdiqlanmagan.
        </Alert>
      ) : null}

      <div className={styles.form}>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Mahsulot</span>
            <span className={styles.detailValue}>{productName}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Xarid sanasi</span>
            <span className={styles.detailValue}>{card.purchase_date}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Do‘kon kafolati</span>
            <span className={styles.detailValue}>{card.store_warranty_months} oy</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Tugash sanasi</span>
            <span className={styles.detailValue}>
              {storeWarrantyExpiry(card.purchase_date, card.store_warranty_months)}
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Ishlab chiqaruvchi kafolati</span>
            <span className={styles.detailValue}>
              {card.manufacturer_warranty_start && card.manufacturer_warranty_months
                ? `${card.manufacturer_warranty_months} oy (${card.manufacturer_warranty_start} → ${manufacturerWarrantyExpiry(card.manufacturer_warranty_start, card.manufacturer_warranty_months)})`
                : 'Kiritilmagan'}
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>QR ko‘rinishi</span>
            <span className={styles.detailValue}>{card.is_qr_visible ? 'Ko‘rinadi' : 'Yashirilgan'}</span>
          </div>
        </div>

        <h3 className={styles.sectionTitle}>Shaxsiy ma’lumot (faqat do‘kon ichida)</h3>
        <p className={styles.privateNote}>
          Quyidagi maydonlar hech qachon ommaviy QR sahifasida ko‘rsatilmaydi.
        </p>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Mijoz ismi</span>
            <span className={styles.privateValue}>{card.customer_name ?? '—'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Telefon</span>
            <span className={styles.privateValue}>{card.customer_phone ?? '—'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Email</span>
            <span className={styles.privateValue}>{card.customer_email ?? '—'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Seriya raqami</span>
            <span className={styles.privateValue}>{card.serial_number ?? '—'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Ichki izoh</span>
            <span className={styles.privateValue}>{card.notes ?? '—'}</span>
          </div>
        </div>

        <div className={styles.actions}>
          <Link to={`/warranties/${card.id}/edit`}>
            <Button type="button">Tahrirlash</Button>
          </Link>
          <Link to="/warranties">
            <Button type="button" variant="secondary">
              Ro‘yxatga qaytish
            </Button>
          </Link>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>QR kod</h3>
          {qrError ? <Alert kind="error">{qrError}</Alert> : null}
          {qrToken ? (
            <div>
              {qrDataUrl ? (
                <div className={styles.qrContainer}>
                  <img src={qrDataUrl} alt="Kafolat kartasi QR kodi" className={styles.qrImage} />
                </div>
              ) : null}
              <p className={styles.cellMuted}>
                QR kodni skanerlang yoki quyidagi havolani ishlating. Token faqat bir marta
                ko‘rsatiladi.
              </p>
              <div className={styles.actions}>
                <Button type="button" variant="secondary" onClick={handleRevokeQr} disabled={qrLoading}>
                  {qrLoading ? 'Bekor qilinmoqda…' : 'QR token bekor qilish'}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button type="button" onClick={handleGenerateQr} disabled={qrLoading}>
                {qrLoading ? 'Yaratilmoqda…' : 'QR token yaratish'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default WarrantyDetailPage
