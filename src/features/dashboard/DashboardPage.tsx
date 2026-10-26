import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStores } from '../../context/StoreContext'
import { listProducts } from '../../api/products'
import { listWarranties } from '../../api/warranties'
import { storeWarrantyStatus, todayIso } from '../../lib/warranty'
import { Alert, Button, EmptyState, Spinner, StatusBadge } from '../../components/ui'
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_TONES,
  STORE_STATUS_LABELS,
  STORE_STATUS_TONES,
} from '../warranty/status-labels'
import type { Product, WarrantyCard } from '../../types/db'
import styles from './DashboardPage.module.css'

export function DashboardPage() {
  const { currentStore, currentStoreId } = useStores()

  const [products, setProducts] = useState<Product[]>([])
  const [cards, setCards] = useState<WarrantyCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentStoreId) return

    let cancelled = false

    // State updates live after the await, i.e. in an async callback rather than
    // synchronously inside the effect body (which would cascade renders).
    void (async () => {
      try {
        const [nextProducts, nextCards] = await Promise.all([
          listProducts(currentStoreId),
          listWarranties(currentStoreId),
        ])
        if (cancelled) return

        setProducts(nextProducts)
        setCards(nextCards)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Statistikani yuklab bo‘lmadi.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    // Prevents setState after unmount or after the active store changes.
    return () => {
      cancelled = true
    }
  }, [currentStoreId])

  const today = todayIso()
  const activeCount = cards.filter(
    (card) => storeWarrantyStatus(card.purchase_date, card.store_warranty_months, today) === 'active',
  ).length
  const expiredCount = cards.length - activeCount
  const cancelledCount = cards.filter((card) => card.status !== 'active').length

  const productNameById = new Map(products.map((product) => [product.id, product.name]))
  const recent = cards.slice(0, 5)

  if (loading) return <Spinner label="Yuklanmoqda…" />

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Boshqaruv paneli</h1>
      <p className={styles.subtitle}>
        {currentStore ? `Do‘kon: ${currentStore.name}` : 'Faol do‘kon tanlanmagan'}
      </p>

      {error ? <Alert kind="error">{error}</Alert> : null}

      <div className={styles.cardGrid}>
        <div className={styles.card}>
          <div className={styles.cardValue}>{products.length}</div>
          <div className={styles.cardLabel}>Mahsulotlar</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardValue}>{activeCount}</div>
          <div className={styles.cardLabel}>Faol kafolat</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardValue}>{expiredCount}</div>
          <div className={styles.cardLabel}>Muddati o‘tgan</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardValue}>{cancelledCount}</div>
          <div className={styles.cardLabel}>Bekor/qaytarilgan/arxiv</div>
        </div>
      </div>

      <div className={styles.recentHeader}>
        <h2 className={styles.recentTitle}>So‘nggi kafolat kartalari</h2>
        <Link to="/warranties/new">
          <Button type="button" variant="secondary">
            Yangi kafolat kartasi
          </Button>
        </Link>
      </div>

      {recent.length === 0 ? (
        <EmptyState title="Hozircha kafolat kartasi yo‘q">
          <p>
            Birinchi kartani yaratish uchun{' '}
            <Link className={styles.link} to="/warranties/new">
              bu yerga
            </Link>{' '}
            bosing.
          </p>
        </EmptyState>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Mahsulot</th>
                <th scope="col">Mijoz</th>
                <th scope="col">Holat</th>
                <th scope="col">Amal</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((card) => (
                <tr key={card.id}>
                  <td>
                    <span className={styles.cellStrong}>
                      {productNameById.get(card.product_id) ?? '—'}
                    </span>
                  </td>
                  <td>{card.customer_name ?? '—'}</td>
                  <td>
                    <div className={styles.badgeRow}>
                      <StatusBadge
                        tone={LIFECYCLE_TONES[card.status]}
                        label={LIFECYCLE_LABELS[card.status]}
                      />
                      {card.status === 'active' ? (
                        <StatusBadge
                          tone={
                            STORE_STATUS_TONES[
                              storeWarrantyStatus(card.purchase_date, card.store_warranty_months, today)
                            ]
                          }
                          label={
                            STORE_STATUS_LABELS[
                              storeWarrantyStatus(card.purchase_date, card.store_warranty_months, today)
                            ]
                          }
                        />
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <Link className={styles.link} to={`/warranties/${card.id}`}>
                      Ko‘rish
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default DashboardPage
