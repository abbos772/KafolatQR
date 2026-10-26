import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStores } from '../../context/StoreContext'
import { listProducts } from '../../api/products'
import { getWarranty, updateWarranty } from '../../api/warranties'
import { toWarrantyPatch, type WarrantyFormSchemaValues } from '../../lib/warranty-schema'
import { WarrantyForm } from '../../components/WarrantyForm'
import { Alert, EmptyState, Spinner } from '../../components/ui'
import type { Product, WarrantyCard } from '../../types/db'
import styles from './warranty.module.css'

export function WarrantyEditPage() {
  const { id } = useParams<{ id: string }>()
  const { currentStoreId } = useStores()
  const navigate = useNavigate()

  const [card, setCard] = useState<WarrantyCard | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
        setLoadError(null)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Kafolat kartasini yuklab bo‘lmadi.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    // Prevents setState after unmount or after the record/store changes.
    return () => {
      cancelled = true
    }
  }, [id, currentStoreId])

  async function handleSubmit(validated: WarrantyFormSchemaValues) {
    const storeId = card?.store_id ?? currentStoreId
    if (!id || !storeId) return

    setSaveError(null)
    setSubmitting(true)
    try {
      // store_id is intentionally excluded: RLS pins the row to the caller's
      // stores, and sending a store_id would invite a cross-store write attempt.
      await updateWarranty(id, toWarrantyPatch(validated))
      navigate(`/warranties/${id}`, { replace: true })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Saqlab bo‘lmadi.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Spinner label="Yuklanmoqda…" />

  if (loadError || !card) {
    return (
      <div className={styles.container}>
        <EmptyState title="Kafolat kartasi topilmadi">
          <p>Yozuv mavjud emas yoki sizda uni tahrirlash uchun ruxsat yo‘q.</p>
          <p style={{ marginTop: '1rem' }}>
            <button className={styles.rowLink} type="button" onClick={() => navigate('/warranties')}>
              Ro‘yxatga qaytish
            </button>
          </p>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Kafolat kartasini tahrirlash</h1>
          <p className={styles.subtitle}>
            O‘chirish o‘rniga holatni “bekor qilingan”, “qaytarilgan” yoki “arxivlangan” qilib
            belgilang — yozuv saqlanib qoladi.
          </p>
        </div>
      </div>

      {saveError ? <Alert kind="error">{saveError}</Alert> : null}

      <WarrantyForm
        storeId={card.store_id}
        products={products}
        initialValues={card}
        submitting={submitting}
        submitLabel="O‘zgarishlarni saqlash"
        onSubmit={handleSubmit}
        onCancel={() => navigate(`/warranties/${card.id}`)}
      />
    </div>
  )
}

export default WarrantyEditPage
