import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useStores } from '../context/StoreContext'
import { Button, Spinner } from './ui'
import styles from './AppLayout.module.css'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '⊞' },
  { to: '/warranties', label: 'Warranties', icon: '☰' },
  { to: '/warranties/new', label: 'Create Warranty', icon: '+' },
  { to: '/store/settings', label: 'Settings', icon: '⚙' },
]

function AppLayout() {
  const { user, signOut } = useAuth()
  const { stores, currentStore, currentStoreId, loading, selectStore, error } = useStores()
  const location = useLocation()

  const onOnboarding = location.pathname === '/onboarding/create-store'

  // Wait for the store list before rendering: the gate below needs to know whether
  // this user owns a store. RLS, not this redirect, is what actually protects data.
  if (loading) return <Spinner label="Do‘kon yuklanmoqda…" />

  if (error) {
    return (
      <div className={styles.main}>
        <p className={styles.loadError} role="alert">
          Do‘kon ma’lumotlarini yuklab bo‘lmadi: {error}
        </p>
      </div>
    )
  }

  if (!currentStore && !onOnboarding) {
    return <Navigate to="/onboarding/create-store" replace />
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>KafolatQR</div>

        {stores.length > 1 ? (
          <div className={styles.storeSelector}>
            <label className={styles.storeLabel} htmlFor="store-select">
              Faol do‘kon
            </label>
            <select
              id="store-select"
              className={styles.storeSelect}
              value={currentStoreId ?? ''}
              onChange={(event) => selectStore(event.target.value)}
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </div>
        ) : currentStore ? (
          <div className={styles.storeSelector}>
            <span className={styles.storeLabel}>Do‘kon</span>
            <span className={styles.storeName}>{currentStore.name}</span>
          </div>
        ) : null}

        <nav className={styles.nav} aria-label="Main navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.userBox}>
          <span className={styles.userEmail} title={user?.email ?? ''}>
            {user?.email ?? '—'}
          </span>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              void signOut().then(() => {
                window.location.assign('/login')
              })
            }}
          >
            Chiqish
          </Button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout
