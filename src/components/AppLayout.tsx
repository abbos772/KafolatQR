import { NavLink, Outlet } from 'react-router-dom'
import styles from './AppLayout.module.css'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '⊞' },
  { to: '/warranties', label: 'Warranties', icon: '☰' },
  { to: '/warranties/new', label: 'Create Warranty', icon: '+' },
  { to: '/store/settings', label: 'Settings', icon: '⚙' },
]

function AppLayout() {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>KafolatQR</div>
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
      </aside>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout
