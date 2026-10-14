import { Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DashboardPage from './features/dashboard/DashboardPage'
import WarrantyListPage from './features/warranty/WarrantyListPage'
import WarrantyCreatePage from './features/warranty/WarrantyCreatePage'
import StoreSettingsPage from './features/settings/StoreSettingsPage'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="warranties" element={<WarrantyListPage />} />
        <Route path="warranties/new" element={<WarrantyCreatePage />} />
        <Route path="store/settings" element={<StoreSettingsPage />} />
      </Route>
    </Routes>
  )
}

export default App
