import { createContext, useContext, useState } from 'react'
import client from '../api/client'

const AuthContext = createContext(null)

const PENDING_TOKEN_KEY = 'deadnet_pending_token'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('deadnet_user')
    return stored ? JSON.parse(stored) : null
  })

  const login = async (username, password) => {
    const { data } = await client.post('/auth/login', { username, password })
    localStorage.setItem('deadnet_access_token', data.access_token)
    // Architect has no refresh token — omit rather than store empty string
    if (data.refresh_token) {
      localStorage.setItem('deadnet_refresh_token', data.refresh_token)
    } else {
      localStorage.removeItem('deadnet_refresh_token')
    }

    const { data: me } = await client.get('/auth/me')
    localStorage.setItem('deadnet_user', JSON.stringify(me))
    setUser(me)
    const _needsOnboarding =
      !me.onboarding_complete &&
      (me.role === 'OPERATIVE' || me.role === 'CONTRACTOR' || me.role === 'HANDLER')
    return { ...me, _needsOnboarding }
  }

  const logout = async () => {
    try {
      await client.post('/auth/logout')
    } catch {
      // Proceed even if the server-side blacklist fails
    }
    localStorage.removeItem('deadnet_access_token')
    localStorage.removeItem('deadnet_refresh_token')
    localStorage.removeItem('deadnet_user')
    setUser(null)
  }

  const register = async (username, email, password) => {
    const { data } = await client.post('/auth/register', { username, email, password })
    return data
  }

  // Used by verify-email and reset-password flows that receive tokens directly
  const loginWithTokens = async (access_token, refresh_token) => {
    localStorage.setItem('deadnet_access_token', access_token)
    if (refresh_token) {
      localStorage.setItem('deadnet_refresh_token', refresh_token)
    } else {
      localStorage.removeItem('deadnet_refresh_token')
    }
    const { data: me } = await client.get('/auth/me')
    localStorage.setItem('deadnet_user', JSON.stringify(me))
    setUser(me)
    const _needsOnboarding =
      !me.onboarding_complete &&
      (me.role === 'OPERATIVE' || me.role === 'CONTRACTOR' || me.role === 'HANDLER')
    return { ...me, _needsOnboarding }
  }

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, register, loginWithTokens }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
