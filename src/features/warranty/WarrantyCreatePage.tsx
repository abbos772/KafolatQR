import styles from './WarrantyCreatePage.module.css'

function WarrantyCreatePage() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Create Warranty</h1>
      <p className={styles.subtitle}>Issue a new warranty card</p>
      <div className={styles.empty}>
        <p>Warranty creation form will be available after database setup.</p>
      </div>
    </div>
  )
}

export default WarrantyCreatePage
