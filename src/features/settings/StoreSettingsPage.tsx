import styles from './StoreSettingsPage.module.css'

function StoreSettingsPage() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Settings</h1>
      <p className={styles.subtitle}>Store profile and subscription</p>
      <div className={styles.empty}>
        <p>Store settings will be available after database setup.</p>
      </div>
    </div>
  )
}

export default StoreSettingsPage
