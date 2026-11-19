import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Store, MapPin, CheckCircle2, ShieldAlert, PackageSearch } from 'lucide-react'
import { ReviewComposer } from '../components/reviews/ReviewComposer'
import { useCatalog } from '../contexts/CatalogContext'
import { useInfiniteProducts } from '../hooks/useInfiniteProducts'
import { usePageMeta } from '../hooks/usePageMeta'
import { useI18n } from '../i18n/LocaleContext'
import { LoadingState, ErrorState } from '../components/common/States'
import { ProductGrid } from '../components/products/ProductGrid'
import { getSupabase } from '../lib/supabase'

export function PublicShopPage() {
  const { t } = useI18n()
  const { slug = '' } = useParams()
  const { status, error, findShopBySlug, categories } = useCatalog()
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [shopCategoryIds, setShopCategoryIds] = useState<string[]>([])
  const [shopSchedule, setShopSchedule] = useState<{ shop_hours: Record<string, { open: boolean; start: string; end: string }>; is_open: boolean } | null>(null)
  const shop = findShopBySlug(slug)
  const shopCatalog = useInfiniteProducts({ sellerId: shop?.id, categoryId: selectedCategoryId || undefined, enabled: Boolean(shop?.id), pageSize: 12, sort: 'newest' })
  useEffect(() => {
    if (!shop?.id) { setShopCategoryIds([]); setShopSchedule(null); return }
    let active = true
    setSelectedCategoryId('')
    const refreshSchedule = async () => {
      const { data, error } = await (getSupabase() as any).rpc('get_public_shop_schedule', { p_seller_id: shop.id })
      if (!active || error || !data) return
      setShopSchedule(Array.isArray(data) ? data[0] ?? null : data)
    }
    void getSupabase().from('products').select('category_id').eq('seller_id', shop.id).eq('publication_status', 'published').eq('moderation_status', 'approved').not('category_id', 'is', null)
      .then(({ data, error }) => {
        if (active && !error) setShopCategoryIds([...new Set((data ?? []).map((row) => row.category_id).filter((id): id is string => Boolean(id)))])
      })
    void refreshSchedule()
    const refreshTimer = window.setInterval(() => { void refreshSchedule() }, 60_000)
    return () => { active = false; window.clearInterval(refreshTimer) }
  }, [shop?.id])
  const shopCategories = categories.filter((category) => category.isActive !== false && shopCategoryIds.includes(category.id))
  const shopProducts = shopCatalog.products

  usePageMeta(shop ? shop.shopName : t('Vendor Shop'), shop ? `Shop ${shop.shopName} on JTBazar.` : t('Vendor shop details.'), { noIndex: status === 'ready' && (!shop || shop.productCount === 0) })

  if (status === 'loading' || (Boolean(shop) && shopCatalog.loading)) return <div className="page-shell"><LoadingState label="Loading shop profile…" /></div>
  if (status === 'error') return <div className="page-shell"><ErrorState message={error || t('The shop directory could not be loaded.')} /><Link to="/shop" className="back-link">{t('Return to Marketplace')}</Link></div>
  if (status === 'unconfigured') return <div className="page-shell"><ErrorState message={t('The shop directory is temporarily unavailable.')} /></div>

  if (!shop) {
    return (
      <div className="page-shell">
        <div className="empty-state">
          <ShieldAlert size={32} />
          <h2>{t('Shop Unavailable')}</h2>
          <p>{t('This seller shop is either currently under review, suspended, or does not exist.')}</p>
          <Link to="/shop" className="button button--dark">{t('Return to Marketplace')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell public-shop-page">
      <nav className="shop-breadcrumb" aria-label={t('Breadcrumb')}><Link to="/shop">{t('Marketplace')}</Link><span aria-hidden="true">/</span><span>{shop.shopName}</span></nav>
      <header className="shop-header-card shine-surface">
        <div className="shop-header-main">
          <span className="shop-avatar">{shop.shopImageUrl ? <img src={shop.shopImageUrl} alt={`${shop.shopName} shop`} /> : <Store size={32} />}</span>
          <div className="shop-header-copy">
            <span className="shop-kicker">{t('Independent seller')}</span>
            <div className="shop-title-row">
              <h1>{shop.shopName}</h1>
              <span className="vendor-status__badge vendor-status__badge--approved"><CheckCircle2 size={14} /> {t('Verified Seller')}</span>
            </div>
            <p className="shop-description">{shop.description || t('This seller has not added a shop description yet.')}</p>
          </div>
        </div>
        <div className="shop-header-footer">
          <div className="shop-meta"><span><MapPin size={15} /> {t('Verified vendor on JTBazar')}</span>{shopSchedule && <span className={`vendor-status__badge vendor-status__badge--${shopSchedule.is_open ? 'approved' : 'suspended'}`}>{shopSchedule.is_open ? t('Shop Open') : t('Shop Closed')}</span>}</div>
          <div className="shop-product-count"><PackageSearch size={17} /><strong>{shopCatalog.count}</strong><span>{t('published products')}</span></div>
        </div>
      </header>

      <ReviewComposer kind="seller" targetId={shop.id} />

      <section className="shop-products-section">
        {shopSchedule?.shop_hours && <div className="shop-hours-public"><h3>{t('Shop opening hours')}</h3><div className="shop-hours-public__grid">{(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const).map((day) => { const slot = shopSchedule.shop_hours[day]; return <div key={day}><strong>{t(day.charAt(0).toUpperCase() + day.slice(1))}</strong><span>{slot?.open ? `${slot.start} – ${slot.end}` : t('Closed')}</span></div> })}</div></div>}
        <div className="page-heading">
          <h2>{t('Shop Products')} ({shopCatalog.count})</h2>
        </div>
        <div className="shop-category-filters" role="group" aria-label={t('Filter shop products by category')}>
          <button type="button" className={`button ${selectedCategoryId ? 'button--outline' : 'button--dark'}`} aria-pressed={!selectedCategoryId} onClick={() => setSelectedCategoryId('')}>{t('All Products')}</button>
          {shopCategories.map((category) => <button type="button" key={category.id} className={`button ${selectedCategoryId === category.id ? 'button--dark' : 'button--outline'}`} aria-pressed={selectedCategoryId === category.id} onClick={() => setSelectedCategoryId(category.id)}>{category.name}</button>)}
        </div>
        {shopCatalog.error && <ErrorState message={shopCatalog.error} />}
        {shopProducts.length === 0
          ? <div className="empty-state"><p>{t(selectedCategoryId ? 'No published products are available in this category.' : 'No published products are currently available from this vendor.')}</p></div>
          : <ProductGrid products={shopProducts} />}
        {shopCatalog.hasMore && <div className="pagination-actions"><button type="button" className="button button--outline" onClick={() => void shopCatalog.loadMore()} disabled={shopCatalog.loadingMore}>{t(shopCatalog.loadingMore ? 'Loading…' : 'Load more products')}</button></div>}
      </section>
    </div>
  )
}
