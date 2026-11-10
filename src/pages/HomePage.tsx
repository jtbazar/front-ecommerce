import { ArrowRight, ArrowUpRight, BookOpen, Check, ExternalLink, Heart, Leaf, MessageCircle, PencilRuler, ShoppingBag, Store, Truck, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../contexts/CartContext'
import { useCatalog } from '../contexts/CatalogContext'
import { useWishlist } from '../contexts/WishlistContext'
import { useToast } from '../contexts/ToastContext'
import type { Category } from '../types/category'
import type { Product } from '../types/product'
import { formatPKR } from '../utils/money'
import { usePageMeta } from '../hooks/usePageMeta'
import { useI18n } from '../i18n/LocaleContext'
import { useScrollReveal } from '../hooks/useScrollReveal'
import { MarketplaceHero } from '../components/home/MarketplaceHero'
import { fetchActivePromotions, type PromotionItem } from '../services/marketplace/promotionsService'
import { fetchActiveProductCampaigns, type ProductCampaign } from '../services/marketplace/productCampaignService'

const faqs = [
  { question: 'Is JTBazar a live marketplace?', answer: 'Yes. JTBazar features live products from verified sellers, accurate stock status, and structured order delivery.' },
  { question: 'Can I place an order?', answer: 'Yes. Checkout accepts confirmed orders with cash on delivery and optional delivery location pin confirmation.' },
  { question: 'How do I become a verified seller?', answer: 'Click "Become a Seller" in the top navigation, complete the seller registration form, and submit your business verification documents.' },
]

const valueCards = [
  { icon: Leaf, title: 'Verified Vendors', description: 'Independent sellers apply with identity and business details before their products are listed.' },
  { icon: Check, title: 'Quality Assurance', description: 'Products are moderated before publication, with buyer complaints and returns handled in one place.' },
  { icon: PencilRuler, title: 'Reliable Support', description: 'Responsive customer support and order tracking from checkout to delivery.' },
]

export function HomePage() {
  const { t } = useI18n()
  const { products, categories, shops, status, error } = useCatalog()
  const homeRef = useScrollReveal<HTMLDivElement>()
  const shopRailRef = useRef<HTMLDivElement>(null)
  const [sellerBanner, setSellerBanner] = useState<PromotionItem | null>(null)
  const [homepageCampaigns, setHomepageCampaigns] = useState<PromotionItem[]>([])
  const [productCampaigns, setProductCampaigns] = useState<ProductCampaign[]>([])
  const [sellerBannerImageIndex, setSellerBannerImageIndex] = useState(0)
  usePageMeta(t('Online Shopping in Pakistan | Home, Kitchen, Bags & More'), t('Shop home and living, kitchen, stationery, bags and everyday essentials from trusted Pakistani sellers. Browse JTBazar and enjoy secure cash-on-delivery shopping.'))
  useEffect(() => { let active = true; void fetchActivePromotions().then((items) => { if (active) { setHomepageCampaigns(items.filter((item) => item.campaign_type === 'banner' && !item.show_on_launch && (item.target_platform === 'website' || item.target_platform === 'both') && (!item.starts_at || new Date(item.starts_at).getTime() <= Date.now()) && (!item.ends_at || new Date(item.ends_at).getTime() >= Date.now()))); setSellerBanner(items.find((item) => item.display_position === 'seller_banner' && item.campaign_type === 'banner' && (item.target_platform === 'website' || item.target_platform === 'both') && (!item.starts_at || new Date(item.starts_at).getTime() <= Date.now()) && (!item.ends_at || new Date(item.ends_at).getTime() >= Date.now())) ?? null) } }); return () => { active = false } }, [])
  useEffect(() => {
    let active = true
    const loadProductCampaigns = () => { void fetchActiveProductCampaigns().then((rows) => { if (active) setProductCampaigns(rows) }).catch((cause) => console.warn('Product campaigns could not be loaded:', cause)) }
    loadProductCampaigns()
    const timer = window.setInterval(loadProductCampaigns, 30000)
    window.addEventListener('focus', loadProductCampaigns)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', loadProductCampaigns) }
  }, [])
  const sellerBannerImages = sellerBanner?.banner_image_urls?.length ? sellerBanner.banner_image_urls : sellerBanner?.banner_image_url ? [sellerBanner.banner_image_url] : []
  useEffect(() => {
    setSellerBannerImageIndex(0)
    if (sellerBannerImages.length < 2) return
    const timer = window.setInterval(() => setSellerBannerImageIndex((index) => (index + 1) % sellerBannerImages.length), 5000)
    return () => window.clearInterval(timer)
  }, [sellerBanner?.id, sellerBannerImages.length])
  useEffect(() => {
    const rail = shopRailRef.current
    if (!rail || window.matchMedia('(max-width: 700px), (prefers-reduced-motion: reduce)').matches) return
    let direction = 1
    const timer = window.setInterval(() => {
      if (rail.matches(':hover') || rail.contains(document.activeElement)) return
      const card = rail.querySelector<HTMLElement>('.home-shop-card')
      const group = rail.querySelector<HTMLElement>('.home-shop-showcase__group')
      if (!card || !group) return
      const step = card.getBoundingClientRect().width + Number.parseFloat(getComputedStyle(group).gap || '0')
      const maxScroll = rail.scrollWidth - rail.clientWidth
      if (maxScroll <= step / 2) return
      if (direction > 0 && rail.scrollLeft >= maxScroll - step / 2) direction = -1
      else if (direction < 0 && rail.scrollLeft <= step / 2) direction = 1
      rail.scrollBy({ left: direction * step, behavior: 'smooth' })
    }, 4200)
    return () => window.clearInterval(timer)
  }, [shops.length])

  const orderedProducts = products.filter((product) => product.isPublished).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  const featured = orderedProducts.filter((product) => product.isFeatured)
  const featuredProducts = (featured.length ? featured : orderedProducts).slice(0, 4)
  const newArrivals = orderedProducts.slice(0, 4)
  const heroProduct = featuredProducts.find((product) => product.images[0])
  const heroShop = shops.find((shop) => shop.shopImageUrl)
  const renderCampaigns = (position: string) => <PromotionPlacement campaigns={homepageCampaigns.filter((item) => item.display_position === position)} />
  const renderProductCampaignSections = () => productCampaigns.map((campaign) => {
    const campaignProducts = campaign.product_ids.map((id) => orderedProducts.find((product) => product.id === id)).filter((product): product is Product => Boolean(product))
    if (!campaignProducts.length) return null
    const dealLabel = campaign.campaign_type === 'bogo' ? `Buy ${campaign.buy_quantity}, Get ${campaign.get_quantity}`
      : campaign.campaign_type === 'bundle' ? `Bundle price ${formatPKR(Number(campaign.bundle_price || 0))}`
      : `${Number(campaign.discount_percent)}% off`
    return <section className="home-section home-products" aria-label={campaign.display_title} key={campaign.id}>
      <div className="home-section__heading">
        <div><span className="home-eyebrow">{campaign.campaign_type.replace('_',' ')}</span><h2>{campaign.display_title}</h2><p>{campaign.description || dealLabel}</p></div>
        <div style={{display:'grid',gap:6,justifyItems:'end'}}><strong style={{color:'#b45309'}}>{dealLabel}</strong><CampaignCountdown endsAt={campaign.ends_at}/></div>
      </div>
      <div className="home-product-grid">{campaignProducts.slice(0,8).map((product) => <HomeProductCard key={product.id} product={product} campaign={campaign}/>)}</div>
    </section>
  })

  return (
    <div ref={homeRef} className="home-page">
      {renderCampaigns('top_promo')}
      {renderCampaigns('hero_banner')}
      <MarketplaceHero product={heroProduct} shop={heroShop} />

      <section className="home-section home-categories" aria-labelledby="home-categories-title">
        <div className="home-section__heading">
          <div>
            <span className="home-eyebrow">{t('Browse')}</span>
            <h2 id="home-categories-title">{t('Shop by Popular Categories')}</h2>
            <p>{t('Find exactly what you need, fast.')}</p>
          </div>
          <Link className="home-text-link" to="/categories">{t('View all collections')} <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="home-category-grid">
          {categories.map((category) => <HomeCategoryCard key={category.id} category={category} />)}
          {status === 'ready' && categories.length === 0 && <p className="home-empty-note">{t('No active categories available at the moment.')}</p>}
        </div>
      </section>

      {renderCampaigns('category_feature')}

      <section className="home-section home-products" aria-labelledby="featured-products-title">
        <div className="home-section__heading">
          <div>
            <span className="home-eyebrow">{t('Featured Products')}</span>
            <h2 id="featured-products-title">{t('Top picks from top sellers.')}</h2>
            <p>{t('Explore popular items with confirmed pricing and stock.')}</p>
          </div>
          <Link className="home-text-link" to="/shop">{t('Browse marketplace')} <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="home-product-grid">
          {status === 'error' && <p className="home-empty-note" role="alert">{t(error || 'The catalog could not be loaded.')}</p>}
          {status === 'ready' && featuredProducts.map((product) => <HomeProductCard key={product.id} product={product} />)}
          {status === 'ready' && featuredProducts.length === 0 && <p className="home-empty-note">{t('No products have been published yet.')}</p>}
        </div>
      </section>

      {renderProductCampaignSections()}

      {renderCampaigns('product_strip')}

      {shops.length > 0 && <section className="home-shop-showcase" aria-labelledby="home-shops-title">
        <div className="home-shop-showcase__heading">
          <div><span className="home-eyebrow">{t('Independent sellers')}</span><h2 id="home-shops-title">{t('Shop from independent stores.')}</h2><p>{t('Explore trusted sellers, their story and the products they bring to JTBazar.')}</p></div>
          <Link className="home-text-link" to="/shop">{t('Meet all sellers')} <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
        <div ref={shopRailRef} className="home-shop-showcase__viewport" aria-label={t('Featured independent shops')}>
          <div className="home-shop-showcase__track">
            <div className="home-shop-showcase__group">
              {shops.slice(0, 8).map((shop) => <Link className="home-shop-card" to={`/shops/${shop.slug}`} key={shop.id}>
                <div className="home-shop-card__cover"><span className="home-shop-card__seller-image">{shop.shopImageUrl ? <img src={shop.shopImageUrl} alt="" loading="lazy" /> : <Store size={25} aria-hidden="true" />}</span><span className="home-shop-card__verified"><Check size={11} aria-hidden="true" /> {t('Verified shop')}</span><span className="home-shop-card__arrow"><ArrowUpRight size={16} aria-hidden="true" /></span></div>
                <div className="home-shop-card__body"><div><span className="home-shop-card__kicker">{t('Independent store')}</span><h3>{t(shop.shopName)}</h3><p>{t(shop.description && !/^(test(ing)?|demo|dummy|sample|asdf|qwerty)$/i.test(shop.description.trim()) ? shop.description : 'A curated collection from a trusted independent seller.')}</p></div><div className="home-shop-card__meta"><span>{shop.shopLocationLabel || t('Online shop')}</span><span>{shop.productCount} {t('products')}</span></div></div>
              </Link>)}
            </div>
          </div>
        </div>
      </section>}

      {renderCampaigns('offer_section')}

      <section className="home-editorial home-editorial--sage shine-surface" aria-labelledby="study-edit-title">
        <div className="home-editorial__media">
          <img src={sellerBannerImages[sellerBannerImageIndex] || '/images/study-kit.webp'} alt={sellerBanner?.title || t('A study kit arranged on a warm desk')} loading="lazy" />
          {sellerBannerImages.length > 1 && <div className="home-editorial__image-dots" aria-label={`Banner image ${sellerBannerImageIndex + 1} of ${sellerBannerImages.length}`}>{sellerBannerImages.map((image, index) => <button key={`${image}-${index}`} type="button" aria-label={`Show banner image ${index + 1}`} aria-current={index === sellerBannerImageIndex} onClick={() => setSellerBannerImageIndex(index)} />)}</div>}
          <span className="home-editorial__stamp">{t('JTBazar Verified Marketplace')}</span>
        </div>
        <div className="home-editorial__copy">
          <span className="home-eyebrow">{t('Vendor Platform')}</span>
          <h2 id="study-edit-title">{sellerBanner?.title || t('Grow your business on JTBazar.')}</h2>
          <p>{sellerBanner?.description || t('Reach active shoppers with store management, inventory tools, and transparent order handling.')}</p>
          <ul className="home-check-list">
            <li><Check size={16} aria-hidden="true" /> {t('Simple business verification')}</li>
            <li><Check size={16} aria-hidden="true" /> {t('Full control over listings & pricing')}</li>
            <li><Check size={16} aria-hidden="true" /> {t('Secure order handling and payouts')}</li>
          </ul>
          <Link className="home-button home-button--dark" to={sellerBanner?.cta_destination?.startsWith('/') ? sellerBanner.cta_destination : '/vendor/apply'}>{sellerBanner?.cta_text || t('Become a Seller')} <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className="home-app-banner" aria-labelledby="home-app-title">
        <div className="home-app-banner__copy">
          <span className="home-eyebrow">{t('JTBazar Mobile App')}</span>
          <h2 id="home-app-title">{t('Your favourite marketplace, now in your pocket.')}</h2>
          <p>{t('Shop everyday essentials, explore trusted sellers and keep your orders close with the JTBazar app.')}</p>
          <div className="home-app-banner__features">
            <span><ShoppingBag size={16} aria-hidden="true" /> {t('Easy shopping')}</span>
            <span><Truck size={16} aria-hidden="true" /> {t('Order updates')}</span>
            <span><ShieldCheck size={16} aria-hidden="true" /> {t('Trusted marketplace')}</span>
          </div>
          <div className="home-app-banner__actions">
            <span className="home-app-play-badge" aria-label={t('JTBazar app coming soon to Google Play')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#34A853" d="M3.5 2.8 14.1 12 3.5 21.2c-.3-.3-.5-.8-.5-1.4V4.2c0-.6.2-1.1.5-1.4Z"/><path fill="#4285F4" d="m3.5 2.8 12.1 6.9-1.5 2.3L3.5 2.8Z"/><path fill="#FBBC04" d="m14.1 12 3.8 2.2-2.3 1.3-3.1-3.5 1.6-0Z"/><path fill="#EA4335" d="m3.5 21.2 12.1-6.9-1.5-2.3L3.5 21.2Z"/></svg>
              <span><small>{t('GET IT ON')}</small><strong>Google Play</strong></span>
              <em>{t('Coming soon')}</em>
            </span>
            <span className="home-app-banner__availability">{t('Android app listing will be available here soon.')}</span>
          </div>
        </div>
        <div className="home-app-banner__visual" aria-hidden="true">
          <div className="home-app-banner__orbit home-app-banner__orbit--one" />
          <div className="home-app-banner__orbit home-app-banner__orbit--two" />
          <div className="home-app-phone">
            <div className="home-app-phone__notch" />
            <div className="home-app-phone__screen">
              <div className="home-app-phone__status"><span>9:41</span><span>● ● ▰</span></div>
              <div className="home-app-phone__brand"><span className="home-app-phone__brand-mark">JT</span><strong>JTBazar</strong><small>YOUR TRUSTED MARKETPLACE</small></div>
              <div className="home-app-phone__search"><span>⌕</span> Search products...</div>
              <div className="home-app-phone__welcome"><small>HELLO, WELCOME!</small><strong>Find your everyday favourites.</strong></div>
              <div className="home-app-phone__tiles"><span><i>✦</i><small>Fashion</small></span><span><i>⌂</i><small>Home</small></span><span><i>♡</i><small>Beauty</small></span></div>
              <div className="home-app-phone__section"><strong>Popular picks</strong><small>VIEW ALL</small></div>
              <div className="home-app-phone__products"><span><i>◈</i><small>Daily essentials</small><b>Shop now</b></span><span><i>✿</i><small>Personal care</small><b>Shop now</b></span></div>
              <div className="home-app-phone__nav"><span>⌂<small>Home</small></span><span>▦<small>Categories</small></span><span>♡<small>Wishlist</small></span><span>◉<small>Account</small></span></div>
            </div>
          </div>
          <div className="home-app-float home-app-float--delivery"><Truck size={17}/><span><strong>On the way!</strong><small>Order updates</small></span></div>
          <div className="home-app-float home-app-float--trusted"><ShieldCheck size={17}/><span><strong>Shop with confidence</strong><small>JTBazar marketplace</small></span></div>
        </div>
      </section>

      <section className="home-section home-arrivals" aria-labelledby="new-arrivals-title">
        <div className="home-section__heading">
          <div>
            <span className="home-eyebrow">{t('New Arrivals')}</span>
            <h2 id="new-arrivals-title">{t('Fresh additions to the store.')}</h2>
            <p>{t('Recently added listings from our verified vendor community.')}</p>
          </div>
          <Link className="home-text-link" to="/shop">{t('Browse the catalog')} <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="home-product-grid home-product-grid--arrivals">
          {status === 'ready' && newArrivals.map((product) => <HomeProductCard key={product.id} product={product} />)}
          {status === 'ready' && newArrivals.length === 0 && <p className="home-empty-note">{t('No new arrivals are published yet.')}</p>}
        </div>
      </section>

      <section className="home-values" aria-labelledby="values-title">
        <div className="home-values__intro">
          <span className="home-eyebrow">{t('Why JTBazar?')}</span>
          <h2 id="values-title">{t('A marketplace built on trust.')}</h2>
        </div>
        {valueCards.map(({ icon: Icon, title, description }) => (
          <article className="home-value-card" key={title}>
            <span className="home-value-card__icon"><Icon size={19} aria-hidden="true" /></span>
            <h3>{t(title)}</h3>
            <p>{t(description)}</p>
          </article>
        ))}
      </section>

      <section className="home-support" aria-labelledby="support-title">
        <div className="home-support__icon" aria-hidden="true"><MessageCircle size={22} /></div>
        <div>
          <span className="home-eyebrow">{t('Customer Support')}</span>
          <h2 id="support-title">{t('Have questions about an order or seller?')}</h2>
          <p>{t('Get in touch with our customer service team or visit our Help Center.')}</p>
        </div>
        <div className="home-support__actions">
          <Link className="home-button home-button--dark" to="/faq">{t('Read Marketplace FAQ')} <ArrowRight size={15} aria-hidden="true" /></Link>
          <Link className="home-text-link" to="/contact">{t('Contact Support')} <ExternalLink size={15} aria-hidden="true" /></Link>
        </div>
      </section>

      <section className="home-faq" aria-labelledby="home-faq-title">
        <div className="home-section__heading">
          <div>
            <span className="home-eyebrow">{t('Helpful Notes')}</span>
            <h2 id="home-faq-title">{t('Frequently Asked Questions')}</h2>
          </div>
          <Link className="home-text-link" to="/faq">{t('View All FAQs')} <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="home-faq__items">
          {faqs.map((faq) => (
            <details className="home-faq__item" key={faq.question}>
              <summary>{t(faq.question)}<span aria-hidden="true">+</span></summary>
              <p>{t(faq.answer)}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}


type PromotionPlacementProps = { campaigns: PromotionItem[] }

function CampaignCountdown({ endsAt }: { endsAt: string | null }) {
  const [remaining, setRemaining] = useState('')
  useEffect(() => {
    if (!endsAt) { setRemaining('Limited-time offer'); return }
    const update = () => {
      const seconds = Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000))
      if (!seconds) { setRemaining('Offer ended'); return }
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const secs = seconds % 60
      setRemaining(days ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m ${secs}s`)
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [endsAt])
  return <small aria-live="off" style={{fontVariantNumeric:'tabular-nums',color:'#64748b'}}>{remaining}</small>
}

function PromotionPlacement({ campaigns }: PromotionPlacementProps) {
  if (!campaigns.length) return null
  return (
    <section aria-label="Sponsored promotions" style={{display:'grid',gap:12,width:'100%',maxWidth:1200,margin:'12px auto',padding:'0 16px'}}>
      {campaigns.map((campaign) => {
        const image = campaign.banner_image_urls?.[0] || campaign.banner_image_url
        if (!image) return null
        const destination = campaign.cta_destination || '/shop'
        const content = <><img src={image} alt={campaign.title} loading="lazy" style={{display:'block',width:'100%',maxHeight:260,objectFit:'cover'}}/><div style={{padding:'12px 16px'}}><strong>{campaign.title}</strong>{campaign.description && <p style={{margin:'5px 0 0',color:'#64748b'}}>{campaign.description}</p>}{campaign.cta_text && <span style={{display:'inline-block',marginTop:8,fontWeight:700}}>{campaign.cta_text} →</span>}</div></>
        return destination.startsWith('https://') ? <a key={campaign.id} href={destination} target="_blank" rel="noreferrer" style={{display:'block',overflow:'hidden',borderRadius:16,border:'1px solid #e5e7eb',background:'#fff',color:'inherit',textDecoration:'none'}}>{content}</a> : <Link key={campaign.id} to={destination.startsWith('/') ? destination : '/shop'} style={{display:'block',overflow:'hidden',borderRadius:16,border:'1px solid #e5e7eb',background:'#fff',color:'inherit',textDecoration:'none'}}>{content}</Link>
      })}
    </section>
  )
}

function HomeCategoryCard({ category }: { category: Category }) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  const name = t(category.name)
  return (
    <Link to={`/categories/${category.slug}`} className="home-category-card shine-surface">
      <div className="home-category-card__image">
          {failed || !category.image ? <div className="home-image-fallback" role="img" aria-label={name}><BookOpen size={28} aria-hidden="true" /></div> : <img src={category.image} alt={`${name} ${t('category collection')}`} loading="lazy" onError={() => setFailed(true)} />}
        <span className="home-category-card__shade" />
        <span className="home-category-card__caption"><strong>{name}</strong><small>{t('Explore products')}</small></span>
        <span className="home-category-card__arrow"><ArrowUpRight size={17} aria-hidden="true" /></span>
      </div>
    </Link>
  )
}

function HomeProductCard({ product, campaign }: { product: Product; campaign?: ProductCampaign }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { add } = useCart()
  const { has, toggle } = useWishlist()
  const { push } = useToast()
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState(false)
  const addLock = useRef(false)
  const name = t(product.name)
  const saved = has(product.id)
  const campaignPercent = campaign && ['flash_sale','seasonal','custom'].includes(campaign.campaign_type) ? Number(campaign.discount_percent) : 0
  const bestPercent = Math.max(Number(product.discountPercent || 0), campaignPercent)
  const displayPrice = bestPercent > Number(product.discountPercent || 0) && product.originalPrice !== undefined
    ? Number((product.originalPrice * (1 - bestPercent / 100)).toFixed(2))
    : product.price
  const campaignOfferLabel = campaign?.campaign_type === 'bogo' ? `Buy ${campaign.buy_quantity} Get ${campaign.get_quantity}`
    : campaign?.campaign_type === 'bundle' ? 'Bundle offer'
    : campaignPercent > Number(product.discountPercent || 0) ? `${campaignPercent}% campaign deal` : null
  const canAdd = product.isPublished && product.variants.length === 0 && product.availabilityStatus !== 'out-of-stock' && product.availabilityStatus !== 'unavailable' && product.availabilityStatus !== 'unknown'
  const availability = product.availabilityStatus === 'available' ? t('In stock') : product.availabilityStatus === 'out-of-stock' ? t('Out of stock') : product.availabilityStatus === 'unknown' ? t('Availability not confirmed') : t('Unavailable')
  const wishlistLabel = saved ? `${t('Remove from wishlist')} · ${name}` : `${t('Add to wishlist')} · ${name}`
  async function handleAdd() {
    if (product.variants.length > 0) {
      navigate(`/products/${product.slug}`)
      return
    }
    if (addLock.current || !canAdd) return
    addLock.current = true
    setAdding(true)
    if (await add(product, 1)) {
      push(t('Added to cart.'), 'success')
      window.setTimeout(() => { addLock.current = false; setAdding(false) }, 900)
    } else {
      addLock.current = false
      setAdding(false)
    }
  }

  return (
    <article className="home-product-card shine-surface">
      <div className="home-product-card__image-wrap">
        <Link to={`/products/${product.slug}`} className="home-product-card__image-link" aria-label={`${t('View')} ${name}`}>
          {failed || !product.images[0] ? <div className="home-image-fallback" role="img" aria-label={name}><BookOpen size={30} aria-hidden="true" /><span>{name}</span></div> : <img src={product.images[0]} alt={name} loading="lazy" onError={() => setFailed(true)} />}
        </Link>
        <button className="home-product-card__wishlist" type="button" onClick={() => { void toggle(product.id); push(t(saved ? 'Removed from wishlist' : 'Added to wishlist'), 'success') }} aria-pressed={saved} aria-label={wishlistLabel}><Heart size={17} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" /></button>
      </div>
      <div className="home-product-card__body">
        <div className="home-product-card__title-row"><Link to={`/products/${product.slug}`} className="home-product-card__name">{name}</Link><span className="home-product-card__price">{formatPKR(displayPrice)}</span></div>{campaignOfferLabel && <small style={{display:"inline-block",marginTop:5,color:"#9a4d25",fontWeight:800}}>{campaignOfferLabel}</small>}
        <p className="home-product-card__description">{t(product.shortDescription)}</p>
        <div className="home-product-card__bottom"><span className="home-product-card__availability">{availability}</span><button type="button" className="home-product-card__add" onClick={handleAdd} disabled={!canAdd || adding} aria-busy={adding} aria-label={product.variants.length ? `${t('Choose options for')} ${name}` : `${t('Add')} ${name} ${t('to cart')}`}><ShoppingBag size={15} aria-hidden="true" /><span>{t(product.variants.length ? 'Choose options' : 'Add')}</span></button></div>
      </div>
    </article>
  )
}
