import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { AuthActionError } from '../../lib/auth-errors'
import { Alert, Button, TextField } from '../../components/ui'
import styles from './auth.module.css'

interface LocationState {
  from?: string
}

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LocationState | null)?.from

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    const nextErrors: { email?: string; password?: string } = {}
    if (email.trim() === '') nextErrors.email = 'Email manzilini kiriting.'
    if (password === '') nextErrors.password = 'Parolni kiriting.'
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
      navigate(from ?? '/', { replace: true })
    } catch (error) {
      setFormError(
        error instanceof AuthActionError
          ? error.message
          : 'Kutilmagan xatolik yuz berdi. Qayta urinib ko‘ring.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>KafolatQR</h1>
        <h2 className={styles.title}>Tizimga kirish</h2>
        <p className={styles.subtitle}>Kafolat kartalaringizni boshqarish uchun kiring.</p>

        {formError ? <Alert kind="error">{formError}</Alert> : null}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <TextField
            id="login-email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            error={fieldErrors.email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            id="login-password"
            label="Parol"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <div className={styles.actions}>
            <Button className={styles.submit} type="submit" disabled={submitting}>
              {submitting ? 'Kiritilmoqda…' : 'Kirish'}
            </Button>
          </div>
        </form>

        <p className={styles.footer}>
          Hisobingiz yo‘qmi? <Link to="/signup">Ro‘yxatdan o‘tish</Link>
        </p>
      </div>
    </div>
  )
}

export default LoginPage
