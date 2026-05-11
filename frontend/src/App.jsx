import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import PrivateRoute from './router/PrivateRoute'
import RoleRoute from './router/RoleRoute'
import VoidTerminal from './components/effects/VoidTerminal'
import { VOID_PATH } from './lib/voidPath'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import ContractBoard from './pages/ContractBoard'
import IntelBroker from './pages/IntelBroker'
import BountyBoard from './pages/BountyBoard'
import TeamPage from './pages/TeamPage'
import OperativeProfile from './pages/OperativeProfile'
import AdminDashboard from './pages/dashboards/AdminDashboard'
import ContractorDashboard from './pages/dashboards/ContractorDashboard'
import HandlerDashboard from './pages/dashboards/HandlerDashboard'
import OperativeDashboard from './pages/dashboards/OperativeDashboard'
import Stats from './pages/Stats'
import Onboarding from './pages/Onboarding'
import ProfileSettings from './pages/ProfileSettings'
import VoidBoard from './pages/VoidBoard'
import NullGate from './pages/NullGate'
import VerifyEmail from './pages/VerifyEmail'
import ResetPassword from './pages/ResetPassword'
import RegisterContractor from './pages/RegisterContractor'
import RegisterHandler from './pages/RegisterHandler'
import PendingApproval from './pages/PendingApproval'
import StaffOnboarding from './pages/StaffOnboarding'
import AdminActivation from './pages/AdminActivation'
import AdminOnboarding from './pages/AdminOnboarding'
import NotFound from './pages/NotFound'
import Events from './pages/Events'
import EventArchive from './pages/EventArchive'
import ArchitectDashboard from './pages/dashboards/ArchitectDashboard'
import ArchitectRoute from './router/ArchitectRoute'
import MaintenanceGate from './components/ui/MaintenanceGate'
import { useEffect, useState } from 'react'
import client from './api/client'

function BountyBoardRoute() {
  const { user } = useAuth()
  const [allowed, setAllowed] = useState(null)

  useEffect(() => {
    client.get('/public/settings').then(r => {
      setAllowed(!!r.data.bounty_board_public || !!user)
    }).catch(() => setAllowed(!!user))
  }, [user])

  if (allowed === null) return null
  if (!allowed) return <Navigate to="/login" replace />
  return <BountyBoard />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {/* Hidden terminal — key sequence ↑↑↓↓S0L, auth pages excluded */}
        <VoidTerminal />
        <MaintenanceGate>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register/contractor" element={<RegisterContractor />} />
          <Route path="/register/handler" element={<RegisterHandler />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/admin/activate" element={<AdminActivation />} />
          <Route path="/pending-approval" element={<PendingApproval />} />
          <Route path="/null/gate" element={<NullGate />} />

          {/* Protected — all authenticated roles */}
          {/* Bounty board — public or auth-gated depending on platform setting */}
          <Route path="/bounty-board" element={<BountyBoardRoute />} />

          <Route element={<PrivateRoute />}>
            <Route path="/contracts" element={<ContractBoard />} />
            <Route path="/intel" element={<IntelBroker />} />
            <Route path="/teams" element={<TeamPage />} />
            <Route path="/teams/:id" element={<TeamPage />} />
            <Route path="/operatives/:id" element={<OperativeProfile />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/staff-onboarding" element={<StaffOnboarding />} />
            <Route path="/settings" element={<ProfileSettings />} />
            <Route path={VOID_PATH || '__void_missing__'} element={<VoidBoard />} />

              {/* Admin Events page */}
            <Route path="/events" element={<Events />} />
            <Route path="/events/history" element={<EventArchive />} />

            {/* Role dashboards */}
            <Route
              path="/admin/onboarding"
              element={<RoleRoute roles={['ADMIN']}><AdminOnboarding /></RoleRoute>}
            />
            <Route
              path="/admin/*"
              element={<RoleRoute roles={['ADMIN']}><AdminDashboard /></RoleRoute>}
            />
            <Route
              path="/contractor/*"
              element={<RoleRoute roles={['ADMIN', 'CONTRACTOR']}><ContractorDashboard /></RoleRoute>}
            />
            <Route
              path="/handler/*"
              element={<RoleRoute roles={['ADMIN', 'HANDLER']}><HandlerDashboard /></RoleRoute>}
            />
            <Route
              path="/operative/*"
              element={<RoleRoute roles={['OPERATIVE']}><OperativeDashboard /></RoleRoute>}
            />
          </Route>

          {/* Architect-only — returns 404 to everyone else */}
          <Route
            path="/architect/dashboard"
            element={<ArchitectRoute><ArchitectDashboard /></ArchitectRoute>}
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
        </MaintenanceGate>
      </BrowserRouter>
    </AuthProvider>
  )
}
