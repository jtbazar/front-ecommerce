import { ArrowLeft, ArrowRight, AlertCircle, CheckCircle2, MapPin, Navigation, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '../components/common/States'
import { CartItem } from '../components/cart/CartItem'
import { useCart } from '../contexts/CartContext'
import { useCatalog } from '../contexts/CatalogContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { usePageMeta } from '../hooks/usePageMeta'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { useI18n } from '../i18n/LocaleContext'
import { createAddress, listMyAddresses, type SavedAddress } from '../services/account/addressService'
import { placeOrder } from '../services/orders/orderService'
import type { CheckoutFormValues } from '../types/order'
import { formatPKR } from '../utils/money'
import { getCartLineUnitPrice, isCartLineAvailable } from '../utils/cart'
import { isValidEmail, isValidPakistaniMobile, normalizePakistaniMobile } from '../utils/contactValidation'

interface LocationCoordinates {
  lat: number
  lng: number
  name: string
  capturedAt: string
}

function newCheckoutKey() {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}-checkout` }
}

const emptyForm: CheckoutFormValues = {
  fullName: '',
  phone: '',
  email: '',
  city: '',
  area: '',
  address: '',
  instructions: '',
}

export function CheckoutPage() {
  const { t } = useI18n()
  usePageMeta(t('Checkout'), t('Confirm your delivery details and place a cash-on-delivery order securely.'))
  const { lines, setQuantity, remove, clear } = useCart()
  const { findProductById, status, error, refresh } = useCatalog()
  const { user, profile, displayName } = useAuth()
  const { push } = useToast()
  const settings = useStoreSettings()
  const navigate = useNavigate()

  const [form, setForm] = useState<CheckoutFormValues>(emptyForm)
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState('')
  const [saveAddress, setSaveAddress] = useState(false)
  const [coords, setCoords] = useState<LocationCoordinates | null>(null)
  const [locationLabel, setLocationLabel] = useState('Home')
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const idempotencyKey = useRef(newCheckoutKey())

  function captureLocation(showSuccess = false) {
    if (!navigator.geolocation) {
      setGeoError(t(requiresFoodDeliveryPin ? 'A location pin is required for nearby food delivery, but this browser cannot read your location.' : 'Location is not available in this browser. You can still place your order without a pin.'))
      return
    }
    setGeoLoading(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: Number(position.coords.latitude.toFixed(7)),
          lng: Number(position.coords.longitude.toFixed(7)),
          name: `${form.city || 'Delivery'}, Pakistan`,
          capturedAt: new Date().toISOString(),
        })
        setGeoLoading(false)
        if (showSuccess) push(t('Delivery location found.'), 'success')
      },
      (failure) => {
        setGeoLoading(false)
        setGeoError(failure.code === failure.PERMISSION_DENIED
          ? t('Location access is blocked. Allow it in your browser settings and try again.')
          : failure.code === failure.POSITION_UNAVAILABLE
            ? t('Your device location is unavailable. Check location services, or continue without a pin.')
            : t('Finding your location took too long. You can retry or place your order without a pin.'))
      },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 },
    )
  }

  useEffect(() => {
    if (user && lines.length > 0) captureLocation()
    // Request location once when checkout opens; the pin is only included if the user places the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!user) return
    setForm((current) => ({
      ...current,
      fullName: current.fullName || displayName || '',
      email: current.email || user.email || '',
      phone: current.phone || profile?.phone || '',
    }))
  }, [user, displayName, profile?.phone])

  useEffect(() => {
    if (!user) { setAddresses([]); return }
    void listMyAddresses().then((rows) => {
      setAddresses(rows)
      const preferred = rows.find((row) => row.is_default) ?? rows[0]
      if (preferred) {
        setSelectedAddressId(preferred.id)
        setForm((current) => ({
          ...current,
          fullName: current.fullName || preferred.recipient_name,
          phone: current.phone || preferred.phone,
          city: current.city || preferred.city,
          address: current.address || [preferred.address_line_1, preferred.address_line_2].filter(Boolean).join(', '),
          instructions: current.instructions || preferred.delivery_instructions || '',
        })
        if (preferred.latitude != null && preferred.longitude != null) {
          setCoords({ lat: preferred.latitude, lng: preferred.longitude, name: preferred.location_label || 'Saved location', capturedAt: new Date().toISOString() })
          setLocationLabel(preferred.location_label || 'Home')
        }
        /*
        }))
      }
    }).catch(() => undefined)
  }, [user])

  const subtotal = lines.reduce((sum, line) => sum + getCartLineUnitPrice(findProductById(line.productId), line) * line.quantity, 0)
  const effectiveDeliveryFee = settings.freeDeliveryEnabled ? 0 : settings.deliveryFee
  const total = subtotal + effectiveDeliveryFee
  const linesAvailable = lines.length > 0 && lines.every((line) => isCartLineAvailable(findProductById(line.productId), line))
  const requiresFoodDeliveryPin = lines.some((line) => { const product = findProductById(line.productId); return Boolean(product?.foodSellingUnit) })

  if (status === 'loading' && lines.length > 0) return <div className="page-shell"><LoadingState label={t('Preparing checkout…')} /></div>
  if (status === 'error' && lines.length > 0) return <div className="page-shell"><ErrorState message={error || t('The catalog could not be loaded.')} /><button type="button" className="button button--outline" onClick={refresh}>{t('Try again')}</button><Link className="back-link" to="/cart">{t('Return to cart')}</Link></div>
  if (lines.length === 0) return <div className="page-shell"><EmptyState title={t('Your cart is empty')} description={t('Add items to your cart before checking out.')} actionLabel={t('Browse the catalog')} actionHref="/shop" /></div>

  if (!user) {
    return <div className="page-shell checkout-page">
      <Link to="/cart" className="back-link"><ArrowLeft size={15} /> {t('Back to cart')}</Link>
      <div className="page-heading"><span className="eyebrow">{t('Checkout')}</span><h1>{t('Sign in to')} <em>{t('place your order.')}</em></h1><p>{t('Orders are linked to a verified account so you can track delivery, open returns and receive updates. Your cart has been kept on this device.')}</p></div>
      <div className="checkout-signin-panel shine-surface">
        <ShieldCheck size={26} aria-hidden="true" />
        <h2>{t('Secure account checkout')}</h2>
        <p>{t('Sign in or create an account, then return here to confirm your delivery details.')}</p>
        <div className="checkout-signin-actions">
          <Link className="button button--dark" to={`/login?redirect=${encodeURIComponent('/checkout')}`}>{t('Sign in')} <ArrowRight size={16} /></Link>
          <Link className="button button--outline" to={`/register?redirect=${encodeURIComponent('/checkout')}`}>{t('Create an account')}</Link>
        </div>
      </div>
    </div>
  }

  function setField(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  function applyAddress(id: string) {
    setSelectedAddressId(id)
    const saved = addresses.find((address) => address.id === id)
    if (!saved) return
    setForm((current) => ({
      ...current,
      fullName: saved.recipient_name,
      phone: saved.phone,
      city: saved.city,
      address: [saved.address_line_1, saved.address_line_2].filter(Boolean).join(', '),
      instructions: saved.delivery_instructions ?? '',
    }))
    if (saved.latitude != null && saved.longitude != null) {
      setCoords({ lat: saved.latitude, lng: saved.longitude, name: saved.location_label || 'Saved location', capturedAt: new Date().toISOString() })
      setLocationLabel(saved.location_label || 'Home')
    } else {
      setCoords(null)
    }
  }

  function resolvedLocation(): LocationCoordinates | null {
    return coords
  }

  function mapEmbedUrl(location?: LocationCoordinates) {
    const center = location ?? { lat: 31.5204, lng: 74.3587 }
    const latDelta = 0.006
    const lngDelta = 0.008
    const bbox = [center.lng - lngDelta, Math.max(-85, center.lat - latDelta), center.lng + lngDelta, Math.min(85, center.lat + latDelta)].join(',')
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik${location ? `&marker=${location.lat}%2C${location.lng}` : ''}`
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!linesAvailable) { push(t('Remove unavailable items before placing your order.'), 'error'); return }
    if (!form.fullName.trim() || !form.phone.trim() || !form.city.trim() || !form.address.trim()) {
      push(t('Please complete the recipient, phone, city and street address fields.'), 'error')
      return
    }
    if (!isValidPakistaniMobile(form.phone)) { push(t('Enter exactly 03001234567 or +923001234567.'), 'error'); return }
    if (form.email.trim() && !isValidEmail(form.email.trim())) { push(t('Enter a valid email address.'), 'error'); return }
    if (!settings.codEnabled) { push(t('Cash on delivery is currently unavailable.'), 'error'); return }
    const location = resolvedLocation()
    if (!location) { push(t('Select your delivery location pin before placing the order.'), 'error'); return }
    setSubmitting(true)
    try {
      const placed = await placeOrder({
        customerName: form.fullName.trim(),
        customerPhone: normalizePakistaniMobile(form.phone),
        customerEmail: form.email.trim() || null,
        shippingAddress: {
          recipient_name: form.fullName.trim(),
          phone: normalizePakistaniMobile(form.phone),
          address_line_1: form.address.trim(),
          address_line_2: form.area.trim() || null,
          city: form.city.trim(),
          province: null,
          postal_code: null,
          delivery_instructions: form.instructions.trim() || null,
          latitude: location?.lat ?? null,
          longitude: location?.lng ?? null,
        },
        items: lines.map((line) => ({ product_id: line.productId, variant_id: line.variantId ?? null, quantity: line.quantity })),
        idempotencyKey: idempotencyKey.current,
        customerNote: form.instructions.trim() || null,
        deliveryLat: location?.lat ?? null,
        deliveryLng: location?.lng ?? null,
        deliveryLocationName: location?.name ?? null,
        deliveryLocationCapturedAt: location?.capturedAt ?? null,
      })

      if (saveAddress) {
        try {
          await createAddress({
            recipient_name: form.fullName.trim(),
            phone: form.phone.trim(),
            address_line_1: form.address.trim(),
            address_line_2: form.area.trim() || null,
            city: form.city.trim(),
            province: null,
            postal_code: null,
            delivery_instructions: form.instructions.trim() || null,
            location_label: locationLabel.trim() || 'Home',
            latitude: location?.lat ?? null,
            longitude: location?.lng ?? null,
            is_default: addresses.length === 0,
          })
        } catch {
          push(t('The order was placed, but the address could not be saved.'), 'error')
        }
      }

      clear()
      refresh()
      push(`${t('Order')} ${placed.orderNumber} ${t('placed successfully.')}`, 'success')
      navigate(`/order-confirmation/${encodeURIComponent(placed.orderNumber)}`, { replace: true })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      if (/stock|availability/i.test(message)) {
        refresh()
        push(t('Stock changed while you were checking out. Review your cart and try again.'), 'error')
      } else {
        push(message || t('The order could not be placed. Please try again.'), 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="page-shell checkout-page">
    <Link to="/cart" className="back-link"><ArrowLeft size={15} /> {t('Back to cart')}</Link>
    <div className="checkout-heading"><span className="eyebrow">{t('Checkout')}</span><h1>{t('Delivery details')}</h1></div>

    <div className="checkout-layout">
      <form className="checkout-form" onSubmit={submitOrder} noValidate>
        {addresses.length > 0 && <div className="checkout-saved-address form-field">
          <label htmlFor="saved-address">{t('Use a saved address')}</label>
          <select id="saved-address" value={selectedAddressId} onChange={(event) => applyAddress(event.target.value)}>
            <option value="">{t('Choose saved address')}</option>
            {addresses.map((address) => <option key={address.id} value={address.id}>{address.recipient_name} · {address.city}{address.is_default ? ` · ${t('Default')}` : ''}</option>)}
          </select>
        </div>}

        <section className="form-section">
          <h2>{t('Contact details')}</h2>
          <div className="form-grid">
            <div className="form-field"><label htmlFor="fullName">{t('Full name')} <span>*</span></label><input id="fullName" name="fullName" value={form.fullName} onChange={setField} autoComplete="name" required /></div>
            <div className="form-field"><label htmlFor="phone">{t('Mobile number')} <span>*</span></label><input id="phone" name="phone" type="tel" placeholder="03001234567 or +923001234567" maxLength={13} pattern="(03[0-9]{9}|\+923[0-9]{9})" value={form.phone} onChange={setField} autoComplete="tel" required /></div>
            <div className="form-field"><label htmlFor="email">{t('Email address')}</label><input id="email" name="email" type="email" value={form.email} onChange={setField} autoComplete="email" /></div>
          </div>
        </section>

        <section className="form-section">
          <h2>{t('Delivery address')}</h2>
          <div className="form-grid">
            <div className="form-field"><label htmlFor="city">{t('City')} <span>*</span></label><input id="city" name="city" value={form.city} onChange={setField} autoComplete="address-level2" required /></div>
            <div className="form-field"><label htmlFor="area">{t('Area / locality')}</label><input id="area" name="area" placeholder="e.g. Gulberg III" value={form.area} onChange={setField} autoComplete="address-level3" /></div>
            <div className="form-field form-field--wide"><label htmlFor="address">{t('Full street address')} <span>*</span></label><textarea id="address" name="address" rows={3} placeholder="House/apartment number, street, block…" value={form.address} onChange={setField} autoComplete="street-address" required /></div>
            <div className="form-field form-field--wide"><label htmlFor="instructions">{t('Delivery instructions')} <span>{t('optional')}</span></label><textarea id="instructions" name="instructions" rows={2} placeholder="Gate code, landmark, calling preferences…" value={form.instructions} onChange={setField} /></div>
          </div>

          <div className="location-pin-box shine-surface">
            <div className="location-pin-header">
              <div><h3><MapPin size={18} /> {t('Delivery location')} <span>{t('Required')}</span></h3></div>
              <button type="button" className="button button--outline" onClick={() => captureLocation(true)} disabled={geoLoading}><Navigation size={16} className={geoLoading ? 'spin' : ''} />{t(geoLoading ? 'Finding location…' : coords ? 'Update my location' : 'Use my current location')}</button>
            </div>
            <div className="form-field" style={{marginTop:12}}><label htmlFor="location-label">{t('Save location as')}</label><input id="location-label" value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} maxLength={60} placeholder="Home, Office…" /></div>
            {geoError && <p className="field-error"><AlertCircle size={15} /> {geoError}</p>}
            {coords
              ? <div className="coords-confirmed-badge"><CheckCircle2 size={18} /><div><strong>{t('Delivery pin confirmed')}</strong><span>{t('Coordinates saved securely for delivery')}</span><button type="button" className="text-button" onClick={() => setCoords(null)}>{t('Change pin')}</button></div></div>
              : !geoError ? <p className="location-pin-note">{t(geoLoading ? 'Finding your location…' : requiresFoodDeliveryPin ? 'A location pin is required to confirm that this food item is within the 5 km delivery area.' : 'Your location will be added to your order when available.')}</p> : null}
            <div className="checkout-map-preview">
              <iframe title={t('Map preview of selected delivery location')} src={mapEmbedUrl(coords ?? undefined)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
              <div className="checkout-map-preview__caption"><span>{coords ? t('Your delivery area') : t('Delivery area')}</span><a href={`https://www.openstreetmap.org/?mlat=${coords?.lat ?? 31.5204}&mlon=${coords?.lng ?? 74.3587}#map=16/${coords?.lat ?? 31.5204}/${coords?.lng ?? 74.3587}`} target="_blank" rel="noreferrer">{t('Open map')}</a></div>
              <small>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> {t('contributors')}</small>
            </div>
          </div>
        </section>

        <label className="checkout-save-address"><input type="checkbox" checked={saveAddress} onChange={(event) => setSaveAddress(event.target.checked)} /> {t('Save this address to my account')}</label>

        {!settings.codEnabled && <p className="field-error"><AlertCircle size={15} /> {t('Cash on delivery is currently unavailable. Please contact support before ordering.')}</p>}

        <button className="button button--dark button--full checkout-submit" type="submit" disabled={submitting || !linesAvailable || !settings.codEnabled}>
          {t(submitting ? 'Placing order…' : 'Place order · Cash on delivery')} <ArrowRight size={16} />
        </button>
      </form>

      <aside className="checkout-sidebar">
        <div className="checkout-order-card">
          <h2>{t('Your order')}</h2>
          <div className="checkout-mini-items">{lines.map((line) => <CartItem key={`${line.productId}-${line.variantId ?? 'default'}`} line={line} compact onQuantity={(quantity) => setQuantity(line.productId, line.variantId, quantity)} onRemove={() => remove(line.productId, line.variantId)} />)}</div>
          <div className="order-summary">
            <div className="order-summary__row"><span>{t('Item subtotal')}</span><strong>{formatPKR(subtotal)}</strong></div>
            <div className="order-summary__row"><span>{t('Delivery fee')}</span><strong>{formatPKR(effectiveDeliveryFee)}</strong></div>
            <div className="order-summary__total"><span>{t('Total')}</span><strong>{formatPKR(total)}</strong></div>
            <p style={{margin:"10px 0 0",fontSize:12,lineHeight:1.5,color:"#64748b"}}>{t("Eligible Flash Sale, BOGO and Bundle savings are verified securely when you place your order. Only the single best offer per product is applied; discounts are never stacked. Your final payable amount is confirmed after campaign savings.")}</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
}
