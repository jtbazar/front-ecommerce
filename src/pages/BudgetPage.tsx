import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Filter, Info } from 'lucide-react'
import { useInfiniteProducts } from '../hooks/useInfiniteProducts'
import { formatPKR } from '../utils/money'
import { useI18n } from '../i18n/LocaleContext'
import { usePageMeta } from '../hooks/usePageMeta'
import { useStoreSettings } from '../hooks/useStoreSettings'
import { LoadingState, ErrorState } from '../components/common/States'
import { ProductCard } from '../components/products/ProductCard'

const BUDGET_OPTIONS = [500, 1000, 2000] as const

function BudgetLoadMore({ loading, hasMore, onLoad }: { loading: boolean; hasMore: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => { const node = ref.current; if (!node || !hasMore) return; const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoad() }, { rootMargin: '450px 0px' }); observer.observe(node); return () => observer.disconnect() }, [hasMore, onLoad])
  return <div ref={ref} className="catalog-load-more" aria-live="polite">{loading ? <LoadingState label="Loading more products…" /> : hasMore ? null : <span>You've reached the end.</span>}</div>
}

export function BudgetPage() {
  const { t } = useI18n()
  const settings = useStoreSettings()
  usePageMeta(t('Shop Within Your Budget'), t('Explore quality products under PKR 500, PKR 1,000, and PKR 2,000 budgets.'))

  const [selectedBudget, setSelectedBudget] = useState<number>(1000)
  const [customBudget, setCustomBudget] = useState('')
  const page = useInfiniteProducts({ maxPrice: selectedBudget })
  const status = page.loading ? 'loading' : page.error ? 'error' : 'ready'
  const error = page.error

  const eligibleProducts = page.products.filter((product) => product.availabilityStatus !== 'out-of-stock' && product.availabilityStatus !== 'unavailable')
  const hasBudgetMatch = page.count > 0

  const infoMessage = status === 'ready' && !hasBudgetMatch
    ? t('No published products currently fit this budget. Try a higher amount or check back as sellers add new items.')
    : t('Delivery charges are calculated separately at checkout and are not included in your selected product budget.')

  return (
    <div className="page-shell budget-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">{t('Budget Shopping Challenge')}</span>
          <h1>{t('Shop Within Your')} <em>{t('Budget.')}</em></h1>
          <p>{t('Select your budget tier to discover products with confirmed live prices.')}</p>
        </div>
      </header>

      <div className="info-notice info-notice--compact" role="note">
        <Info size={16} aria-hidden="true" />
        <span><strong>{t('Note:')}</strong> {infoMessage}</span>
      </div>

      <div className="budget-selector">
        <span className="budget-label"><Filter size={16} /> {t('Select Budget Limit:')}</span>
        <div className="budget-chips">
          {BUDGET_OPTIONS.map((amount) => (
            <button key={amount} type="button" className={`budget-chip${selectedBudget === amount ? ' is-active' : ''}`} onClick={() => { setSelectedBudget(amount); setCustomBudget('') }}>{formatPKR(amount)}</button>
          ))}
          <label className={`budget-custom${!BUDGET_OPTIONS.includes(selectedBudget as 500 | 1000 | 2000) ? ' is-active' : ''}`}>
            <span>{t('Custom PKR')}</span>
            <input aria-label={t('Enter custom budget in PKR')} type="number" inputMode="numeric" min="1" step="1" value={customBudget} placeholder={t('Any amount')} onChange={(event) => {
              const value = event.target.value
              setCustomBudget(value)
              const amount = Number(value)
              if (value.trim() && Number.isSafeInteger(Math.floor(amount)) && amount >= 1) setSelectedBudget(Math.floor(amount))
            }} />
          </label>
        </div>
      </div>

      {status === 'loading' && <LoadingState label="Finding products within budget…" />}
      {status === 'error' && <ErrorState message={error || 'The catalog could not be loaded.'} />}
      {status === 'ready' && eligibleProducts.length === 0 && (
        <div className="empty-state">
          <h2>{t('No products found under')} {formatPKR(selectedBudget)}</h2>
          <p>{t('Try selecting a higher budget tier or check back as vendors publish new items.')}</p>
          <div className="budget-chips"><button className="button button--outline" onClick={() => setSelectedBudget(2000)}>{t('Try PKR 2,000 Budget')}</button></div>
        </div>
      )}
      {status === 'ready' && eligibleProducts.length > 0 && <><div className="product-grid product-grid--uniform">{eligibleProducts.map((product) => <ProductCard key={product.id} product={product} />)}</div><BudgetLoadMore loading={page.loadingMore} hasMore={page.hasMore} onLoad={page.loadMore} />{page.error && <ErrorState message={page.error} />}</>}
      <p className="budget-delivery-note"><Link to="/shipping">{t('Read delivery information')}</Link> · {t('Delivery fee')}: {formatPKR(settings.deliveryFee)}</p>
    </div>
  )
}
