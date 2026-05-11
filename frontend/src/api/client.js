import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const client = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Attach access token to every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('deadnet_access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auto-refresh on 401; clear dead architect sessions on 404 from /architect/* routes
client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    const status = error.response?.status

    // Architect routes return 404 (not 401) when the session is invalid —
    // detect this and clear the stale session so the user is prompted to re-login.
    if (status === 404 && original.url?.includes('/architect/') && !original._archRetry) {
      const storedUser = localStorage.getItem('deadnet_user')
      if (storedUser) {
        try {
          const parsed = JSON.parse(storedUser)
          if (parsed.role === 'ARCHITECT') {
            original._archRetry = true
            localStorage.removeItem('deadnet_access_token')
            localStorage.removeItem('deadnet_refresh_token')
            localStorage.removeItem('deadnet_user')
            window.location.href = '/login'
            return Promise.reject(error)
          }
        } catch { /* ignore parse error */ }
      }
    }

    if (status === 401 && !original._retry && original.url !== '/auth/login') {
      original._retry = true
      const refreshToken = localStorage.getItem('deadnet_refresh_token')
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          })
          localStorage.setItem('deadnet_access_token', data.access_token)
          original.headers.Authorization = `Bearer ${data.access_token}`
          return client(original)
        } catch {
          localStorage.removeItem('deadnet_access_token')
          localStorage.removeItem('deadnet_refresh_token')
          localStorage.removeItem('deadnet_user')
          window.location.href = '/login'
        }
      } else {
        // No refresh token (architect) — clear and redirect
        localStorage.removeItem('deadnet_access_token')
        localStorage.removeItem('deadnet_refresh_token')
        localStorage.removeItem('deadnet_user')
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default client
