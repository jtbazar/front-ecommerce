import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { authService } from '../services/auth/authService'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import { disableWebPush, enableWebPush } from '../services/notifications/webPush'

type Profile = Database['public']['Tables']['profiles']['Row']

interface AuthValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  configured: boolean
  error: string | null
  avatarUrl: string | null
  displayName: string | null
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)
const USER_RECHECK_MS = 5 * 60 * 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession?.user) {
        setProfile(null)
        setIsAdmin(false)
        setError(null)
      }
      setLoading(false)
    })

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSession(data.session)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.access_token || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    void enableWebPush(session.access_token).catch((cause) => console.warn('JTBazar push token registration failed:', cause))
  }, [session?.user?.id, session?.access_token])

  // A locally cached JWT can outlive a user deleted from Supabase Auth.
  // Revalidate it against Auth on startup, tab focus and periodically.
  useEffect(() => {
    if (!session?.user || !supabase) return
    let active = true
    let checking = false

    const validateUser = async () => {
      if (checking || !active) return
      checking = true
      try {
        const { data, error: userError } = await authService.getCurrentUser()
        if (!active) return
        if (userError) {
          const status = (userError as { status?: number }).status
          const code = (userError as { code?: string }).code
          if (status === 401 || status === 403 || status === 404 || code === 'user_not_found' || code === 'session_not_found') {
            await authService.signOutLocal()
          }
          return
        }
        if (!data.user || data.user.id !== session.user.id) await authService.signOutLocal()
      } catch {
        // A temporary network failure must not sign out a legitimate user.
      } finally {
        checking = false
      }
    }

    void validateUser()
    const onFocus = () => { if (document.visibilityState === 'visible') void validateUser() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const interval = window.setInterval(() => { void validateUser() }, USER_RECHECK_MS)

    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [session?.user?.id, session?.access_token])

  useEffect(() => {
    let active = true
    if (!session?.user || !supabase) {
      setProfile(null)
      setIsAdmin(false)
      return () => { active = false }
    }

    setProfile(null)
    setIsAdmin(false)
    setError(null)

    void Promise.all([authService.getOwnProfile(), authService.isCurrentUserAdmin()])
      .then(async ([profileResult, adminResult]) => {
        if (!active) return
        if (profileResult.error) throw profileResult.error
        if (adminResult.error) throw adminResult.error
        let currentProfile = profileResult.data

        const metaAvatar = (session.user.user_metadata?.avatar_url as string | undefined) ||
                           (session.user.user_metadata?.picture as string | undefined)
        const metaName = (session.user.user_metadata?.full_name as string | undefined) ||
                         (session.user.user_metadata?.name as string | undefined)

        if (metaAvatar && !currentProfile?.avatar_url) {
          try {
            await supabase?.from('profiles').update({
              avatar_url: metaAvatar,
              ...(!currentProfile?.full_name && metaName ? { full_name: metaName } : {})
            }).eq('id', session.user.id)
            if (currentProfile) {
              currentProfile = {
                ...currentProfile,
                avatar_url: metaAvatar,
                full_name: currentProfile.full_name || metaName || null
              }
            }
          } catch {
            // non-critical, avatarUrl fallback handles it
          }
        }

        setProfile(currentProfile)
        setIsAdmin(Boolean(adminResult.data))
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setProfile(null)
        setIsAdmin(false)
        setError(cause instanceof Error ? cause.message : 'Account details could not be loaded.')
      })

    return () => { active = false }
  }, [session?.user?.id, session?.access_token])

  const avatarUrl = profile?.avatar_url ||
    (session?.user?.user_metadata?.avatar_url as string | undefined) ||
    (session?.user?.user_metadata?.picture as string | undefined) ||
    null

  const displayName = profile?.full_name ||
    (session?.user?.user_metadata?.full_name as string | undefined) ||
    (session?.user?.user_metadata?.name as string | undefined) ||
    (session?.user?.email ? session.user.email.split('@')[0] : null)

  const value = useMemo<AuthValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isAdmin,
    loading,
    configured: isSupabaseConfigured,
    error,
    avatarUrl,
    displayName,
    signOut: async () => {
      if (session?.access_token && typeof Notification !== 'undefined' && Notification.permission === 'granted') await disableWebPush(session.access_token)
      const { error: signOutError } = await authService.signOut()
      if (signOutError) throw signOutError
    },
    refreshProfile: async () => {
      if (!session?.user) return
      const [profileResult, adminResult] = await Promise.all([authService.getOwnProfile(), authService.isCurrentUserAdmin()])
      if (profileResult.error) throw profileResult.error
      if (adminResult.error) throw adminResult.error
      setProfile(profileResult.data)
      setIsAdmin(Boolean(adminResult.data))
      setError(null)
    },
  }), [session, profile, isAdmin, loading, error, avatarUrl, displayName])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
