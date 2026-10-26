import { Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { LoginPage } from './features/auth/LoginPage'
import { SignupPage } from './features/auth/SignupPage'
import { CreateStorePage } from './features/onboarding/CreateStorePage'
import { WarrantyListPage } from './features/warranty/WarrantyListPage'
import { WarrantyCreatePage } from './features/warranty/WarrantyCreatePage'
import { WarrantyDetailPage } from './features/warranty/WarrantyDetailPage'
import { WarrantyEditPage } from './features/warranty/WarrantyEditPage'
import StoreSettingsPage from './features/settings/StoreSettingsPage'
import { VerifyPage } from './features/verify/VerifyPage'

function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnlyRoute>
            <SignupPage />
          </PublicOnlyRoute>
        }
      />

      <Route
        path="/onboarding/create-store"
        element={
          <ProtectedRoute>
            <CreateStorePage />
          </ProtectedRoute>
        }
      />

      <Route path="/verify" element={<VerifyPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="warranties" element={<WarrantyListPage />} />
        <Route path="warranties/new" element={<WarrantyCreatePage />} />
        <Route path="warranties/:id" element={<WarrantyDetailPage />} />
        <Route path="warranties/:id/edit" element={<WarrantyEditPage />} />
        <Route path="store/settings" element={<StoreSettingsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Route>
    </Routes>
  )
}

export default App
