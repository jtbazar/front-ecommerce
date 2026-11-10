import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { AlertCircle, ArrowRight, Boxes, CheckCircle2, Clock3, ClipboardList, ExternalLink, FileUp, LayoutDashboard, LocateFixed, MapPin, Package, PackageSearch, Pencil, Plus, Printer, RefreshCw, Search, Send, MessageCircle, Settings, ShieldCheck, Store, Truck, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useCatalog } from '../contexts/CatalogContext'
import { useToast } from '../contexts/ToastContext'
import { useI18n } from '../i18n/LocaleContext'
import { usePageMeta } from '../hooks/usePageMeta'
import { getMyAccountSuspensionReason } from '../services/account/notificationService'
import { LoadingState } from '../components/common/States'
import { ShopLocationPicker } from '../components/shops/ShopLocationPicker'
import { formatPKR } from '../utils/money'
import type { Json } from '../types/database'
import { isValidEmail, isValidPakistaniMobile, normalizePakistaniMobile } from '../utils/contactValidation'
import {
  adjustOwnInventory,
  applyAsSeller,
  createVendorProduct,
  getCaseEvidenceUrl,
  getOwnSellerProfile,
  getVendorCommissionPreview,
  getOwnSellerDocumentUrls,
  listOwnCases,
  listOwnInventory,
  listOwnOrderItems,
  listOwnProducts,
  listOwnProductImageUrls,
  listOwnProductVariants,
  saveOwnProductVariants,
  resubmitSellerApplication,
  respondToCase,
  updateOwnShop,
  updateVendorProduct,
  setVendorDailyAvailability,
  setVendorFoodProductDetails,
  setVendorProductVisibility,
  setOwnProductInventory,
  requestOwnProductDeletion,
  listOwnProductDeletionRequests,
  markVendorOrderReady,
  uploadOwnProductImage,
  uploadVendorDocument,
  uploadVendorCnicImage,
  removeVendorDocument,
  uploadVendorShopImage,
  removeVendorShopImage,
  listOwnSupportTickets,
  createOwnSupportTicket,
  listOwnSupportMessages,
  sendOwnSupportMessage,
  type MarketplaceCase,
  type SellerProfile,
  type VendorInventory,
  type VendorOrderItem,
  type VendorProduct,
  type VendorProductVariantInput,
  type VendorSupportTicket,
  type VendorSupportMessage,
} from '../services/marketplace/vendorService'

function SignInForVendor() {
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}${location.hash}`
  return <Navigate to={`/login?redirect=${encodeURIComponent(returnTo)}`} replace state={{ from: returnTo }} />
}

function VendorGate({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth()
  if (loading) return <LoadingState label="Loading your seller account…" />
  if (!configured || !user) return <SignInForVendor />
  return <>{children}</>
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  return <span className={`vendor-status__badge vendor-status__badge--${status}`}>{t(status.replace(/_/g, ' '))}</span>
}

function VendorStatusCard({ profile, onEdit }: { profile: SellerProfile; onEdit?: () => void }) {
  const { t } = useI18n()
  const approved = profile.status === 'approved'
  const rejected = profile.status === 'rejected'
  const pending = profile.status === 'pending'
  return <section className="page-shell info-page">
    <header className="info-page__heading">
      <span className="eyebrow">{t('Seller application')}</span>
      <h1>{profile.shop_name} <em>{t(pending ? 'Application under review' : profile.status)}.</em></h1>
      <p>{pending ? t('Your application is in process. Our marketplace team is verifying your shop details.') : rejected ? t('Your application needs attention before seller tools can be enabled.') : t('Your seller tools are active. Keep product and stock information current.')}</p>
    </header>
    <div className={`placeholder-panel vendor-status${pending ? ' vendor-status--pending' : ''}`}>
      {pending ? <>
        <div className="vendor-status__hero">
          <div className="vendor-status__hero-icon"><Clock3 size={30} strokeWidth={1.7} /></div>
          <StatusBadge status="pending" />
          <h2>{t('Application Under Review')}</h2>
          <p>{t('Thank you for applying to become a JTBazar seller. Your application has been received and is currently being verified by our marketplace team.')}</p>
        </div>
        <div className="vendor-status__steps" aria-label="Application progress">
          <div className="vendor-status__step is-complete"><span><CheckCircle2 size={17} /></span><div><strong>Application received</strong><small>Your shop details have been submitted successfully.</small></div></div>
          <div className="vendor-status__step is-current"><span><Clock3 size={17} /></span><div><strong>Verification in progress</strong><small>Our marketplace team is reviewing your shop information.</small></div></div>
          <div className="vendor-status__step"><span><Store size={17} /></span><div><strong>Seller access</strong><small>We’ll email you when your seller dashboard is ready.</small></div></div>
        </div>
        <div className="vendor-status__notice"><ShieldCheck size={19} /><p>{t('If we need any additional information or your application is not approved, we will notify you by email.')}</p></div>
      </> : <StatusBadge status={profile.status} />}
      {rejected && profile.rejection_reason && <p><strong>{t('Review note')}:</strong> {profile.rejection_reason}</p>}
      <div className="vendor-status__submitted"><span>{t('Submitted')}</span><strong>{new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(profile.created_at))}</strong></div>
      <div className="vendor-status__actions">
        {approved && <Link className="button button--dark" to="/vendor">{t('Open vendor dashboard')} <ArrowRight size={15} /></Link>}
        {onEdit && !approved && !profile.vendor_locked && <button type="button" className="button button--outline" onClick={onEdit}><Pencil size={15} /> {t('Update application details')}</button>}
        <Link className="text-link" to="/account">{t('Back to account')}</Link>
      </div>
    </div>
  </section>
}

function AccountSuspensionNotice({ reason }: { reason: string | null }) {
  const { t } = useI18n()
  return <section className="page-shell"><div className="placeholder-panel vendor-status vendor-suspension-notice" role="status"><span className="vendor-status__badge vendor-status__badge--suspended">{t('Account suspended')}</span><h2>{t('Seller access is suspended')}</h2><p>{t('Your account is suspended, so seller applications and vendor tools are unavailable.')}</p>{reason && <p><strong>{t('Reason')}:</strong> {reason}</p>}<Link className="text-link" to="/contact">{t('Contact marketplace support')} <ArrowRight size={15} /></Link></div></section>
}

function ShopForm({ profile, onSaved, mode = 'apply' }: { profile: SellerProfile | null; onSaved: (profile: SellerProfile) => void; mode?: 'apply' | 'settings' }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const accountEmail = (user?.email ?? '').trim().toLowerCase()
  const { push } = useToast()
  const [saving, setSaving] = useState(false)
  const [shopImage, setShopImage] = useState<File | null>(null)
  const [verificationDocument, setVerificationDocument] = useState<File | null>(null)
  const [cnicFront, setCnicFront] = useState<File | null>(null)
  const [cnicBack, setCnicBack] = useState<File | null>(null)
  const [vendorType, setVendorType] = useState<string>(profile?.vendor_type ?? 'individual_seller')
  const [shopPreview, setShopPreview] = useState<string | null>(null)
  const [existingDocuments, setExistingDocuments] = useState<{ cnicFront: string | null; cnicBack: string | null; verification: string | null }>({ cnicFront: null, cnicBack: null, verification: null })
  const [shopLatitude, setShopLatitude] = useState(profile?.shop_lat?.toString() ?? '')
  const [shopLongitude, setShopLongitude] = useState(profile?.shop_lng?.toString() ?? '')
  const [shopLocationLabel, setShopLocationLabel] = useState(profile?.shop_location_label ?? '')
  const [showShopOnMap, setShowShopOnMap] = useState(profile?.show_shop_on_map ?? false)
  const [locationLoading, setLocationLoading] = useState(false)
  const draftKey = user?.id ? `jtbazar-vendor-application-session:${user.id}:${mode}` : null
  useEffect(() => {
    if (!draftKey) return
    try {
      const raw = window.sessionStorage.getItem(draftKey)
      if (!raw) return
      const draft = JSON.parse(raw) as { fields?: Record<string, string | boolean>; vendorType?: string; latitude?: string; longitude?: string; locationLabel?: string; showShopOnMap?: boolean }
      const form = document.querySelector<HTMLFormElement>('[data-vendor-form]')
      if (form && draft.fields) for (const [name, value] of Object.entries(draft.fields)) {
        const field = form.elements.namedItem(name)
        if (field instanceof RadioNodeList) continue
        if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = Boolean(value)
        else if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && typeof value === 'string' && !('readOnly' in field && field.readOnly) && field.type !== 'file') field.value = value
      }
      if (typeof draft.vendorType === 'string') setVendorType(draft.vendorType)
      if (typeof draft.latitude === 'string') setShopLatitude(draft.latitude)
      if (typeof draft.longitude === 'string') setShopLongitude(draft.longitude)
      if (typeof draft.locationLabel === 'string') setShopLocationLabel(draft.locationLabel)
      if (typeof draft.showShopOnMap === 'boolean') setShowShopOnMap(draft.showShopOnMap)
    } catch { /* Ignore invalid temporary session data. */ }
  }, [draftKey])
  function saveApplicationSession(form: HTMLFormElement) {
    if (!draftKey) return
    const fields: Record<string, string | boolean> = {}
    for (const element of Array.from(form.elements)) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue
      if (!element.name || element.type === 'file' || element.type === 'password' || ('readOnly' in element && element.readOnly)) continue
      fields[element.name] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value
    }
    try { window.sessionStorage.setItem(draftKey, JSON.stringify({ fields, vendorType: String(fields.vendor_type ?? vendorType), latitude: shopLatitude, longitude: shopLongitude, locationLabel: shopLocationLabel, showShopOnMap })) } catch { /* Keep form entry working if storage is unavailable. */ }
  }

  useEffect(() => {
    let active = true
    if (!profile) { setExistingDocuments({ cnicFront: null, cnicBack: null, verification: null }); return }
    getOwnSellerDocumentUrls({ cnicFront: profile.cnic_front_path, cnicBack: profile.cnic_back_path, verification: profile.document_path })
      .then((urls) => { if (active) setExistingDocuments(urls) })
      .catch(() => { if (active) setExistingDocuments({ cnicFront: null, cnicBack: null, verification: null }) })
    return () => { active = false }
  }, [profile?.cnic_front_path, profile?.cnic_back_path, profile?.document_path])

  useEffect(() => {
    if (!shopImage) { setShopPreview(null); return }
    const preview = URL.createObjectURL(shopImage)
    setShopPreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [shopImage])

  function useShopLocation() {
    if (!navigator.geolocation) { push(t('This browser cannot read your location.'), 'error'); return }
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setShopLatitude(coords.latitude.toFixed(6)); setShopLongitude(coords.longitude.toFixed(6)); setLocationLoading(false); push(t('Shop location added. Add a public area label before saving.'), 'success') },
      () => { setLocationLoading(false); push(t('Location could not be read. Allow location access and try again.'), 'error') },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const shopName = String(data.get('shop_name') ?? '').trim()
    const slug = String(data.get('slug') ?? '').trim().toLowerCase()
    const description = String(data.get('description') ?? '').trim()
    const currentAddress = String(data.get('current_address') ?? '').trim()
    const completeAddress = String(data.get('complete_address') ?? '').trim()
    const contactEmail = String(data.get('contact_email') ?? '').trim()
    const phone = String(data.get('phone') ?? '').trim()
    const ownerFullName = String(data.get('owner_full_name') ?? '').trim()
    const cnicNumber = String(data.get('cnic_number') ?? '').replace(/\D/g, '')
    const shopLocationText = String(data.get('shop_location_text') ?? '').trim()
    const showLocation = mode === 'settings' && data.get('show_shop_on_map') === 'on'
    const latitude = shopLatitude.trim() ? Number(shopLatitude) : null
    const longitude = shopLongitude.trim() ? Number(shopLongitude) : null
    const locationLabel = shopLocationLabel.trim()
    if (shopName.length < 2) { push(t('Enter a shop name of at least two characters.'), 'error'); return }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { push(t('Use a URL-safe slug, for example acme-traders.'), 'error'); return }
    if (!description || description.length < 10) { push(t('Enter a shop description of at least 10 characters.'), 'error'); return }
    if (currentAddress.length < 3) { push(t('Enter your current address (area and city).'), 'error'); return }
    if (completeAddress.length < 10) { push(t('Enter your complete address with house, street and area details.'), 'error'); return }
    if (!isValidEmail(contactEmail)) { push(t('Enter a valid business contact email.'), 'error'); return }
    if (!accountEmail || contactEmail.trim().toLowerCase() !== accountEmail) {
      push(t('Use the same email address as your signed-in JTBazar account to apply as a seller.'), 'error')
      return
    }
    if (!isValidPakistaniMobile(phone)) { push(t('Enter exactly 03001234567 or +923001234567.'), 'error'); return }
    if (!vendorType) { push(t('Select your vendor type.'), 'error'); return }
    if (ownerFullName.length < 3) { push(t('Enter the owner’s full legal name.'), 'error'); return }
    if (!/^\d{13}$/.test(cnicNumber)) { push(t('Enter a valid 13-digit CNIC number without dashes.'), 'error'); return }
    if ((!profile?.cnic_front_path && !cnicFront) || (!profile?.cnic_back_path && !cnicBack)) { push(t('Upload both front and back CNIC images.'), 'error'); return }
    if (shopLocationText.length < 10) { push(t('Enter the complete shop location/address.'), 'error'); return }
    if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) { push(t('Pin the required shop location on the map.'), 'error'); return }
    if (!profile?.document_path && !verificationDocument) { push(t('Upload an identity or business document before submitting or reapplying.'), 'error'); return }
    if (showLocation && (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || locationLabel.length < 2)) { push(t('Add valid coordinates and a public area label to show this shop on Explore.'), 'error'); return }

    setSaving(true)
    try {
      let uploadedImage: { path: string; url: string } | null = null
      let uploadedDocument: string | null = null
      let uploadedCnicFront: string | null = null
      let uploadedCnicBack: string | null = null
      let committed = false
      try {
        if (shopImage && profile) uploadedImage = await uploadVendorShopImage(shopImage)
        if (verificationDocument) uploadedDocument = await uploadVendorDocument(verificationDocument)
        if (cnicFront) uploadedCnicFront = await uploadVendorCnicImage(cnicFront, 'cnic-front')
        if (cnicBack) uploadedCnicBack = await uploadVendorCnicImage(cnicBack, 'cnic-back')
        const input = { shop_name: shopName, slug, description, current_address: currentAddress, complete_address: completeAddress, contact_email: contactEmail, phone: normalizePakistaniMobile(phone), vendor_type: vendorType, owner_full_name: ownerFullName, cnic_number: cnicNumber, cnic_front_path: uploadedCnicFront ?? profile?.cnic_front_path ?? null, cnic_back_path: uploadedCnicBack ?? profile?.cnic_back_path ?? null, shop_location_text: shopLocationText, shop_lat: latitude, shop_lng: longitude, ...(uploadedImage ? { shop_image_url: uploadedImage.url } : {}), ...(uploadedDocument ? { document_path: uploadedDocument } : {}), ...(mode === 'settings' ? { shop_lat: latitude, shop_lng: longitude, shop_location_label: locationLabel, show_shop_on_map: showLocation } : {}) }
        const saved = profile ? await updateOwnShop(input) : await applyAsSeller(input)
        committed = true
        if (uploadedImage && profile?.shop_image_url?.includes('/shop-images/')) {
          const previousPath = decodeURIComponent(new URL(profile.shop_image_url).pathname.split('/shop-images/').at(-1) ?? '')
          if (previousPath) await removeVendorShopImage(previousPath).catch(() => undefined)
        }
        push(t(profile?.status === 'rejected' ? 'Application resubmitted for review.' : profile ? 'Shop details updated.' : 'Seller application submitted for review.'), 'success')
        if (profile && profile.status === 'rejected') {
          const resubmitted = await resubmitSellerApplication()
          onSaved(resubmitted)
        } else {
          onSaved(saved)
        }
      } catch (cause) {
        if (uploadedImage && !committed) await removeVendorShopImage(uploadedImage.path).catch(() => undefined)
        if (uploadedDocument && !committed) await removeVendorDocument(uploadedDocument).catch(() => undefined)
        if (uploadedCnicFront && !committed) await removeVendorDocument(uploadedCnicFront).catch(() => undefined)
        if (uploadedCnicBack && !committed) await removeVendorDocument(uploadedCnicBack).catch(() => undefined)
        throw cause
      }
      if (draftKey) window.sessionStorage.removeItem(draftKey)
      form.reset()
      setShopImage(null)
      setVerificationDocument(null)
      setCnicFront(null)
      setCnicBack(null)
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('The shop details could not be saved.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return <form className="placeholder-panel vendor-form" data-vendor-form onSubmit={submit} onInput={(event) => saveApplicationSession(event.currentTarget)} onChange={(event) => saveApplicationSession(event.currentTarget)}>
    <h2>{t(profile?.status === 'rejected' ? 'Correct and resubmit application' : mode === 'settings' ? 'Shop settings' : profile ? 'Update application' : 'Apply to open a shop')}</h2>
    <p>{t('Your public shop details and private verification information are handled separately. Only approved shops can publish products.')}</p>
    <div className="form-field"><label htmlFor="shop_name">{t('Shop name')} <span>*</span></label><input id="shop_name" name="shop_name" required maxLength={160} defaultValue={profile?.shop_name ?? ''} placeholder="e.g. Acme Traders" /></div>
    <div className="form-field"><label htmlFor="slug">{t('Shop URL slug')} <span>*</span></label><input id="slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={profile?.slug ?? ''} placeholder="acme-traders" /></div>
    <div className="form-field"><label htmlFor="contact_email">{t('Account email')} <span>*</span></label><input id="contact_email" name="contact_email" type="email" required value={user?.email ?? ''} readOnly aria-readonly="true" /><p className="form-help">{t('Seller applications must use the same verified email address as your signed-in JTBazar customer account. To use another email, sign out and create or sign in to that account first.')}</p></div>
    <div className="form-field"><label htmlFor="vendor-type">{t('Business type')} <span>*</span></label><select id="vendor-type" name="vendor_type" value={vendorType} onChange={(event) => setVendorType(event.target.value)} required><option value="individual_seller">{t('Individual seller')}</option><option value="registered_business">{t('Registered business')}</option><option value="sole_proprietor">{t('Sole proprietor')}</option><option value="partnership">{t('Partnership')}</option><option value="company">{t('Company')}</option></select></div>
    <div className="form-field"><label htmlFor="owner_full_name">{t("Owner's full legal name")} <span>*</span></label><input id="owner_full_name" name="owner_full_name" required minLength={3} maxLength={160} defaultValue={profile?.owner_full_name ?? ''} /></div>
    <div className="form-field"><label htmlFor="cnic_number">{t('CNIC number')} <span>*</span></label><input id="cnic_number" name="cnic_number" required inputMode="numeric" maxLength={13} pattern="[0-9]{13}" placeholder="13 digits without dashes" defaultValue={profile?.cnic_number ?? ''} /></div>
    <div className="form-field"><label htmlFor="phone">{t('Business phone')} <span>*</span></label><input id="phone" name="phone" type="tel" required defaultValue={profile?.phone ?? ''} maxLength={13} pattern="(03[0-9]{9}|\+923[0-9]{9})" placeholder="03001234567 or +923001234567" /></div>
    <div className="form-field form-field--wide"><label htmlFor="description">{t('Shop description')} <span>*</span></label><textarea id="description" name="description" rows={4} required minLength={10} maxLength={2000} defaultValue={profile?.description ?? ''} placeholder={t('Describe your products, sourcing and fulfilment.')} /></div>
    <div className="form-field"><label htmlFor="current_address">{t('Current Address')} <span>*</span></label><input id="current_address" name="current_address" required minLength={3} maxLength={200} defaultValue={profile?.current_address ?? ''} placeholder={t('Area, city and current location')} /></div>
    <div className="form-field form-field--wide"><label htmlFor="complete_address">{t('Complete Address')} <span>*</span></label><textarea id="complete_address" name="complete_address" required minLength={10} maxLength={1000} rows={3} defaultValue={profile?.complete_address ?? ''} placeholder={t('House/shop number, street, building, area, city and nearby landmark')} /></div>
    {mode === 'settings' && <div className="form-field form-field--wide"><label htmlFor="shop-image">{t('Public shop picture')}</label>{(shopPreview || profile?.shop_image_url) && <img className="vendor-shop-image-preview" src={shopPreview ?? profile?.shop_image_url ?? ''} alt={t('Current shop picture')} />}<input id="shop-image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => setShopImage(event.target.files?.[0] ?? null)} /><p className="form-help"><Store size={13} /> {t('Shown on your public shop page. JPG, PNG, WebP or AVIF up to 5 MB.')}</p></div>}
    {mode === 'settings' && <div className="form-field form-field--wide vendor-map-settings"><h3><MapPin size={17} /> {t('Explore map location')}</h3><p>{t('Add your shop location and choose whether customers may see its approximate area on the Explore map. Exact coordinates are rounded before publication.')}</p><button type="button" className="button button--outline" onClick={useShopLocation} disabled={locationLoading}><LocateFixed size={15} /> {t(locationLoading ? 'Getting location…' : shopLatitude && shopLongitude ? 'Refresh my location' : 'Use this device location')}</button><div className="form-field"><label htmlFor="shop-location-label">{t('Public area label')}</label><input id="shop-location-label" value={shopLocationLabel} onChange={(event) => setShopLocationLabel(event.target.value)} maxLength={120} placeholder={t('e.g. Gulberg, Lahore')} /></div><label className="vendor-map-opt-in"><input type="checkbox" name="show_shop_on_map" checked={showShopOnMap} onChange={(event) => setShowShopOnMap(event.target.checked)} /> <span>{t('Show my approximate shop location to customers on Explore')}</span></label></div>}
    <div className="form-field form-field--wide"><label htmlFor="shop_location_text">{t('Shop location / complete address for admin verification')} <span>*</span></label><textarea id="shop_location_text" name="shop_location_text" required minLength={10} maxLength={1200} rows={3} defaultValue={profile?.shop_location_text ?? profile?.complete_address ?? ''} placeholder={t('House/shop number, street, area, city, province and nearby landmark')} /></div>
    <div className="form-field form-field--wide vendor-map-settings"><h3><MapPin size={17} /> {t('Required shop map pin')}</h3><button type="button" className="button button--outline" onClick={useShopLocation} disabled={locationLoading}><LocateFixed size={15} /> {t(locationLoading ? 'Getting location…' : 'Use this device location')}</button><ShopLocationPicker point={shopLatitude && shopLongitude ? { latitude: Number(shopLatitude), longitude: Number(shopLongitude) } : null} onChange={({ latitude, longitude }) => { setShopLatitude(latitude.toFixed(6)); setShopLongitude(longitude.toFixed(6)) }} /><p className="form-help">{t('This location is required for administrator verification. It is not automatically published to customers.')}</p></div>
     <div className="form-field form-field--wide"><label htmlFor="cnic-front">{t('CNIC front image')} <span>*</span></label>{existingDocuments.cnicFront && <div className="vendor-document-preview"><img src={existingDocuments.cnicFront} alt="Saved CNIC front" /><p className="form-help"><a href={existingDocuments.cnicFront} target="_blank" rel="noreferrer">Open full CNIC front image</a></p></div>}<input id="cnic-front" type="file" accept="image/jpeg,image/png,image/webp" required={!profile?.cnic_front_path} onChange={(event) => setCnicFront(event.target.files?.[0] ?? null)} /><p className="form-help">{profile?.cnic_front_path ? 'Current CNIC front is saved. Choose a new file only if you want to replace it.' : 'Upload the front side of your CNIC.'}</p></div>
     <div className="form-field form-field--wide"><label htmlFor="cnic-back">{t('CNIC back image')} <span>*</span></label>{existingDocuments.cnicBack && <div className="vendor-document-preview"><img src={existingDocuments.cnicBack} alt="Saved CNIC back" /><p className="form-help"><a href={existingDocuments.cnicBack} target="_blank" rel="noreferrer">Open full CNIC back image</a></p></div>}<input id="cnic-back" type="file" accept="image/jpeg,image/png,image/webp" required={!profile?.cnic_back_path} onChange={(event) => setCnicBack(event.target.files?.[0] ?? null)} /><p className="form-help">{profile?.cnic_back_path ? 'Current CNIC back is saved. Choose a new file only if you want to replace it.' : 'Upload the back side of your CNIC.'}</p></div>
     <div className="form-field form-field--wide"><label htmlFor="application-document">{t('Identity or business registration document')} <span>*</span></label>{existingDocuments.verification && <p className="form-help"><a href={existingDocuments.verification} target="_blank" rel="noreferrer">Open current verification document</a></p>}<input id="application-document" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required={!profile?.document_path} onChange={(event) => setVerificationDocument(event.target.files?.[0] ?? null)} /><p className="form-help">{profile?.document_path ? 'A verification document is already saved. Choose a new file only if you want to replace it.' : 'Upload an identity or business registration document.'} <ShieldCheck size={13} /> {t('Required for review. PDF, JPG, PNG or WebP up to 10 MB. Only marketplace administrators can open this file.')}</p></div>
    <div className="vendor-form__actions"><button className="button button--dark" disabled={saving}>{saving ? t('Saving…') : t(profile?.status === 'rejected' ? 'Correct & resubmit application' : mode === 'settings' ? 'Save shop settings' : profile ? 'Save application' : 'Submit for verification')}</button><Link className="text-link" to="/account">{t('Back to account')}</Link></div>
  </form>
}

export function VendorApplicationPage() {
  const { t } = useI18n()
  const { user, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState<SellerProfile | null>(null)
  const [accountSuspensionReason, setAccountSuspensionReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  usePageMeta(t('Seller application'), t('Apply to sell on JTBazar.'))

  useEffect(() => {
    let cancelled = false
    if (!user) { setLoading(false); return }
    void Promise.allSettled([getOwnSellerProfile(), getMyAccountSuspensionReason()])
      .then(([profileResult, suspensionResult]) => {
        if (cancelled) return
        const nextProfile = profileResult.status === 'fulfilled' ? profileResult.value : null
        setProfile(nextProfile)
        setAccountSuspensionReason(suspensionResult.status === 'fulfilled' ? suspensionResult.value : null)
        setEditing(!nextProfile)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user])

  if (authLoading) return <LoadingState label="Checking your account…" />
  if (!user) return <SignInForVendor />
  if (loading) return <LoadingState label="Loading seller application…" />
  if (accountSuspensionReason) return <VendorGate><AccountSuspensionNotice reason={accountSuspensionReason} /></VendorGate>
  if (profile?.status === 'suspended') return <VendorGate><AccountSuspensionNotice reason={profile.rejection_reason} /></VendorGate>

  if (profile?.status === 'approved') return <Navigate to="/vendor" replace />
  if (profile && !editing) {
    return <VendorGate><VendorStatusCard profile={profile} onEdit={() => setEditing(true)} /></VendorGate>
  }

  return <VendorGate><section className="page-shell info-page">
    {!profile && <header className="info-page__heading"><span className="eyebrow">JTBazar</span><h1>{t('Apply to open a')} <em>{t('shop.')}</em></h1><p>{t('Submit your seller details for platform review. Approval is required before listings, inventory and fulfilment tools are enabled.')}</p></header>}
    {profile && <header className="info-page__heading"><span className="eyebrow">{t('Seller application')}</span><h1>{t('Update your')} <em>{t('shop details.')}</em></h1><p>{t('Update the details below. A rejected application is sent back for review when you save.')}</p></header>}
    <ShopForm profile={profile} mode={profile ? 'settings' : 'apply'} onSaved={(saved) => { setProfile(saved); setEditing(false) }} />
    {profile && <button type="button" className="text-button vendor-cancel-edit" onClick={() => setEditing(false)}><X size={14} /> {t('Cancel')}</button>}
  </section></VendorGate>
}

type DashboardTab = 'overview' | 'listings' | 'inventory' | 'orders' | 'cases' | 'settings'

export function VendorDashboardPage() {
  const { t } = useI18n()
  const { user, loading: authLoading } = useAuth()
  const { push } = useToast()
  const { categories } = useCatalog()
  const [profile, setProfile] = useState<SellerProfile | null>(null)
  const [accountSuspensionReason, setAccountSuspensionReason] = useState<string | null>(null)
  const [products, setProducts] = useState<VendorProduct[]>([])
  const [inventory, setInventory] = useState<VendorInventory[]>([])
  const [cases, setCases] = useState<MarketplaceCase[]>([])
  const [orderItems, setOrderItems] = useState<VendorOrderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DashboardTab>('overview')
  const [editingProduct, setEditingProduct] = useState<VendorProduct | null>(null)
  const [creatingProduct, setCreatingProduct] = useState(false)
  const [stockProduct, setStockProduct] = useState<VendorProduct | null>(null)
  const [stockQuantity, setStockQuantity] = useState('0')
  const [stockMinimum, setStockMinimum] = useState('1')
  const [stockMinimumValue, setStockMinimumValue] = useState('0')
  const [savingStock, setSavingStock] = useState(false)
  const [deletionRequests, setDeletionRequests] = useState<Array<{ product_id: string; status: string }>>([])
  const [visibilityTarget, setVisibilityTarget] = useState<VendorProduct | null>(null)
  const [deletionTarget, setDeletionTarget] = useState<VendorProduct | null>(null)
  const [deletionReason, setDeletionReason] = useState('')
  const [inventoryAddOpen, setInventoryAddOpen] = useState(false)
  const [inventoryAddProductId, setInventoryAddProductId] = useState('')
  const [inventoryAddQuantity, setInventoryAddQuantity] = useState('0')
  const [inventoryAddNote, setInventoryAddNote] = useState('')
  const [editingInventoryProductId, setEditingInventoryProductId] = useState<string | null>(null)
  const [inventoryEditQuantities, setInventoryEditQuantities] = useState<Record<string, string>>({})
  const [inventoryEditNote, setInventoryEditNote] = useState('')
  const [savingInventoryGroup, setSavingInventoryGroup] = useState(false)
  const [savingProductAction, setSavingProductAction] = useState(false)
  usePageMeta(t('Vendor dashboard'), t('Manage listings, stock, fulfilment and customer cases.'))

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const suspensionReason = await getMyAccountSuspensionReason().catch(() => null)
      setAccountSuspensionReason(suspensionReason)
      if (suspensionReason) { setProfile(null); return }
      const nextProfile = await getOwnSellerProfile()
      setProfile(nextProfile)
      if (nextProfile?.status === 'approved') {
        const results = await Promise.allSettled([listOwnProducts(), listOwnInventory(), listOwnCases(), listOwnOrderItems(), listOwnProductDeletionRequests()] as const)
        const [productsResult, inventoryResult, casesResult, ordersResult, deletionResult] = results
        setProducts(productsResult.status === 'fulfilled' ? productsResult.value : [])
        setInventory(inventoryResult.status === 'fulfilled' ? inventoryResult.value : [])
        setCases(casesResult.status === 'fulfilled' ? casesResult.value : [])
        setOrderItems(ordersResult.status === 'fulfilled' ? ordersResult.value : [])
        setDeletionRequests(deletionResult.status === 'fulfilled' ? deletionResult.value : [])
        const failures = [
          { label: 'Listings', result: productsResult }, { label: 'Inventory', result: inventoryResult },
          { label: 'Cases', result: casesResult }, { label: 'Fulfilment', result: ordersResult }, { label: 'Deletion requests', result: deletionResult },
        ].flatMap(({ label, result }) => result.status === 'rejected' ? [`${label}: ${result.reason instanceof Error ? result.reason.message : 'could not be loaded'}`] : [])
        setError(failures.length ? failures.join(' · ') : null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vendor data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!user) { setLoading(false); return }
    void load()
  }, [authLoading, user?.id])

  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories])
  const isFoodCategoryId = (categoryId: string | null) => {
    let category = categories.find((item) => item.id === categoryId)
    while (category) {
      if (category.isFoodCategory) return true
      category = category.parentId ? categories.find((item) => item.id === category?.parentId) : undefined
    }
    return false
  }

  if (authLoading) return <LoadingState label="Checking your account…" />
  if (!user) return <SignInForVendor />
  if (loading) return <LoadingState label="Loading vendor dashboard…" />
  if (accountSuspensionReason) return <VendorGate><AccountSuspensionNotice reason={accountSuspensionReason} /></VendorGate>
  if (!profile) return <VendorGate><section className="page-shell"><div className="placeholder-panel vendor-status"><h2>{t('No seller application yet')}</h2><p>{t('Apply for a seller account to manage listings and orders.')}</p><Link className="button button--dark" to="/vendor/apply">{t('Apply to sell')}</Link></div></section></VendorGate>
  if (profile.status === 'suspended') return <VendorGate><AccountSuspensionNotice reason={profile.rejection_reason} /></VendorGate>
  if (profile.status !== 'approved') return <VendorGate><VendorStatusCard profile={profile} /></VendorGate>

  const openCases = cases.filter((item) => !['resolved', 'rejected', 'approved'].includes(item.status)).length
  const inventoryGroups = Object.values(inventory.reduce<Record<string, { productId: string; productName: string; rows: VendorInventory[] }>>((groups, item) => { const group = groups[item.product_id] ?? { productId: item.product_id, productName: item.product_name, rows: [] }; group.rows.push(item); groups[item.product_id] = group; return groups }, {}))
  function openInventoryEditor(group: { productId: string; rows: VendorInventory[] }) { setEditingInventoryProductId(group.productId); setInventoryEditQuantities(Object.fromEntries(group.rows.map((row) => [row.id, String(row.quantity)]))); setInventoryEditNote('') }

  return <VendorGate><section className="page-shell vendor-dashboard">
    <header className="vendor-dashboard__header">
      <div><span className="eyebrow">{profile.shop_name}</span><h1>{t('Vendor')} <em>{t('dashboard.')}</em></h1><p>{t('Listings begin in moderation, stock changes are recorded, and customer cases stay within your authorized seller boundary.')}</p></div>
      <div className="vendor-dashboard__links"><Link to={`/shops/${profile.slug}`} className="text-link">{t('View public shop')} <ExternalLink size={14} /></Link><button type="button" className="button button--outline" onClick={() => void load()}><RefreshCw size={15} /> {t('Refresh')}</button></div>
    </header>

    {error && <div className="placeholder-panel vendor-error"><AlertCircle size={18} /> {error}</div>}

    <div className="vendor-dashboard-layout">
    <aside className="vendor-sidebar" aria-label={t('Vendor dashboard navigation')}>
    <nav className="vendor-tabs" aria-label={t('Vendor sections')}>
      {([
        { value: 'overview', label: 'Overview', icon: LayoutDashboard },
        { value: 'listings', label: 'Listings', icon: PackageSearch },
        { value: 'inventory', label: 'Inventory', icon: Boxes },
        { value: 'orders', label: 'Fulfilment', icon: Truck },
        { value: 'cases', label: 'Cases', icon: ClipboardList },
        { value: 'settings', label: 'Shop settings', icon: Settings },
      ] as const).map(({ value, label, icon: Icon }) => <button key={value} type="button" className={tab === value ? 'is-active' : ''} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}><Icon size={17} aria-hidden="true" /><span>{t(label)}</span></button>)}
    </nav>
    <Link to="/account" className="vendor-sidebar-account">{t('Account settings')}</Link>
    </aside>
    <div className="vendor-dashboard-main">
    <div className="vendor-metrics">
      <div><Store size={18} /><strong>{products.length}</strong><span>{t('Listings')}</span></div>
      <div><Boxes size={18} /><strong>{inventory.filter((item) => item.quantity > 0).length}</strong><span>{t('Stock records')}</span></div>
      <div><Truck size={18} /><strong>{orderItems.filter((item) => !['delivered', 'cancelled'].includes(item.vendor_fulfillment_status)).length}</strong><span>{t('Open fulfilment')}</span></div>
      <div><ClipboardList size={18} /><strong>{openCases}</strong><span>{t('Open cases')}</span></div>
    </div>

    {tab === 'overview' && <div className="vendor-grid">
      <section className="placeholder-panel vendor-stack">
        <h2>{t('Recent listings')}</h2>
        {products.slice(0, 5).map((product) => <div className="vendor-list__row" key={product.id}><div><strong>{product.name}</strong><small>{formatPKR(Number(product.food_unit_price ?? product.price))}{product.food_selling_unit ? ` / ${product.food_selling_unit}` : ''} · {product.publication_status.replace(/_/g, ' ')} · {t('moderation')}: {product.moderation_status.replace(/_/g, ' ')}</small></div><StatusBadge status={product.publication_status} /></div>)}
        {products.length === 0 && <p>{t('No listings yet. Create your first listing to enter moderation.')}</p>}
        <button type="button" className="text-link" onClick={() => { setCreatingProduct(true); setTab('listings') }}><Plus size={14} /> {t('Create a listing')}</button>
      </section>
      <section className="placeholder-panel vendor-stack">
        <h2>{t('Latest orders')}</h2>
        {orderItems.slice(0, 5).map((item) => <div className="vendor-list__row" key={item.id}><div><strong>{item.order_number} · {item.product_name_snapshot}</strong><small>{t('Qty')} {item.quantity} · {formatPKR(Number(item.line_total))}</small></div><StatusBadge status={item.vendor_fulfillment_status} /></div>)}
        {orderItems.length === 0 && <p>{t('No vendor order items yet. Buyer contact and address details are intentionally excluded from this view.')}</p>}
        <button type="button" className="text-link" onClick={() => setTab('orders')}>{t('Open fulfilment')} <ArrowRight size={14} /></button>
      </section>
    </div>}

    {tab === 'listings' && <section className="account-panel">
      <div className="account-panel__heading"><div><h2>{t('Listings')}</h2><p>{t('Vendor edits are re-checked by moderation before publication. Supplier costs stay private.')}</p></div>{!creatingProduct && !editingProduct && <button type="button" className="button button--dark" onClick={() => setCreatingProduct(true)}><Plus size={15} /> {t('New listing')}</button>}</div>
      {(creatingProduct || editingProduct) && <ProductEditor
        key={editingProduct?.id ?? 'new-vendor-product'}
        product={editingProduct}
        categories={categories.map((category) => ({ id: category.id, name: category.name, slug: category.slug, parent_id: category.parentId }))}
        onCancel={() => { setCreatingProduct(false); setEditingProduct(null) }}
        onSaved={async (message) => { push(message, 'success'); setCreatingProduct(false); setEditingProduct(null); await load() }}
      />}
      {products.length === 0 && !creatingProduct && <div className="empty-state"><Package size={28} /><h2>{t('No listings yet')}</h2><p>{t('Submit a listing for moderation. It will appear in the catalog once approved.')}</p></div>}
      {products.length > 0 && <div className="admin-table-wrap"><table className="admin-table vendor-table"><thead><tr><th>{t('Product')}</th><th>{t('Price')}</th><th>{t('Publication')}</th><th>{t('Moderation')}</th><th>{t('Costs')}</th><th>{t('Actions')}</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td data-label={t('Product')}><strong>{product.name}</strong><small>{categoriesById.get(product.category_id ?? '') ?? t('No category')}</small></td><td data-label={t('Price')}>{formatPKR(Number(product.food_unit_price ?? product.price))}{product.food_selling_unit ? ` / ${product.food_selling_unit}` : ''}</td><td data-label={t('Publication')}><StatusBadge status={product.publication_status} /></td><td data-label={t('Moderation')}><StatusBadge status={product.moderation_status} /></td><td data-label={t('Costs')}><small>{t('Supplier')}: {product.supplier_cost === null ? '—' : formatPKR(Number(product.supplier_cost))}<br />{t('Fulfilment')}: {formatPKR(Number(product.fulfillment_expense))}</small></td><td data-label={t('Actions')}><button type="button" className="text-button" onClick={() => { setEditingProduct(product); setCreatingProduct(false) }}><Pencil size={14} /> {t('Edit')}</button>{product.moderation_status === 'approved' && <button type="button" className="text-button" onClick={() => setVisibilityTarget(product)}>{product.vendor_hidden ? t('Unhide') : t('Hide')}</button>}{!deletionRequests.some((request) => request.product_id === product.id && request.status === 'pending') && <button type="button" className="text-button text-button--danger" onClick={() => { setDeletionTarget(product); setDeletionReason('') }}>{t('Request deletion')}</button>}{deletionRequests.some((request) => request.product_id === product.id && request.status === 'pending') && <StatusBadge status="pending" />}{isFoodCategoryId(product.category_id) && <button type="button" className="text-button" onClick={() => { setStockProduct(product); setStockQuantity(String(product.daily_available_quantity ?? 0)); setStockMinimum(String(product.daily_minimum_quantity ?? 1)); setStockMinimumValue('0') }}>{t('Set today’s stock')}</button>}</td></tr>)}</tbody></table></div>}
    </section>}

    {stockProduct && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingStock) setStockProduct(null) }}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="daily-stock-title">
        <div className="account-panel__heading"><div><h2 id="daily-stock-title">{t('Set today’s stock')}</h2><p>{stockProduct.name}</p></div><button type="button" className="icon-button" aria-label={t('Close')} onClick={() => setStockProduct(null)} disabled={savingStock}><X size={18} /></button></div>
        <label className="form-field"><span>{t('Today’s available stock')} {stockProduct.food_selling_unit ? `(${stockProduct.food_quantity_increment} ${stockProduct.food_selling_unit === 'kg' ? 'g' : stockProduct.food_selling_unit === 'l' ? 'ml' : stockProduct.food_selling_unit} per step)` : ''}</span><input type="number" min="0" step="1" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} /></label>
        <label className="form-field"><span>{t('Minimum order quantity (steps)')}</span><input type="number" min="1" step="1" value={stockMinimum} onChange={(event) => setStockMinimum(event.target.value)} /></label>
        <label className="form-field"><span>{t('Shop minimum order value (PKR)')}</span><input type="number" min="0" step="1" value={stockMinimumValue} onChange={(event) => setStockMinimumValue(event.target.value)} /></label>
        <div className="dialog-actions"><button type="button" className="button button--outline" onClick={() => setStockProduct(null)} disabled={savingStock}>{t('Cancel')}</button><button type="button" className="button button--dark" disabled={savingStock || !Number.isInteger(Number(stockQuantity)) || Number(stockQuantity)<0 || !Number.isInteger(Number(stockMinimum)) || Number(stockMinimum)<1 || !Number.isFinite(Number(stockMinimumValue)) || Number(stockMinimumValue)<0} onClick={async () => { setSavingStock(true); try { await setVendorDailyAvailability({ productId: stockProduct.id, isDailyItem: true, availableQuantity: Number(stockQuantity), minimumQuantity: Number(stockMinimum), minimumOrderValue: Number(stockMinimumValue) }); push(t('Today’s availability and minimum order rules saved.'), 'success'); setStockProduct(null); await load() } catch (cause) { push(cause instanceof Error ? cause.message : t('Availability update failed.'), 'error') } finally { setSavingStock(false) } }}>{savingStock ? t('Saving…') : t('Save availability')}</button></div>
      </section>
    </div>}
    {tab === 'inventory' && <section className="account-panel">
      <div className="account-panel__heading"><div><h2>{t('Inventory')}</h2><p>{t('Stock changes are recorded in the inventory movement log.')}</p></div><div className="vendor-form__actions"><button type="button" className="button button--dark" onClick={() => { setInventoryAddProductId(products[0]?.id ?? ''); setInventoryAddQuantity('0'); setInventoryAddNote(''); setInventoryAddOpen(true) }} disabled={!products.length}><Plus size={15} /> {t('Add stock')}</button><button type="button" className="button button--outline" onClick={() => void load()}><RefreshCw size={15} /> {t('Refresh')}</button></div></div>
      {inventory.length === 0 ? <div className="empty-state"><Boxes size={28} /><h2>{t('No stock records')}</h2><p>{t('Stock records appear when a listing with inventory tracking is created.')}</p></div> : <div className="admin-table-wrap"><table className="admin-table vendor-table"><thead><tr><th>{t('Product')}</th><th>{t('Variants')}</th><th>{t('Total quantity')}</th><th>{t('Updated')}</th><th>{t('Adjust')}</th></tr></thead><tbody>{inventoryGroups.map((group) => { const total = group.rows.reduce((sum, row) => sum + Number(row.quantity), 0); const updated = group.rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, group.rows[0].updated_at); return <tr key={group.productId}><td data-label={t('Product')}><strong>{group.productName}</strong></td><td data-label={t('Variants')}>{group.rows.length === 1 && !group.rows[0].variant_id ? t('Default') : <><strong>{group.rows.length} {t('variants')}</strong><small>{group.rows.map((row) => row.variant_name ?? t('Default')).join(' · ')}</small></>}</td><td data-label={t('Total quantity')}><strong>{total}</strong></td><td data-label={t('Updated')}><small>{new Date(updated).toLocaleDateString()}</small></td><td data-label={t('Adjust')}><button type="button" className="text-button" onClick={() => openInventoryEditor(group)}><Pencil size={14}/> {t('Edit stock')}</button></td></tr> })}</tbody></table></div>}
      {editingInventoryProductId && (() => { const group = inventoryGroups.find((entry) => entry.productId === editingInventoryProductId); if (!group) return null; return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingInventoryGroup) setEditingInventoryProductId(null) }}><section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="vendor-inventory-edit-title"><div className="account-panel__heading"><div><h2 id="vendor-inventory-edit-title">{t('Edit product stock')}</h2><p>{group.productName}</p><small>{t('Update all variants together. Each variant keeps its own stock record.')}</small></div><button type="button" className="icon-button" aria-label={t('Close')} disabled={savingInventoryGroup} onClick={() => setEditingInventoryProductId(null)}><X size={18}/></button></div><form className="vendor-form" onSubmit={async (event) => { event.preventDefault(); if (!inventoryEditNote.trim()) { push(t('Add a reason for this stock adjustment.'), 'error'); return }; const changes = group.rows.map((row) => ({ row, value: Number(inventoryEditQuantities[row.id]) })); if (changes.some(({ value }) => !Number.isInteger(value) || value < 0)) { push(t('Every variant quantity must be a whole number of zero or more.'), 'error'); return }; setSavingInventoryGroup(true); try { for (const change of changes) await adjustOwnInventory(change.row.id, change.value, inventoryEditNote.trim()); setEditingInventoryProductId(null); setInventoryEditNote(''); push(t('All product variant quantities updated.'), 'success'); await load() } catch (cause) { push(cause instanceof Error ? cause.message : t('Inventory could not be updated. Some earlier variants may already have been saved; refresh before retrying.'), 'error') } finally { setSavingInventoryGroup(false) } }}><div className="vendor-form__grid">{group.rows.map((row) => <label className="form-field" key={row.id}><span>{row.variant_name ?? t('Default product')}</span><input type="number" min="0" step="1" required value={inventoryEditQuantities[row.id] ?? '0'} onChange={(event) => setInventoryEditQuantities((current) => ({ ...current, [row.id]: event.target.value }))}/><small>{t('Current quantity')}: {row.quantity}</small></label>)}<label className="form-field"><span>{t('Adjustment reason')}</span><input required value={inventoryEditNote} onChange={(event) => setInventoryEditNote(event.target.value)} placeholder={t('e.g. Stock count / supplier restock')}/></label></div><div className="dialog-actions"><button type="button" className="button button--outline" disabled={savingInventoryGroup} onClick={() => setEditingInventoryProductId(null)}>{t('Cancel')}</button><button type="submit" className="button button--dark" disabled={savingInventoryGroup}>{savingInventoryGroup ? t('Saving…') : t('Save all quantities')}</button></div></form></section></div> })()}
    </section>}

    {inventoryAddOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingProductAction) setInventoryAddOpen(false) }}><section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="vendor-add-stock-title"><div className="account-panel__heading"><div><h2 id="vendor-add-stock-title">{t('Add or update stock')}</h2><p>{t('Choose one of your own products and set its current stock.')}</p></div><button type="button" className="icon-button" onClick={() => setInventoryAddOpen(false)} disabled={savingProductAction}><X size={18}/></button></div><label className="form-field"><span>{t('Product')}</span><select value={inventoryAddProductId} onChange={(event) => setInventoryAddProductId(event.target.value)}>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="form-field"><span>{t('Available quantity')}</span><input type="number" min="0" step="1" value={inventoryAddQuantity} onChange={(event) => setInventoryAddQuantity(event.target.value)}/></label><label className="form-field"><span>{t('Adjustment note')}</span><input value={inventoryAddNote} onChange={(event) => setInventoryAddNote(event.target.value)} required minLength={2}/></label><div className="dialog-actions"><button type="button" className="button button--outline" onClick={() => setInventoryAddOpen(false)} disabled={savingProductAction}>{t('Cancel')}</button><button type="button" className="button button--dark" disabled={savingProductAction || !inventoryAddProductId || !Number.isInteger(Number(inventoryAddQuantity)) || Number(inventoryAddQuantity)<0 || inventoryAddNote.trim().length<2} onClick={async () => { setSavingProductAction(true); try { await setOwnProductInventory(inventoryAddProductId,Number(inventoryAddQuantity),inventoryAddNote); push(t('Inventory updated.'),'success'); setInventoryAddOpen(false); await load() } catch(cause) { push(cause instanceof Error ? cause.message : t('Inventory could not be updated.'),'error') } finally { setSavingProductAction(false) } }}>{savingProductAction ? t('Saving…') : t('Save stock')}</button></div></section></div>}
    {visibilityTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if(event.target===event.currentTarget && !savingProductAction) setVisibilityTarget(null) }}><section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="vendor-visibility-title"><h2 id="vendor-visibility-title">{visibilityTarget.vendor_hidden ? t('Unhide product?') : t('Hide product?')}</h2><p>{visibilityTarget.name}</p><p>{t('This changes storefront visibility only. It does not change moderation approval.')}</p><div className="dialog-actions"><button className="button button--outline" type="button" onClick={() => setVisibilityTarget(null)} disabled={savingProductAction}>{t('Cancel')}</button><button className="button button--dark" type="button" disabled={savingProductAction} onClick={async()=>{setSavingProductAction(true);try{await setVendorProductVisibility(visibilityTarget.id,!visibilityTarget.vendor_hidden);setVisibilityTarget(null);push(t('Product visibility updated.'),'success');await load()}catch(cause){push(cause instanceof Error?cause.message:t('Visibility update failed.'),'error')}finally{setSavingProductAction(false)}}}>{t('Confirm')}</button></div></section></div>}
    {deletionTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if(event.target===event.currentTarget && !savingProductAction) setDeletionTarget(null) }}><section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="vendor-delete-request-title"><h2 id="vendor-delete-request-title">{t('Request product deletion')}</h2><p>{deletionTarget.name}</p><label className="form-field"><span>{t('Reason for deletion')} *</span><textarea rows={4} value={deletionReason} onChange={(event)=>setDeletionReason(event.target.value)} minLength={3} required placeholder={t('Tell the JTBazar admin why this product should be removed.')}/></label><p className="form-help">{t('The product will not be deleted until an admin approves this request.')}</p><div className="dialog-actions"><button className="button button--outline" type="button" onClick={()=>setDeletionTarget(null)} disabled={savingProductAction}>{t('Cancel')}</button><button className="button button--dark" type="button" disabled={savingProductAction || deletionReason.trim().length<3} onClick={async()=>{setSavingProductAction(true);try{await requestOwnProductDeletion(deletionTarget.id,deletionReason);push(t('Deletion request sent to admin.'),'success');setDeletionTarget(null);await load()}catch(cause){push(cause instanceof Error?cause.message:t('Deletion request failed.'),'error')}finally{setSavingProductAction(false)}}}>{savingProductAction?t('Submitting…'):t('Submit request')}</button></div></section></div>}
    {tab === 'orders' && <VendorOrdersPanel items={orderItems} products={products} onError={(message) => push(message, 'error')} />}

    {tab === 'cases' && <section className="account-panel">
      <div className="account-panel__heading"><div><h2>{t('Support & cases')}</h2><p>{t('Create a support ticket or respond to customer returns and complaints.')}</p></div><button type="button" className="button button--outline" onClick={() => void load()}><RefreshCw size={15} /> {t('Refresh')}</button></div>
      <VendorSupportDesk sellerId={profile.id} onError={(message) => push(message, 'error')} />
      <h3 className="vendor-cases-subheading">{t('Customer cases')}</h3>
      {cases.length === 0 ? <div className="empty-state"><ClipboardList size={28} /><h2>{t('No cases')}</h2><p>{t('Buyer cases for your items will appear here.')}</p></div> : <div className="case-list">{cases.map((item) => <CaseResponse key={item.id} item={item} onResponded={async () => { push(t('Response sent.'), 'success'); await load() }} onError={(message) => push(message, 'error')} />)}</div>}
    </section>}

    {tab === 'settings' && <section className="account-panel">
      <div className="account-panel__heading"><div><h2>{t('Shop settings')}</h2><p>{t('Update the public details and logo customers see on your shop page.')}</p></div></div>
      <ShopForm profile={profile} mode="settings" onSaved={(saved) => { setProfile(saved); push(t('Shop settings saved.'), 'success') }} />
    </section>}
    </div></div>
  </section></VendorGate>
}

function ProductEditor({ product, categories, onCancel, onSaved }: {
  product: VendorProduct | null
  categories: { id: string; name: string; slug: string; parent_id?: string | null; isFoodCategory?: boolean }[]
  onCancel: () => void
  onSaved: (message: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [existingImageUrls, setExistingImageUrls] = useState<string[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [variantRows, setVariantRows] = useState<VendorProductVariantInput[]>([])
  const [variantsLoading, setVariantsLoading] = useState(false)
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState(product?.category_id ?? '')
  const [sellingUnit, setSellingUnit] = useState(product?.food_selling_unit ?? 'kg')
  const [unitPrice, setUnitPrice] = useState(String(product?.food_unit_price ?? product?.price ?? ''))
  const [regularPrice, setRegularPrice] = useState(String(product?.price ?? ''))
  const [quantityIncrement, setQuantityIncrement] = useState(String(product?.food_quantity_increment ?? 250))
  const [minimumQuantity, setMinimumQuantity] = useState(String(product?.food_minimum_quantity ?? 1))
  const [commissionPercent, setCommissionPercent] = useState(0)
  const [commissionLoading, setCommissionLoading] = useState(false)
  const [commissionLoadError, setCommissionLoadError] = useState<string | null>(null)
  const editing = Boolean(product)

  useEffect(() => {
    let active = true
    setCommissionLoading(true)
    setCommissionLoadError(null)
    void getVendorCommissionPreview(selectedCategoryId || null)
      .then((rate) => { if (active) setCommissionPercent(rate) })
      .catch((cause) => { if (active) setCommissionLoadError(cause instanceof Error ? cause.message : t('Commission could not be loaded.')) })
      .finally(() => { if (active) setCommissionLoading(false) })
    return () => { active = false }
  }, [selectedCategoryId, product?.id, t])

  const previewBasePrice = Number(isFoodCategory ? unitPrice : regularPrice)
  const previewCommission = Number.isFinite(previewBasePrice) && previewBasePrice >= 0
    ? Number((previewBasePrice * commissionPercent / 100).toFixed(2)) : 0
  const previewCustomerPrice = Number.isFinite(previewBasePrice) && previewBasePrice >= 0
    ? Number((previewBasePrice + previewCommission).toFixed(2)) : 0
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const isFoodCategory = (() => {
    let current = categoryById.get(selectedCategoryId)
    while (current) {
      if (current.isFoodCategory) return true
      current = current.parent_id ? categoryById.get(current.parent_id) : undefined
    }
    return false
  })()
  const unitOptions = [
    { value: 'kg', label: 'Kilogram (kg)' }, { value: 'g', label: 'Gram (g)' },
    { value: 'l', label: 'Litre (L)' }, { value: 'ml', label: 'Millilitre (ml)' },
    { value: 'piece', label: 'Piece' }, { value: 'dozen', label: 'Dozen' }, { value: 'pack', label: 'Pack' },
  ]

  useEffect(() => {
    let active = true
    if (!product?.id) { setExistingImageUrls([]); return () => { active = false } }
    setImagesLoading(true)
    void listOwnProductImageUrls(product.id)
      .then((urls) => { if (active) setExistingImageUrls(urls) })
      .catch(() => { if (active) setExistingImageUrls([]) })
      .finally(() => { if (active) setImagesLoading(false) })
    return () => { active = false }
  }, [product?.id])

  useEffect(() => {
    let active = true
    if (!product?.id) { setVariantRows([]); return () => { active = false } }
    setVariantsLoading(true)
    void listOwnProductVariants(product.id)
      .then((rows) => { if (active) setVariantRows(rows) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t('Product variants could not be loaded.')) })
      .finally(() => { if (active) setVariantsLoading(false) })
    return () => { active = false }
  }, [product?.id, t])

  useEffect(() => {
    const previewUrls = imageFiles.map((file) => URL.createObjectURL(file))
    setImagePreviews(previewUrls)
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url))
  }, [imageFiles])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const price = Number(data.get('price'))
    const supplierCostRaw = String(data.get('supplier_cost') ?? '').trim()
    const supplierCost = supplierCostRaw ? Number(supplierCostRaw) : null
    const fulfillmentExpense = Number(data.get('fulfillment_expense') || 0)
    const minimumProfit = Number(data.get('minimum_profit') || 0)
    const foodIncrement = Number(quantityIncrement)
    const foodMinimum = Number(minimumQuantity)
    if (!Number.isFinite(price) || price < 0) { setError(t('Enter a valid base price.')); return }
    if (supplierCost !== null && (!Number.isFinite(supplierCost) || supplierCost < 0)) { setError(t('Enter a valid supplier cost.')); return }
    if (!Number.isFinite(fulfillmentExpense) || fulfillmentExpense < 0 || !Number.isFinite(minimumProfit) || minimumProfit < 0) { setError(t('Enter valid fulfilment and profit values.')); return }
    if (isFoodCategory && (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0 || !Number.isInteger(foodIncrement) || foodIncrement < 1 || !Number.isInteger(foodMinimum) || foodMinimum < 1)) { setError(t('Enter a valid food unit price, quantity increment and minimum purchase quantity.')); return }
    if (variantRows.some((row) => !row.option_label.trim() || !row.option_value.trim() || !Number.isInteger(row.quantity) || row.quantity < 0 || (row.price_override !== null && (!Number.isFinite(row.price_override) || row.price_override < 0)))) { setError(t('Every variant needs an option name, value, valid price and whole-number stock.')); return }
    const variantKeys = variantRows.map((row) => row.option_label.trim().toLowerCase() + '::' + row.option_value.trim().toLowerCase())
    if (new Set(variantKeys).size !== variantKeys.length) { setError(t('Duplicate variant option and value. Please make each variant unique.')); return }
    setSaving(true)
    setError(null)
    try {
      let specifications: Json = []; let dimensions: Json = {}
      try { specifications = JSON.parse(String(data.get('specifications') || '[]')); dimensions = JSON.parse(String(data.get('dimensions') || '{}')) } catch { throw new Error(t('Specifications and dimensions must be valid JSON.')) }
      const input: Parameters<typeof updateVendorProduct>[1] = {
        category_id: String(data.get('category_id') ?? '') || null,
        name: String(data.get('name') ?? '').trim(),
        slug: String(data.get('slug') ?? '').trim(),
        sku: String(data.get('sku') ?? '').trim() || null,
        short_description: String(data.get('short_description') ?? '').trim(),
        description: String(data.get('description') ?? '').trim(),
        price,
        supplier_cost: supplierCost,
        fulfillment_expense: fulfillmentExpense,
        minimum_profit: minimumProfit,
        discount_percent: Number(data.get('discount_percent') ?? 0),
        weight_grams: data.get('weight_grams') ? Number(data.get('weight_grams')) : null,
        specifications: specifications as Json, dimensions: dimensions as Json,
        seo_title: String(data.get('seo_title') ?? '').trim() || null,
        seo_description: String(data.get('seo_description') ?? '').trim() || null,
      }
      const wasEditing = Boolean(product || createdProductId)
      let productId = product?.id ?? createdProductId
      if (productId) {
        await updateVendorProduct(productId, input)
      } else {
        const createInput: Parameters<typeof createVendorProduct>[0] = { ...input, category_id: String(data.get('category_id') ?? '') || null, track_inventory: data.get('track_inventory') === 'on', initial_stock: Number(data.get('initial_stock') ?? 0) }
        productId = await createVendorProduct(createInput)
        setCreatedProductId(productId)
      }
      if (productId) await saveOwnProductVariants(productId, variantRows)
      if (isFoodCategory && productId) await setVendorFoodProductDetails({ productId, sellingUnit, unitPrice: Number(unitPrice), quantityIncrement: foodIncrement, minimumQuantity: foodMinimum })
      if (productId) {
        for (const imageFile of imageFiles) await uploadOwnProductImage(productId, imageFile, input.name)
      }
      await onSaved(t(wasEditing ? 'Product changes submitted for moderation.' : 'Listing submitted for moderation.'))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t('The listing could not be saved.')
      setError(createdProductId && !product
        ? `${t('The listing was created, but its images could not be saved. Correct the images and submit again; the listing will not be duplicated.')} ${message}`
        : message)
    } finally {
      setSaving(false)
    }
  }

  return <form className="vendor-form shine-surface vendor-form--editor" onSubmit={submit}>
    <div className="account-panel__heading"><h2>{t(editing ? 'Edit listing' : 'New listing')}</h2><button type="button" className="icon-button" onClick={onCancel} aria-label={t('Close listing form')}><X size={17} /></button></div>
    {error && <p className="field-error" role="alert"><AlertCircle size={15} /> {error}</p>}
    <div className="form-field"><label htmlFor="product-name">{t('Product name')} <span>*</span></label><input id="product-name" name="name" required defaultValue={product?.name ?? ''} /></div>
    <div className="form-field"><label htmlFor="product-slug">{t('Slug')} <span>*</span></label><input id="product-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={product?.slug ?? ''} /></div>
    <div className="form-field"><label htmlFor="product-sku">{t('SKU')}</label><input id="product-sku" name="sku" defaultValue={product?.sku ?? ''} /></div>
    <div className="form-field"><label htmlFor="product-category">{t('Category')} <span>*</span></label><select id="product-category" name="category_id" required value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)}><option value="">{t('Select a category')}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
    <div className="form-field"><label htmlFor="product-price">{t('Your base price')} <span>*</span></label><input id="product-price" name="price" type="number" min="0" step="0.01" required value={isFoodCategory ? unitPrice : regularPrice} onChange={(event) => isFoodCategory ? setUnitPrice(event.target.value) : setRegularPrice(event.target.value)} /><small className="form-help">{isFoodCategory ? t('Your base price per selected selling unit. JTBazar automatically adds the configured commission.') : t('Your base price per product. JTBazar automatically adds the configured commission to the customer price.')}</small>
      <div className="vendor-commission-preview" aria-live="polite">
        <div className="vendor-commission-preview__heading"><strong>{t('Price breakdown')}</strong><span>{commissionLoading ? t('Loading commission…') : `${commissionPercent}% ${t('JTBazar commission')}`}</span></div>
        {commissionLoadError ? <p className="vendor-commission-preview__error">{commissionLoadError}</p> : <>
          <div><span>{t('Your base price')}</span><strong>{formatPKR(Number.isFinite(previewBasePrice) ? previewBasePrice : 0)}</strong></div>
          <div><span>{t('JTBazar commission')} ({commissionPercent}%)</span><strong>+ {formatPKR(previewCommission)}</strong></div>
          <div className="vendor-commission-preview__total"><span>{t('Customer price before discount')}</span><strong>{formatPKR(previewCustomerPrice)}</strong></div>
          <small>{t('Commission is added automatically. The customer sees the final price; your entered base price remains your vendor price. Discount is applied separately at checkout.')}</small>
        </>}
      </div></div>
    {isFoodCategory && <section className="form-field form-field--wide food-unit-config" aria-label={t('Food selling unit configuration')}>
      <h3>{t('Selling unit & quantity')}</h3>
      <p className="form-help">{t('These fields appear only for Food Category products. Shipping weight remains separate.')}</p><p className="form-help">{t('Nearby food delivery is limited to 5 km from your shop. Add your shop coordinates in Shop Settings before accepting food orders.')}</p>
      <div className="form-field"><label htmlFor="food-selling-unit">{t('Selling unit')}</label><select id="food-selling-unit" value={sellingUnit} onChange={(event) => { const next=event.target.value as typeof sellingUnit; setSellingUnit(next); setQuantityIncrement(next==='kg'||next==='l'?'250':next==='g'||next==='ml'?'100':'1') }}>{unitOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
      <div className="form-field"><label htmlFor="food-quantity-increment">{t('Customer quantity step')}</label><input id="food-quantity-increment" type="number" min="1" step="1" value={quantityIncrement} onChange={(event) => setQuantityIncrement(event.target.value)} /><small className="form-help">{t('For kg or litre, enter the step in grams or millilitres (e.g. 250). For piece, dozen or pack, enter number of units.')}</small></div>
      <div className="form-field"><label htmlFor="food-minimum-quantity">{t('Minimum purchase steps')}</label><input id="food-minimum-quantity" type="number" min="1" step="1" value={minimumQuantity} onChange={(event) => setMinimumQuantity(event.target.value)} /></div>
    </section>}
    <div className="form-field"><label htmlFor="product-discount">{t('Discount (%)')}</label><input id="product-discount" name="discount_percent" type="number" min="0" max="100" step="0.01" defaultValue={product?.discount_percent ?? 0}/></div>
    <div className="form-field"><label htmlFor="product-weight">{t('Shipping weight (grams)')}</label><input id="product-weight" name="weight_grams" type="number" min="0" step="1" defaultValue={product?.weight_grams ?? ''}/></div>
    <div className="form-field"><label htmlFor="product-supplier-cost">{t('Supplier cost')} <span>{t('private')}</span></label><input id="product-supplier-cost" name="supplier_cost" type="number" min="0" step="0.01" defaultValue={product?.supplier_cost == null ? '' : String(product.supplier_cost)} /></div>
    <div className="form-field"><label htmlFor="product-fulfilment">{t('Fulfilment expense')}</label><input id="product-fulfilment" name="fulfillment_expense" type="number" min="0" step="0.01" defaultValue={product ? String(product.fulfillment_expense) : '0'} /></div>
    <div className="form-field"><label htmlFor="product-profit">{t('Minimum profit')}</label><input id="product-profit" name="minimum_profit" type="number" min="0" step="0.01" defaultValue={product ? String(product.minimum_profit) : '0'} /></div>
    <section className="form-field form-field--wide vendor-product-variants">
      <div className="account-panel__heading"><div><h3>{t('Product variants')}</h3><p className="form-help">{t('Add options such as Size, Color or Material. Each option value can have its own SKU, price and stock.')}</p></div><button type="button" className="button button--outline" onClick={() => setVariantRows((rows) => [...rows, { id: 'new-' + crypto.randomUUID(), option_label: 'Size', option_value: '', sku: null, price_override: null, attributes: {}, quantity: 0 }])}><Plus size={15} /> {t('Add variant')}</button></div>
      {variantsLoading && <p className="form-help">{t('Loading saved variants…')}</p>}
      {variantRows.length === 0 && !variantsLoading && <p className="form-help">{t('No variants added. Leave empty for a single-option product.')}</p>}
      {variantRows.map((row, index) => <div className="vendor-product-variant-row" key={row.id ?? ('variant-' + index)}>
        <label>{t('Option name')}<input value={row.option_label} onChange={(event) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, option_label: event.target.value } : item))} placeholder="Size / Color / Material" /></label>
        <label>{t('Option value')}<input value={row.option_value} onChange={(event) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, option_value: event.target.value } : item))} placeholder="18x18 / Sage Green / Cotton" /></label>
        <label>{t('Variant SKU')}<input value={row.sku ?? ''} onChange={(event) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, sku: event.target.value || null } : item))} placeholder="Optional SKU" /></label>
        <label>{t('Price override (PKR)')}<input type="number" min="0" step="0.01" value={row.price_override ?? ''} onChange={(event) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, price_override: event.target.value === '' ? null : Number(event.target.value) } : item))} placeholder={t('Use base price')} /></label>
        <label>{t('Stock quantity')}<input type="number" min="0" step="1" value={row.quantity} onChange={(event) => setVariantRows((rows) => rows.map((item, i) => i === index ? { ...item, quantity: Number(event.target.value) } : item))} /></label>
        <button type="button" className="icon-button" aria-label={t('Remove variant')} onClick={() => setVariantRows((rows) => rows.filter((_, i) => i !== index))}><X size={15} /></button>
      </div>)}
      <p className="form-help">{t('Variant changes are sent to JTBazar moderation before publication. Supplier costs and fulfilment details remain private.')}</p>
    </section>
    <div className="form-field form-field--wide"><label htmlFor="product-image">{t('Product images')} <span>({existingImageUrls.length + imageFiles.length}/8)</span></label>{imagesLoading && <p className="form-help">{t('Loading saved images…')}</p>}<div className="vendor-product-image-gallery">{existingImageUrls.map((url, index) => <img key={`${url}-${index}`} className="vendor-product-image-preview" src={url} alt={`${product?.name ?? t('Product')} ${index + 1}`} loading="lazy" />)}{imagePreviews.map((url, index) => <div className="vendor-product-image-selected" key={`${url}-${index}`}><img className="vendor-product-image-preview" src={url} alt={`${t('Selected product image')} ${index + 1}`} /><button type="button" className="icon-button" aria-label={t('Remove selected image')} onClick={() => setImageFiles((files) => files.filter((_, fileIndex) => fileIndex !== index))}><X size={14} /></button></div>)}</div><input id="product-image" name="product_images" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" disabled={existingImageUrls.length + imageFiles.length >= 8} onChange={(event) => { const selected = Array.from(event.target.files ?? []); const remaining = Math.max(0, 8 - existingImageUrls.length - imageFiles.length); const valid = selected.filter((file) => file.size <= 10 * 1024 * 1024 && ['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)); if (valid.length !== selected.length) setError(t('Only JPG, PNG, WebP or AVIF images up to 10 MB each are allowed.')); if (selected.length > remaining) setError(t('You can add up to 8 product images in total.')); setImageFiles((files) => [...files, ...valid.slice(0, remaining)]) ; event.target.value = '' }} /><p className="form-help">{t('Select multiple JPG, PNG, WebP or AVIF images · maximum 10 MB each · up to 8 images total. Existing images are kept when you add more.')}</p></div>
    <div className="form-field form-field--wide"><label htmlFor="product-short">{t('Short description')}</label><input id="product-short" name="short_description" maxLength={300} defaultValue={product?.short_description ?? ''} /></div>
    <div className="form-field form-field--wide"><label htmlFor="product-description">{t('Full description')}</label><textarea id="product-description" name="description" rows={5} defaultValue={product?.description ?? ''} /></div>
    <div className="form-field form-field--wide"><label htmlFor="product-specifications">{t('Specifications (JSON array)')}</label><textarea id="product-specifications" name="specifications" rows={3} defaultValue={JSON.stringify(product?.specifications ?? [],null,2)} /></div>
    <div className="form-field form-field--wide"><label htmlFor="product-dimensions">{t('Dimensions (JSON object)')}</label><textarea id="product-dimensions" name="dimensions" rows={3} defaultValue={JSON.stringify(product?.dimensions ?? {},null,2)} /></div>
    <div className="form-field"><label htmlFor="product-seo-title">{t('SEO title')}</label><input id="product-seo-title" name="seo_title" defaultValue={product?.seo_title ?? ''}/></div>
    <div className="form-field"><label htmlFor="product-seo-description">{t('SEO description')}</label><textarea id="product-seo-description" name="seo_description" rows={2} defaultValue={product?.seo_description ?? ''}/></div>
    {!editing && <><label className="checkout-save-address"><input type="checkbox" name="track_inventory" defaultChecked /> {t('Track inventory for this listing')}</label><div className="form-field"><label htmlFor="product-initial-stock">{t('Initial stock quantity')}</label><input id="product-initial-stock" name="initial_stock" type="number" min="0" step="1" defaultValue="0"/></div></>}
    <div className="vendor-form__actions form-field--wide" style={{ gridColumn: '1 / -1', width: '100%', display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap' }}><button type="submit" className="button button--dark" disabled={saving || variantsLoading}>{saving ? t('Saving…') : t(editing ? 'Save changes' : 'Submit listing')}</button><button type="button" className="button button--outline" onClick={onCancel}>{t('Cancel')}</button></div>
  </form>
}

function formatVariantSnapshot(variant: unknown): string {
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return '—'
  const snapshot = variant as Record<string, unknown>
  const parts: string[] = []
  const label = typeof snapshot.label === 'string' ? snapshot.label.trim() : ''
  const value = typeof snapshot.value === 'string' || typeof snapshot.value === 'number' ? String(snapshot.value).trim() : ''
  if (label && value) parts.push(`${label}: ${value}`)
  else if (value) parts.push(value)

  const attributes = snapshot.attributes && typeof snapshot.attributes === 'object' && !Array.isArray(snapshot.attributes)
    ? snapshot.attributes as Record<string, unknown>
    : {}
  const humanize = (key: string) => key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const readableValue = (raw: unknown) => {
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      return trimmed ? trimmed.replace(/^\p{L}/u, (letter) => letter.toUpperCase()) : ''
    }
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
    return ''
  }
  for (const [key, raw] of Object.entries(attributes)) {
    const text = readableValue(raw)
    if (text) parts.push(`${humanize(key)}: ${text}`)
  }
  for (const [key, raw] of Object.entries(snapshot)) {
    if (['label', 'value', 'attributes'].includes(key)) continue
    const text = readableValue(raw)
    if (text) parts.push(`${humanize(key)}: ${text}`)
  }
  return [...new Set(parts)].join(' · ') || '—'
}

function formatVendorFoodQuantity(product: VendorProduct | undefined, quantity: number): string {
  if (!product?.food_selling_unit) return String(quantity)
  const amount = (product.food_quantity_increment ?? 1) * quantity
  const unit = product.food_selling_unit
  if (unit === 'kg' || unit === 'g') return unit === 'kg' && amount % 1000 === 0 ? `${amount / 1000} kg` : `${amount} g`
  if (unit === 'l' || unit === 'ml') return unit === 'l' && amount % 1000 === 0 ? `${amount / 1000} L` : `${amount} ml`
  if (unit === 'piece') return `${amount} ${amount === 1 ? 'piece' : 'pieces'}`
  if (unit === 'dozen') return `${amount} dozen`
  return `${amount} ${amount === 1 ? 'pack' : 'packs'}`
}

function VendorOrdersPanel({ items, products, onError }: { items: VendorOrderItem[]; products: VendorProduct[]; onError: (message: string) => void }) {
  const { t } = useI18n()
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null)
  const [pageItems, setPageItems] = useState(items)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [fetching, setFetching] = useState(false)
  const pageSize = 12
  const totalOrders = Number(pageItems[0]?.total_orders ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize))
  const orderGroups = useMemo(() => {
    const groups = new Map<string, VendorOrderItem[]>()
    for (const item of pageItems) groups.set(item.order_id, [...(groups.get(item.order_id) ?? []), item])
    return [...groups.entries()].map(([id, orderItems]) => ({ id, items: orderItems }))
  }, [pageItems])

  async function reloadPage() {
    setFetching(true)
    try {
      const rows = await listOwnOrderItems({ page, pageSize, search, status })
      setPageItems(rows)
    } catch (cause) { onError(cause instanceof Error ? cause.message : t('Orders could not be loaded.')) }
    finally { setFetching(false) }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void reloadPage() }, 250)
    return () => window.clearTimeout(timer)
  }, [search, status, page])

  useEffect(() => {
    if (!printingOrderId) return
    const frame = window.requestAnimationFrame(() => window.print())
    return () => window.cancelAnimationFrame(frame)
  }, [printingOrderId])

  useEffect(() => {
    const clearPrint = () => setPrintingOrderId(null)
    window.addEventListener('afterprint', clearPrint)
    return () => window.removeEventListener('afterprint', clearPrint)
  }, [])

  return <section className="account-panel">
    <div className="account-panel__heading"><div><h2>{t('My product orders')}</h2><p>{t('View orders for your own products and check whether each order has been delivered. Customer contact and delivery details are managed by the marketplace team.')}</p></div></div>
    <div className="vendor-order-filters"><label className="vendor-order-search"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder={t('Search order number or product')} /></label><label><span>{t('Delivery status')}</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="all">{t('All delivery statuses')}</option>{['pending','delivered','not_delivered'].map((value) => <option key={value} value={value}>{t(value.replace(/_/g, ' '))}</option>)}</select></label></div>
    {pageItems.length === 0 ? <div className="empty-state"><PackageSearch size={28} /><h2>{search || status !== 'all' ? t('No matching orders') : t('No product orders yet')}</h2><p>{search || status !== 'all' ? t('Clear the search or choose another delivery status to see more orders.') : t('Orders for your products will appear here after a customer places an order.')}</p></div> : <div className={`vendor-list${fetching ? ' is-loading' : ''}`} aria-busy={fetching}>{orderGroups.map(({ id, items: orderItems }) => <section className="vendor-order-group" key={id}>
      <header className="vendor-order-group__head"><div><strong>{orderItems[0].order_number}</strong><small>{new Date(orderItems[0].order_created_at).toLocaleString()} · {orderItems.length} {t(orderItems.length === 1 ? 'item' : 'items')}</small></div><div className="vendor-order-group__actions">{orderItems.every((item) => ['pending', 'accepted', 'processing'].includes(item.vendor_fulfillment_status)) && <button type="button" className="button button--dark" onClick={() => void markVendorOrderReady(id).then(() => reloadPage()).catch((cause) => onError(cause instanceof Error ? cause.message : t('Order could not be marked ready.')))}>{t('Ready for pickup')}</button>}<button type="button" className="button button--outline vendor-order-slip-action" onClick={() => setPrintingOrderId(id)}><Printer size={15} /> {t('Print product slip')}</button></div></header>
      {orderItems.map((item) => <article className="vendor-order-card" key={item.id}>
        <div className="vendor-order-card__head">{item.product_image_url && <img src={item.product_image_url} alt="" loading="lazy" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />}<div><strong>{item.product_name_snapshot}</strong><small>{t('Qty')} {formatVendorFoodQuantity(products.find((product) => product.name === item.product_name_snapshot), item.quantity)} · {t('Variant')}: {formatVariantSnapshot(item.variant_snapshot)} · {new Date(item.created_at).toLocaleDateString()}</small></div><StatusBadge status={item.vendor_fulfillment_status === 'delivered' ? 'delivered' : item.vendor_fulfillment_status === 'pending' ? 'pending' : 'not_delivered'} /></div>
      </article>)}
      {printingOrderId === id && <VendorOrderSlip items={orderItems} products={products} />}
    </section>)}</div>}
    <div className="vendor-api-pagination"><span>{totalOrders ? `${page * pageSize + 1}–${Math.min(totalOrders, (page + 1) * pageSize)} ${t('of')} ${totalOrders} ${t('orders')}` : t('No orders')}</span><div><button type="button" className="button button--outline" disabled={page === 0 || fetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>{t('Previous')}</button><span>{page + 1} / {totalPages}</span><button type="button" className="button button--outline" disabled={page + 1 >= totalPages || fetching} onClick={() => setPage((value) => value + 1)}>{t('Next')}</button></div></div>
  </section>
}

function VendorOrderSlip({ items, products }: { items: VendorOrderItem[]; products: VendorProduct[] }) {
  const { t } = useI18n()
  const order = items[0]
  return <article className="vendor-print-slip" data-active="true">
    <header className="vendor-print-slip__header"><div><span>{t('Product packing slip')}</span><h1>JTBazar</h1></div><div><strong>{order.order_number}</strong><small>{new Date(order.order_created_at).toLocaleString()}</small></div></header>
    <table><thead><tr><th>{t('Product')}</th><th>{t('SKU')}</th><th>{t('Variant')}</th><th>{t('Qty')}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.product_name_snapshot}</td><td>{item.sku_snapshot || '—'}</td><td>{formatVariantSnapshot(item.variant_snapshot)}</td><td>{formatVendorFoodQuantity(products.find((product) => product.id === item.product_id), item.quantity)}</td></tr>)}</tbody></table>
    <footer>{t('Product and quantity summary only. Customer contact and delivery details are managed by the marketplace team.')}</footer>
  </article>
}

function CaseResponse({ item, onResponded, onError }: { item: MarketplaceCase; onResponded: () => Promise<void>; onError: (message: string) => void }) {
  const { t } = useI18n()
  const [response, setResponse] = useState(item.seller_response ?? '')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try { await respondToCase(item.id, response); await onResponded() }
    catch (cause) { onError(cause instanceof Error ? cause.message : t('The response could not be sent.')) }
    finally { setSaving(false) }
  }
  const canRespond = ['open', 'seller_responded', 'under_review'].includes(item.status)
  return <article className="case-card">
    <div className="case-card__head"><div><strong>{t(item.case_type)}</strong><span>{new Date(item.created_at).toLocaleString()}</span></div><StatusBadge status={item.status} /></div>
    <p>{item.reason}</p>
    {item.seller_response && <div className="case-card__response"><span className="eyebrow">{t('Your response')}</span><p>{item.seller_response}</p></div>}
    {item.admin_decision && <div className="case-card__response"><span className="eyebrow">{t('Marketplace decision')}</span><p>{item.admin_decision}</p></div>}
    <div className="case-card__footer">
      {item.evidence_path && <button type="button" className="text-button" onClick={async () => { const url = await getCaseEvidenceUrl(item.evidence_path!); if (url) window.open(url, '_blank', 'noopener,noreferrer'); else onError(t('The evidence file could not be opened.')) }}><FileUp size={14} /> {t('View evidence')}</button>}
      {canRespond && <form className="case-response-form" onSubmit={submit}><label className="sr-only" htmlFor={`case-response-${item.id}`}>{t('Your response')}</label><textarea id={`case-response-${item.id}`} rows={3} value={response} onChange={(event) => setResponse(event.target.value)} placeholder={t('Explain what you can offer or what you have checked.')} /><button type="submit" className="button button--dark" disabled={saving}>{saving ? t('Sending…') : t('Send response')}</button></form>}
    </div>
  </article>
}

function VendorSupportConversation({ ticket }: { ticket: VendorSupportTicket }) {
  const { t } = useI18n()
  const { push } = useToast()
  const [messages, setMessages] = useState<VendorSupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    const loadMessages = async () => {
      try {
        const rows = await listOwnSupportMessages(ticket.id)
        if (active) { setMessages(rows); setError(null); setLoading(false) }
      } catch (cause) {
        if (active) { setError(cause instanceof Error ? cause.message : t('Messages could not be loaded.')); setLoading(false) }
      }
    }
    void loadMessages()
    const interval = window.setInterval(() => { void loadMessages() }, 10000)
    return () => { active = false; window.clearInterval(interval) }
  }, [ticket.id, refresh, t])
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || sending) return
    setSending(true)
    try {
      const sent = await sendOwnSupportMessage(ticket.id, message)
      setMessages((current) => [...current, sent])
      setDraft('')
      setRefresh((value) => value + 1)
    } catch (cause) {
      push(cause instanceof Error ? cause.message : t('Message could not be sent.'), 'error')
    } finally { setSending(false) }
  }
  return <div className="vendor-support-chat">
    <div className="vendor-support-chat__messages" aria-live="polite">
      <div className="vendor-support-chat__bubble vendor-support-chat__bubble--seller">
        <span>{t('You')} · {t('Ticket created')}</span><p>{ticket.message}</p><time>{new Date(ticket.created_at).toLocaleString()}</time>
      </div>
      {messages.length === 0 && ticket.admin_response && <div className="vendor-support-chat__bubble vendor-support-chat__bubble--admin"><span>{t('JTBazar Support')}</span><p>{ticket.admin_response}</p><time>{new Date(ticket.updated_at).toLocaleString()}</time></div>}
      {messages.map((message) => <div className={`vendor-support-chat__bubble vendor-support-chat__bubble--${message.sender_role}`} key={message.id}><span>{message.sender_role === 'admin' ? t('JTBazar Support') : t('You')}</span><p>{message.message}</p><time>{new Date(message.created_at).toLocaleString()}</time></div>)}
      {loading && <p className="vendor-support-chat__hint">{t('Loading conversation…')}</p>}
      {error && <p className="field-error">{error}</p>}
      {!loading && messages.length === 0 && !ticket.admin_response && <p className="vendor-support-chat__hint">{t('Your message has been sent. The marketplace team will reply here.')}</p>}
    </div>
    {ticket.status !== 'resolved' ? <form className="vendor-support-chat__composer" onSubmit={(event) => void sendMessage(event)}><textarea aria-label={t('Write a message')} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('Write your message…')} rows={2} maxLength={4000}/><button className="button button--dark" type="submit" disabled={sending || !draft.trim()}><Send size={15}/>{sending ? t('Sending…') : t('Send')}</button></form> : <p className="vendor-support-chat__resolved">{t('This ticket is resolved. Contact support again if you need more help.')}</p>}
  </div>
}

function VendorSupportDesk({ sellerId, onError }: { sellerId: string; onError: (message: string) => void }) {
  const { t } = useI18n()
  const { push } = useToast()
  const [tickets, setTickets] = useState<VendorSupportTicket[]>([])
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  useEffect(() => { let active = true; void listOwnSupportTickets().then((rows) => { if (active) { setTickets(rows); setSelectedTicketId((current) => current ?? rows[0]?.id ?? null); setLoadError(null) } }).catch((cause: unknown) => { if (active) setLoadError(cause instanceof Error ? cause.message : t('Support tickets could not be loaded.')) }); return () => { active = false } }, [refresh, t])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const subject = String(data.get('subject') ?? '').trim()
    const message = String(data.get('message') ?? '').trim()
    setSaving(true)
    try { const emailed = await createOwnSupportTicket(sellerId, subject, message); form.reset(); push(emailed ? t('Support ticket sent to the marketplace team.') : t('Ticket saved. Email notifications are not configured yet.'), 'success'); setRefresh((value) => value + 1) }
    catch (cause) { onError(cause instanceof Error ? cause.message : t('Support ticket could not be created.')) }
    finally { setSaving(false) }
  }
  return <div className="vendor-support-desk">
    <form className="vendor-support-form" onSubmit={(event) => void submit(event)}><h3>{t('Contact marketplace support')}</h3><div className="form-field"><label htmlFor="vendor-ticket-subject">{t('Subject')}</label><input id="vendor-ticket-subject" name="subject" required minLength={3} maxLength={180}/></div><div className="form-field"><label htmlFor="vendor-ticket-message">{t('How can we help?')}</label><textarea id="vendor-ticket-message" name="message" required minLength={3} maxLength={4000} rows={4}/></div><button type="submit" className="button button--dark" disabled={saving}>{saving ? t('Sending…') : t('Create support ticket')}</button></form>
    <div className="vendor-support-list"><h3>{t('Your support tickets')}</h3>{loadError ? <p className="field-error">{loadError}</p> : tickets.length === 0 ? <p>{t('No support tickets yet.')}</p> : tickets.map((ticket) => <article className={`vendor-support-ticket${selectedTicketId === ticket.id ? ' is-selected' : ''}`} key={ticket.id}><button type="button" className="vendor-support-ticket__toggle" onClick={() => setSelectedTicketId((current) => current === ticket.id ? null : ticket.id)}><span><strong>{ticket.subject}</strong><small>{new Date(ticket.updated_at).toLocaleString()}</small></span><span className="vendor-support-ticket__meta"><StatusBadge status={ticket.status}/><span><MessageCircle size={15}/>{t('Open chat')}</span></span></button>{selectedTicketId === ticket.id && <VendorSupportConversation ticket={ticket}/>}</article>)}</div>
  </div>
}
