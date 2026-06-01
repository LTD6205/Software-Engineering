'use client'
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'

interface AuthUser {
  user_id: string
  name: string
  email: string
  role: 'manager' | 'staff' | 'admin' | 'eventmanager'
  phone?: string
  avatar?: string
}

interface AuthContextType {
  user: AuthUser | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  updateUser: (partial: Partial<AuthUser>) => void
  isManager: boolean        // manager or admin — task/team/AI features
  isAdmin: boolean
  isEventManager: boolean    // eventmanager role
  canManageEvents: boolean   // eventmanager or admin — create/edit events
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [token, setToken]     = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  // On mount — restore session from localStorage. This must run in an effect
  // (not a lazy useState initializer): the server renders with no session, so
  // reading localStorage during the first client render would cause a
  // hydration mismatch. Setting state here is intentional.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const savedToken = localStorage.getItem('token')
    const savedUser  = localStorage.getItem('user')
    if (savedToken && savedUser) {
      setToken(savedToken)
      setUser(JSON.parse(savedUser))
      axios.defaults.headers.common['Authorization'] = `Bearer ${savedToken}`
    }
    setIsLoading(false)
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const login = async (email: string, password: string) => {
    const res = await axios.post(`${API}/auth/login`, { email, password })
    const { access_token, user: loggedInUser } = res.data
    setToken(access_token)
    setUser(loggedInUser)
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(loggedInUser))
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
    router.push('/')
  }

  // Merge updated fields (e.g. after editing the profile) into the stored user.
  const updateUser = (partial: Partial<AuthUser>) => {
    setUser(prev => {
      const next = prev ? { ...prev, ...partial } : prev
      if (next) localStorage.setItem('user', JSON.stringify(next))
      return next
    })
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    delete axios.defaults.headers.common['Authorization']
    router.push('/login')
  }

  return (
    <AuthContext.Provider value={{
      user, token, login, logout, updateUser,
      isManager: user?.role === 'manager' || user?.role === 'admin',
      isAdmin: user?.role === 'admin',
      isEventManager: user?.role === 'eventmanager',
      canManageEvents: user?.role === 'eventmanager' || user?.role === 'admin',
      isLoading,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
