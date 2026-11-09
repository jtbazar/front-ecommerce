import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, BadgeCheck, Clock3, ExternalLink, FileText, Leaf, Mail, MapPin, MessageCircle, NotebookPen, PackageCheck, Phone, Send, ShieldCheck, ShoppingBag, Store, Truck, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCart } from '../contexts/CartContext'
import { useWishlist } from '../contexts/WishlistContext'
import { usePageMeta } from '../hooks/usePageMeta'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { supportDestination } from '../utils/support'
import { useI18n } from '../i18n/LocaleContext'
import { formatPKR } from '../utils/money'
import { useAuth } from '../contexts/AuthContext'
import { createCustomerSupportTicket, listMyCustomerSupportTickets, notifySupportEmail, type CustomerSupportTicket } from '../services/account/supportService'

function InfoLayout({ eyebrow, title, intro, children }: { eyebrow: string; title: React.ReactNode; intro: string; children: React.ReactNode }) {
  return <div className="page-shell info-page"><header className="info-page__heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{intro}</p></header>{children}</div>
}

export function AboutPage() {
  const { t } = useI18n()
  const settings = useStoreSettings()
  usePageMeta(t('About JTBazar'), t('A multi-vendor marketplace for thoughtful goods across everyday routines.'))
  return <InfoLayout eyebrow={t('A little about us')} title={<>{t('Space for the')} <em>{t('everyday idea.')}</em></>} intro={t(`${settings.storeName} is a multi-vendor marketplace connecting independent sellers with buyers across Pakistan.`)}>
    <section className="about-story">
      <div className="about-story__copy"><span className="eyebrow">{t('Our point of view')}</span><h2>{t('A marketplace made of many small stories.')}</h2><p>{t('JTBazar brings independent shops and their carefully chosen goods together in one place. Browse the catalog, learn about the shop behind an item, and keep your order details together in your account.')}</p><Link to="/shop" className="button button--dark">{t('Explore the marketplace')} <ArrowRight size={16} /></Link></div>
      <div className="about-story__visual" aria-hidden="true"><span className="about-story__orbit about-story__orbit--one" /><span className="about-story__orbit about-story__orbit--two" /><span className="about-story__visual-mark"><ShoppingBag size={38} /></span><span className="about-story__visual-label">JTBazar · Pakistan</span></div>
    </section>
    <div className="info-feature-grid about-values">
      <article><span><Leaf size={19} /></span><h2>{t('Thoughtful by design')}</h2><p>{t('A considered range of goods for creative routines, useful spaces and everyday moments.')}</p></article>
      <article><span><Store size={19} /></span><h2>{t('Independent shops')}</h2><p>{t('Each shop has its own identity, products and story. Find the seller details on shop and product pages.')}</p></article>
      <article><span><ShieldCheck size={19} /></span><h2>{t('Reviewed before listing')}</h2><p>{t('Seller applications are reviewed and products pass marketplace moderation before publication.')}</p></article>
    </div>
    <section className="about-journey"><div><span className="eyebrow">{t('How it works')}</span><h2>{t('From discovery to delivery')}</h2></div><div className="about-journey__steps"><article><span>01</span><strong>{t('Discover')}</strong><p>{t('Explore products and independent stores.')}</p></article><article><span>02</span><strong>{t('Place your order')}</strong><p>{t('Sign in to check out and keep order details in your account.')}</p></article><article><span>03</span><strong>{t('Follow progress')}</strong><p>{t('See marketplace and seller updates from your account.')}</p></article></div></section>
  </InfoLayout>
}

export function ContactPage() {
  const { t } = useI18n()
  const settings = useStoreSettings()
  const { user } = useAuth()
  const [formMessage, setFormMessage] = useState('')
  const [tickets, setTickets] = useState<CustomerSupportTicket[]>([])
  const [sending, setSending] = useState(false)
  useEffect(() => { if (!user) { setTickets([]); return }; void listMyCustomerSupportTickets().then(setTickets).catch(() => {}) }, [user?.id])
  usePageMeta(t('Contact'), t('Contact JTBazar support.'))
  const destination = supportDestination(undefined, settings.supportWhatsapp)
  const email = settings.supportEmail
  const phone = settings.supportPhone
  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const subject = String(data.get('subject') ?? '').trim()
    if (user) {
      setSending(true)
      try {
        const ticket = await createCustomerSupportTicket(subject, String(data.get('message') ?? '').trim())
        const emailed = await notifySupportEmail(ticket.id, 'customer', 'created')
        setTickets((current) => [ticket, ...current])
        form.reset()
        setFormMessage(emailed ? 'Support request sent. We will reply here and by email.' : 'Support request saved. Email notifications are not configured yet.')
      } catch (cause) { setFormMessage(cause instanceof Error ? cause.message : 'Support request could not be sent.') }
      finally { setSending(false) }
      return
    }
    const message = `Name: ${String(data.get('name') ?? '').trim()}\nEmail: ${String(data.get('email') ?? '').trim()}\nTopic: ${subject}\n\n${String(data.get('message') ?? '').trim()}`
    if (email) {
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
      setFormMessage(t('Your email app is opening with your message ready to send.'))
    } else if (destination.startsWith('https://')) {
      window.open(supportDestination(message, settings.supportWhatsapp), '_blank', 'noopener,noreferrer')
      setFormMessage(t('WhatsApp is opening with your message ready to send.'))
    } else {
      setFormMessage(t('Support has not published an email or WhatsApp contact yet. Please use the FAQ or account support options.'))
    }
  }
  return <InfoLayout eyebrow={t('Questions & notes')} title={<>{t('Let’s keep the')} <em>{t('conversation clear.')}</em></>} intro={t('Reach the marketplace support team for help with orders, delivery, returns or seller questions.')}>
    <div className="contact-layout">
    <section className="contact-form-panel">
      <div className="contact-form-heading"><span className="eyebrow">{t('Send a message')}</span><h2>{t('How can we help?')}</h2><p>{t('Share a few details and we will help you find the right next step.')}</p></div>
      <form className="contact-form" onSubmit={submitContact}>
        <div className="form-grid">
          {!user && <><div className="form-field"><label htmlFor="contact-name">{t('Your name')} <span>*</span></label><input id="contact-name" name="name" autoComplete="name" required maxLength={120} /></div>
          <div className="form-field"><label htmlFor="contact-email">{t('Email address')} <span>*</span></label><input id="contact-email" name="email" type="email" autoComplete="email" required maxLength={254} /></div></>}
          <div className="form-field form-field--wide"><label htmlFor="contact-subject">{t('What do you need help with?')} <span>*</span></label><select id="contact-subject" name="subject" required defaultValue=""><option value="" disabled>{t('Choose a topic')}</option><option>{t('Order or delivery')}</option><option>{t('Return or refund')}</option><option>{t('Seller question')}</option><option>{t('Other')}</option></select></div>
          <div className="form-field form-field--wide"><label htmlFor="contact-message">{t('Message')} <span>*</span></label><textarea id="contact-message" name="message" rows={6} required minLength={10} maxLength={4000} placeholder={t('Include your order number if your message is about an order.')} /></div>
        </div>
        <div className="contact-form-submit"><button className="button button--dark" type="submit" disabled={sending}>{sending ? 'Sending…' : user ? 'Send support request' : t('Continue to support')} <Send size={15} /></button>{formMessage && <p role="status">{formMessage}</p>}</div>
      </form>
    </section>
    <aside className="contact-aside"><div className="contact-aside__intro"><span className="contact-aside__icon"><MessageCircle size={21} /></span><span className="eyebrow">{t('Customer support')}</span><h2>{t('A real person, one clear message away.')}</h2><p>{t('Choose the contact route that works for your question. For an order, add its order number so we can find it faster.')}</p></div>
      <div className="contact-methods">
        {email && <a className="contact-method" href={`mailto:${email}`}><span><Mail size={17} /></span><span><small>{t('Email support')}</small><strong>{email}</strong></span><ArrowRight size={15} /></a>}
        {phone && <a className="contact-method" href={`tel:${phone.replace(/\s/g, '')}`}><span><Phone size={17} /></span><span><small>{t('Call support')}</small><strong>{phone}</strong></span><ArrowRight size={15} /></a>}
        {destination.startsWith('https://') && <a className="contact-method" href={destination} target="_blank" rel="noopener noreferrer"><span><MessageCircle size={17} /></span><span><small>{t('WhatsApp')}</small><strong>{t('Message our support team')}</strong></span><ExternalLink size={14} /></a>}
        <Link className="contact-method" to="/faq"><span><PackageCheck size={17} /></span><span><small>{t('Looking for an answer?')}</small><strong>{t('Browse common questions')}</strong></span><ArrowRight size={15} /></Link>
      </div>
      <div className="contact-aside__note"><ShieldCheck size={16} /><p>{user ? t('Your message is saved as a private support request. You can return here to follow its status.') : t('Signed-in customers can send a private support request and follow its status from this page.')}</p></div>
    </aside>
    </div>
    {user && tickets.length > 0 && <section className="contact-history"><div className="contact-history__heading"><span className="eyebrow">{t('Your requests')}</span><h2>{t('Support history')}</h2></div>{tickets.map((ticket) => <article key={ticket.id} className="contact-history__item"><div><strong>{ticket.subject}</strong><span className={`support-ticket-status support-ticket-status--${ticket.status}`}>{ticket.status.replace('_', ' ')}</span></div><p>{ticket.message}</p><small>{new Date(ticket.created_at).toLocaleDateString()}</small>{ticket.admin_response && <blockquote><strong>{t('Marketplace reply')}</strong><br />{ticket.admin_response}</blockquote>}</article>)}</section>}
  </InfoLayout>
}

export function FAQPage() {
  const { t } = useI18n()
  const settings = useStoreSettings()
  usePageMeta(t('Frequently asked questions'), t('Answers about ordering, delivery, returns and seller verification.'))
  const faqItems = [
    { question: 'Is JTBazar accepting orders?', answer: settings.codEnabled ? 'Yes. Signed-in customers can place cash-on-delivery orders from published products. The marketplace validates price, stock and delivery fee when the order is created.' : 'Cash on delivery is currently paused, so checkout is unavailable. Published products and their stock status can still be browsed.' },
    { question: 'Is cash on delivery available?', answer: settings.codEnabled ? `Yes. Cash on delivery is available, with a delivery fee of ${formatPKR(settings.deliveryFee)} per order.` : 'Cash on delivery is currently paused. Please contact support before ordering.' },
    { question: 'How is stock confirmed?', answer: 'Availability is shown from the published catalog and checked again by the database when you place an order. If an item sells out first, the order is rejected safely.' },
    { question: 'What is the delivery timeline?', answer: 'JTBazar manages delivery. Items available together are delivered in one visit. If an item is unavailable, it may be delivered separately when ready without an additional delivery fee. For food orders, the expected preparation and delivery time is shown on the order screen.' },
    { question: 'What is the return or refund policy?', answer: 'If a product arrives damaged, submit a return request through your account within 2 calendar days of delivery. JTBazar reviews each request and informs you about the next steps.' }, 
    { question: 'How do I contact support?', answer: settings.supportEmail ? `Email ${settings.supportEmail} or use the contact page. Include your order number so we can help faster.` : 'Use the contact page for the support details published by the marketplace. Include your order number so we can help faster.' },
    { question: 'What happens to my checkout details?', answer: 'Your order and delivery details are stored with your account so you can track the order, save addresses and open a return. When signed in, your cart is saved to your account and can be restored on another device. Guest cart items are temporary until you sign in.' },
  ]
  return <InfoLayout eyebrow={t('Helpful notes')} title={<>{t('Frequently')} <em>{t('asked.')}</em></>} intro={t('Straight answers about ordering, delivery and marketplace policies.')}><div className="info-accordion">{faqItems.map((item) => <details className="faq-item" key={item.question}><summary>{t(item.question)}<span aria-hidden="true">+</span></summary><p>{t(item.answer)}</p></details>)}</div></InfoLayout>
}

export function PrivacyPage() {
  const { t } = useI18n()
  const cart = useCart()
  const wishlist = useWishlist()
  const { user } = useAuth()
  usePageMeta(t('Privacy'), t('How JTBazar uses account, order and delivery information.'))
  return <InfoLayout eyebrow={t('Privacy')} title={<>{t('Your details,')} <em>{t('handled with care.')}</em></>} intro={t('This policy explains the information used to operate JTBazar, confirm orders, arrange JTBazar-managed delivery and support customers. Last updated: 7 November 2026.')}>
    <div className="policy-grid privacy-grid">
      <article className="policy-card"><span className="policy-card__icon"><ShieldCheck size={18} /></span><span className="eyebrow">{t('01 · Information we use')}</span><h2>{t('Account, contact and technical details')}</h2><p>{t('Depending on how you use the website, we may process your name, email address, phone number, account identifiers, saved addresses, delivery instructions, and basic technical or session information needed for website security and operation.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><ShoppingBag size={18} /></span><span className="eyebrow">{t('02 · Orders and support')}</span><h2>{t('Order and case records')}</h2><p>{t('An order may contain your recipient name, phone number, delivery address, order items, quantities, variants, payment method and status, delivery notes, and any delivery location pin you choose to share. We also keep relevant order communications and return, refund or complaint case details.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Truck size={18} /></span><span className="eyebrow">{t('03 · How we use information')}</span><h2>{t('Order confirmation and delivery')}</h2><p>{t('JTBazar uses relevant information to manage your account, contact you to confirm an order, check availability, deliver your order, provide status updates, handle support requests, investigate complaints, prevent misuse and maintain required business records.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Store size={18} /></span><span className="eyebrow">{t('04 · Seller access')}</span><h2>{t('Your personal details stay protected')}</h2><p>{t('Vendors can only see the product and order-item information needed to manage their own listings. They cannot access your personal contact details, phone number or delivery address. JTBazar manages customer communication and delivery.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><ShieldCheck size={18} /></span><span className="eyebrow">{t('05 · Sharing and safeguards')}</span><h2>{t('Limited operational access')}</h2><p>{t('We do not sell personal information. Relevant details may be accessed by authorized JTBazar administrators and delivery personnel when needed to confirm, collect or deliver an order, and by service providers that host or operate parts of the website. Access is intended to be limited to legitimate operational needs. No online service can guarantee absolute security.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Mail size={18} /></span><span className="eyebrow">{t('06 · Your choices')}</span><h2>{t('Review, correct or ask us')}</h2><p>{t('You can update available profile and saved address details in your account. You may contact JTBazar to ask about, correct or request deletion of eligible personal information. Some order, payment, security or dispute records may need to be retained for legitimate business or legal reasons.')}</p><Link className="text-link" to="/contact">{t('Contact support')} <ArrowRight size={15} /></Link></article>
      <article className="policy-card"><span className="policy-card__icon"><Clock3 size={18} /></span><span className="eyebrow">{t('07 · Retention')}</span><h2>{t('How long information is kept')}</h2><p>{t('We retain account, order, support and case information for as long as reasonably needed to provide the marketplace, manage transactions, resolve disputes, prevent fraud and meet applicable recordkeeping requirements. When information is no longer needed, it may be deleted or de-identified under our retention practices.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><FileText size={18} /></span><span className="eyebrow">{t('08 · Third-party services')}</span><h2>{t('Infrastructure and communications')}</h2><p>{t('JTBazar uses third-party infrastructure and service providers for functions such as database hosting, account authentication, website delivery and transactional communications. Those providers process information as needed to provide their services and may have their own privacy terms.')}</p></article>
    </div>
    <section className="privacy-local-controls"><div><span className="eyebrow">{t('On this device')}</span><h2>{t('Clear your saved cart')}</h2><p>{user ? t('This removes the items in your account cart from the database. Your account wishlist stays saved.') : t('This clears the temporary guest cart and saved items in this browser session only.')}</p></div><button type="button" className="button button--outline" onClick={() => { cart.clear(); if (!user) wishlist.ids.forEach((id) => { void wishlist.toggle(id) }) }}>{user ? t('Clear saved cart') : t('Clear guest cart and saved items')}</button></section>
    <div className="policy-page-cta"><div><strong>{t('Questions about your information?')}</strong><p>{t('Contact support from the email connected to your account where possible.')}</p></div><Link className="button button--dark" to="/contact">{t('Contact support')} <ArrowRight size={15} /></Link></div>
  </InfoLayout>
}

export function ShippingPage() {
  const { t } = useI18n()
  const settings = useStoreSettings()
  usePageMeta(t('Shipping and delivery'), t('How JTBazar confirms and delivers your orders.'))
  return <InfoLayout eyebrow={t('Shipping & delivery')} title={<>{t('From order confirmation')} <em>{t('to your door.')}</em>} intro={t('JTBazar manages order confirmation and delivery from start to finish. Last updated: 9 November 2026.')}>
    <div className="policy-summary"><span className="policy-summary__icon"><Truck size={21} /></span><div><span className="eyebrow">{t('Delivery at a glance')}</span><h2>{formatPKR(settings.deliveryFee)} <small>{t('standard delivery fee')}</small></h2><p>{t('Your delivery fee is shown at checkout. One delivery fee covers items delivered together. If an item is unavailable and must be delivered separately later, no additional delivery fee is charged for that follow-up delivery.')}</p></div><span className="policy-summary__badge">{t(settings.codEnabled ? 'Cash on delivery available' : 'Cash on delivery paused')}</span></div>
    <div className="policy-grid">
      <article className="policy-card"><span className="policy-card__icon"><Phone size={18} /></span><span className="eyebrow">01 · {t('Order confirmation')}</span><h2>{t('JTBazar contacts you')}</h2><p>{t('After checkout, JTBazar receives your order and may call the phone number you provided to confirm the items, quantities, availability, address and delivery arrangements. An order is not treated as confirmed until JTBazar confirms it. Keep your phone number active and respond to confirmation calls.')}</p></article>
      
      <article className="policy-card"><span className="policy-card__icon"><PackageCheck size={18} /></span><span className="eyebrow">03 · {t('Delivery')}</span><h2>{t('Delivered by JTBazar')}</h2><p>{t('JTBazar delivers your order to the address you provided. Items that are available together are delivered in one visit. If an item is not yet available, it may be delivered separately when ready. You will not be charged an additional delivery fee for that follow-up delivery.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Clock3 size={18} /></span><span className="eyebrow">04 · {t('Delivery timing')}</span><h2>{t('Confirmed arrangements matter')}</h2><p>{t('Delivery timing depends on your location and product availability. For food orders, the expected preparation and delivery time will be shown on the order screen. For other products, the estimated or confirmed delivery schedule will be shared with your order. Unexpected circumstances may cause delays.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><MapPin size={18} /></span><span className="eyebrow">05 · {t('Your address')}</span><h2>{t('Provide complete details')}</h2><p>{t('Provide a complete address including house or building number, street, area, city and a nearby landmark. A delivery pin may help where the checkout offers it, but it does not replace a written address. You or an authorized recipient should be reachable and available at the confirmed location.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Wallet size={18} /></span><span className="eyebrow">06 · {t('Payment and charges')}</span><h2>{t('Cash on delivery')}</h2><p>{settings.codEnabled ? t('Cash on delivery is currently enabled. Pay the confirmed amount to the JTBazar delivery representative when the order is delivered. The delivery fee shown at checkout is included in the order total.') : t('Cash on delivery is currently paused. The payment method available to you will be shown at checkout.')}</p></article>
    </div>
    <div className="policy-page-cta"><div><strong>{t('A delivery attempt could not be completed?')}</strong><p>{t('Incorrect address, an unreachable phone number or no available recipient may delay delivery. Contact support promptly with your order number to discuss the next step.')}</p></div><Link className="button button--dark" to="/contact">{t('Contact support')} <ArrowRight size={15} /></Link></div>
  </InfoLayout>
}

export function ReturnsPage() {
  const { t } = useI18n()
  const settings = useStoreSettings()
  usePageMeta(t('Returns and complaints'), t('How to request a return, refund or complaint from your account.'))
  return <InfoLayout eyebrow={t('Returns & complaints')} title={<>{t('A clear review process,')} <em>{t('with JTBazar.')}</em></>} intro={t('Submit a request against an eligible delivered order item and follow its progress from your account. Last updated: 7 November 2026.')}>
    <div className="policy-summary policy-summary--returns"><span className="policy-summary__icon"><ArrowRight size={21} /></span><div><span className="eyebrow">{t('Damage return request window')}</span><h2>2 <small>{t('calendar days after delivery')}</small></h2><p>{t('Submit a damage-related request within 2 calendar days of delivery. Every request is reviewed by JTBazar and is not automatically approved.')}</p></div><Link className="button button--dark" to="/account">{t('Open your orders')} <ArrowRight size={15} /></Link></div>
    <div className="policy-grid policy-grid--three">
      <article className="policy-card"><span className="policy-card__icon"><BadgeCheck size={18} /></span><span className="eyebrow">01 · {t('Eligible issues')}</span><h2>{t('Wrong, damaged or defective')}</h2><p>{t('You may request a review if the wrong item or variant was delivered, an item arrived damaged or defective, an item is materially different from its listing, or an item is missing from your order. The team reviews the details and available evidence.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Leaf size={18} /></span><span className="eyebrow">02 · {t('Food and groceries')}</span><h2>{t('Food and perishable items')}</h2><p>{t('Food, fresh produce and other perishable or hygiene-sensitive products are not covered by the standard 2-day return window. Contact JTBazar support about a food order issue so the team can review it.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><NotebookPen size={18} /></span><span className="eyebrow">03 · {t('How to request')}</span><h2>{t('Open a case in your account')}</h2><p>{t('Sign in, open your order, select the affected item and choose the relevant return, refund or complaint option. Explain what happened. A photo or other evidence is required for return and complaint cases; a refund request may be submitted without an evidence image.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><MessageCircle size={18} /></span><span className="eyebrow">04 · {t('Review')}</span><h2>{t('JTBazar reviews your request')}</h2><p>{t('JTBazar reviews the request, order details and any evidence you provide, then decides the appropriate next steps. You can follow the case status and decision from your account.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><PackageCheck size={18} /></span><span className="eyebrow">05 · {t('Returning an item')}</span><h2>{t('Wait for instructions')}</h2><p>{t('Keep the item, packaging and included accessories in their original condition where reasonably possible. Do not send or hand an item back until JTBazar provides return or collection instructions. The arrangement depends on the item and service availability.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Wallet size={18} /></span><span className="eyebrow">06 · {t('Refunds')}</span><h2>{t('After approval and verification')}</h2><p>{t('Refunds are considered for approved cases, including verified wrong, damaged, defective or missing items and eligible cancellations where payment was collected. JTBazar currently offers cash on delivery. For an approved refund, support will verify the order and coordinate the refund method and timing with you individually.')}</p></article>
    </div>
    <div className="policy-page-cta"><div><strong>{t('Need help with a return or refund?')}</strong><p>{t('Include your order number and the affected item when contacting support.')}</p></div><Link className="button button--outline" to="/contact">{t('Contact support')} <ArrowRight size={15} /></Link></div>
  </InfoLayout>
}

export function TermsPage() {
  const { t } = useI18n()
  const settings = useStoreSettings()
  usePageMeta(t('Terms of Service'), t('The terms for using JTBazar, placing orders and shopping through our marketplace.'))
  return <InfoLayout eyebrow={t('Marketplace terms')} title={<>{t('Clear terms for')} <em>{t('confident shopping.')}</em></>} intro={t('Please read these terms before using JTBazar or placing an order. By accessing the marketplace, you agree to follow the terms below.')}>
    <div className="policy-summary">
      <span className="policy-summary__icon"><ShieldCheck size={21} /></span>
      <div><span className="eyebrow">{t('A marketplace built on clarity')}</span><h2>{t('JTBazar · Terms of Service')}</h2><p>{t('Last updated: 7 November 2026. These terms apply to customers using the JTBazar marketplace.')}</p></div>
    </div>
    <div className="policy-grid">
      <article className="policy-card"><span className="policy-card__icon"><ShoppingBag size={18} /></span><span className="eyebrow">01 · {t('Using JTBazar')}</span><h2>{t('Marketplace access')}</h2><p>{t('JTBazar provides an online marketplace where customers can discover products offered by JTBazar and approved independent sellers. You agree to provide accurate account, contact and delivery information, keep your sign-in details secure, and use the website lawfully. Do not misuse the marketplace, interfere with its operation, submit false orders or attempt unauthorized access.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><BadgeCheck size={18} /></span><span className="eyebrow">02 · {t('Accounts & orders')}</span><h2>{t('Order placement and confirmation')}</h2><p>{t('Placing an order is a request to purchase the items shown at checkout; it is not final acceptance. JTBazar may contact you on the phone number provided to confirm the order, address, availability and delivery details. An order may be declined or adjusted if an item is unavailable, information is incomplete, a price or listing error is found, or delivery cannot be arranged. We will make reasonable efforts to contact you about material changes.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Wallet size={18} /></span><span className="eyebrow">03 · {t('Payment')}</span><h2>{t('Cash on delivery')}</h2><p>{t('JTBazar currently offers cash on delivery where it is enabled at checkout. Pay the confirmed order amount to the JTBazar delivery representative when the order is delivered. Any delivery fee or other applicable charge is shown at checkout before you submit the order. Online payment options should only be used if they are explicitly presented on the website.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><Truck size={18} /></span><span className="eyebrow">04 · {t('Delivery')}</span><h2>{t('Coverage and delivery arrangements')}</h2><p>{t('Delivery is currently limited to serviceable areas of Karachi. The applicable delivery fee is displayed during checkout. Items available together are delivered in one visit under one delivery fee. If an item is unavailable and must be delivered separately later, no additional delivery fee is charged for that follow-up delivery. Any estimated delivery date or time is an estimate unless expressly confirmed by JTBazar. Please provide a complete address and remain reachable for order confirmation and delivery.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><PackageCheck size={18} /></span><span className="eyebrow">05 · {t('Returns & refunds')}</span><h2>{t('Return requests and complaints')}</h2><p>{t(`For eligible general products, submit a return request through your account within ${settings.returnWindowDays} calendar days after delivery. Report food and grocery concerns as soon as possible after delivery; JTBazar reviews these cases individually because products may be perishable or time-sensitive. A return, replacement or refund is not automatic and is subject to review under the Returns Policy. Any approved refund arrangement will be communicated by support.`)}</p><Link className="text-link" to="/returns">{t('Read the Returns Policy')} <ArrowRight size={15} /></Link></article>
      <article className="policy-card"><span className="policy-card__icon"><Store size={18} /></span><span className="eyebrow">06 · {t('Products & sellers')}</span><h2>{t('Listings and availability')}</h2><p>{t('Product descriptions, images, prices, variants and availability are provided for customer guidance and may be updated. Sellers are reviewed before participation and product listings require marketplace approval. JTBazar may correct listing errors, pause or remove products, or limit seller access when necessary. JTBazar manages order handling, customer communication and delivery. Vendors cannot access customer contact or delivery details.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><ShieldCheck size={18} /></span><span className="eyebrow">07 · {t('Privacy')}</span><h2>{t('Your information')}</h2><p>{t('We use account, contact, order and delivery information to operate the marketplace, confirm orders, arrange delivery, prevent misuse and provide support. Access to personal information is limited to people who need it to perform marketplace operations. Our Privacy Policy explains this in more detail.')}</p><Link className="text-link" to="/privacy">{t('Read the Privacy Policy')} <ArrowRight size={15} /></Link></article>
      <article className="policy-card"><span className="policy-card__icon"><FileText size={18} /></span><span className="eyebrow">08 · {t('Changes & availability')}</span><h2>{t('Website updates and limitations')}</h2><p>{t('We may update website features, listings or these terms from time to time. The latest version will be published on this page with its update date. We aim to keep the marketplace available and information accurate, but do not guarantee uninterrupted access or that every listing will always be available. To the extent permitted by applicable law, JTBazar is not responsible for indirect losses arising from temporary service interruptions or events outside its reasonable control.')}</p></article>
      <article className="policy-card"><span className="policy-card__icon"><MessageCircle size={18} /></span><span className="eyebrow">09 · {t('Questions')}</span><h2>{t('Contact JTBazar')}</h2><p>{t('If you have a question about these terms, an order, delivery or a return, contact our support team and include your order number where relevant.')}</p><Link className="text-link" to="/contact">{t('Contact support')} <ArrowRight size={15} /></Link></article>
    </div>
    <div className="policy-page-cta"><div><strong>{t('Need help before placing an order?')}</strong><p>{t('Our support team can help clarify marketplace and order questions.')}</p></div><Link className="button button--dark" to="/contact">{t('Contact support')} <ArrowRight size={15} /></Link></div>
  </InfoLayout>
}
