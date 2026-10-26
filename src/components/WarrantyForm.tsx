import { useMemo, useState, type FormEvent } from 'react'
import { createProduct } from '../api/products'
import type {
  Product,
  WarrantyCard,
  WarrantyFormValues,
  WarrantyLifecycleStatus,
} from '../types/db'
import {
  manufacturerWarrantyStatus,
  storeWarrantyExpiry,
  storeWarrantyStatus,
  todayIso,
} from '../lib/warranty'
import {
  validateManufacturerPair,
  warrantyFormSchema,
  WARRANTY_STATUSES,
  type WarrantyFormSchemaValues,
} from '../lib/warranty-schema'
import { Alert, Button, CheckboxField, SelectField, TextField } from './ui'
import styles from '../features/warranty/warranty.module.css'

interface WarrantyFormProps {
  storeId: string
  products: Product[]
  initialValues?: WarrantyCard | null
  submitting: boolean
  submitLabel: string
  /** Receives zod-validated values, not raw form state. */
  onSubmit: (values: WarrantyFormSchemaValues) => Promise<void>
  onCancel: () => void
}

function toFormValues(card: WarrantyCard | null | undefined): WarrantyFormValues {
  if (!card) {
    return {
      product_id: '',
      serial_number: '',
      customer_name: '',
      customer_phone: '',
      customer_email: '',
      purchase_date: todayIso(),
      store_warranty_months: 12,
      manufacturer_warranty_months: '',
      manufacturer_warranty_start: '',
      manufacturer_claim_url: '',
      status: 'active',
      is_qr_visible: true,
      notes: '',
    }
  }

  return {
    product_id: card.product_id,
    serial_number: card.serial_number ?? '',
    customer_name: card.customer_name ?? '',
    customer_phone: card.customer_phone ?? '',
    customer_email: card.customer_email ?? '',
    purchase_date: card.purchase_date,
    store_warranty_months: card.store_warranty_months,
    manufacturer_warranty_months: card.manufacturer_warranty_months ?? '',
    manufacturer_warranty_start: card.manufacturer_warranty_start ?? '',
    manufacturer_claim_url: card.manufacturer_claim_url ?? '',
    status: card.status,
    is_qr_visible: card.is_qr_visible,
    notes: card.notes ?? '',
  }
}

function toPositiveIntOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** Maps a database/RLS error to a safe, actionable sentence. */
function toFormErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message
    if (message.includes('warranty_cards_product_same_store')) {
      return 'Tanlangan mahsulot boshqa do‘konga tegishli. Boshqa mahsulot tanlang.'
    }
    if (message.includes('purchase_date')) {
      return 'Xarid sanasi bugungi kundan oldingi sana bo‘lishi kerak.'
    }
    if (message.includes('manufacturer_claim_url')) {
      return 'Ishlab chiqaruvchi havolasi faqat https:// bilan boshlanishi kerak.'
    }
    if (message.includes('permission denied') || message.includes('row-level security')) {
      return 'Bu amal uchun ruxsat yo‘q.'
    }
    return message
  }
  return 'Saqlab bo‘lmadi. Qayta urinib ko‘ring.'
}

export function WarrantyForm({
  storeId,
  products,
  initialValues,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: WarrantyFormProps) {
  const [values, setValues] = useState<WarrantyFormValues>(() => toFormValues(initialValues))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  const [newProduct, setNewProduct] = useState({ name: '', sku: '', manufacturer: '' })
  const [productBusy, setProductBusy] = useState(false)
  const [productMessage, setProductMessage] = useState<string | null>(null)
  const [localProducts, setLocalProducts] = useState<Product[]>([])

  const availableProducts = useMemo(
    () => [...products, ...localProducts],
    [products, localProducts],
  )

  // Live preview computed with the SAME rule the public verification endpoint uses.
  const preview = useMemo(() => {
    const months = Number(values.store_warranty_months)
    if (
      values.purchase_date.trim() === '' ||
      !Number.isInteger(months) ||
      months <= 0
    ) {
      return null
    }
    const expiry = storeWarrantyExpiry(values.purchase_date, months)
    return {
      expiry,
      storeStatus: storeWarrantyStatus(values.purchase_date, months, todayIso()),
      manufacturerStatus: manufacturerWarrantyStatus(
        values.manufacturer_warranty_start.trim() === '' ? null : values.manufacturer_warranty_start,
        toPositiveIntOrNull(String(values.manufacturer_warranty_months)),
        todayIso(),
      ),
    }
  }, [values.purchase_date, values.store_warranty_months, values.manufacturer_warranty_start, values.manufacturer_warranty_months])

  function setField<K extends keyof WarrantyFormValues>(key: K, value: WarrantyFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }))
  }

  async function handleAddProduct() {
    setProductMessage(null)
    if (newProduct.name.trim().length < 2 || newProduct.sku.trim().length < 1) {
      setProductMessage('Mahsulot nomi va SKU kiritilishi shart.')
      return
    }

    setProductBusy(true)
    try {
      const created = await createProduct({
        store_id: storeId,
        sku: newProduct.sku.trim(),
        name: newProduct.name.trim(),
        manufacturer: newProduct.manufacturer,
      })
      setLocalProducts((previous) => [...previous, created])
      setField('product_id', created.id)
      setNewProduct({ name: '', sku: '', manufacturer: '' })
    } catch (error) {
      setProductMessage(
        error instanceof Error ? error.message : 'Mahsulot qo‘shib bo‘lmadi.',
      )
    } finally {
      setProductBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setFormSuccess(null)

    const errors: Record<string, string> = {}

    if (values.product_id === '') errors.product_id = 'Mahsulotni tanlang.'
    if (values.purchase_date.trim() === '') {
      errors.purchase_date = 'Xarid sanasini kiriting.'
    } else if (values.purchase_date > todayIso()) {
      errors.purchase_date = 'Xarid sanasi bugungi kundan keyin bo‘lmasligi kerak.'
    }

    const months = Number(values.store_warranty_months)
    if (!Number.isInteger(months) || months <= 0) {
      errors.store_warranty_months = 'Kafolat muddati musbat butun son bo‘lishi kerak.'
    }

    if (values.customer_email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.customer_email)) {
      errors.customer_email = 'Email manzil noto‘g‘ri.'
    }

    if (
      values.manufacturer_claim_url.trim() !== '' &&
      !values.manufacturer_claim_url.startsWith('https://')
    ) {
      errors.manufacturer_claim_url = 'Faqat https:// havolalar qabul qilinadi.'
    }

    const manufacturerIssue = validateManufacturerPair(values)
    if (manufacturerIssue) errors.manufacturer_warranty_start = manufacturerIssue

    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    // Full shape check with the shared schema; only do we send anything.
    const parsed = warrantyFormSchema.safeParse(values)
    if (!parsed.success) {
      const schemaErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '')
        if (key && !schemaErrors[key]) schemaErrors[key] = issue.message
      }
      setFieldErrors(schemaErrors)
      return
    }

    try {
      await onSubmit(parsed.data)
      setFormSuccess('Kafolat kartasi saqlandi.')
    } catch (error) {
      setFormError(toFormErrorMessage(error))
    }
  }

  const statusLabels: Record<WarrantyLifecycleStatus, string> = {
    active: 'Faol',
    cancelled: 'Bekor qilingan',
    returned: 'Qaytarilgan',
    archived: 'Arxivlangan',
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {formError ? <Alert kind="error">{formError}</Alert> : null}
      {formSuccess ? <Alert kind="success">{formSuccess}</Alert> : null}

      {availableProducts.length === 0 ? (
        <div className={styles.inlineProduct}>
          <h3 className={styles.sectionTitle}>Avval mahsulot qo‘shing</h3>
          <TextField
            id="new-product-name"
            label="Mahsulot nomi"
            required
            value={newProduct.name}
            onChange={(event) => setNewProduct((p) => ({ ...p, name: event.target.value }))}
          />
          <TextField
            id="new-product-sku"
            label="SKU"
            required
            value={newProduct.sku}
            onChange={(event) => setNewProduct((p) => ({ ...p, sku: event.target.value }))}
          />
          <TextField
            id="new-product-manufacturer"
            label="Ishlab chiqaruvchi (ixtiyoriy)"
            value={newProduct.manufacturer}
            onChange={(event) => setNewProduct((p) => ({ ...p, manufacturer: event.target.value }))}
          />
          {productMessage ? <Alert kind="error">{productMessage}</Alert> : null}
          <Button type="button" variant="secondary" disabled={productBusy} onClick={handleAddProduct}>
            {productBusy ? 'Qo‘shilmoqda…' : 'Mahsulot qo‘shish'}
          </Button>
        </div>
      ) : (
        <>
          <SelectField
            id="warranty-product"
            label="Mahsulot"
            required
            value={values.product_id}
            error={fieldErrors.product_id}
            onChange={(event) => setField('product_id', event.target.value)}
          >
            <option value="">— Mahsulotni tanlang —</option>
            {availableProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
                {product.sku ? ` (${product.sku})` : ''}
              </option>
            ))}
          </SelectField>
          <div className={styles.inlineProduct}>
            <h3 className={styles.sectionTitle}>Yangi mahsulot qo‘shish</h3>
            <TextField
              id="new-product-name"
              label="Mahsulot nomi"
              required
              value={newProduct.name}
              onChange={(event) => setNewProduct((p) => ({ ...p, name: event.target.value }))}
            />
            <TextField
              id="new-product-sku"
              label="SKU"
              required
              value={newProduct.sku}
              onChange={(event) => setNewProduct((p) => ({ ...p, sku: event.target.value }))}
            />
            <TextField
              id="new-product-manufacturer"
              label="Ishlab chiqaruvchi (ixtiyoriy)"
              value={newProduct.manufacturer}
              onChange={(event) => setNewProduct((p) => ({ ...p, manufacturer: event.target.value }))}
            />
            {productMessage ? <Alert kind="error">{productMessage}</Alert> : null}
            <Button type="button" variant="secondary" disabled={productBusy} onClick={handleAddProduct}>
              {productBusy ? 'Qo‘shilmoqda…' : 'Mahsulot qo‘shish'}
            </Button>
          </div>
        </>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Do‘kon kafolati</h3>
        <TextField
          id="warranty-purchase-date"
          label="Xarid sanasi"
          type="date"
          required
          value={values.purchase_date}
          error={fieldErrors.purchase_date}
          onChange={(event) => setField('purchase_date', event.target.value)}
        />
        <TextField
          id="warranty-months"
          label="Kafolat muddati (oy)"
          type="number"
          min={1}
          step={1}
          required
          value={String(values.store_warranty_months)}
          error={fieldErrors.store_warranty_months}
          onChange={(event) => setField('store_warranty_months', Number(event.target.value))}
        />
        {preview ? (
          <p className={styles.preview}>
            Tugash sanasi: <strong>{preview.expiry}</strong> — holat:{' '}
            <strong>{preview.storeStatus === 'active' ? 'faol' : 'muddati o‘tgan'}</strong>
          </p>
        ) : null}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Ishlab chiqaruvchi kafolati (ixtiyoriy)</h3>
        <TextField
          id="warranty-mfr-start"
          label="Boshlanish sanasi"
          type="date"
          value={values.manufacturer_warranty_start}
          error={fieldErrors.manufacturer_warranty_start}
          hint="Xarid sanasidan farq qilishi mumkin. Bo‘sh qoldirilsa, holat “noma’lum” bo‘ladi."
          onChange={(event) => setField('manufacturer_warranty_start', event.target.value)}
        />
        <TextField
          id="warranty-mfr-months"
          label="Muddat (oy)"
          type="number"
          min={1}
          step={1}
          value={String(values.manufacturer_warranty_months)}
          onChange={(event) =>
            setField('manufacturer_warranty_months', event.target.value === '' ? '' : Number(event.target.value))
          }
        />
        <TextField
          id="warranty-mfr-url"
          label="Ishlab chiqaruvchi tekshiruv havolasi"
          type="url"
          placeholder="https://manufacturer.example/verify"
          value={values.manufacturer_claim_url}
          error={fieldErrors.manufacturer_claim_url}
          hint="Faqat https://. Bu ma’lumot sotuvchi tomonidan kiritilgan va KafolatQR tomonidan tasdiqlanmagan."
          onChange={(event) => setField('manufacturer_claim_url', event.target.value)}
        />
        {preview ? (
          <p className={styles.preview}>
            Ishlab chiqaruvchi kafolati holati:{' '}
            <strong>
              {preview.manufacturerStatus === 'not_known'
                ? 'noma’lum'
                : preview.manufacturerStatus === 'active'
                  ? 'faol'
                  : 'muddati o‘tgan'}
            </strong>
          </p>
        ) : null}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Mijoz va qurilma (shaxsiy ma’lumot)</h3>
        <TextField
          id="warranty-serial"
          label="Seriya raqami"
          value={values.serial_number}
          onChange={(event) => setField('serial_number', event.target.value)}
          hint="Ixtiyoriy. Bu maydon hech qachon ommaviy QR sahifasida ko‘rsatilmaydi."
        />
        <TextField
          id="warranty-customer-name"
          label="Mijoz ismi"
          value={values.customer_name}
          onChange={(event) => setField('customer_name', event.target.value)}
        />
        <TextField
          id="warranty-customer-phone"
          label="Telefon"
          type="tel"
          value={values.customer_phone}
          onChange={(event) => setField('customer_phone', event.target.value)}
        />
        <TextField
          id="warranty-customer-email"
          label="Email"
          type="email"
          value={values.customer_email}
          error={fieldErrors.customer_email}
          onChange={(event) => setField('customer_email', event.target.value)}
        />
        <TextField
          id="warranty-notes"
          label="Ichki izoh"
          value={values.notes}
          onChange={(event) => setField('notes', event.target.value)}
          hint="Faqat do‘kon ichida ko‘rinadi; audit jurnaliga yozilmaydi."
        />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Yozuv holati</h3>
        <SelectField
          id="warranty-status"
          label="Holat"
          value={values.status}
          onChange={(event) => setField('status', event.target.value as WarrantyLifecycleStatus)}
        >
          {WARRANTY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </SelectField>
        <CheckboxField
          id="warranty-qr-visible"
          label="QR orqali ko‘rinadi"
          checked={values.is_qr_visible}
          hint="O‘chirilsa, havola “topilmadi” natijasini qaytaradi."
          onChange={(checked) => setField('is_qr_visible', checked)}
        />
      </div>

      <div className={styles.actions}>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saqlanmoqda…' : submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Bekor qilish
        </Button>
      </div>
    </form>
  )
}

export default WarrantyForm
