import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { AuthActionError } from '../../lib/auth-errors'
import { Alert, Button, TextField } from '../../components/ui'
import styles from './auth.module.css'

const MIN_PASSWORD_LENGTH = 8

export function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string
    password?: string
    confirmPassword?: string
  }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setConfirmationSent(false)

    const nextErrors: typeof fieldErrors = {}
    if (email.trim() === '') nextErrors.email = 'Email manzilini kiriting.'
    if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Parol kamida ${MIN_PASSWORD_LENGTH} ta belgidan iborat bo‘lishi kerak.`
    }
    if (confirmPassword !== password) nextErrors.confirmPassword = 'Parollar mos kelmadi.'
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      const result = await signUp(email.trim(), password)

      if (result.needsEmailConfirmation) {
        // Supabase returns a user but no session: email confirmation is required.
        setConfirmationSent(true)
        return
      }

      // Immediate session (email confirmation disabled locally): go create a store.
      navigate('/onboarding/create-store', { replace: true })
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

  if (confirmationSent) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.brand}>KafolatQR</h1>
          <h2 className={styles.title}>Emailni tasdiqlang</h2>
          <p className={styles.subtitle}>
            <strong>{email}</strong> manziliga tasdiqlash havolasini yubordik.
          </p>
          <Alert kind="info">
            Havolani tasdiqlagach, quyidagi tugma bilan tizimga kirishingiz mumkin. Session
            yaratilmaguncha kafolat kartalariga kira olmaysiz.
          </Alert>
          <div className={styles.actions}>
            <Button className={styles.submit} type="button" onClick={() => navigate('/login')}>
              Kirish sahifasiga o‘tish
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>KafolatQR</h1>
        <h2 className={styles.title}>Ro‘yxatdan o‘tish</h2>
        <p className={styles.subtitle}>Do‘koningiz uchun raqamli kafolat kartalarini yarating.</p>

        {formError ? <Alert kind="error">{formError}</Alert> : null}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <TextField
            id="signup-email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            error={fieldErrors.email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            id="signup-password"
            label="Parol"
            type="password"
            autoComplete="new-password"
            required
            hint={`Kamida ${MIN_PASSWORD_LENGTH} ta belgi.`}
            value={password}
            error={fieldErrors.password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            id="signup-confirm-password"
            label="Parolni tasdiqlang"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            error={fieldErrors.confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />

          <div className={styles.actions}>
            <Button className={styles.submit} type="submit" disabled={submitting}>
              {submitting ? 'Yaratilmoqda…' : 'Hisob yaratish'}
            </Button>
          </div>
        </form>

        <p className={styles.footer}>
          Hisobingiz bormi? <Link to="/login">Tizimga kirish</Link>
        </p>
      </div>
    </div>
  )
}

export default SignupPage
