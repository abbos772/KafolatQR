import styles from './DashboardPage.module.css'

function DashboardPage() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Dashboard</h1>
      <p className={styles.subtitle}>Store overview and statistics</p>
      <div className={styles.cardGrid}>
        <div className={styles.card}>
          <div className={styles.cardValue}>—</div>
          <div className={styles.cardLabel}>Total Products</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardValue}>—</div>
          <div className={styles.cardLabel}>Active Warranties</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardValue}>—</div>
          <div className={styles.cardLabel}>Expired Warranties</div>
        </div>
      </div>
      <p className={styles.note}>Data will be available after database setup.</p>
    </div>
  )
}

export default DashboardPage
