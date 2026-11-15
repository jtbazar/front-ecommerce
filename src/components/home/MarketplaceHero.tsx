import { ArrowRight, Check, ChevronLeft, ChevronRight, MapPin, Store } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../i18n/LocaleContext'
import { fetchActiveHomepageHeroes, type HomepageHeroItem } from '../../services/marketplace/promotionsService'
import { getOwnSellerProfile } from '../../services/marketplace/vendorService'
import type { Product } from '../../types/product'
import type { PublicShop } from '../../types/shop'
import { formatPKR } from '../../utils/money'

type MarketplaceHeroProps = {
  product?: Product
  shop?: PublicShop
}

function safeHeroHref(value: string | null | undefined): string {
  if (value?.startsWith('/') && !value.startsWith('//')) return value
  if (value?.startsWith('https://')) return value
  return '/shop'
}

export function MarketplaceHero({ product, shop }: MarketplaceHeroProps) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [heroes, setHeroes] = useState<HomepageHeroItem[]>([])
  const [activeHeroIndex, setActiveHeroIndex] = useState(0)
  const [sellerStatus, setSellerStatus] = useState<string | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    let active = true
    void fetchActiveHomepageHeroes().then((items) => {
      if (active) setHeroes(items)
    }).catch(() => { /* the local marketplace hero remains available */ })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let active = true
    if (!user) { setSellerStatus(null); return () => { active = false } }
    void getOwnSellerProfile().then((profile) => {
      if (active) setSellerStatus(profile?.status ?? null)
    }).catch(() => { if (active) setSellerStatus(null) })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    if (reducedMotion || paused || heroes.length < 2) return
    const timer = window.setInterval(() => setActiveHeroIndex((index) => (index + 1) % heroes.length), 6000)
    return () => window.clearInterval(timer)
  }, [heroes.length, paused, reducedMotion])

  useEffect(() => { setActiveHeroIndex(0) }, [heroes.length])

  const activeHero = heroes[activeHeroIndex]
  const title = activeHero?.title ?? ''
  const titleParts = title.includes('\n') ? title.split('\n', 2) : title.includes(',') ? [title.slice(0, title.indexOf(',') + 1), title.slice(title.indexOf(',') + 1).trim()] : [title]
  const sellerHref = sellerStatus === 'approved' ? '/vendor' : '/vendor/apply'
  const sellerLabel = sellerStatus === 'approved' ? t('Open Seller Dashboard') : sellerStatus === 'pending' || sellerStatus === 'rejected' ? t('View Application Status') : t('Become a Seller')
  const primaryHref = safeHeroHref(activeHero?.cta_destination)
  const primaryLabel = activeHero?.cta_text?.trim() || t('Start Shopping')

  return (
    <section className="marketplace-hero jtb-home-hero" aria-roledescription={t('carousel')} aria-label={t('Homepage highlights')} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false) }}>
      <div className="marketplace-hero__copy">
        <span className="marketplace-hero__eyebrow"><span aria-hidden="true" />{t('One marketplace, more possibilities')}</span>
        <h1 id="marketplace-hero-title">{activeHero ? titleParts.map((part, index) => <span key={`${activeHero.id}-${index}`}>{index > 0 && <br />}{t(part)}</span>) : <>{t('Everything You Need,')}<br />{t('All in One Place')}</>}</h1>
        <p className="marketplace-hero__description">{t(activeHero?.subtitle || 'Buy and sell products, discover services, find properties, and connect with trusted vendors across multiple categories.')}</p>
        <div className="marketplace-hero__actions">
          {primaryHref.startsWith('https://') ? <a className="marketplace-hero__primary" href={primaryHref}>{primaryLabel}<ArrowRight size={17} aria-hidden="true" /></a> : <Link className="marketplace-hero__primary" to={primaryHref}>{primaryLabel}<ArrowRight size={17} aria-hidden="true" /></Link>}
          <Link className="marketplace-hero__secondary" to={sellerHref}>{sellerLabel}<ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <div className="marketplace-hero__trust"><span className="marketplace-hero__trust-icon"><Check size={15} aria-hidden="true" /></span><span>{t('Trusted by buyers and sellers')}</span></div>
        {heroes.length > 1 && <div className="marketplace-hero__controls" role="group" aria-label={t('Hero slide controls')}>
          <button type="button" onClick={() => setActiveHeroIndex((index) => (index - 1 + heroes.length) % heroes.length)} aria-label={t('Previous slide')}><ChevronLeft size={16} /></button>
          <span className="marketplace-hero__count">{String(activeHeroIndex + 1).padStart(2, '0')} / {String(heroes.length).padStart(2, '0')}</span>
          <span className="marketplace-hero__dots">{heroes.map((hero, index) => <button key={hero.id} type="button" className={index === activeHeroIndex ? 'is-active' : ''} onClick={() => setActiveHeroIndex(index)} aria-label={`${t('Show slide')} ${index + 1}`} aria-pressed={index === activeHeroIndex} />)}</span>
          <button type="button" onClick={() => setActiveHeroIndex((index) => (index + 1) % heroes.length)} aria-label={t('Next slide')}><ChevronRight size={16} /></button>
        </div>}
      </div>

      <div className="marketplace-hero__visual" aria-label={t('A shopper with shopping bags')}>
        <div className="marketplace-hero__globe" aria-hidden="true"><span /><span /><span /><span /><span /></div>
        <div className="marketplace-hero__photo-wrap">
          <picture>
            {activeHero?.mobile_image_url && <source media="(max-width: 700px)" srcSet={activeHero.mobile_image_url} />}
            <img key={activeHero?.id ?? 'shopper'} className="marketplace-hero__photo" src={activeHero?.image_url ?? '/images/marketplace-shopper.webp'} alt={t(activeHero?.image_alt_text || 'A shopper carrying shopping bags in a bright mall')} width="1600" height="900" fetchPriority="high" decoding="async" />
          </picture>
        </div>

        {product?.images[0] && <Link className="marketplace-hero__product" to={`/products/${product.slug}`} aria-label={`${t('View')} ${t(product.name)}`}>
          <img src={product.images[0]} alt="" loading="lazy" />
          <span className="marketplace-hero__product-copy"><small>{t('Featured product')}</small><strong>{t(product.name)}</strong><b>{formatPKR(product.price)}</b></span>
          <span className="marketplace-hero__card-arrow"><ArrowRight size={15} aria-hidden="true" /></span>
        </Link>}

        {shop?.shopImageUrl && <Link className="marketplace-hero__shop" to={`/shops/${shop.slug}`} aria-label={`${t('View store')} ${t(shop.shopName)}`}>
          <img src={shop.shopImageUrl} alt="" loading="lazy" />
          <span className="marketplace-hero__shop-copy"><small><Store size={12} aria-hidden="true" />{t('Marketplace shop')}</small><strong>{t(shop.shopName)}</strong>{shop.shopLocationLabel && <span className="marketplace-hero__shop-location"><MapPin size={11} aria-hidden="true" />{t(shop.shopLocationLabel)}</span>}</span>
        </Link>}
      </div>
    </section>
  )
}
