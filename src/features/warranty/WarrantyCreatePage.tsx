import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStores } from '../../context/StoreContext'
import { listProducts } from '../../api/products'
import { createWarranty } from '../../api/warranties'
import { toWarrantyInsert, type WarrantyFormSchemaValues } from '../../lib/warranty-schema'
import { WarrantyForm } from '../../components/WarrantyForm'
import { Spinner } from '../../components/ui'
import type { Product } from '../../types/db'
import styles from './warranty.module.css'

export function WarrantyCreatePage() {
  const { currentStoreId } = useStores()
  const navigate = useNavigate()

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!currentStoreId) return

    let cancelled = false

    // State updates live after the await, i.e. in an async callback rather than
    // synchronously inside the effect body (which would cascade renders).
    void (async () => {
      try {
        const nextProducts = await listProducts(currentStoreId)
        if (cancelled) return

        setProducts(nextProducts)
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Mahsulotlarni yuklab bo‘lmadi.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    // Prevents setState after unmount or after the active store changes.
    return () => {
      cancelled = true
    }
  }, [currentStoreId])

  async function handleSubmit(validated: WarrantyFormSchemaValues) {
    if (!currentStoreId) throw new Error('Faol do‘kon tanlanmagan.')

    setSubmitting(true)
    try {
      const created = await createWarranty(toWarrantyInsert(validated, currentStoreId))
      navigate(`/warranties/${created.id}`, { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Spinner label="Yuklanmoqda…" />

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Yangi kafolat kartasi</h1>
          <p className={styles.subtitle}>Sotilgan qurilma va uning kafolat shartlari.</p>
        </div>
      </div>

      {loadError ? <p className={styles.detailValue}>{loadError}</p> : null}

      <WarrantyForm
        storeId={currentStoreId ?? ''}
        products={products}
        submitting={submitting}
        submitLabel="Kafolat kartasini saqlash"
        onSubmit={handleSubmit}
        onCancel={() => navigate('/warranties')}
      />
    </div>
  )
}

export default WarrantyCreatePage
