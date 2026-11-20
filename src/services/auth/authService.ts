import type { User } from '@supabase/supabase-js'
import { getSupabase } from '../../lib/supabase'
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../../utils/passwordPolicy'
import { sendCommerceEmail } from '../account/commerceEmailService'

export const OTP_LENGTH = 6

function redirect(path: string) {
  return new URL(path, window.location.origin).toString()
}

function callbackRedirect(nextPath: string, provider?: 'google', flow?: 'recovery') {
  const query = new URLSearchParams({ next: nextPath })
  if (provider) query.set('provider', provider)
  if (flow) query.set('flow', flow)
  return redirect(`/auth/callback?${query.toString()}`)
}


export function sendLoginOtp(email: string) {
  return getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
}

export function verifyLoginOtp(email: string, token: string) {
  return getSupabase().auth.verifyOtp({ email, token, type: 'email' })
}

export function verifySignupOtp(email: string, token: string) {
  return getSupabase().auth.verifyOtp({ email, token, type: 'signup' })
}

export function verifySignupTokenHash(tokenHash: string) {
  return getSupabase().auth.verifyOtp({ token_hash: tokenHash, type: 'signup' })
}

export function verifyRecoveryTokenHash(tokenHash: string) {
  return getSupabase().auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
}

export function isGoogleBlockedForUser(user: User): boolean {
  const identities = (user.identities ?? []) as Array<{
    provider?: string
    created_at?: string | null
  }>
  const emailIdentity = identities.find((identity) => identity.provider === 'email')
  const googleIdentity = identities.find((identity) => identity.provider === 'google')
  if (!emailIdentity || !googleIdentity) return false
  if (!emailIdentity.created_at || !googleIdentity.created_at) return true
  return new Date(emailIdentity.created_at).getTime() <= new Date(googleIdentity.created_at).getTime()
}

export const authService = {
  async signInWithPassword(email: string, password: string) {
    const result = await getSupabase().auth.signInWithPassword({ email, password })
    if (!result.error && result.data.session) {
      void sendCommerceEmail({ event: 'security_login', platform: 'website', event_id: crypto.randomUUID() })
    }
    return result
  },

  async signUp(email: string, password: string, fullName: string) {
    if (!isStrongPassword(password)) throw new Error(PASSWORD_POLICY_MESSAGE)
    // Supabase sends a six-digit signup OTP using the Confirm signup email template.
    // No emailRedirectTo is supplied: signup confirmation is code-based, not link-based.
    return getSupabase().auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
  },

  resendSignupConfirmation(email: string) {
    // Resend the six-digit signup OTP (requires {{ .Token }} in the Confirm signup template).
    return getSupabase().auth.resend({ type: 'signup', email })
  },

  exchangeCodeForSession(code: string) {
    return getSupabase().auth.exchangeCodeForSession(code)
  },

  setSession(accessToken: string, refreshToken: string) {
    return getSupabase().auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  },

  getCurrentUser() {
    return getSupabase().auth.getUser()
  },

  sendLoginOtp,
  verifyLoginOtp,
  verifySignupOtp,

  sendPasswordRecovery(email: string) {
    return getSupabase().auth.resetPasswordForEmail(email, { redirectTo: callbackRedirect('/reset-password', undefined, 'recovery') })
  },

  async updatePassword(password: string) {
    if (!isStrongPassword(password)) throw new Error(PASSWORD_POLICY_MESSAGE)
    const result = await getSupabase().auth.updateUser({ password })
    if (!result.error) {
      void sendCommerceEmail({ event: 'security_password_changed', platform: 'website', event_id: crypto.randomUUID() })
    }
    return result
  },

  signInWithGoogle(redirectPath = '/account') {
    return getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackRedirect(redirectPath, 'google') },
    })
  },

  isGoogleBlockedForUser,

  getOwnProfile() {
    return getSupabase().from('profiles').select('id, full_name, phone, avatar_url, created_at, updated_at').maybeSingle()
  },

  isCurrentUserAdmin() {
    return getSupabase().rpc('current_user_is_admin')
  },

  signOut() {
    return getSupabase().auth.signOut()
  },

  signOutLocal() {
    return getSupabase().auth.signOut({ scope: 'local' })
  },
}
