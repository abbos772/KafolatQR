import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import styles from './ui.module.css'

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({ variant = 'primary', className, ...rest }: ButtonProps) {
  const variantClass =
    variant === 'primary' ? styles.primary : variant === 'secondary' ? styles.secondary : styles.ghost
  return <button className={`${styles.button} ${variantClass} ${className ?? ''}`} {...rest} />
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                */
/* -------------------------------------------------------------------------- */

function describedBy(id: string, errorId?: string, hintId?: string): string | undefined {
  const ids = [errorId ? `${id}-error` : null, hintId ? `${id}-hint` : null].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  error?: string
  hint?: string
  required?: boolean
}

export function TextField({ id, label, error, hint, required, ...rest }: TextFieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <input
        id={id}
        className={`${styles.control} ${error ? styles.controlInvalid : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error ? id : undefined, hint ? id : undefined)}
        aria-required={required ? true : undefined}
        {...rest}
      />
      {hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className={styles.errorText} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string
  label: string
  error?: string
  hint?: string
  required?: boolean
}

export function SelectField({
  id,
  label,
  error,
  hint,
  required,
  children,
  ...rest
}: SelectFieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <select
        id={id}
        className={`${styles.control} ${error ? styles.controlInvalid : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error ? id : undefined, hint ? id : undefined)}
        {...rest}
      >
        {children}
      </select>
      {hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className={styles.errorText} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

interface CheckboxFieldProps {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}

export function CheckboxField({ id, label, checked, onChange, hint }: CheckboxFieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />{' '}
        {label}
      </label>
      {hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

interface AlertProps {
  kind: 'error' | 'success' | 'info'
  children: ReactNode
}

export function Alert({ kind, children }: AlertProps) {
  const cls =
    kind === 'error'
      ? styles.alertError
      : kind === 'success'
        ? styles.alertSuccess
        : styles.alertInfo
  return (
    <div className={`${styles.alert} ${cls}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function Spinner({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div className={styles.spinnerRow} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      {children}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Status badges                                                              */
/* -------------------------------------------------------------------------- */

export type LifecycleBadgeTone = 'active' | 'expired' | 'not_known' | 'cancelled' | 'returned' | 'archived'

/**
 * One badge per concept, so lifecycle and computed expiry are never conflated:
 *   lifecycle : active | cancelled | returned | archived   (record state)
 *   expiry    : active | expired                           (computed from dates)
 *   manufacturer: active | expired | not_known             (computed, often unknown)
 */
export function StatusBadge({ tone, label }: { tone: LifecycleBadgeTone; label: string }) {
  const cls =
    tone === 'active'
      ? styles.badgeActive
      : tone === 'expired'
        ? styles.badgeExpired
        : tone === 'not_known'
          ? styles.badgeUnknown
          : tone === 'cancelled'
            ? styles.badgeCancelled
            : tone === 'returned'
              ? styles.badgeReturned
              : styles.badgeArchived

  return (
    <span className={`${styles.badge} ${cls}`} data-tone={tone}>
      {label}
    </span>
  )
}
