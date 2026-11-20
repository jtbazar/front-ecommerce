import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Info, KeyRound, LockKeyhole, LogOut, Mail } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { useI18n } from '../i18n/LocaleContext'
import { authService, OTP_LENGTH, verifySignupTokenHash, verifyRecoveryTokenHash } from '../services/auth/authService'
import { clearRememberedAccountSuspension, rememberAccountSuspension } from '../services/auth/accountAccessNotice'
import { LoadingState } from '../components/common/States'
import { isValidEmail } from '../utils/contactValidation'
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy'
type AuthStatus = 'ready' | 'loading' | 'success' | 'error'
type FieldErrors = Record<string, string>

const emailPattern = isValidEmail
const isValidGmailAddress = (value: string) => emailPattern(value.trim()) && /^[^\s@]+@gmail\.com$/i.test(value.trim())
const PENDING_SIGNUP_EMAIL_KEY = 'jtbazar_pending_signup_email'
const GOOGLE_PASSWORD_ACCOUNT_MESSAGE = "Google sign-in could not be completed for this email. If you created your account with email and password, please sign in with your email and password instead."

function getPendingSignupEmail() {
  try { return window.sessionStorage.getItem(PENDING_SIGNUP_EMAIL_KEY) ?? '' }
  catch { return '' }
}

function clearPendingSignupEmail() {
  try { window.sessionStorage.removeItem(PENDING_SIGNUP_EMAIL_KEY) }
  catch { /* session storage may be unavailable */ }
}
const emptyRegistration = { name: '', email: '', password: '', confirmation: '', terms: false }

function describeError(error: unknown) {
  if (error instanceof Error) return error.message
  return 'The authentication request could not be completed. Please try again.'
}

function friendlyAuthError(error: unknown) {
  const message = describeError(error)
  if (/already registered|already exists|user_already_exists|email_exists/i.test(message)) {
    return 'We could not complete this request. If you already have an account, please sign in; otherwise try again shortly.'
  }
  return message
}

function isSuspendedAccountError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  return code === 'user_banned' || code === 'account_suspended' || /\b(user|account) (is|has been) (banned|suspended)\b|vendor account (?:is )?locked/i.test(message)
}

function throwIfAuthError<T extends { error: { message: string } | null }>(response: T) {
  if (response.error) throw response.error
  return response
}

function getSafeAuthRedirect(search: string, state: unknown) {
  const queryTarget = new URLSearchParams(search).get('redirect')
  const stateTarget = state && typeof state === 'object' && 'from' in state && typeof state.from === 'string' ? state.from : null
  const target = queryTarget || stateTarget
  return target && target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/login') ? target : '/account'
}

function AuthStatusMessage({ status, message }: { status: AuthStatus; message: string }) {
  const { t } = useI18n()
  if (status === 'loading') return <p className="auth-status auth-status--loading" role="status" aria-live="polite"><Info size={17} aria-hidden="true" />{t('Connecting securely…')}</p>
  if (status === 'success') return <p className="auth-status auth-status--success" role="status" aria-live="polite"><CheckCircle2 size={17} aria-hidden="true" />{t(message)}</p>
  if (status === 'error') return <p className="auth-status auth-status--error" role="alert"><AlertCircle size={17} aria-hidden="true" />{t(message)}</p>
  return null
}

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="google-icon">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.15Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.27 21.36 7.35 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.26C.46 8.16 0 9.94 0 12s.46 3.84 1.26 5.42l4.02-3.15Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.27 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
      />
    </svg>
  )
}

function AuthLayout({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  const { t } = useI18n()
  const { configured } = useAuth()
  return <section className="auth-page"><div className="auth-page__inner"><header className="auth-page__heading"><span className="auth-eyebrow">{t(eyebrow)}</span><h1>{t(title)}</h1><p>{t(intro)}</p></header>{!configured && <div className="auth-preview-notice" role="note"><Info size={18} aria-hidden="true" /><strong>{t('Account access is temporarily unavailable. Please try again later.')}</strong></div>}{children}</div></section>
}

function FieldError({ id, message }: { id: string; message?: string }) {
  const { t } = useI18n()
  return message ? <p className="auth-field__error" id={id} role="alert">{t(message)}</p> : null
}

function AuthField({ label, name, type = 'text', value, onChange, error, autoComplete, required = true, help, readOnly = false, children }: { label: string; name: string; type?: string; value: string; onChange?: (event: ChangeEvent<HTMLInputElement>) => void; error?: string; autoComplete?: string; required?: boolean; help?: string; readOnly?: boolean; children?: ReactNode }) {
  const { t } = useI18n()
  const errorId = `${name}-error`
  const helpId = `${name}-help`
  return <div className="auth-field"><label htmlFor={name}>{t(label)} <span className="auth-field__meta">{t(required ? 'Required' : 'Optional')}</span></label><div className="auth-field__control"><input id={name} name={name} type={type} value={value} onChange={onChange} readOnly={readOnly} autoComplete={autoComplete} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : help ? helpId : undefined} />{children}</div>{help && !error ? <p className="auth-field__help" id={helpId}>{t(help)}</p> : null}<FieldError id={errorId} message={error} /></div>
}

function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useI18n()
  if (!password) return null
  const checks = [
    { label: 'At least 8 characters', passed: password.length >= 8 },
    { label: 'One uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'One number', passed: /[0-9]/.test(password) },
    { label: 'One special symbol', passed: /[^A-Za-z0-9\\s]/.test(password) },
  ]
  const score = checks.filter((item) => item.passed).length
  const strength = score <= 1 ? 'Weak' : score <= 3 ? 'Fair' : score === 4 ? 'Good' : 'Strong'
  return <div className="password-strength" aria-live="polite">
    <div className="password-strength__heading"><span>{t('Password strength')}</span><strong data-strength={strength.toLowerCase()}>{t(strength)}</strong></div>
    <div className="password-strength__track" role="progressbar" aria-label={t('Password strength')} aria-valuemin={0} aria-valuemax={5} aria-valuenow={score}><span data-strength={strength.toLowerCase()} style={{ width: `${score * 20}%` }} /></div>
    <ul className="password-strength__checks">{checks.map((item) => <li key={item.label} data-passed={item.passed}><span aria-hidden="true">{item.passed ? '✓' : '○'}</span>{t(item.label)}</li>)}</ul>
  </div>
}

function PasswordField({ name, label, value, onChange, error, autoComplete, help, showStrength = false }: { name: string; label: string; value: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void; error?: string; autoComplete?: string; help?: string; showStrength?: boolean }) {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)
  return <><AuthField label={label} name={name} type={visible ? 'text' : 'password'} value={value} onChange={onChange} error={error} autoComplete={autoComplete} help={help}><button type="button" className="auth-password-toggle" onClick={() => setVisible((current) => !current)} aria-label={t(visible ? 'Hide password' : 'Show password')}><span aria-hidden="true">{visible ? <EyeOff size={16} /> : <Eye size={16} />}</span><span>{t(visible ? 'Hide' : 'Show')}</span></button></AuthField>{showStrength ? <PasswordStrengthMeter password={value} /> : null}</>
}

function ProviderButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n()
  return <button type="button" className="auth-provider-button" onClick={onClick} disabled={disabled}>
    <span className="auth-provider-button__mark" aria-hidden="true"><GoogleIcon size={19} /></span><span>{t('Continue with Google')}</span>
  </button>
}

function Divider() {
  const { t } = useI18n()
  return <div className="auth-divider" role="separator"><span>{t('or continue with email')}</span></div>
}

function AuthLinks({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useI18n()
  return <div className="auth-links">{mode === 'login' ? <><span>{t('No account?')}</span><Link to="/register" className="auth-link">{t('Register instead')}<ArrowRight size={15} aria-hidden="true" /></Link></> : <><span>{t('Already have an account?')}</span><Link to="/login" className="auth-link">{t('Sign in instead')}<ArrowRight size={15} aria-hidden="true" /></Link></>}</div>
}

export function LoginPage() {
  const { t } = useI18n()
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const redirectTarget = getSafeAuthRedirect(location.search, location.state)
  const [form, setForm] = useState({
    email: (location.state as { email?: string } | null)?.email ?? '',
    password: '',
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<AuthStatus>('ready')
  const [message, setMessage] = useState(() => (location.state as { message?: string } | null)?.message ?? '')

  const update = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '' }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = form.email.trim().toLowerCase()
    const next: FieldErrors = {}
    if (!email) next.email = 'Email is required.'
    else if (!emailPattern(email)) next.email = 'Enter a valid email address.'
    if (!form.password) next.password = 'Password is required.'
    setErrors(next)
    if (Object.keys(next).length) return

    clearRememberedAccountSuspension()
    setStatus('loading')
    setMessage('')
    try {
      const passwordResult = await authService.signInWithPassword(email, form.password)
      if (passwordResult.error) {
        const authError = passwordResult.error as { code?: string; message?: string }
        if (authError.code === 'email_not_confirmed') {
          throwIfAuthError(await authService.resendSignupConfirmation(email))
          const pending: PendingOtp = { email, purpose: 'signup', redirect: redirectTarget }
          try {
            window.sessionStorage.setItem(PENDING_SIGNUP_EMAIL_KEY, email)
            window.sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(pending))
          } catch { /* route state remains available */ }
          navigate('/verify-otp', { replace: true, state: pending })
          return
        }
        throw passwordResult.error
      }

      throwIfAuthError(await authService.sendLoginOtp(email))
      const pending = { email, purpose: 'login' as const, redirect: redirectTarget }
      try { window.sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(pending)) } catch { /* route state remains available */ }
      navigate('/verify-otp', { replace: true, state: pending })
    } catch (error) {
      if (isSuspendedAccountError(error)) {
        rememberAccountSuspension()
        navigate('/account?access=suspended', { replace: true })
        return
      }
      setStatus('error')
      setMessage(describeError(error))
    }
  }

  const google = async () => {
    clearRememberedAccountSuspension()
    setStatus('loading')
    setMessage('')
    try {
      throwIfAuthError(await authService.signInWithGoogle(redirectTarget))
      setStatus('success')
      setMessage('Redirecting to Google sign-in…')
    } catch (error) {
      setStatus('error')
      setMessage(describeError(error))
    }
  }
  if (authLoading) return <LoadingState label="Checking your account…" />
  if (user) return <Navigate to={redirectTarget} replace />

  return <AuthLayout eyebrow="Authentication" title="Sign in to your account" intro="Sign in with your email and password, then verify the six-digit code sent to your inbox.">
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={status === 'loading'}>
      <AuthStatusMessage status={status} message={message} />
      <ProviderButton onClick={google} disabled={status === 'loading'} />
      <Divider />
      <AuthField label="Email" name="email" type="email" value={form.email} onChange={update} error={errors.email} autoComplete="email" help="Use your Gmail address (example@gmail.com)." />
      <PasswordField label="Password" name="password" value={form.password} onChange={update} error={errors.password} autoComplete="current-password" />
      <button className="auth-submit" type="submit" disabled={status === 'loading'}>{status === 'loading' ? t('Checking credentials…') : t('Log in')}<ArrowRight size={16} aria-hidden="true" /></button>
      <Link className="auth-link auth-form__forgot" to="/forgot-password">{t('Forgot password?')}</Link>
    </form>
    <AuthLinks mode="login" />
  </AuthLayout>
}

export function RegisterPage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const redirectTarget = getSafeAuthRedirect(location.search, location.state)
  const [form, setForm] = useState(emptyRegistration)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<AuthStatus>('ready')
  const [message, setMessage] = useState('')
  const update = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '' }))
  }
  const google = async () => {
    setStatus('loading')
    setMessage('')
    try {
      throwIfAuthError(await authService.signInWithGoogle(redirectTarget))
      setStatus('success')
      setMessage('Redirecting to Google sign-in…')
    } catch (error) {
      setStatus('error')
      setMessage(friendlyAuthError(error))
    }
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next: FieldErrors = {}
    if (!form.name.trim()) next.name = 'Full name is required.'
    if (!form.email.trim()) next.email = 'Email is required.'
    else if (!isValidGmailAddress(form.email)) next.email = 'Enter a valid Gmail address ending in @gmail.com.'
    if (!form.password) next.password = 'Password is required.'
    else if (!isStrongPassword(form.password)) next.password = PASSWORD_POLICY_MESSAGE
    if (!form.confirmation) next.confirmation = 'Password confirmation is required.'
    else if (form.password !== form.confirmation) next.confirmation = 'Passwords do not match.'
    if (!form.terms) next.terms = 'Please accept the terms to create an account.'
    setErrors(next)
    if (Object.keys(next).length) return

    setStatus('loading')
    setMessage('')
    const email = form.email.trim().toLowerCase()
    try {
      const response = throwIfAuthError(await authService.signUp(email, form.password, form.name.trim()))
      if (response.data.session) {
        // Email confirmation may be disabled in some Supabase environments.
        // Keep registration deterministic: sign out and ask the customer to sign in.
        await authService.signOutLocal()
        navigate('/login', { replace: true, state: { email, message: 'Your account was created. Please sign in to continue.' } })
        return
      }
      const pendingOtp: PendingOtp = { email, purpose: 'signup', redirect: redirectTarget }
      try {
        window.sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(pendingOtp))
        window.sessionStorage.setItem(PENDING_SIGNUP_EMAIL_KEY, email)
      } catch { /* route state remains available */ }
      navigate('/verify-otp', { replace: true, state: pendingOtp })
    } catch (error) {
      setStatus('error')
      setMessage(friendlyAuthError(error))
    }
  }
  return <AuthLayout eyebrow="Authentication" title="Create your account" intro="Create your JTBazar account to save your favorites and enjoy seamless shopping.">
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={status === 'loading'}>
      <AuthStatusMessage status={status} message={message} />
      <ProviderButton onClick={google} disabled={status === 'loading'} />
      <Divider />
      <AuthField label="Full name" name="name" value={form.name} onChange={update} error={errors.name} autoComplete="name" />
      <AuthField label="Email" name="email" type="email" value={form.email} onChange={update} error={errors.email} autoComplete="email" />
      <PasswordField label="Password" name="password" value={form.password} onChange={update} error={errors.password} autoComplete="new-password" help={PASSWORD_POLICY_MESSAGE} showStrength />
      <PasswordField label="Confirm password" name="confirmation" value={form.confirmation} onChange={update} error={errors.confirmation} autoComplete="new-password" />
      <div className="auth-terms">
        <label className="auth-checkbox auth-checkbox--terms"><input type="checkbox" name="terms" checked={form.terms} onChange={(event) => { setForm((current) => ({ ...current, terms: event.target.checked })); setErrors((current) => ({ ...current, terms: '' })) }} aria-invalid={Boolean(errors.terms)} aria-describedby={errors.terms ? 'terms-error' : undefined} /> <span>{t('I agree to the terms')}</span></label>
        <Link className="auth-link auth-terms-link" to="/privacy">{t('Read privacy notes')}</Link>
      </div>
      <FieldError id="terms-error" message={errors.terms} />
      <button className="auth-submit" type="submit" disabled={status === 'loading'}>{status === 'loading' ? t('Creating account…') : t('Create account')}<ArrowRight size={16} aria-hidden="true" /></button>
    </form>
    <AuthLinks mode="register" />
  </AuthLayout>
}

const PENDING_OTP_KEY = 'jtbazar_pending_email_otp'
type OtpPurpose = 'login' | 'signup'
type PendingOtp = { email: string; purpose: OtpPurpose; redirect?: string }

function readPendingOtp(): PendingOtp | null {
  try {
    const value = sessionStorage.getItem(PENDING_OTP_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as PendingOtp
    return parsed.email && (parsed.purpose === 'login' || parsed.purpose === 'signup') ? parsed : null
  } catch { return null }
}

function otpErrorMessage(error: unknown) {
  const message = describeError(error)
  if (/invalid.*(otp|token)|otp.*(invalid|incorrect)|token.*(invalid|expired)|expired/i.test(message)) return 'That code is invalid or has expired. Please check the code or request a new one.'
  if (/rate.?limit|too many requests|email rate limit/i.test(message)) return 'Too many attempts. Please wait a little before requesting another code.'
  return message
}

export function VerifyOtpPage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as PendingOtp | null
  const pending = state?.email ? state : readPendingOtp()
  const email = pending?.email ?? ''
  const purpose = pending?.purpose ?? 'signup'
  const redirectTarget = getSafeAuthRedirect('', { from: pending?.redirect })
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [status, setStatus] = useState<AuthStatus>('ready')
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(60)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const submittingRef = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  useEffect(() => {
    if (!email) navigate('/login', { replace: true })
    else inputRefs.current[0]?.focus()
  }, [email, navigate])

  const verifyCode = async (code: string) => {
    if (code.length !== OTP_LENGTH || submittingRef.current || !email) return
    submittingRef.current = true
    setStatus('loading')
    setMessage('')
    try {
      const result = purpose === 'login'
        ? await authService.verifyLoginOtp(email, code)
        : await authService.verifySignupOtp(email, code)
      throwIfAuthError(result)
      try { window.sessionStorage.removeItem(PENDING_OTP_KEY); clearPendingSignupEmail() } catch { /* storage may be unavailable */ }
      clearRememberedAccountSuspension()
      if (purpose === 'signup') {
        // Signup OTP verification creates a session; require the customer to sign in explicitly.
        await authService.signOutLocal()
        navigate('/login', { replace: true, state: { email, message: 'Your email has been verified successfully. You can now sign in to JTBazar.' } })
      } else {
        navigate(redirectTarget, { replace: true })
      }
    } catch (error) {
      if (isSuspendedAccountError(error)) {
        rememberAccountSuspension()
        navigate('/account?access=suspended', { replace: true })
        return
      }
      setStatus('error')
      setMessage(otpErrorMessage(error))
      setDigits(Array(OTP_LENGTH).fill(''))
      inputRefs.current[0]?.focus()
    } finally {
      submittingRef.current = false
    }
  }

  const updateDigit = (index: number, rawValue: string) => {
    const value = rawValue.replace(/\D/g, '')
    if (value.length > 1) {
      const pasted = value.slice(0, OTP_LENGTH).split('')
      const next = Array(OTP_LENGTH).fill('').map((_, i) => pasted[i] ?? '')
      setDigits(next)
      setMessage('')
      if (pasted.length === OTP_LENGTH) void verifyCode(pasted.join(''))
      else inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus()
      return
    }
    if (!value) {
      setDigits((current) => current.map((digit, i) => i === index ? '' : digit))
      return
    }
    const next = [...digits]
    next[index] = value.slice(-1)
    setDigits(next)
    setMessage('')
    if (index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus()
    const code = next.join('')
    if (code.length === OTP_LENGTH) void verifyCode(code)
  }

  const pasteCode = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!pasted) return
    const next = Array(OTP_LENGTH).fill('').map((_, index) => pasted[index] ?? '')
    setDigits(next)
    if (pasted.length === OTP_LENGTH) void verifyCode(pasted)
    else inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus()
  }

  const resend = async () => {
    if (cooldown > 0 || status === 'loading') return
    setStatus('loading')
    setMessage('')
    try {
      const result = purpose === 'login'
        ? await authService.sendLoginOtp(email)
        : await authService.resendSignupConfirmation(email)
      throwIfAuthError(result)
      setCooldown(60)
      setStatus('success')
      setMessage('A new six-digit verification code has been sent. Please check your inbox.')
    } catch (error) {
      setStatus('error')
      setMessage(otpErrorMessage(error))
    }
  }

  if (!email) return null
  return <AuthLayout eyebrow="Account security" title={purpose === 'signup' ? 'Verify your email' : 'Verify your sign-in'} intro={purpose === 'signup' ? 'Enter the six-digit code sent to your email address to activate your JTBazar account.' : 'Enter the six-digit code sent to your email address to finish signing in securely.'}>
    <div className="auth-form" aria-busy={status === 'loading'}>
      <AuthStatusMessage status={status} message={message} />
      <div className="auth-explainer">
        <Mail size={20} aria-hidden="true" />
        <div><h2>{t(purpose === 'signup' ? 'Verify your new account' : 'Check your inbox')}</h2><p>{t('We sent a six-digit verification code to')} <strong>{email}</strong>.</p></div>
      </div>
      <div className="auth-otp">
        <div className="auth-otp__inputs" role="group" aria-label={t('Six-digit verification code')}>
          {digits.map((digit, index) => <input
            key={index}
            ref={(element) => { inputRefs.current[index] = element }}
            className="auth-otp__input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${index + 1}`}
            disabled={status === 'loading'}
            onChange={(event) => updateDigit(index, event.target.value)}
            onPaste={pasteCode}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus()
              if (event.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus()
              if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus()
            }}
          />)}
        </div>
      </div>
      <button className="auth-submit" type="button" disabled={status === 'loading' || digits.join('').length !== OTP_LENGTH} onClick={() => void verifyCode(digits.join(''))}>
        {status === 'loading' ? t('Verifying code…') : t('Verify code')}<ArrowRight size={16} aria-hidden="true" />
      </button>
      <button className="auth-link auth-otp__resend" type="button" disabled={cooldown > 0 || status === 'loading'} onClick={() => void resend()}>
        {cooldown > 0 ? t(`Resend code in ${cooldown}s`) : t('Resend code')}
      </button>
      <Link className="auth-link auth-form__back" to="/login"><ArrowLeft size={15} aria-hidden="true" />{t('Back to sign in')}</Link>
    </div>
  </AuthLayout>
}



export function ForgotPasswordPage() {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<AuthStatus>('ready')
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) { setError('Email is required.'); return }
    if (!emailPattern(email)) { setError('Enter a valid email address.'); return }
    setError(''); setStatus('loading'); setMessage('')
    try {
      throwIfAuthError(await authService.sendPasswordRecovery(email.trim()))
      setStatus('success'); setMessage('If an eligible account uses that email, a password recovery link has been sent.')
    } catch (cause) { setStatus('error'); setMessage(describeError(cause)) }
  }
  return <AuthLayout eyebrow="Password recovery" title="Forgot your password?" intro="Request a secure recovery link to reset your account password."><form className="auth-form" onSubmit={submit} noValidate aria-busy={status === 'loading'}><AuthStatusMessage status={status} message={message} /><AuthField label="Email address" name="recovery-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError('') }} error={error} autoComplete="email" help="A recovery link will be sent if the email is associated with an account." /><button className="auth-submit" type="submit" disabled={status === 'loading'}>{status === 'loading' ? t('Requesting recovery…') : t('Send recovery link')}<Mail size={16} aria-hidden="true" /></button><Link className="auth-link auth-form__back" to="/login"><ArrowLeft size={15} aria-hidden="true" />{t('Back to sign in')}</Link></form></AuthLayout>
}

export function VerifyEmailPage() {
  const { t } = useI18n()
  const location = useLocation()
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const stateEmail = (location.state as { email?: string } | null)?.email ?? ''
  const email = stateEmail || getPendingSignupEmail() || user?.email || ''
  const [error, setError] = useState('')
  const [status, setStatus] = useState<AuthStatus>('ready')
  const [message, setMessage] = useState('')
  const [checkingVerification, setCheckingVerification] = useState(true)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  useEffect(() => {
    let active = true
    if (authLoading) return () => { active = false }
    if (!user) { setCheckingVerification(false); return () => { active = false } }
    setCheckingVerification(true)
    void authService.getCurrentUser().then(({ data, error: userError }) => {
      if (!active) return
      if (userError) {
        setStatus('error')
        setMessage('We could not confirm your email status. Please sign in again and retry.')
        setCheckingVerification(false)
        return
      }
      if (data.user?.email_confirmed_at) {
        navigate('/account', { replace: true })
        return
      }
      setCheckingVerification(false)
    }).catch(() => {
      if (!active) return
      setStatus('error')
      setMessage('We could not confirm your email status. Please sign in again and retry.')
      setCheckingVerification(false)
    })
    return () => { active = false }
  }, [authLoading, user?.id, navigate])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (resendCooldown > 0) return
    if (!email.trim()) { setError('Your registered email address could not be found. Please return to registration and try again.'); return }
    if (!emailPattern(email)) { setError('The registered email address is invalid. Please return to registration and try again.'); return }
    setError(''); setStatus('loading'); setMessage('')
    try {
      throwIfAuthError(await authService.resendSignupConfirmation(email.trim()))
      const pending: PendingOtp = { email: email.trim().toLowerCase(), purpose: 'signup', redirect: '/account' }
      try {
        window.sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(pending))
        window.sessionStorage.setItem(PENDING_SIGNUP_EMAIL_KEY, pending.email)
      } catch { /* route state remains available */ }
      navigate('/verify-otp', { replace: true, state: pending })
    } catch (cause) { setStatus('error'); setMessage(describeError(cause)) }
  }

  if (authLoading || checkingVerification) return <section className="account-page"><div className="account-page__inner"><h1>{t('Checking email verification')}</h1><p role="status">{t('Please wait while we securely check your account status…')}</p></div></section>
  return <AuthLayout eyebrow="Email confirmation" title="Check your email" intro="We will send a six-digit verification code. Enter it to activate your account. If you already have an account, sign in instead."><form className="auth-form" onSubmit={submit} noValidate aria-busy={status === 'loading'}><AuthStatusMessage status={status} message={message} /><div className="auth-explainer"><Mail size={20} aria-hidden="true" /><div><h2>{t('Check your inbox')}</h2><p>{t('Enter the six-digit code from your inbox. If you do not see it, check spam or junk. Existing accounts can sign in instead.')}</p></div></div><AuthField label="Email" name="verification-email" type="email" value={email} readOnly error={error} autoComplete="email" /><button className="auth-submit" type="submit" disabled={status === 'loading' || resendCooldown > 0}>{status === 'loading' ? t('Sending verification code…') : resendCooldown > 0 ? t(`Resend available in ${resendCooldown}s`) : t('Resend verification code')}<Mail size={16} aria-hidden="true" /></button><Link className="auth-link auth-form__back" to="/login"><ArrowLeft size={15} aria-hidden="true" />{t('Back to sign in')}</Link></form></AuthLayout>
}

export function ResetPasswordPage() {
  const { t } = useI18n()
  const { user, loading } = useAuth()
  const [recoveryUser, setRecoveryUser] = useState(user)
  const [recoveryChecking, setRecoveryChecking] = useState(true)
  useEffect(() => {
    if (!supabase) { setRecoveryChecking(false); return }
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setRecoveryUser(session?.user ?? null)
      setRecoveryChecking(false)
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (!error) setRecoveryUser(data.session?.user ?? null)
      setRecoveryChecking(false)
    }).catch(() => { if (active) setRecoveryChecking(false) })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  const activeUser = recoveryUser ?? user
  const [form, setForm] = useState({ password: '', confirmation: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<AuthStatus>('ready')
  const [message, setMessage] = useState('')
  const update = (event: ChangeEvent<HTMLInputElement>) => { const { name, value } = event.target; setForm((current) => ({ ...current, [name]: value })); setErrors((current) => ({ ...current, [name]: '' })) }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next: FieldErrors = {}
    if (!form.password) next.password = 'New password is required.'
    else if (!isStrongPassword(form.password)) next.password = PASSWORD_POLICY_MESSAGE
    if (!form.confirmation) next.confirmation = 'Password confirmation is required.'
    else if (form.password !== form.confirmation) next.confirmation = 'Passwords do not match.'
    setErrors(next)
    if (Object.keys(next).length) return
    if (!activeUser) { setStatus('error'); setMessage('Open the latest password reset link sent to your email in the same browser, then try again.'); return }
    setStatus('loading'); setMessage('')
    try { throwIfAuthError(await authService.updatePassword(form.password)); setStatus('success'); setMessage('Your password was updated successfully.'); setForm({ password: '', confirmation: '' }) }
    catch (cause) { setStatus('error'); setMessage(describeError(cause)) }
  }
  return <AuthLayout eyebrow="Password reset" title="Reset your password" intro="Set a new secure password for your account."><form className="auth-form" onSubmit={submit} noValidate aria-busy={status === 'loading'}><AuthStatusMessage status={status} message={message} /><div className="auth-explainer"><LockKeyhole size={20} aria-hidden="true" /><div><h2>{t('Secure password update')}</h2><p>{t(loading || recoveryChecking ? 'Verifying the recovery session…' : activeUser ? 'Recovery session is active.' : 'No active recovery session found.')}</p></div></div><PasswordField label="New password" name="password" value={form.password} onChange={update} error={errors.password} autoComplete="new-password" help={PASSWORD_POLICY_MESSAGE} showStrength /><PasswordField label="Confirm password" name="confirmation" value={form.confirmation} onChange={update} error={errors.confirmation} autoComplete="new-password" /><button className="auth-submit" type="submit" disabled={status === 'loading' || loading || recoveryChecking || !activeUser}>{status === 'loading' ? t('Updating password…') : t('Reset password')}<KeyRound size={16} aria-hidden="true" /></button><Link className="auth-link auth-form__back" to="/forgot-password"><ArrowLeft size={15} aria-hidden="true" />{t('Request another recovery link')}</Link></form></AuthLayout>
}

export function AuthCallbackPage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [message, setMessage] = useState('Completing your secure sign-in…')
  const [googleError, setGoogleError] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const completionRef = useRef<Promise<{ nextPath: string; emailVerified: boolean; email: string }> | null>(null)

  useEffect(() => {
    let active = true
    if (!completionRef.current) {
      completionRef.current = (async () => {
        const query = new URLSearchParams(location.search)
        const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
        const provider = query.get('provider')
        const providerError = query.get('error_description') || query.get('error') || hash.get('error_description') || hash.get('error')
        if (provider === 'google' && providerError) {
          const normalized = providerError.replace(/\+/g, ' ')
          throw new Error(normalized === 'access_denied' ? 'Google sign-in was cancelled.' : GOOGLE_PASSWORD_ACCOUNT_MESSAGE)
        }
        if (providerError) throw new Error(providerError.replace(/\+/g, ' '))

        const tokenHash = query.get('token_hash')
        const tokenType = query.get('type') || hash.get('type')
        const code = query.get('code')
        const hashAccessToken = hash.get('access_token')
        const hashRefreshToken = hash.get('refresh_token')
        const isTokenHashSignup = Boolean(tokenHash && (tokenType === 'signup' || tokenType === 'email'))
        const isTokenHashRecovery = Boolean(tokenHash && tokenType === 'recovery')
        const isHashRecovery = Boolean(tokenType === 'recovery' && hashAccessToken && hashRefreshToken)
        if (!isTokenHashSignup && !isTokenHashRecovery && !isHashRecovery && !code) throw new Error('This verification link is invalid or has expired. Please request a new link.')
        // Supabase projects can send recovery credentials as a token hash, a PKCE code,
        // or an access/refresh-token pair in the URL fragment. Establish the session
        // before navigating so the reset screen never sees an empty recovery session.
        const response = throwIfAuthError(isTokenHashSignup
          ? await verifySignupTokenHash(tokenHash!)
          : isTokenHashRecovery
            ? await verifyRecoveryTokenHash(tokenHash!)
            : isHashRecovery
              ? await authService.setSession(hashAccessToken!, hashRefreshToken!)
              : await authService.exchangeCodeForSession(code!))
        if (!response.data.session) throw new Error('Your account session could not be created. Please sign in again.')
        if (provider === 'google' && authService.isGoogleBlockedForUser(response.data.session.user)) {
          await authService.signOutLocal()
          throw new Error(GOOGLE_PASSWORD_ACCOUNT_MESSAGE)
        }

        const isRecovery = isTokenHashRecovery || isHashRecovery || tokenType === 'recovery'
        const nextPath = isRecovery ? '/reset-password' : getSafeAuthRedirect('', { from: query.get('next') })
        const isEmailConfirmation = provider !== 'google' && !isRecovery && (isTokenHashSignup || nextPath === '/account')
        if (isEmailConfirmation) {
          const confirmedAt = response.data.session.user.email_confirmed_at
          if (!confirmedAt) throw new Error('We could not confirm your email address. Please request a new verification link.')
          const email = response.data.session.user.email ?? ''
          await authService.signOutLocal()
          clearPendingSignupEmail()
          return { nextPath: '/login', emailVerified: true, email }
        }

        clearPendingSignupEmail()
        return { nextPath, emailVerified: false, email: '' }
      })()
    }

    completionRef.current.then((result) => {
      if (!active) return
      if (result.emailVerified) {
        setVerifiedEmail(result.email)
        setEmailVerified(true)
        setStatus('success')
        setMessage('Your email has been verified successfully. You can now sign in to your JTBazar account.')
        return
      }
      navigate(result.nextPath, { replace: true })
    }).catch((cause: unknown) => {
      if (!active) return
      const isGoogle = new URLSearchParams(location.search).get('provider') === 'google'
      setGoogleError(isGoogle)
      setStatus('error')
      setMessage(isGoogle ? (describeError(cause) === 'Google sign-in was cancelled.' ? 'Google sign-in was cancelled.' : GOOGLE_PASSWORD_ACCOUNT_MESSAGE) : friendlyAuthError(cause))
    })
    return () => { active = false }
  }, [location.search, location.hash, navigate])

  return <AuthLayout
    eyebrow="Account security"
    title={emailVerified ? 'Email verified successfully' : googleError ? 'Google sign-in unavailable' : 'Finishing verification'}
    intro={emailVerified ? 'Your JTBazar account email is now confirmed. Sign in to continue shopping.' : googleError ? message : 'Please wait while we securely confirm your account.'}
  >
    <div className="auth-form" aria-busy={status === 'loading'}>
      <AuthStatusMessage status={status} message={message} />
      {emailVerified && <div className="auth-explainer">
        <CheckCircle2 size={22} aria-hidden="true" />
        <div><h2>{t('Email verified')}</h2><p>{verifiedEmail ? <><strong>{verifiedEmail}</strong><br /></> : null}{t('Your email address has been confirmed. You can now sign in with your email and password.')}</p></div>
      </div>}
      {emailVerified && <div className="auth-callback-actions">
        <Link className="auth-submit" to="/login" state={{ email: verifiedEmail }}>{t('Sign in to JTBazar')}<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>}
      {status === 'error' && <div className="auth-callback-actions">
        {googleError
          ? <Link className="auth-submit" to="/login">{t('Back to sign in')}<ArrowRight size={16} aria-hidden="true" /></Link>
          : <><Link className="auth-submit" to="/verify-email">{t('Request a new verification email')}<Mail size={16} aria-hidden="true" /></Link><Link className="auth-link" to="/login">{t('Back to sign in')}<ArrowRight size={15} aria-hidden="true" /></Link></>}
      </div>}
    </div>
  </AuthLayout>
}

export function LogoutPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [status, setStatus] = useState<AuthStatus>('ready')
  const [message, setMessage] = useState('')
  const logout = async () => {
    setStatus('loading'); setMessage('')
    try { await signOut(); setStatus('success'); setMessage('You have been signed out successfully.') }
    catch (cause) { setStatus('error'); setMessage(describeError(cause)) }
  }
  return <section className="account-page account-page--logged-out"><div className="account-page__inner"><div className="account-page__icon" aria-hidden="true"><LogOut size={28} /></div><span className="auth-eyebrow">{t('Account session')}</span><h1>{t(user ? 'Sign out of this account?' : 'You are signed out.')}</h1><p>{t(user ? 'Sign out of your account on this device.' : 'You are currently signed out.')}</p><AuthStatusMessage status={status} message={message} /><div className="account-page__actions">{user ? <button className="account-page__primary" type="button" disabled={status === 'loading'} onClick={logout}>{t(status === 'loading' ? 'Signing out…' : 'Sign out')}<LogOut size={16} aria-hidden="true" /></button> : <Link className="account-page__primary" to="/login">{t('Sign in')}<ArrowRight size={16} aria-hidden="true" /></Link>}<button className="account-page__secondary" type="button" onClick={() => navigate('/')}>{t('Continue shopping')}</button></div></div></section>
}
