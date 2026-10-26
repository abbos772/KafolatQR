import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useStores } from '../../context/StoreContext'
import { Alert, Button, Spinner, TextField } from '../../components/ui'
import styles from './CreateStorePage.module.css'

/**
 * First-store onboarding.
 *
 * The store is created with `owner_id` taken from the authenticated session; the
 * `stores_insert` RLS policy independently requires `owner_id = auth.uid()`, and
 * the `on_store_created` trigger inserts the owner membership server-side. This
 * page therefore never writes to `store_members` and never accepts a user id,
 * store id or role from the URL/query/form as proof of authorization.
 */
export function CreateStorePage() {
  const { user } = useAuth()
  const { stores, loading, createStore, error: storeError } = useStores()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>(undefined)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already owns a store -> onboarding must never reappear.
  useEffect(() => {
    if (!loading && stores.length > 0) {
      navigate('/', { replace: true })
    }
  }, [loading, stores.length, navigate])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setFieldError('Do‘kon nomi kamida 2 ta belgidan iborat bo‘lishi kerak.')
      return
    }
    setFieldError(undefined)

    setSubmitting(true)
    try {
      await createStore(trimmed)
      navigate('/', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Do‘kon yaratib bo‘lmadi.'
      setFormError(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Spinner label="Yuklanmoqda…" />

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>KafolatQR</h1>
        <h2 className={styles.title}>Do‘koningizni yarating</h2>
        <p className={styles.subtitle}>
          Birinchi do‘kon — kafolat kartalari shu do‘kon nomidan chiqariladi. Keyin qo‘shimcha
          do‘konlar qo‘shish mumkin.
        </p>

        {formError ? <Alert kind="error">{formError}</Alert> : null}
        {storeError ? <Alert kind="error">{storeError}</Alert> : null}
        {user?.email ? (
          <Alert kind="info">
            Hisob: <strong>{user.email}</strong>
          </Alert>
        ) : null}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <TextField
            id="store-name"
            label="Do‘kon nomi"
            required
            autoComplete="organization"
            placeholder="Masalan: Texno Do‘kon"
            value={name}
            error={fieldError}
            onChange={(event) => setName(event.target.value)}
          />

          <div className={styles.actions}>
            <Button className={styles.submit} type="submit" disabled={submitting}>
              {submitting ? 'Yaratilmoqda…' : 'Do‘kon yaratish'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateStorePage
