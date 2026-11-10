import './CustomerSupportCenter.css'
import { useEffect, useState, type FormEvent } from 'react'
import { MessageSquare, Plus, RefreshCw, Send, X } from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import { createCustomerSupportTicket, listMyCustomerSupportMessages, listMyCustomerSupportTickets, notifySupportEmail, sendCustomerSupportMessage, type CustomerSupportTicket, type CustomerSupportMessage } from '../../services/account/supportService'

export function CustomerSupportCenter() {
  const { push } = useToast()
  const [tickets, setTickets] = useState<CustomerSupportTicket[]>([])
  const [selected, setSelected] = useState<CustomerSupportTicket | null>(null)
  const [messages, setMessages] = useState<CustomerSupportMessage[]>([])
  const [subject, setSubject] = useState('')
  const [initialMessage, setInitialMessage] = useState('')
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadTickets() {
    setError(null)
    try { setTickets(await listMyCustomerSupportTickets()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Support tickets could not be loaded.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void loadTickets() }, [])

  useEffect(() => {
    if (!selected) { setMessages([]); return }
    let active = true
    const load = async () => {
      try { const rows = await listMyCustomerSupportMessages(selected.id); if (active) setMessages(rows) }
      catch (cause) { if (active) push(cause instanceof Error ? cause.message : 'Conversation could not be loaded.', 'error') }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 10000)
    return () => { active = false; window.clearInterval(timer) }
  }, [selected?.id])

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending || subject.trim().length < 3 || initialMessage.trim().length < 3) return
    setSending(true)
    try {
      const ticket = await createCustomerSupportTicket(subject, initialMessage)
      setSubject(''); setInitialMessage('')
      await notifySupportEmail(ticket.id, 'customer', 'created')
      await loadTickets()
      setSelected(ticket)
      push('Support request submitted.', 'success')
    } catch (cause) { push(cause instanceof Error ? cause.message : 'Support request could not be submitted.', 'error') }
    finally { setSending(false) }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !reply.trim() || sending || ['resolved', 'closed'].includes(selected.status.toLowerCase())) return
    setSending(true)
    try {
      const row = await sendCustomerSupportMessage(selected.id, reply.trim())
      setMessages(current => [...current, row])
      setReply('')
      await loadTickets()
    } catch (cause) { push(cause instanceof Error ? cause.message : 'Message could not be sent.', 'error') }
    finally { setSending(false) }
  }

  return <section className="account-panel customer-support-center">
    <div className="account-panel__heading"><div><h2>JTBazar Support</h2><p>Send us a message and continue the conversation here.</p></div><button type="button" className="button button--outline" onClick={() => { setLoading(true); void loadTickets() }} disabled={loading}><RefreshCw size={15}/> Refresh</button></div>
    <form className="customer-support-form" onSubmit={createTicket}>
      <div className="form-grid">
        <div className="form-field form-field--wide"><label htmlFor="customer-support-subject">Subject</label><input id="customer-support-subject" value={subject} onChange={e => setSubject(e.target.value)} minLength={3} maxLength={160} required placeholder="How can we help?" /></div>
        <div className="form-field form-field--wide"><label htmlFor="customer-support-message">Message</label><textarea id="customer-support-message" value={initialMessage} onChange={e => setInitialMessage(e.target.value)} minLength={3} maxLength={4000} rows={3} required placeholder="Describe your question or issue…" /></div>
      </div>
      <button className="button button--dark" disabled={sending}><Plus size={15}/> {sending ? 'Sending…' : 'Create support request'}</button>
    </form>
    <div className="customer-support-list">
      {loading ? <p>Loading your support requests…</p> : error ? <p role="alert">{error}</p> : tickets.length === 0 ? <p>You have no support conversations yet.</p> : tickets.map(ticket => <article className="customer-support-ticket" key={ticket.id}>
        <div><strong>{ticket.subject}</strong><p>{ticket.message}</p><small>{new Date(ticket.updated_at).toLocaleString()} · {ticket.status.replace('_',' ')}</small></div>
        <button type="button" className="button button--outline" onClick={() => setSelected(ticket)}><MessageSquare size={15}/> Open chat</button>
      </article>)}
    </div>
    {selected && <div className="customer-support-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !sending) setSelected(null) }}>
      <section className="customer-support-modal" role="dialog" aria-modal="true" aria-labelledby="customer-support-chat-title">
        <header><div><small>JTBazar Customer Support</small><h3 id="customer-support-chat-title">{selected.subject}</h3><span>{selected.status.replace('_',' ')}</span></div><button type="button" aria-label="Close chat" onClick={() => setSelected(null)}><X size={18}/></button></header>
        <div className="customer-support-thread">
          <article className="customer-support-bubble customer-support-bubble--customer"><strong>You · {new Date(selected.created_at).toLocaleString()}</strong><p>{selected.message}</p></article>
          {messages.map(message => <article key={message.id} className={`customer-support-bubble customer-support-bubble--${message.sender_role}`}><strong>{message.sender_role === 'admin' ? 'JTBazar Support' : 'You'} · {new Date(message.created_at).toLocaleString()}</strong><p>{message.message}</p></article>)}
          {messages.length === 0 && selected.admin_response && <article className="customer-support-bubble customer-support-bubble--admin"><strong>JTBazar Support</strong><p>{selected.admin_response}</p></article>}
        </div>
        {['resolved','closed'].includes(selected.status.toLowerCase()) ? <p className="customer-support-closed">This conversation is closed. Contact support again by creating a new request.</p> : <form className="customer-support-composer" onSubmit={sendReply}><textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} maxLength={4000} placeholder="Write your message…" required/><button className="button button--dark" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : <><Send size={15}/> Send</>}</button></form>}
      </section>
    </div>}
  </section>
}
