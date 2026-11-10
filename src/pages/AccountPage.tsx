import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, MessageSquare, AlertCircle, ArrowRight, CheckCircle2, ClipboardList, FileUp, Heart, Home, MapPin, Package, Pencil, Plus, RefreshCw, ShieldCheck, Store, Trash2, UserRound, X, XCircle } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '../components/common/States'
import { UserAvatar } from '../components/common/UserAvatar'
import { ReviewComposer } from '../components/reviews/ReviewComposer'
import { useAuth } from '../contexts/AuthContext'
import { useCatalog } from '../contexts/CatalogContext'
import { useI18n } from '../i18n/LocaleContext'
import { useToast } from '../contexts/ToastContext'
import { usePageMeta } from '../hooks/usePageMeta'
import { authService } from '../services/auth/authService'
import { createAddress, deleteAddress, listMyAddresses, setDefaultAddress, updateAddress, type AddressInput, type SavedAddress } from '../services/account/addressService'
import { hasRememberedAccountSuspension } from '../services/auth/accountAccessNotice'
import { cancelCustomerOrder, createMarketplaceCase, listMyCases, listMyOrders, listOrderItems, uploadComplaintEvidence } from '../services/orders/orderService'
import type { MarketplaceCaseRecord, OrderItemRecord, OrderRecord } from '../types/order'
import { formatPKR } from '../utils/money'
import { isValidPakistaniMobile } from '../utils/contactValidation'
import { CustomerProfilePanel } from '../components/account/CustomerProfilePanel'
import { enableWebPush } from '../services/notifications/webPush'
import { CustomerSupportCenter } from '../components/account/CustomerSupportCenter'

type Tab = 'profile' | 'orders' | 'addresses' | 'cases' | 'support'

const emptyAddress: AddressInput = {
  recipient_name: '',
  phone: '',
  address_line_1: '',
  address_line_2: null,
  city: '',
  province: null,
  postal_code: null,
  delivery_instructions: null,
  is_default: false,
}

function addressSummary(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const address = value as Record<string, unknown>
  return [address.address_line_1, address.address_line_2, address.area, address.city, address.province, address.postal_code, address.country].filter((part) => typeof part === 'string' && part.trim()).join(', ')
}

function formatDeliveryDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDeliveryTime(value: string): string {
  const [hourText, minuteText] = value.slice(0, 5).split(':')
  const hour = Number(hourText)
  return `${hour % 12 || 12}:${minuteText} ${hour >= 12 ? 'PM' : 'AM'}`
}

function statusClass(status: string): string {
  return `order-status order-status--${status.replace(/_/g, '-')}`
}

function orderItemQuantityLabel(item: OrderItemRecord): string {
  const snapshot = item.product_snapshot
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && typeof snapshot.display_quantity === 'string') return snapshot.display_quantity
  return String(item.quantity)
}

function orderItemPreparationLabel(item: OrderItemRecord): string {
  const snapshot = item.product_snapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ''
  const data = snapshot as Record<string, unknown>
  const keys = ['preparation_time', 'preparation_time_minutes', 'prep_time', 'prep_time_minutes', 'estimated_preparation_time', 'estimated_prep_time', 'cooking_time', 'cooking_time_minutes']
  const value = keys.map((key) => data[key]).find((entry) => entry !== null && entry !== undefined && entry !== '')
  if (typeof value === 'number' && Number.isFinite(value)) return value + ' min'
  return typeof value === 'string' ? value : ''
}

function orderItemVariantLabel(item: OrderItemRecord): string {
  const value = item.variant_snapshot
  if (!value || typeof value !== 'object' || Array.isArray(value)) return typeof value === 'string' ? value : ''
  return Object.entries(value as Record<string, unknown>).map(([key, entry]) => entry == null || entry === '' ? '' : key.replace(/_/g, ' ') + ': ' + String(entry)).filter(Boolean).join(' · ')
}

function formatCaseVariant(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return typeof value === 'string' ? value : ''
  return Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (entry === null || entry === undefined || entry === '') return ''
    if (typeof entry === 'object') return Object.entries(entry as Record<string, unknown>).map(([nestedKey, nestedValue]) => nestedValue == null ? '' : nestedKey + ': ' + String(nestedValue)).filter(Boolean).join(', ')
    return key.replace(/_/g, ' ') + ': ' + String(entry)
  }).filter(Boolean).join(' · ')
}

export function AccountPage() {
  const { t } = useI18n()
  const { configured, loading, user, session, isAdmin, error: authError, avatarUrl, displayName } = useAuth()
  const navigate = useNavigate()
  const [emailVerified, setEmailVerified] = useState(false)
  const [verificationCheckDone, setVerificationCheckDone] = useState(false)
  const { push } = useToast()
  const { refresh: refreshCatalog } = useCatalog()
  const [tab, setTab] = useState<Tab>('orders')
  const [pushBusy, setPushBusy] = useState(false)
  const [knownSuspendedAccount] = useState(hasRememberedAccountSuspension)

  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [orderHistoryDate, setOrderHistoryDate] = useState(new Date().toLocaleDateString('en-CA'))
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, OrderItemRecord[]>>({})
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null)

  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [addressesLoading, setAddressesLoading] = useState(true)
  const [addressesError, setAddressesError] = useState<string | null>(null)
  const [addressForm, setAddressForm] = useState<AddressInput | null>(null)
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null)
  const [savingAddress, setSavingAddress] = useState(false)

  const [cases, setCases] = useState<MarketplaceCaseRecord[]>([])
  const [casesLoading, setCasesLoading] = useState(true)
  const [casesError, setCasesError] = useState<string | null>(null)
  const [caseTarget, setCaseTarget] = useState<{ order: OrderRecord; item: OrderItemRecord | null } | null>(null)
  const [caseType, setCaseType] = useState<'return' | 'refund' | 'complaint'>('complaint')
  const [caseReason, setCaseReason] = useState('')
  const [caseEvidence, setCaseEvidence] = useState<File | null>(null)
  const [caseItemId, setCaseItemId] = useState('')
  const [submittingCase, setSubmittingCase] = useState(false)

  usePageMeta(t('Your account'), t('Manage your orders, delivery addresses, returns and complaints.'))

  async function loadOrders() {
    setOrdersLoading(true)
    setOrdersError(null)
    try {
      const rows = await listMyOrders()
      setOrders(rows)
      const itemEntries = await Promise.all(rows.map(async (order) => [order.id, await listOrderItems(order.id)] as const))
      setItemsByOrder(Object.fromEntries(itemEntries))
    } catch (cause) {
      setOrdersError(cause instanceof Error ? cause.message : 'Orders could not be loaded.')
    } finally {
      setOrdersLoading(false)
    }
  }

  async function cancelOrder(order: OrderRecord) {
    if (!window.confirm(t('Cancel this order? You can only cancel before fulfilment starts.'))) return
    setCancellingOrderId(order.id)
    try {
      await cancelCustomerOrder(order.id)
      refreshCatalog()
      push(t('Order cancelled. Available stock has been restored.'), 'success')
      await loadOrders()
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('This order could not be cancelled.'), 'error')
    } finally {
      setCancellingOrderId(null)
    }
  }

  async function loadAddresses() {
    setAddressesLoading(true)
    setAddressesError(null)
    try { setAddresses(await listMyAddresses()) }
    catch (cause) { setAddressesError(cause instanceof Error ? cause.message : 'Addresses could not be loaded.') }
    finally { setAddressesLoading(false) }
  }

  async function loadCases() {
    setCasesLoading(true)
    setCasesError(null)
    try { setCases(await listMyCases()) }
    catch (cause) { setCasesError(cause instanceof Error ? cause.message : 'Returns and complaints could not be loaded.') }
    finally { setCasesLoading(false) }
  }

  useEffect(() => {
    let active = true
    if (!user) {
      setEmailVerified(false)
      setVerificationCheckDone(false)
      setOrdersLoading(false); setAddressesLoading(false); setCasesLoading(false)
      return () => { active = false }
    }
    setEmailVerified(false)
    setVerificationCheckDone(false)
    void authService.getCurrentUser().then(({ data, error }) => {
      if (!active) return
      if (error || !data.user?.email_confirmed_at) {
        navigate('/verify-email', { replace: true })
        return
      }
      setEmailVerified(true)
      setVerificationCheckDone(true)
    }).catch(() => {
      if (active) navigate('/login', { replace: true })
    })
    return () => { active = false }
  }, [user?.id, navigate])

  useEffect(() => {
    if (!user || !emailVerified) { setOrdersLoading(false); setAddressesLoading(false); setCasesLoading(false); return }
    void loadOrders()
    void loadAddresses()
    void loadCases()
  }, [user?.id, emailVerified])

  const orderNumbers = useMemo(() => new Map(orders.map((order) => [order.id, order.order_number])), [orders])

  const visibleOrders = useMemo(() => orders.filter((order) => order.created_at.slice(0, 10) === orderHistoryDate), [orders, orderHistoryDate])

  if (loading || (user && !verificationCheckDone)) return <section className="account-page"><div className="account-page__inner"><span className="auth-eyebrow">{t('Account security')}</span><h1>{t('Verifying account access')}</h1><p role="status">{t('Checking your verified email and secure session…')}</p></div></section>

  if (!configured || !user) {
    return <section className="account-page"><div className="account-page__inner"><div className="account-page__icon" aria-hidden="true"><UserRound size={28} /></div><span className="auth-eyebrow">{t('Account')}</span><h1>{t(knownSuspendedAccount ? 'Account suspended' : configured ? 'Sign in to view your account' : 'Account access is not configured')}</h1><p className={knownSuspendedAccount ? 'account-page__note' : undefined} role={knownSuspendedAccount ? 'alert' : undefined}>{t(knownSuspendedAccount ? 'This account was suspended by marketplace administration. Sign-in is disabled. Contact support if you believe this is a mistake.' : configured ? 'You are not currently signed in.' : 'Account access is currently unavailable.')}</p>{authError && !knownSuspendedAccount && <p className="account-page__note" role="alert">{t(authError)}</p>}<div className="account-page__actions"><Link className="account-page__primary" to="/login">{t('Sign in')}<ArrowRight size={16} aria-hidden="true" /></Link>{knownSuspendedAccount ? <Link className="account-page__secondary" to="/contact">{t('Contact marketplace support')}</Link> : <Link className="account-page__secondary" to="/register">{t('Create account')}</Link>}</div></div></section>
  }

  function setAddressField(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value, type } = event.target
    setAddressForm((current) => current ? { ...current, [name]: type === 'checkbox' ? (event.target as HTMLInputElement).checked : (value || null) } : current)
  }

  function startNewAddress() {
    setAddressForm({ ...emptyAddress, is_default: addresses.length === 0 })
    setEditingAddressId(null)
  }

  function startEditAddress(address: SavedAddress) {
    setEditingAddressId(address.id)
    setAddressForm({
      recipient_name: address.recipient_name,
      phone: address.phone,
      address_line_1: address.address_line_1,
      address_line_2: address.address_line_2,
      city: address.city,
      province: address.province,
      postal_code: address.postal_code,
      delivery_instructions: address.delivery_instructions,
      is_default: address.is_default,
    })
  }

  async function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!addressForm) return
    if (!addressForm.recipient_name.trim() || !addressForm.phone.trim() || !addressForm.address_line_1.trim() || !addressForm.city.trim()) {
      push(t('Recipient, phone, street address and city are required.'), 'error')
      return
    }
    if (!isValidPakistaniMobile(addressForm.phone)) { push(t('Enter exactly 03001234567 or +923001234567.'), 'error'); return }
    setSavingAddress(true)
    try {
      if (editingAddressId) await updateAddress(editingAddressId, addressForm)
      else await createAddress(addressForm)
      push(t(editingAddressId ? 'Address updated.' : 'Address saved.'), 'success')
      setAddressForm(null)
      setEditingAddressId(null)
      await loadAddresses()
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('The address could not be saved.'), 'error')
    } finally {
      setSavingAddress(false)
    }
  }

  async function removeAddress(id: string) {
    try {
      await deleteAddress(id)
      setAddresses((current) => current.filter((address) => address.id !== id))
      if (editingAddressId === id) { setAddressForm(null); setEditingAddressId(null) }
      push(t('Address removed.'), 'success')
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('The address could not be removed.'), 'error')
    }
  }

  async function makeDefault(id: string) {
    try {
      await setDefaultAddress(id)
      await loadAddresses()
      push(t('Default address updated.'), 'success')
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('The default address could not be updated.'), 'error')
    }
  }

  async function turnOnNotifications() {
    if (!session?.access_token) return
    setPushBusy(true)
    try {
      await enableWebPush(session.access_token)
      push(t('Notifications enabled on this browser.'), 'success')
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('Could not enable notifications.'), 'error')
    } finally { setPushBusy(false) }
  }


  function openCase(order: OrderRecord, item: OrderItemRecord | null) {
    setCaseTarget({ order, item })
    setCaseType('complaint')
    setCaseReason('')
    setCaseEvidence(null)
    setCaseItemId(item?.id ?? itemsByOrder[order.id]?.[0]?.id ?? '')
    setTab('cases')
  }

  async function submitCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!caseTarget) return
    const selectedItem = (itemsByOrder[caseTarget.order.id] ?? []).find((item) => item.id === caseItemId)
    if (!selectedItem) { push(t('Select the product from this order.'), 'error'); return }
    if (caseReason.trim().length < 3 || caseReason.trim().length > 2000) { push(t('Enter a reason between 3 and 2,000 characters.'), 'error'); return }
    if (caseType !== 'refund' && !caseEvidence) { push(t('A product evidence image is required.'), 'error'); return }
    if (caseEvidence && !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(caseEvidence.type)) { push(t('Choose a JPG, PNG, WebP or AVIF image.'), 'error'); return }
    setSubmittingCase(true)
    try {
      const evidencePath = caseEvidence ? await uploadComplaintEvidence(caseTarget.order.id, caseEvidence) : null
      await createMarketplaceCase({
        orderId: caseTarget.order.id,
        orderItemId: selectedItem.id,
        sellerId: selectedItem.seller_id,
        caseType,
        reason: caseReason,
        evidencePath,
      })
      push(t('Your case has been submitted.'), 'success')
      setCaseTarget(null)
      setCaseReason('')
      setCaseEvidence(null)
      setCaseItemId('')
      await loadCases()
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('The case could not be submitted.'), 'error')
    } finally {
      setSubmittingCase(false)
    }
  }

  return <div className="page-shell account-dashboard">
    <header className="account-dashboard__header">
      <div className="account-dashboard__identity">
        <div className="account-dashboard__avatar">{avatarUrl ? <UserAvatar avatarUrl={avatarUrl} name={displayName} size={30} /> : <UserRound size={26} />}</div>
        <div>
          <span className="eyebrow">{t('Your account')}</span>
          <h1>{displayName || t('My account')}</h1>
          <p>{user.email}{isAdmin ? <span className="account-dashboard__admin"><ShieldCheck size={14} /> {t('Administrator')}</span> : null}</p>
        </div>
      </div>
      <div className="account-dashboard__quick-links">
        <Link to="/wishlist"><Heart size={15} /> {t('Wishlist')}</Link>
        <Link to="/vendor"><Store size={15} /> {t('Seller area')}</Link>
        <button type="button" onClick={() => void turnOnNotifications()} disabled={pushBusy}><Bell size={15} /> {t(pushBusy ? 'Working…' : 'Enable notifications')}</button>
        <Link to="/logout">{t('Sign out')}</Link>
      </div>
    </header>

    <nav className="account-tabs" aria-label={t('Account sections')}>
      <button type="button" className={tab === 'profile' ? 'is-active' : ''} onClick={() => setTab('profile')}><UserRound size={16} /> {t('Profile')}</button>
      <button type="button" className={tab === 'orders' ? 'is-active' : ''} onClick={() => setTab('orders')}><Package size={16} /> {t('Orders')}{visibleOrders.length > 0 ? ` · ${visibleOrders.length}` : ''}</button>
      <button type="button" className={tab === 'addresses' ? 'is-active' : ''} onClick={() => setTab('addresses')}><Home size={16} /> {t('Addresses')}</button>
      <button type="button" className={tab === 'cases' ? 'is-active' : ''} onClick={() => setTab('cases')}><ClipboardList size={16} /> {t('Returns & complaints')}{cases.length > 0 ? ` · ${cases.length}` : ''}</button>
      <button type="button" className={tab === 'support' ? 'is-active' : ''} onClick={() => setTab('support')}><MessageSquare size={16} /> {t('Support')}</button>
    </nav>

    {tab === 'profile' && <CustomerProfilePanel />
    {tab === 'support' && <CustomerSupportCenter />}

    {tab === 'orders' && <section className="account-panel" aria-labelledby="account-orders-title">
      <div className="account-panel__heading"><div><h2 id="account-orders-title">{t('Order history')}</h2><p>{t('Track delivery and open a return or complaint from an order.')}</p></div><button type="button" className="button button--outline" onClick={() => void loadOrders()} disabled={ordersLoading}><RefreshCw size={15} className={ordersLoading ? 'spin' : ''} /> {t('Refresh')}</button></div>
      {ordersLoading && <LoadingState label={t('Loading your orders…')} centered={false} />}
      {ordersError && <><ErrorState message={ordersError} /><button type="button" className="button button--outline" onClick={() => void loadOrders()}>{t('Try again')}</button></>}
      {!ordersLoading && !ordersError && orders.length === 0 && <EmptyState title={t('No orders yet')} description={t('Your placed orders will appear here with their delivery and case status.')} actionLabel={t('Browse the catalog')} actionHref="/shop" />}
      {!ordersLoading && !ordersError && orders.length > 0 && <><div className="order-history-filter"><label htmlFor="order-history-date">{t('Orders for date')}</label><input id="order-history-date" type="date" value={orderHistoryDate} max={new Date().toLocaleDateString('en-CA')} onChange={(event) => setOrderHistoryDate(event.target.value)} /><span>{visibleOrders.length ? `${visibleOrders.length} ${t('orders')}` : t('No orders on this date')}</span></div>{visibleOrders.length > 0 ? <div className="order-list">
        {visibleOrders.map((order, orderIndex) => {
          const items = itemsByOrder[order.id] ?? []
          const open = expandedOrder === order.id
          const canCancel = ['pending', 'confirmed'].includes(order.order_status)
            && order.payment_method === 'cod'
            && order.payment_status === 'pending'
            && items.length > 0
            && items.every((item) => ['pending', 'accepted'].includes(item.vendor_fulfillment_status))
          return <article className={`order-card${open ? ' is-open' : ''}`} key={order.id}>
            <button type="button" className="order-card__summary" onClick={() => setExpandedOrder(open ? null : order.id)} aria-expanded={open}>
              <div><small className="order-card__serial">#{orderIndex + 1}</small><strong>{order.order_number}</strong><span>{new Date(order.created_at).toLocaleDateString()}</span></div>
              <div><span className={statusClass(order.order_status)}>{t(order.order_status)}</span><span className={statusClass(order.payment_status)}>{order.payment_method === 'cod' ? t('Cash on delivery') : t(order.payment_method)}</span></div>
              <div className="order-card__total"><strong>{formatPKR(Number(order.total))}</strong><span>{items.length} {items.length === 1 ? t('item') : t('items')}</span></div>
            </button>
            {open && <div className="order-card__detail">
              <ul className="order-line-list">
                {items.map((item) => {
                  const prepTime = orderItemPreparationLabel(item)
                  const variant = orderItemVariantLabel(item)
                  return <li className="order-line-list__item" key={item.id}>
                    <div className="order-line-list__product">
                      <div className="order-line-list__product-main">
                        {item.product_image_url ? <img className="order-line-list__image" src={item.product_image_url} alt={item.product_name_snapshot} loading="lazy" /> : <div className="order-line-list__image order-line-list__image--empty"><Package size={20} /></div>}
                        <div className="order-line-list__product-info">
                          <strong>{item.product_name_snapshot}</strong>
                          {variant && <span>{variant}</span>}
                          <span>{t('Qty')} {orderItemQuantityLabel(item)} · {formatPKR(Number(item.unit_price))} {t('each')}</span>
                          {item.seller_name_snapshot && <span>{t('Sold by')} {item.seller_name_snapshot}</span>}
                          {prepTime && <span className="order-line-list__prep">{t('Preparation time')}: {prepTime}</span>}
                          <span className={statusClass(order.order_status === 'delivered' ? 'delivered' : order.order_status === 'cancelled' ? 'cancelled' : item.vendor_fulfillment_status)}>{t(order.order_status === 'delivered' ? 'delivered' : order.order_status === 'cancelled' ? 'cancelled' : item.vendor_fulfillment_status)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="order-line-list__actions"><strong>{formatPKR(Number(item.line_total))}</strong><button type="button" className="text-button" onClick={() => openCase(order, item)}>{t('Open a case')}</button></div>
                  </li>
                })}
              </ul>
              <div className="order-card__meta">
                {order.expected_delivery_date && order.delivery_timing_confirmed_at && <div className="order-card__delivery-eta"><span className="eyebrow">{t('Confirmed delivery schedule')}</span><p><strong>{formatDeliveryDate(order.expected_delivery_date)}</strong></p>{order.delivery_window_start && order.delivery_window_end && <p>{formatDeliveryTime(order.delivery_window_start)} – {formatDeliveryTime(order.delivery_window_end)}</p>}{order.delivery_note && <p>{order.delivery_note}</p>}<small>{t('This is the delivery time confirmed by JTBazar.')}</small></div>}
                <div className="order-card__delivery"><span className="eyebrow"><MapPin size={13} /> {t('Delivery address')}</span><p><strong>{order.customer_name}</strong> · {order.customer_phone}</p><p>{addressSummary(order.shipping_address_snapshot) || t('Address on file')}</p>{order.delivery_location_name && <p className="order-card__location-name"><MapPin size={13} /> {order.delivery_location_name}</p>}{typeof (order.shipping_address_snapshot as Record<string, unknown> | null)?.delivery_instructions === 'string' && <p><strong>{t('Delivery instructions')}:</strong> {(order.shipping_address_snapshot as Record<string, string>).delivery_instructions}</p>}</div>
                <div><span className="eyebrow">{t('Payment')}</span><p>{t('Item subtotal')}: {formatPKR(Number(order.subtotal))}</p><p>{t('Delivery fee')}: {formatPKR(Number(order.delivery_fee))}</p><p><strong>{t('Total')}: {formatPKR(Number(order.total))}</strong></p></div>
              </div>
              <div className="order-card__actions"><Link to={`/order-confirmation/${order.order_number}`} className="text-button">{t('View confirmation')}</Link><button type="button" className="text-button" onClick={() => openCase(order, null)}>{t('Report an order issue')}</button>{canCancel && <button type="button" className="text-button text-button--danger" onClick={() => void cancelOrder(order)} disabled={cancellingOrderId === order.id}><XCircle size={14} /> {t(cancellingOrderId === order.id ? 'Cancelling…' : 'Cancel order')}</button>}</div>
              {order.order_status === 'delivered' && <div className="order-card__review-actions" aria-label={t('Write a review')}>
                {items.filter((item, index, all) => item.product_id && all.findIndex((candidate) => candidate.product_id === item.product_id) === index).map((item) => <ReviewComposer key={item.product_id} kind="product" targetId={item.product_id!} compact />)}
              </div>}
            </div>}
          </article>
        })}
      </div> : <EmptyState title={t('No orders for this date')} description={t('Choose another date to view your previous orders.')} />}</>}
    </section>}

    {tab === 'addresses' && <section className="account-panel" aria-labelledby="account-addresses-title">
      <div className="account-panel__heading"><div><h2 id="account-addresses-title">{t('Delivery addresses')}</h2><p>{t('Save addresses to speed up checkout.')}</p></div>{!addressForm && <button type="button" className="button button--dark" onClick={startNewAddress}><Plus size={15} /> {t('Add address')}</button>}</div>
      {addressesLoading && <LoadingState label={t('Loading addresses…')} centered={false} />}
      {addressesError && <><ErrorState message={addressesError} /><button type="button" className="button button--outline" onClick={() => void loadAddresses()}>{t('Try again')}</button></>}
      {!addressesLoading && !addressesError && addresses.length === 0 && !addressForm && <EmptyState title={t('No saved addresses')} description={t('Add an address here or save one during checkout.')} actionLabel={t('Add address')} onAction={startNewAddress} />}
      {!addressesLoading && addresses.length > 0 && <div className="address-grid">
        {addresses.map((address) => <article className="address-card" key={address.id}>
          <div className="address-card__head"><strong>{address.recipient_name}</strong>{address.is_default && <span className="address-card__default"><CheckCircle2 size={13} /> {t('Default')}</span>}</div>
          <p>{address.address_line_1}{address.address_line_2 ? `, ${address.address_line_2}` : ''}</p>
          <p>{address.city}{address.province ? `, ${address.province}` : ''}{address.postal_code ? ` ${address.postal_code}` : ''}</p>
          <p>{address.phone}</p>
          {address.delivery_instructions && <p className="address-card__note">{address.delivery_instructions}</p>}
          <div className="address-card__actions">
            <button type="button" className="text-button" onClick={() => startEditAddress(address)}><Pencil size={14} /> {t('Edit')}</button>
            {!address.is_default && <button type="button" className="text-button" onClick={() => void makeDefault(address.id)}><CheckCircle2 size={14} /> {t('Make default')}</button>}
            <button type="button" className="text-button text-button--danger" onClick={() => void removeAddress(address.id)}><Trash2 size={14} /> {t('Remove')}</button>
          </div>
        </article>)}
      </div>}
      {addressForm && <form className="address-form shine-surface" onSubmit={saveAddress}>
        <div className="account-panel__heading"><h2>{t(editingAddressId ? 'Edit address' : 'New address')}</h2><button type="button" className="icon-button" aria-label={t('Close address form')} onClick={() => { setAddressForm(null); setEditingAddressId(null) }}><X size={17} /></button></div>
        <div className="form-grid">
          <div className="form-field"><label htmlFor="address-recipient">{t('Recipient name')} <span>*</span></label><input id="address-recipient" name="recipient_name" value={addressForm.recipient_name} onChange={setAddressField} autoComplete="name" required /></div>
          <div className="form-field"><label htmlFor="address-phone">{t('Phone')} <span>*</span></label><input id="address-phone" name="phone" type="tel" value={addressForm.phone} onChange={setAddressField} autoComplete="tel" maxLength={13} pattern="(03[0-9]{9}|\+923[0-9]{9})" placeholder="03001234567 or +923001234567" required /></div>
          <div className="form-field form-field--wide"><label htmlFor="address-line1">{t('Street address')} <span>*</span></label><input id="address-line1" name="address_line_1" value={addressForm.address_line_1} onChange={setAddressField} autoComplete="address-line1" required /></div>
          <div className="form-field form-field--wide"><label htmlFor="address-line2">{t('Apartment, area or landmark')}</label><input id="address-line2" name="address_line_2" value={addressForm.address_line_2 ?? ''} onChange={setAddressField} autoComplete="address-line2" /></div>
          <div className="form-field"><label htmlFor="address-city">{t('City')} <span>*</span></label><input id="address-city" name="city" value={addressForm.city} onChange={setAddressField} autoComplete="address-level2" required /></div>
          <div className="form-field"><label htmlFor="address-province">{t('Province')}</label><input id="address-province" name="province" value={addressForm.province ?? ''} onChange={setAddressField} autoComplete="address-level1" /></div>
          <div className="form-field"><label htmlFor="address-postal">{t('Postal code')}</label><input id="address-postal" name="postal_code" value={addressForm.postal_code ?? ''} onChange={setAddressField} autoComplete="postal-code" /></div>
          <div className="form-field form-field--wide"><label htmlFor="address-instructions">{t('Delivery instructions')}</label><textarea id="address-instructions" name="delivery_instructions" rows={2} value={addressForm.delivery_instructions ?? ''} onChange={setAddressField} /></div>
        </div>
        <label className="checkout-save-address"><input type="checkbox" name="is_default" checked={addressForm.is_default} onChange={setAddressField} /> {t('Use as my default address')}</label>
        <div className="address-form__actions"><button type="submit" className="button button--dark" disabled={savingAddress}>{savingAddress ? t('Saving…') : t('Save address')}</button><button type="button" className="button button--outline" onClick={() => { setAddressForm(null); setEditingAddressId(null) }}>{t('Cancel')}</button></div>
      </form>}
    </section>}

    {tab === 'cases' && <section className="account-panel" aria-labelledby="account-cases-title">
      <div className="account-panel__heading"><div><h2 id="account-cases-title">{t('Returns & complaints')}</h2><p>{t('Open a case from an order item and follow the seller response.')}</p></div><button type="button" className="button button--outline" onClick={() => void loadCases()} disabled={casesLoading}><RefreshCw size={15} className={casesLoading ? 'spin' : ''} /> {t('Refresh')}</button></div>
      {caseTarget && <form className="case-form shine-surface" onSubmit={submitCase}>
        <div className="account-panel__heading"><div><h3>{t('New case for')} {caseTarget.order.order_number}</h3><p>{(itemsByOrder[caseTarget.order.id] ?? []).find((row) => row.id === caseItemId)?.product_name_snapshot ?? t('Select a product from this order')}</p></div><button type="button" className="icon-button" aria-label={t('Close case form')} onClick={() => setCaseTarget(null)}><X size={17} /></button></div>
        <div className="form-grid">
          <div className="form-field form-field--wide"><label htmlFor="case-product">{t('Product involved')} <span>*</span></label><select id="case-product" value={caseItemId} onChange={(event) => setCaseItemId(event.target.value)} required><option value="">{t('Select a product from this order')}</option>{(itemsByOrder[caseTarget.order.id] ?? []).map((orderItem) => <option key={orderItem.id} value={orderItem.id}>{orderItem.product_name_snapshot} · {t('Qty')} {orderItemQuantityLabel(orderItem)}</option>)}</select></div>
          <div className="form-field"><label htmlFor="case-type">{t('Case type')}</label><select id="case-type" value={caseType} onChange={(event) => setCaseType(event.target.value as typeof caseType)}><option value="complaint">{t('Complaint')}</option><option value="return">{t('Return')}</option><option value="refund">{t('Refund')}</option></select></div>
          <div className="form-field form-field--wide"><label htmlFor="case-reason">{t('What happened?')} <span>*</span></label><textarea id="case-reason" rows={4} maxLength={2000} value={caseReason} onChange={(event) => setCaseReason(event.target.value)} placeholder={t('Describe the issue and what would resolve it.')} required /></div>
          <div className="form-field form-field--wide"><label htmlFor="case-evidence">{caseType === 'return' ? t('Product image') : t('Evidence image')} {caseType !== 'refund' && <span>*</span>}</label><input id="case-evidence" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => setCaseEvidence(event.target.files?.[0] ?? null)} required={caseType !== 'refund'} /><p className="form-help"><FileUp size={13} /> {caseType === 'refund' ? t('Optional JPG, PNG, WebP or AVIF image, up to 10 MB.') : t('Required JPG, PNG, WebP or AVIF image, up to 10 MB.')}</p>{caseEvidence && <p className="form-help">{caseEvidence.name}</p>}</div>
        </div>
        <div className="address-form__actions"><button type="submit" className="button button--dark" disabled={submittingCase}>{submittingCase ? t('Submitting…') : t('Submit case')}</button><button type="button" className="button button--outline" onClick={() => setCaseTarget(null)}>{t('Cancel')}</button></div>
      </form>}
      {casesLoading && <LoadingState label={t('Loading your cases…')} centered={false} />}
      {casesError && <><ErrorState message={casesError} /><button type="button" className="button button--outline" onClick={() => void loadCases()}>{t('Try again')}</button></>}
      {!casesLoading && !casesError && cases.length === 0 && <EmptyState title={t('No returns or complaints')} description={t('Open a case from a delivered or shipped order item if something is wrong.')} actionLabel={t('View your orders')} onAction={() => setTab('orders')} />}
      {!casesLoading && !casesError && cases.length > 0 && <div className="case-list">
        {cases.map((item) => <article className="case-card" key={item.id}>
          <div className="case-card__head"><div><strong>{t(item.case_type)}</strong><span>{item.order_number || orderNumbers.get(item.order_id) || item.order_id}</span></div><span className={statusClass(item.status)}>{t(item.status)}</span></div>
          {item.product_name && <div className="case-card__product">{item.product_image_url && <img src={item.product_image_url} alt={item.product_name} />}<div><strong>{item.product_name}</strong>{item.product_sku && <span>SKU: {item.product_sku}</span>}{item.product_quantity !== null && item.product_quantity !== undefined && <span>{t('Qty')} {item.product_quantity}</span>}{item.product_variant && <span>{formatCaseVariant(item.product_variant)}</span>}</div></div>}
          <p>{item.reason}</p>
          {item.seller_response && <div className="case-card__response"><span className="eyebrow">{t('Seller response')}</span><p>{item.seller_response}</p></div>}
          {item.admin_decision && <div className="case-card__response"><span className="eyebrow">{t('Marketplace decision')}</span><p>{item.admin_decision}</p></div>}
          {item.evidence_url && <a className="case-card__evidence" href={item.evidence_url} target="_blank" rel="noreferrer"><img src={item.evidence_url} alt={t('Submitted case evidence')} /><span><FileUp size={14} /> {t('View evidence image')}</span></a>}
          <div className="case-card__footer"><span>{new Date(item.created_at).toLocaleString()}</span></div>
        </article>)}
      </div>}
      {!caseTarget && orders.length > 0 && <p className="account-panel__hint"><AlertCircle size={14} /> {t('To open a new case, expand an order in the Orders tab and choose an item.')}</p>}
    </section>}
  </div>
}
