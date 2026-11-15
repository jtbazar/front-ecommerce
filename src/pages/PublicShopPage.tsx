import { Link, useParams } from 'react-router-dom'
import { Store, MapPin, CheckCircle2, ShieldAlert, PackageSearch } from 'lucide-react'
import { ReviewComposer } from '../components/reviews/ReviewComposer'
import { useCatalog } from '../contexts/CatalogContext'
import { useInfiniteProducts } from '../hooks/useInfiniteProducts'
import { usePageMeta } from '../hooks/usePageMeta'
import { useI18n } from '../i18n/LocaleContext'
import { LoadingState, ErrorState } from '../components/common/States'
import { ProductGrid } from '../components/products/ProductGrid'

export function PublicShopPage() {
  const { t } = useI18n()
  const { slug = '' } = useParams()
  const { status, error, findShopBySlug } = useCatalog()
  const shop = findShopBySlug(slug)
  const shopCatalog = useInfiniteProducts({ sellerId: shop?.id, enabled: Boolean(shop?.id), pageSize: 12, sort: 'newest' })
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
          <div className="shop-meta"><span><MapPin size={15} /> {t('Verified vendor on JTBazar')}</span></div>
          <div className="shop-product-count"><PackageSearch size={17} /><strong>{shopCatalog.count}</strong><span>{t('published products')}</span></div>
        </div>
      </header>

      <ReviewComposer kind="seller" targetId={shop.id} />

      <section className="shop-products-section">
        <div className="page-heading">
          <h2>{t('Shop Products')} ({shopCatalog.count})</h2>
        </div>
        {shopCatalog.error && <ErrorState message={shopCatalog.error} />}
        {shopProducts.length === 0
          ? <div className="empty-state"><p>{t('No published products are currently available from this vendor.')}</p></div>
          : <ProductGrid products={shopProducts} />}
        {shopCatalog.hasMore && <div className="pagination-actions"><button type="button" className="button button--outline" onClick={() => void shopCatalog.loadMore()} disabled={shopCatalog.loadingMore}>{t(shopCatalog.loadingMore ? 'Loading…' : 'Load more products')}</button></div>}
      </section>
    </div>
  )
}
