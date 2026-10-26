import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStores } from '../../context/StoreContext'
import { listProducts } from '../../api/products'
import { filterWarranties, listWarranties } from '../../api/warranties'
import {
  manufacturerWarrantyStatus,
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

export function WarrantyListPage() {
  const { currentStoreId } = useStores()

  const [cards, setCards] = useState<WarrantyCard[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [term, setTerm] = useState('')

  useEffect(() => {
    if (!currentStoreId) return

    let cancelled = false

    // State updates live after the await, i.e. in an async callback rather than
    // synchronously inside the effect body (which would cascade renders).
    void (async () => {
      try {
        const [nextCards, nextProducts] = await Promise.all([
          listWarranties(currentStoreId),
          listProducts(currentStoreId),
        ])
        if (cancelled) return

        setCards(nextCards)
        setProducts(nextProducts)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Kafolat kartalarini yuklab bo‘lmadi.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    // Prevents setState after unmount or after the active store changes.
    return () => {
      cancelled = true
    }
  }, [currentStoreId])

  const productNameById = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  )

  const visible = useMemo(
    () => filterWarranties(cards, term, productNameById),
    [cards, term, productNameById],
  )

  const today = todayIso()

  if (loading) return <Spinner label="Kafolat kartalari yuklanmoqda…" />

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Kafolat kartalari</h1>
          <p className={styles.subtitle}>Sotilgan qurilmalar va ularning kafolat muddati.</p>
        </div>
        <Link to="/warranties/new">
          <Button type="button">Yangi kafolat kartasi</Button>
        </Link>
      </div>

      {error ? <Alert kind="error">{error}</Alert> : null}

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Qidirish: mijoz, seriya raqami, mahsulot, holat…"
          aria-label="Kafolat kartalarini qidirish"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <span className={styles.resultCount}>
          {visible.length} ta yozuv{term.trim() !== '' ? ` (jami ${cards.length})` : ''}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState title={cards.length === 0 ? 'Hozircha kafolat kartasi yo‘q' : 'Hech narsa topilmadi'}>
          {cards.length === 0 ? (
            <p>
              Birinchi kartani yaratish uchun{' '}
              <Link className={styles.rowLink} to="/warranties/new">
                “Yangi kafolat kartasi”
              </Link>{' '}
              tugmasini bosing.
            </p>
          ) : (
            <p>Qidiruv so‘zini o‘zgartirib ko‘ring.</p>
          )}
        </EmptyState>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <caption className={styles.cellMuted}>
              Faqat siz egalik qilgan do‘konlarning kartalari ko‘rsatiladi.
            </caption>
            <thead>
              <tr>
                <th scope="col">Mahsulot</th>
                <th scope="col">Mijoz</th>
                <th scope="col">Seriya</th>
                <th scope="col">Xarid sanasi</th>
                <th scope="col">Tugash</th>
                <th scope="col">Holat</th>
                <th scope="col">Amal</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((card) => {
                const storeStatus = storeWarrantyStatus(
                  card.purchase_date,
                  card.store_warranty_months,
                  today,
                )
                const mfrStatus = manufacturerWarrantyStatus(
                  card.manufacturer_warranty_start,
                  card.manufacturer_warranty_months,
                  today,
                )
                return (
                  <tr key={card.id}>
                    <td>
                      <span className={styles.cellStrong}>
                        {productNameById.get(card.product_id) ?? '—'}
                      </span>
                    </td>
                    <td>
                      <div className={styles.cellStack}>
                        <span className={styles.cellStrong}>{card.customer_name ?? '—'}</span>
                        <span className={styles.cellMuted}>{card.customer_phone ?? ''}</span>
                      </div>
                    </td>
                    <td>
                      <span className={styles.cellMuted}>{card.serial_number ?? '—'}</span>
                    </td>
                    <td>{card.purchase_date}</td>
                    <td>{storeWarrantyExpiry(card.purchase_date, card.store_warranty_months)}</td>
                    <td>
                      <div className={styles.badgeRow}>
                        <StatusBadge
                          tone={LIFECYCLE_TONES[card.status]}
                          label={LIFECYCLE_LABELS[card.status]}
                        />
                        <StatusBadge
                          tone={STORE_STATUS_TONES[storeStatus]}
                          label={STORE_STATUS_LABELS[storeStatus]}
                        />
                        {mfrStatus !== 'not_known' ? (
                          <StatusBadge
                            tone={MANUFACTURER_STATUS_TONES[mfrStatus]}
                            label={MANUFACTURER_STATUS_LABELS[mfrStatus]}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <Link className={styles.rowLink} to={`/warranties/${card.id}`}>
                        Ko‘rish
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > 0 && cards.some((card) => card.manufacturer_warranty_months !== null) ? (
        <p className={styles.cellMuted} style={{ marginTop: '0.75rem' }}>
          Ishlab chiqaruvchi kafolati ma’lumotlari sotuvchi tomonidan kiritilgan va KafolatQR
          tomonidan tasdiqlanmagan.
        </p>
      ) : null}
    </div>
  )
}

export default WarrantyListPage
