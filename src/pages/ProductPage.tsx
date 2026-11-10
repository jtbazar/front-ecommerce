import { ArrowLeft, ArrowRight, BookOpen, Check, MessageCircle, PackageCheck, ShieldCheck, Store } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AvailabilityBadge } from '../components/products/AvailabilityBadge'
import { ReviewComposer } from '../components/reviews/ReviewComposer'
import { QuantitySelector } from '../components/products/QuantitySelector'
import { getCartLineMaxQuantity } from '../utils/cart'
import { WishlistButton } from '../components/products/WishlistButton'
import { EmptyState, ErrorState, LoadingState } from '../components/common/States'
import { useCart } from '../contexts/CartContext'
import { useAuth } from '../contexts/AuthContext'
import { useCatalog } from '../contexts/CatalogContext'
import { useToast } from '../contexts/ToastContext'
import { usePageMeta } from '../hooks/usePageMeta'
import { SITE_URL } from '../config/store'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { useI18n } from '../i18n/LocaleContext'
import { formatPKR } from '../utils/money'
import { supportDestination, productInquiryMessage } from '../utils/support'
import { getFoodQuantityLabel } from '../utils/cart'
import { isFoodAvailabilityCategory } from '../utils/foodAvailability'
import { fetchActiveProductCampaigns, type ProductCampaign } from '../services/marketplace/productCampaignService'

export function ProductPage() {
  const { t } = useI18n()
  const { slug = '' } = useParams()
  const { status, error, findProductBySlug, categories } = useCatalog()
  const settings = useStoreSettings()
  const product = findProductBySlug(slug)
  const [quantity, setQuantity] = useState(product?.foodMinimumQuantity ?? 1)
  const [variantId, setVariantId] = useState(product?.variants[0]?.id ?? '')
  const [imageIndex, setImageIndex] = useState(0)
  const [imageFailed, setImageFailed] = useState(false)
  const [productCampaign, setProductCampaign] = useState<ProductCampaign | null>(null)
  const [campaignRemaining, setCampaignRemaining] = useState('')
  const [added, setAdded] = useState(false)
  const addLock = useRef(false)
  const { add } = useCart()
  const { user } = useAuth()
  const { push } = useToast()

  useEffect(() => {
    let cancelled = false
    setProductCampaign(null)
    if (!product?.id) return () => { cancelled = true }
    fetchActiveProductCampaigns()
      .then((campaigns) => {
        if (cancelled) return
        setProductCampaign(campaigns.find((campaign) => campaign.product_ids.includes(product.id)) ?? null)
      })
      .catch(() => { if (!cancelled) setProductCampaign(null) })
    return () => { cancelled = true }
  }, [product?.id])

  useEffect(() => {
    if (!productCampaign?.ends_at) { setCampaignRemaining(''); return }
    const update = () => {
      const seconds = Math.max(0, Math.floor((new Date(productCampaign.ends_at as string).getTime() - Date.now()) / 1000))
      if (seconds <= 0) { setCampaignRemaining('Offer ended'); setProductCampaign(null); return }
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const secs = seconds % 60
      setCampaignRemaining(`${days}d ${hours}h ${minutes}m ${secs}s`)
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [productCampaign?.id, productCampaign?.ends_at])

  useEffect(() => {
    setQuantity(product?.foodMinimumQuantity ?? 1)
    setVariantId(product?.variants[0]?.id ?? '')
    setImageIndex(0)
    setImageFailed(false)
    setAdded(false)
    addLock.current = false
  }, [product?.id])

  const productSchema = product ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription || product.description,
    image: product.images,
    sku: product.variants.find((variant) => variant.id === variantId)?.sku,
    brand: { '@type': 'Brand', name: 'JTBazar' },
    offers: {
      '@type': 'Offer',
      url: `${SITE_URL}/products/${product.slug}`,
      priceCurrency: product.currency || 'PKR',
      price: product.variants.find((variant) => variant.id === variantId)?.price ?? product.price,
      availability: product.availabilityStatus === 'available' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  } : null
  usePageMeta(product ? t(product.seoTitle || product.name) : t('Product not found'), product ? t(product.seoDescription || product.shortDescription || product.description) : t('This catalog product could not be found.'), { image: product?.images[0], type: 'product', structuredData: productSchema, noIndex: status === 'ready' && !product })
  if (status === 'loading') return <div className="page-shell"><LoadingState label="Loading product details…" /></div>
  if (status === 'error') return <div className="page-shell"><ErrorState message={error || 'The catalog could not be loaded.'} /></div>
  if (status === 'unconfigured') return <div className="page-shell"><ErrorState message="The product catalog is temporarily unavailable." /></div>
  if (!product) return <div className="page-shell"><EmptyState title="This product is not in the published catalog" description="It may have been unpublished or removed. Browse current active products instead." actionLabel="Browse the catalog" /></div>

  const productName = t(product.name)
  const categoryName = t(categories.find((item) => item.id === product.categoryId)?.name ?? 'Collection')
  const foodCategory = isFoodAvailabilityCategory(product.categoryId, categories)
  const images = product.images
  const activeImage = images[imageIndex]
  const selectedVariant = product.variants.find((variant) => variant.id === variantId)
  const price = selectedVariant?.price ?? product.price
  const originalPrice = selectedVariant?.originalPrice ?? product.originalPrice ?? price
  const productDiscountPercent = product.discountPercent ?? 0
  const campaignDiscountPercent = productCampaign && ['flash_sale', 'seasonal', 'custom'].includes(productCampaign.campaign_type) ? Number(productCampaign.discount_percent || 0) : 0
  const useCampaignDiscount = campaignDiscountPercent > productDiscountPercent
  const discountPercent = useCampaignDiscount ? campaignDiscountPercent : productDiscountPercent
  const displayPrice = useCampaignDiscount ? Number((price * (1 - campaignDiscountPercent / 100)).toFixed(2)) : price
  const displayOriginalPrice = useCampaignDiscount ? price : originalPrice
  const support = supportDestination(productInquiryMessage(productName, product.slug), settings.supportWhatsapp)
  const availability = selectedVariant?.availabilityStatus ?? product.availabilityStatus
  const canAdd = product.isPublished && availability !== 'out-of-stock' && availability !== 'unavailable' && availability !== 'unknown'
  const previousImage = () => { setImageFailed(false); setImageIndex((current) => (current - 1 + images.length) % images.length) }
  const nextImage = () => { setImageFailed(false); setImageIndex((current) => (current + 1) % images.length) }
  async function handleAdd() {
    if (!product || !canAdd || added || addLock.current) return
    addLock.current = true
    if (await add(product, quantity, variantId || undefined, selectedVariant?.value)) {
      setAdded(true)
      push(t(user ? 'Added to your saved cart.' : 'Added to a temporary guest cart. Sign in to save it.'), 'success')
      window.setTimeout(() => { addLock.current = false; setAdded(false) }, 2200)
    } else {
      addLock.current = false
      push(t('The item could not be saved to your cart.'), 'error')
    }
  }

  return <div className="page-shell product-detail-page">
    <Link to="/shop" className="back-link"><ArrowLeft size={15} /> {t('Back to collection')}</Link>
    <div className="product-detail">
      <div className="product-gallery" role="group" aria-label={`${productName} ${t('image gallery')}`}>
        <div className="product-gallery__main">
          {imageFailed || !activeImage ? <div className="image-fallback image-fallback--large"><BookOpen size={42} /><span>{productName}</span></div> : <img src={activeImage} alt={`${productName} ${imageIndex + 1}`} onError={() => setImageFailed(true)} />}
          {images.length > 0 && <span className="gallery-counter" aria-live="polite">{String(imageIndex + 1).padStart(2, '0')} / {String(images.length).padStart(2, '0')}</span>}
        </div>
        {images.length > 1 && <>
          <div className="product-gallery__controls"><button type="button" aria-label={t('Previous product image')} onClick={previousImage}><ArrowLeft size={17} /></button><span>{t('Image')} {imageIndex + 1} {t('of')} {images.length}</span><button type="button" aria-label={t('Next product image')} onClick={nextImage}><ArrowRight size={17} /></button></div>
          <div className="product-gallery__thumbnails" aria-label={t('Choose a product image')}>{images.map((image, index) => <button type="button" key={image} className={`product-gallery__thumbnail${imageIndex === index ? ' is-active' : ''}`} aria-label={`${t('Show image')} ${index + 1} ${t('of')} ${images.length}`} aria-pressed={imageIndex === index} onClick={() => { setImageFailed(false); setImageIndex(index) }}><img src={image} alt="" aria-hidden="true" loading="lazy" /></button>)}</div>
        </>}
      </div>
      <div className="product-detail__content">
        <div className="product-detail__topline"><span className="eyebrow">{categoryName}</span><WishlistButton productId={product.id} productName={productName} variantId={variantId || undefined} /></div>
        <h1>{productName}</h1>
        <p className="product-detail__description">{t(product.description)}</p>
        {productCampaign && <section className="product-campaign-offer" aria-label={t("Active campaign offer")}>
          <div className="product-campaign-offer__heading">
            <span className="product-campaign-offer__type">{t(productCampaign.campaign_type.replaceAll("_", " "))}</span>
            {productCampaign.ends_at && campaignRemaining && <strong className="product-campaign-offer__timer" aria-live="off">{campaignRemaining}</strong>}
          </div>
          <h2>{t(productCampaign.display_title)}</h2>
          {productCampaign.description && <p>{t(productCampaign.description)}</p>}
          {productCampaign.campaign_type === "bogo" && <strong>{t("Buy")} {productCampaign.buy_quantity} {t("Get")} {productCampaign.get_quantity}</strong>}
          {productCampaign.campaign_type === "bundle" && productCampaign.bundle_price !== null && <strong>{t("Bundle price")}: {formatPKR(productCampaign.bundle_price)}</strong>}
        </section>}
        <div className="product-price-row">
          {discountPercent > 0 ? <span className="product-discount-price"><strong>{formatPKR(product.foodUnitPrice ?? displayPrice)}</strong><s>{formatPKR(product.foodUnitPrice ? (product.originalFoodUnitPrice ?? originalPrice) : displayOriginalPrice)}</s><small>{discountPercent}% OFF</small></span> : <strong>{formatPKR(product.foodUnitPrice ?? price)}</strong>}
          <AvailabilityBadge status={availability} foodCategory={foodCategory} />
        </div>
        <p className="product-price-caption">{product.foodSellingUnit ? `${t('Price per')} ${product.foodSellingUnit}` : t('Published catalog price')} · {t('Availability is checked again when you place your order.')}</p>
        {product.isDailyItem && <p className="product-price-caption"><strong>{t(product.dailyStatus === 'coming_soon' ? 'Coming soon' : product.dailyStatus === 'not_today' ? 'Not for today' : 'Available today')}</strong>{product.dailyStatus === 'available' && product.dailyAvailableQuantity !== undefined ? ` · ${product.dailyAvailableQuantity} ${t('available')}` : ''}</p>}
        {product.foodSellingUnit && product.sellerId && <p className="product-price-caption">{t('Nearby food delivery only · within 5 km of the shop')}</p>}
        {product.variants.length > 0 && <fieldset className="variant-picker"><legend>{t(product.variants[0].label)}</legend><div className="variant-options">{product.variants.map((variant) => { const variantUnavailable = variant.availabilityStatus === 'out-of-stock'; return <button type="button" key={variant.id} className={`variant-option${variantId === variant.id ? ' is-selected' : ''}`} aria-pressed={variantId === variant.id} aria-disabled={variantUnavailable} onClick={() => { setVariantId(variant.id); setQuantity(Math.max(1, Math.min(quantity, getCartLineMaxQuantity(product, { productId: product.id, variantId: variant.id, quantity })))) }}><span>{t(variant.value)}{variant.price !== undefined && variant.price !== product.price ? ` · ${formatPKR(variant.price)}` : ''}</span>{variantId === variant.id && <Check size={14} />}{variantUnavailable && <small>{t(foodCategory ? 'Currently Unavailable' : 'Out of stock')}</small>}</button> })}</div></fieldset>}
        <div className="detail-purchase-row"><span className="eyebrow">{t('Quantity')}</span><QuantitySelector value={quantity} min={product.foodMinimumQuantity ?? 1} displayValue={product.foodSellingUnit ? getFoodQuantityLabel(product, quantity) : undefined} max={getCartLineMaxQuantity(product, { productId: product.id, quantity, variantId: variantId || undefined })} onChange={setQuantity} label={`${t('Quantity for')} ${productName}`} /></div>
        {product.foodSellingUnit && <p className="product-price-caption">{t('Estimated price for selected quantity')}: <strong>{formatPKR(Number(((product.foodUnitPrice ?? 0) * (product.foodQuantityIncrement ?? 1) * quantity / (product.foodSellingUnit === 'kg' || product.foodSellingUnit === 'l' ? 1000 : 1)).toFixed(2)))}</strong></p>}
        <button type="button" className="button button--dark button--full" disabled={!canAdd || added} onClick={handleAdd}>{added ? <><Check size={17} /> {t('Added to cart')}</> : <>{t('Add to cart')} <ArrowRight size={17} /></>}</button>
        <p className="product-detail__reassurance"><ShieldCheck size={15} /> {t(settings.codEnabled ? 'Cash on delivery. Prices and stock are validated when the order is placed.' : 'Prices and stock are validated when an order is placed.')}</p>
        {product.sellerName && product.sellerSlug && <Link className="product-seller-link" to={`/shops/${product.sellerSlug}`}><Store size={15} /> {t('Sold by')} {product.sellerName}</Link>}
        <ReviewComposer kind="product" targetId={product.id} />
        <div className="detail-accordions"><details><summary><span><BookOpen size={16} /> {t('Product details')}</span><span>+</span></summary><ul>{product.specifications.map((spec) => <li key={spec.label}><span>{t(spec.label)}</span><span>{t(spec.value)}</span></li>)}</ul></details><details><summary><span><PackageCheck size={16} /> {t('Shipping & returns')}</span><span>+</span></summary><p>{t('Delivery fee')}: {formatPKR(settings.deliveryFee)}. {t('Returns are accepted within')} {settings.returnWindowDays} {t('days of delivery through your account.')}</p><Link to="/returns">{t('Read the returns policy')}</Link></details></div>
        <a className="product-inquiry-link" href={support} target={support.startsWith('https://') ? '_blank' : undefined} rel={support.startsWith('https://') ? 'noopener noreferrer' : undefined}><MessageCircle size={16} /> {t('Ask a question about this listing')}</a>
      </div>
    </div>
  </div>
}
