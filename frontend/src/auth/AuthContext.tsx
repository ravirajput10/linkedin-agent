import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { authApi } from '@/services/api'
import { ApiRequestError } from '@/services/client'
import { clearTokens, loadTokens, saveTokens, setSessionEndedHandler } from '@/services/tokens'
import type { TokenPair, UserProfile } from '@/types/api'

interface AuthContextValue {
  user: UserProfile | null
  /** True until the stored token has been checked against the server. */
  loading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  login: (email: string, password: string, turnstile_token?: string) => Promise<UserProfile>
  setSessionTokens: (tokens: TokenPair) => UserProfile
  register: (payload: {
    email: string
    password: string
    full_name?: string
    plan_id?: string
    billing_cycle?: string
    turnstile_token?: string
  }) => Promise<{ user: UserProfile; verificationRequired: boolean; verificationToken: string | null }>
  logout: () => Promise<void>
  /** Replaces the cached profile after the user edits it themselves. */
  setUser: (user: UserProfile) => void
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUserState] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reset = useCallback(() => {
    clearTokens()
    try {
      localStorage.removeItem('linkedin-agent.approval-mode')
    } catch {
      // ignore
    }
    setUserState(null)
    // Another account must never read the previous one's cached pages.
    queryClient.clear()
  }, [queryClient])

  // The client calls this when a refresh fails mid-session.
  useEffect(() => {
    setSessionEndedHandler(() => {
      if (mounted.current) reset()
    })
    return () => setSessionEndedHandler(null)
  }, [reset])

  const loadProfile = useCallback(async () => {
    if (!loadTokens()) {
      setUserState(null)
      setLoading(false)
      return
    }
    try {
      const profile = await authApi.me()
      if (mounted.current) setUserState(profile)
    } catch (error) {
      // A 401 means the stored token is dead; anything else (the API being
      // down, say) should not silently discard a session that may be fine.
      if (error instanceof ApiRequestError && error.status < 500) reset()
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [reset])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const login = useCallback(
    async (email: string, password: string, turnstile_token?: string) => {
      const tokens = await authApi.login(email, password, turnstile_token)
      saveTokens({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token })
      queryClient.clear()
      setUserState(tokens.user)
      return tokens.user
    },
    [queryClient],
  )

  const register = useCallback<AuthContextValue['register']>(
    async (payload) => {
      const result = await authApi.register(payload)
      if (result.tokens) {
        saveTokens({
          accessToken: result.tokens.access_token,
          refreshToken: result.tokens.refresh_token,
        })
        queryClient.clear()
        setUserState(result.tokens.user)
      }
      return {
        user: result.user,
        verificationRequired: result.verification_required,
        verificationToken: result.verification_token,
      }
    },
    [queryClient],
  )

  const setSessionTokens = useCallback(
    (tokens: TokenPair) => {
      saveTokens({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token })
      queryClient.clear()
      setUserState(tokens.user)
      return tokens.user
    },
    [queryClient],
  )

  const logout = useCallback(async () => {
    const tokens = loadTokens()
    try {
      if (tokens) await authApi.logout(tokens.refreshToken)
    } catch {
      // Signing out locally must succeed even when the server cannot be reached.
    } finally {
      reset()
    }
  }, [reset])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: user !== null,
      isAdmin: user?.role === 'ADMIN',
      login,
      setSessionTokens,
      register,
      logout,
      setUser: setUserState,
      refresh: loadProfile,
    }),
    [user, loading, login, setSessionTokens, register, logout, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext)
}

