import styles from './WarrantyListPage.module.css'

function WarrantyListPage() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Warranties</h1>
      <p className={styles.subtitle}>Manage warranty cards</p>
      <div className={styles.empty}>
        <p>No warranties yet. Create your first warranty card to get started.</p>
      </div>
    </div>
  )
}

export default WarrantyListPage
