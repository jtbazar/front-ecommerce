import { Heart, Info } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from '../components/common/States'
import { ProductGrid } from '../components/products/ProductGrid'
import { useAuth } from '../contexts/AuthContext'
import { useCatalog } from '../contexts/CatalogContext'
import { useWishlist } from '../contexts/WishlistContext'
import { useI18n } from '../i18n/LocaleContext'
import { usePageMeta } from '../hooks/usePageMeta'
import type { Product } from '../types/product'

export function WishlistPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const { ids, items, syncError } = useWishlist()
  const { findProductById, status, error } = useCatalog()
  usePageMeta(t('Wishlist'), t('Products saved to your account or this browser.'))
  const products = ids.map((id) => findProductById(id)).filter((product): product is Product => Boolean(product))
  const notice = user
    ? 'Saved items are kept with your account and updated from the live catalog.'
    : 'Saved items are kept in this browser. Sign in to keep them with your account.'
  return <div className="page-shell wishlist-page">
    <div className="page-heading"><span className="eyebrow"><Heart size={14} /> {t('Your saved pages')}</span><h1>{t('A little list of')} <em>{t('maybes.')}</em></h1><p>{t('Saved products are checked against the current published catalog.')}</p></div>
    <div className="info-notice info-notice--compact" role="note"><Info size={16} aria-hidden="true" /><span>{t(notice)} {t('Selected variants are saved separately under the same product.')}</span></div>
    {items.some((item) => item.variantId) && <ul className="wishlist-variant-list">{items.filter((item) => item.variantId).map((item) => { const product = findProductById(item.productId); const variant = product?.variants.find((entry) => entry.id === item.variantId); return variant ? <li key={item.productId + '-' + item.variantId}><strong>{t(product?.name ?? '')}</strong> · {t(variant.label)}: {t(variant.value)}</li> : null })}</ul>}
    {syncError && <p className="field-error" role="alert">{t(syncError)}</p>}
    {status === 'loading' && <LoadingState label="Loading saved products…" />}
    {status === 'error' && <ErrorState message={error || 'The catalog could not be loaded.'} />}
    {status === 'unconfigured' && <ErrorState message="The catalog is temporarily unavailable. Please check back later." />}
    {status === 'ready' && (products.length ? <ProductGrid products={products} /> : <EmptyState title="Nothing saved just yet" description="Tap the heart on a published product to save it here." actionLabel="Explore the collection" actionHref="/shop" />)}
  </div>
}
