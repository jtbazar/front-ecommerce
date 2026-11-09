import { useState, type FormEvent } from 'react'
import { Mail, MessageCircle, ShieldCheck, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../hooks/usePageMeta'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { supportDestination } from '../utils/support'

export function DeleteAccountPage() {
  const settings = useStoreSettings()
  const [status, setStatus] = useState('')
  usePageMeta('Request account deletion', 'Request deletion of your JTBazar account and associated personal information.')
  const email = settings.supportEmail?.trim()
  const whatsapp = supportDestination(undefined, settings.supportWhatsapp)
  const canEmail = Boolean(email)
  const canWhatsApp = whatsapp.startsWith('https://')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const accountEmail = String(data.get('email') ?? '').trim()
    const reason = String(data.get('reason') ?? '').trim()
    const subject = 'JTBazar account deletion request'
    const body = [
      'I am requesting deletion of my JTBazar account and associated personal data.',
      '',
      `Name: ${name}`,
      `JTBazar account email: ${accountEmail}`,
      `Reason (optional): ${reason || 'Not provided'}`,
      '',
      'Please verify my identity using a secure process before taking action and confirm when the request is completed.',
    ].join('\\n')
    if (canEmail) {
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      setStatus('Your email app should open with the deletion request prepared. Send the email to submit your request.')
    } else if (canWhatsApp) {
      const url = supportDestination(body, settings.supportWhatsapp)
      window.open(url, '_blank', 'noopener,noreferrer')
      setStatus('WhatsApp should open with your request prepared. Send the message to submit your request.')
    } else {
      setStatus('Online support contact is not configured yet. Please use the Contact page to reach JTBazar.')
    }
  }
  return <div className="page-shell info-page">
    <header className="info-page__heading">
      <span className="eyebrow">JTBazar · Privacy</span>
      <h1>Request <em>account deletion.</em></h1>
      <p>Use this public page to ask JTBazar to delete your account. You do not need to sign in or reinstall the app to submit a request.</p>
    </header>
    <div className="contact-layout">
      <section className="contact-form-panel">
        <div className="contact-form-heading"><span className="eyebrow">Deletion request</span><h2>Tell us which account to delete</h2><p>Enter the email address associated with your JTBazar account. Do not share your password or OTP.</p></div>
        <form className="contact-form" onSubmit={submit}>
          <div className="form-grid">
            <div className="form-field"><label htmlFor="delete-name">Your name *</label><input id="delete-name" name="name" autoComplete="name" required maxLength={120} /></div>
            <div className="form-field"><label htmlFor="delete-email">JTBazar account email *</label><input id="delete-email" name="email" type="email" autoComplete="email" required maxLength={254} /></div>
            <div className="form-field form-field--wide"><label htmlFor="delete-reason">Reason (optional)</label><textarea id="delete-reason" name="reason" rows={3} maxLength={1000} /></div>
          </div>
          <div className="contact-form-submit">
            <button className="button button--dark" type="submit"><Send size={15} /> Prepare deletion request</button>
            {status && <p role="status">{status}</p>}
          </div>
          {!canEmail && !canWhatsApp && <p>Support contact details are not currently published. <Link to="/contact">Contact JTBazar support</Link>.</p>}
        </form>
      </section>
      <aside className="contact-aside">
        <div className="contact-aside__intro"><span className="contact-aside__icon"><ShieldCheck size={21} /></span><span className="eyebrow">What happens next</span><h2>Your request and your data</h2><p>JTBazar support will verify that you control the account before processing a deletion request. We will confirm the outcome using the contact details you provide.</p></div>
        <div className="contact-methods">
          {canEmail && <a className="contact-method" href={`mailto:${email}`}><span><Mail size={17} /></span><span><small>Email support</small><strong>{email}</strong></span></a>}
          {canWhatsApp && <a className="contact-method" href={whatsapp} target="_blank" rel="noopener noreferrer"><span><MessageCircle size={17} /></span><span><small>WhatsApp support</small><strong>Message JTBazar</strong></span></a>}
        </div>
        <div className="contact-aside__note"><ShieldCheck size={16} /><p>After verification, JTBazar will delete or de-identify personal account data that is not required to be retained. Limited order, transaction, fraud-prevention or legal records may be retained where required by law or for legitimate security purposes.</p></div>
        <p><Link to="/privacy">Read the Privacy Policy</Link></p>
      </aside>
    </div>
  </div>
}
