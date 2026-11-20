import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, ShieldCheck, UserRound, LockKeyhole } from 'lucide-react'
import { UserAvatar } from '../common/UserAvatar'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../i18n/LocaleContext'
import { useToast } from '../../contexts/ToastContext'
import { saveMyProfile } from '../../services/account/profileService'
import { isValidPakistaniMobile } from '../../utils/contactValidation'
import { authService } from '../../services/auth/authService'

export function CustomerProfilePanel() {
  const { t } = useI18n()
  const { user, profile, avatarUrl, displayName, refreshProfile } = useAuth()
  const { push } = useToast()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  useEffect(() => { setFullName(profile?.full_name ?? displayName ?? ''); setPhone(profile?.phone ?? '') }, [profile?.full_name, profile?.phone, displayName])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (!file) return
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    if (phone.trim() && !isValidPakistaniMobile(phone)) { push(t('Enter exactly 03001234567 or +923001234567.'), 'error'); return }
    setSaving(true)
    try {
      await saveMyProfile({ fullName, phone, avatarFile: photo })
      await refreshProfile()
      setPhoto(null)
      setPreview(null)
      push(t('Your profile has been updated.'), 'success')
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('Your profile could not be updated.'), 'error')
    } finally { setSaving(false) }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user?.email) { push(t('Your account email could not be verified. Please sign in again.'), 'error'); return }
    if (!currentPassword) { push(t('Enter your current password.'), 'error'); return }
    if (newPassword.length < 8) { push(t('Password must be at least 8 characters.'), 'error'); return }
    if (newPassword !== confirmPassword) { push(t('Passwords do not match.'), 'error'); return }
    if (currentPassword === newPassword) { push(t('Your new password must be different from your current password.'), 'error'); return }
    setPasswordSaving(true)
    try {
      // Verify the current credentials in an isolated client so the active account session is not replaced.
      const verification = await authService.signInWithPassword(user.email, currentPassword)
      if (verification.error) {
        const message = verification.error.message.toLowerCase()
        if (message.includes('invalid login') || message.includes('invalid credentials') || message.includes('password')) {
          throw new Error(t('Your current password is incorrect.'))
        }
        throw verification.error
      }
      const response = await authService.updatePassword(newPassword)
      if (response.error) throw response.error
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      push(t('Your password has been changed.'), 'success')
    } catch (cause) { push(cause instanceof Error ? cause.message : t('Your password could not be changed.'), 'error') }
    finally { setPasswordSaving(false) }
  }
  return <section className="account-panel customer-profile-panel" aria-labelledby="customer-profile-title">
    <div className="account-panel__heading"><div><h2 id="customer-profile-title">{t('Personal profile')}</h2><p>{t('Update your name, phone number and profile photo.')}</p></div><span className="customer-profile-panel__privacy"><ShieldCheck size={15} /> {t('Private account')}</span></div>
    <form className="customer-profile-form" onSubmit={submit}>
      <div className="customer-profile-photo"><div className="customer-profile-photo__avatar">{preview || avatarUrl ? <UserAvatar avatarUrl={preview || avatarUrl} name={fullName || user?.email} size={54} /> : <UserRound size={34} />}</div>
        <div className="customer-profile-photo__copy"><strong>{t('Profile photo')}</strong><span>{t('JPG, PNG or WebP · up to 5 MB')}</span><label className="button button--outline customer-profile-photo__button"><Camera size={15} /> {t('Choose photo')}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} /></label></div>
      </div>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="customer-profile-name">{t('Full name')} <span>*</span></label><input id="customer-profile-name" autoComplete="name" maxLength={120} value={fullName} onChange={event => setFullName(event.target.value)} required /></div>
        <div className="form-field"><label htmlFor="customer-profile-email">{t('Email address')}</label><input id="customer-profile-email" value={user?.email ?? ''} readOnly disabled /><p className="form-help">{t('Email changes are managed through account security.')}</p></div>
        <div className="form-field"><label htmlFor="customer-profile-phone">{t('Phone number')}</label><input id="customer-profile-phone" type="tel" autoComplete="tel" maxLength={13} pattern="(03[0-9]{9}|\\+923[0-9]{9})" placeholder="03001234567 or +923001234567" value={phone} onChange={event => setPhone(event.target.value)} /></div>
      </div>
      <div className="customer-profile-form__footer"><p>{t('Your profile and personal details are visible only to your signed-in account.')}</p><button className="button button--dark" type="submit" disabled={saving}>{saving ? t('Saving…') : t('Save changes')}</button></div>
    </form>
    <section className="customer-password-panel" aria-labelledby="customer-password-title">
      <div className="account-panel__heading"><div><h3 id="customer-password-title"><LockKeyhole size={17} /> {t('Change password')}</h3><p>{t('Choose a new password for your JTBazar account.')}</p></div></div>
      <form className="customer-profile-form" onSubmit={changePassword}>
        <div className="form-grid">
          <div className="form-field"><label htmlFor="customer-current-password">{t('Current password')}</label><input id="customer-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
          <div className="form-field"><label htmlFor="customer-new-password">{t('New password')}</label><input id="customer-new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div>
          <div className="form-field"><label htmlFor="customer-confirm-password">{t('Confirm new password')}</label><input id="customer-confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
        </div>
        <div className="customer-profile-form__footer"><p>{t('Enter your current password to verify your identity. Use at least 8 characters for the new password.')}</p><button className="button button--dark" type="submit" disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}>{t(passwordSaving ? 'Updating password…' : 'Update password')}</button></div>
      </form>
    </section>
  </section>
}
