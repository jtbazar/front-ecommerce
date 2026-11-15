import { Fragment, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

type GateMode = 'checking' | 'enroll' | 'challenge' | 'error' | 'complete'

export function MfaGate({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const [mode, setMode] = useState<GateMode>('checking')
  const [factorId, setFactorId] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)
  const [verifiedChildrenKey, setVerifiedChildrenKey] = useState(0)

  useEffect(() => {
    let active = true
    if (!session?.user || !supabase) {
      setMode('complete')
      return () => { active = false }
    }

    const client = supabase
    const prepare = async () => {
      setMode('checking')
      setError('')

      // Read the role from the trusted user_roles table, never user-editable metadata.
      const roleResult = await client.rpc('current_user_is_admin')
      if (roleResult.error) throw roleResult.error
      const admin = Boolean(roleResult.data)
      if (active) setIsAdmin(admin)

      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assurance.error) throw assurance.error
      if (assurance.data.currentLevel === 'aal2') {
        if (active) setMode('complete')
        return
      }

      const listed = await client.auth.mfa.listFactors()
      if (listed.error) throw listed.error
      const verified = listed.data.totp.find((factor) => factor.status === 'verified')

      // Customers and vendors only use TOTP after explicitly enrolling.
      // Administrators must enroll TOTP before accessing the marketplace.
      if (!admin && !verified) {
        for (const pending of listed.data.totp.filter((factor) => factor.status !== 'verified')) {
          const removed = await client.auth.mfa.unenroll({ factorId: pending.id })
          if (removed.error) throw removed.error
        }
        if (active) setMode('complete')
        return
      }

      if (verified) {
        if (active) {
          setFactorId(verified.id)
          setQrCode('')
          setSecret('')
          setCode('')
          setMode('challenge')
        }
        return
      }

      for (const pending of listed.data.totp.filter((factor) => factor.status !== 'verified')) {
        const removed = await client.auth.mfa.unenroll({ factorId: pending.id })
        if (removed.error) throw removed.error
      }

      const enrolled = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'JTBazar Admin Authenticator',
      })
      if (enrolled.error) throw enrolled.error
      if (active) {
        setFactorId(enrolled.data.id)
        setQrCode(enrolled.data.totp.qr_code)
        setSecret(enrolled.data.totp.secret)
        setCode('')
        setMode('enroll')
      }
    }

    void prepare().catch((cause: unknown) => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : 'Security verification could not be initialized.')
      setMode('error')
    })

    return () => { active = false }
  }, [session?.user?.id, session?.access_token, attempt])

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const client = supabase
    if (!client || !factorId || !/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const challenge = await client.auth.mfa.challenge({ factorId })
      if (challenge.error) throw challenge.error
      const result = await client.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code,
      })
      if (result.error) throw result.error
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assurance.error) throw assurance.error
      if (assurance.data.currentLevel !== 'aal2') {
        const refreshed = await client.auth.refreshSession()
        if (refreshed.error) throw refreshed.error
        const confirmed = await client.auth.mfa.getAuthenticatorAssuranceLevel()
        if (confirmed.error || confirmed.data.currentLevel !== 'aal2') {
          throw confirmed.error || new Error('Second-factor verification was not confirmed.')
        }
      }
      setCode('')
      setQrCode('')
      setSecret('')
      setVerifiedChildrenKey((key) => key + 1)
      setMode('complete')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The verification code was not accepted.')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'complete') return verifiedChildrenKey ? <Fragment key={verifiedChildrenKey}>{children}</Fragment> : <>{children}</>
  // Keep the storefront available while the role/factor check runs; protected data remains server-gated.
  if (mode === 'checking') return <>{children}</>

  return <main style={shell}>
    <section style={panel}>
      <div style={mark}>JT</div>
      <p style={eyebrow}>{isAdmin ? 'Mandatory administrator security' : 'Authenticator verification'}</p>
      <h1 style={heading}>{mode === 'enroll' ? 'Secure your admin account' : mode === 'challenge' ? 'Verify it’s you' : 'Security verification required'}</h1>
      <p style={copy}>{mode === 'enroll'
        ? 'JTBazar administrators must secure their accounts with an authenticator app. Scan this QR code with Google Authenticator, Microsoft Authenticator, 1Password or another TOTP app.'
        : mode === 'challenge'
          ? 'Enter the current 6-digit code from your authenticator app to continue.'
          : 'We could not start secure verification. Please retry or sign out and contact support.'}</p>
      {mode === 'enroll' && qrCode && <div style={qrWrap}><img src={qrCode} alt="Authenticator setup QR code" style={{ width: 190, height: 190 }} /></div>}
      {mode === 'enroll' && secret && <details style={secretBox}><summary>Can’t scan the QR code?</summary><code style={{ wordBreak: 'break-all' }}>{secret}</code></details>}
      {mode === 'error' ? <button type="button" onClick={() => setAttempt((value) => value + 1)} style={primaryButton}>Retry security setup</button> : <form onSubmit={verify} style={{ display: 'grid', gap: 14 }}>
        {(mode === 'enroll' || mode === 'challenge') && <label style={label}>6-digit authenticator code
          <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" style={codeInput} required />
        </label>}
        {error && <p role="alert" style={errorStyle}>{error}</p>}
        <button type="submit" disabled={busy || code.length !== 6} style={primaryButton}>
          {busy ? 'Verifying…' : mode === 'enroll' ? 'Verify and secure admin account' : 'Verify and continue'}
        </button>
      </form>}
      {mode === 'error' && error && <p role="alert" style={errorStyle}>{error}</p>}
      <button type="button" onClick={() => void signOut()} style={secondaryButton}>Sign out</button>
      <p style={footnote}>Email OTP remains required for every account. Administrator access also requires authenticator verification.</p>
    </section>
  </main>
}

const shell: CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f7f5ef' }
const panel: CSSProperties = { width: 'min(100%, 480px)', padding: 32, border: '1px solid #e6e1d7', borderRadius: 16, background: '#fff', boxShadow: '0 24px 70px rgba(31,36,29,.09)' }
const mark: CSSProperties = { width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 13, color: '#fff', background: '#27382d', fontWeight: 800, letterSpacing: '-.04em' }
const eyebrow: CSSProperties = { margin: '22px 0 8px', color: '#9b634a', fontSize: 11, fontWeight: 800, letterSpacing: '.13em', textTransform: 'uppercase' }
const heading: CSSProperties = { margin: 0, color: '#202820', fontSize: 30, lineHeight: 1.12, letterSpacing: '-.04em' }
const copy: CSSProperties = { margin: '12px 0 22px', color: '#697168', fontSize: 14, lineHeight: 1.7 }
const qrWrap: CSSProperties = { display: 'grid', placeItems: 'center', margin: '0 0 18px', padding: 16, border: '1px solid #ece8df', borderRadius: 12, background: '#fff' }
const secretBox: CSSProperties = { margin: '0 0 18px', padding: 12, borderRadius: 8, background: '#f7f5ef', color: '#394238', fontSize: 12 }
const label: CSSProperties = { display: 'grid', gap: 8, color: '#394238', fontSize: 12, fontWeight: 700 }
const codeInput: CSSProperties = { width: '100%', padding: '14px 16px', border: '1px solid #d9dcd4', borderRadius: 9, outlineColor: '#9b634a', fontSize: 24, fontWeight: 700, letterSpacing: '.35em', textAlign: 'center' }
const primaryButton: CSSProperties = { minHeight: 48, border: 0, borderRadius: 9, color: '#fff', background: '#27382d', fontSize: 13, fontWeight: 800, cursor: 'pointer' }
const secondaryButton: CSSProperties = { width: '100%', marginTop: 10, minHeight: 42, border: '1px solid #e6e1d7', borderRadius: 9, color: '#4e594f', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const errorStyle: CSSProperties = { margin: 0, padding: 11, borderRadius: 8, color: '#9a3f35', background: '#fff0ed', fontSize: 12 }
const footnote: CSSProperties = { margin: '18px 0 0', color: '#92988f', fontSize: 11, lineHeight: 1.5 }
