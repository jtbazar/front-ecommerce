import { ArrowLeft, ArrowRight, Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '../components/common/States'
import { CategoryCard } from '../components/products/CategoryCard'
import { ProductGrid } from '../components/products/ProductGrid'
import { useCatalog } from '../contexts/CatalogContext'
import { usePageMeta } from '../hooks/usePageMeta'
import { useI18n } from '../i18n/LocaleContext'
import { useInfiniteProducts } from '../hooks/useInfiniteProducts'
import type { Category } from '../types/category'
import type { Product } from '../types/product'
import type { PriceSort } from '../components/products/FilterControls'

type Translator = (english: string) => string

function CatalogSearch({ t }: { t: Translator }) {
  const [value, setValue] = useState('')
  const navigate = useNavigate()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = value.trim()
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search')
  }
  return <form className="search-field" role="search" onSubmit={submit}><Search size={17} aria-hidden="true" /><label className="sr-only" htmlFor="catalog-search">{t('Search items')}</label><input id="catalog-search" type="search" placeholder={t('Search products, categories…')} value={value} onChange={(event) => setValue(event.target.value)} /><button type="submit" className="search-submit">{t('Search')}</button></form>
}

function CatalogFilters({ category, onCategory, sort, onSort, count, categories, t }: { category: string; onCategory: (id: string) => void; sort: PriceSort; onSort: (sort: PriceSort) => void; count: number; categories: Category[]; t: Translator }) {
  return <div className="catalog-filters"><div className="category-chips" aria-label={t('Filter by category')}><button type="button" className={`category-chip${category === 'all' ? ' is-active' : ''}`} aria-pressed={category === 'all'} onClick={() => onCategory('all')}>{t('All')}</button>{categories.map((item) => <button key={item.id} type="button" className={`category-chip${category === item.id ? ' is-active' : ''}${item.isComingSoon ? ' is-coming-soon' : ''}`} aria-pressed={category === item.id} disabled={item.isComingSoon} title={item.isComingSoon ? t('Coming soon') : undefined} onClick={() => onCategory(item.id)}>{t(item.name)}{item.isComingSoon ? ` · ${t('Coming soon')}` : ''}</button>)}</div><div className="filter-meta"><span><SlidersHorizontal size={15} aria-hidden="true" /> {count} {t('products')}</span><label htmlFor="price-sort" className="sr-only">{t('Sort products by price')}</label><select id="price-sort" value={sort} onChange={(event) => onSort(event.target.value as PriceSort)}><option value="featured">{t('Featured')}</option><option value="price-low">{t('Price: low to high')}</option><option value="price-high">{t('Price: high to low')}</option></select></div></div>
}

function useCatalogFilters(products: Product[]) {
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<PriceSort>('featured')
  const items = useMemo(() => {
    const result = products.filter((product) => category === 'all' || product.categoryId === category)
    if (sort === 'price-low') result.sort((a, b) => a.price - b.price)
    if (sort === 'price-high') result.sort((a, b) => b.price - a.price)
    if (sort === 'featured') result.sort((a, b) => Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured)))
    return result
  }, [products, category, sort])
  return { category, setCategory, sort, setSort, items }
}

function CatalogState({ status, error }: { status: 'loading' | 'ready' | 'error' | 'unconfigured'; error: string | null }) {
  if (status === 'loading') return <LoadingState label="Loading the live catalog…" />
  if (status === 'error') return <ErrorState message={error || 'The catalog could not be loaded.'} />
  if (status === 'unconfigured') return <ErrorState message="The store is not connected to its catalog service. Please check back later." />
  return null
}

function ProductLoadMore({ loading, hasMore, onLoad }: { loading: boolean; hasMore: boolean; onLoad: () => void }) {
  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoad() }, { rootMargin: '500px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, onLoad])
  return <div ref={sentinel} className="catalog-load-more" aria-live="polite">{loading ? <LoadingState label="Loading more products…" /> : hasMore ? <span>Scroll to load more</span> : <span>You've reached the end of the collection.</span>}</div>
}

export function ShopPage() {
  const { t } = useI18n()
  const { categories } = useCatalog()
  const catalog = useCatalogFilters([])
  const page = useInfiniteProducts({ categoryId: catalog.category === 'all' ? null : catalog.category, sort: catalog.sort === 'featured' ? 'featured' : catalog.sort === 'price-low' ? 'price-low' : 'price-high' })
  usePageMeta(t('Shop the collection'), t('Explore the currently published JTBazar catalog.'))
  return <div className="page-shell shop-catalog-page"><div className="page-heading page-heading--with-search shop-catalog-heading"><div><span className="eyebrow">{t('Shop JTBazar')}</span><h1>{t('Shop all products')}</h1><p>{t('Find everyday essentials, popular picks and new arrivals from trusted JTBazar sellers.')}</p></div><CatalogSearch t={t} /></div><CatalogFilters category={catalog.category} onCategory={catalog.setCategory} sort={catalog.sort} onSort={catalog.setSort} count={page.count} categories={categories} t={t} />{page.loading ? <LoadingState label="Loading the live catalog…" /> : page.error && page.products.length === 0 ? <ErrorState message={page.error} /> : <><ProductGrid products={page.products} emptyTitle={t('No products are published yet')} emptyDescription={t('New listings will appear after sellers add products and they pass moderation.')} /><ProductLoadMore loading={page.loadingMore} hasMore={page.hasMore} onLoad={page.loadMore} />{page.error && <ErrorState message={page.error} />}</>}</div>
}

export function CategoriesPage() {
  const { t } = useI18n()
  const { categories, status, error } = useCatalog()
  usePageMeta(t('Browse categories'), t('Browse active product categories in the JTBazar store.'))
  return <div className="page-shell"><Link to="/shop" className="back-link"><ArrowLeft size={15} /> {t('Shop all')}</Link><div className="page-heading"><span className="eyebrow">{t('A place for every page')}</span><h1>{t('Browse the')} <em>{t('collections.')}</em></h1><p>{t('Choose an active category to explore published products.')}</p></div><CatalogState status={status} error={error} />{status === 'ready' && (categories.length ? <div className="category-grid category-grid--large">{categories.map((category) => <CategoryCard key={category.id} category={category} />)}</div> : <EmptyState title="No categories are published yet" description="Active categories will appear here after they are configured in the store." actionLabel="Browse the collection" actionHref="/shop" />)}</div>
}

export function CategoryPage() {
  const { t } = useI18n()
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { categories } = useCatalog()
  const category = categories.find((item) => item.slug === slug && item.isActive !== false)
  const [sort, setSort] = useState<PriceSort>('featured')
  const page = useInfiniteProducts({ categoryId: category?.id ?? null, sort: sort === 'featured' ? 'featured' : sort === 'price-low' ? 'price-low' : 'price-high', enabled: Boolean(category) })
  usePageMeta(category ? t(category.seoTitle || category.name) : t('Collection not found'), category ? t(category.seoDescription || `Explore published ${category.name} products on JTBazar in Pakistan.`) : t('This collection could not be found.'), { noIndex: !category })
  if (!category) return <div className="page-shell"><EmptyState title="That collection isn't here" description="Try another active category or browse the full catalog." actionLabel="Browse the collection" actionHref="/shop" /></div>
  return <div className="page-shell category-page"><Link to="/categories" className="back-link"><ArrowLeft size={15} /> {t('All collections')}</Link><div className={`category-hero${category.isFoodCategory ? " category-hero--food" : ""}`}><div className="category-hero__copy"><span className="eyebrow">{t(category.eyebrow ?? 'Collection')}</span><h1>{t(category.name)}</h1><p>{t(category.description)}</p></div>{category.image && <img src={category.image} alt={t(category.name)} loading="eager" fetchPriority="high" />}</div><CatalogFilters category={category.id} onCategory={(id) => navigate(id === 'all' ? '/shop' : `/categories/${categories.find((item) => item.id === id)?.slug ?? ''}`)} sort={sort} onSort={setSort} count={page.count} categories={categories.filter((item) => item.parentId === category.id)} t={t} />{page.loading ? <LoadingState label="Loading category products…" /> : page.error && page.products.length === 0 ? <ErrorState message={page.error} /> : <><ProductGrid products={page.products} emptyTitle={t('Nothing on this page yet')} emptyDescription={t('Try another category or clear your filters.')} /><ProductLoadMore loading={page.loadingMore} hasMore={page.hasMore} onLoad={page.loadMore} />{page.error && <ErrorState message={page.error} />}</>}</div>
}

export function SearchPage() {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [debounced, setDebounced] = useState(initial)
  const { categories } = useCatalog()
  useEffect(() => setQuery(initial), [initial])
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(query.trim()), 300); return () => window.clearTimeout(timer) }, [query])
  const page = useInfiniteProducts({ search: debounced, enabled: Boolean(debounced) })
  usePageMeta(t('Search the catalog'), t('Search currently published JTBazar products and active categories.'))
  return <div className="page-shell"><Link to="/shop" className="back-link"><ArrowLeft size={15} /> {t('Shop all')}</Link><div className="search-page-heading"><span className="eyebrow">{t('Find a useful item')}</span><h1>{t('Search the')} <em>{t('collection.')}</em></h1><form className="search-page-form" onSubmit={(event) => event.preventDefault()}><Search size={19} /><label className="sr-only" htmlFor="search-results-query">{t('Search items')}</label><input id="search-results-query" type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Try a product or category name')} /></form><p>{debounced ? `${page.count} ${t(page.count === 1 ? 'product' : 'products')} ${t('for')} “${debounced}”` : t('Type a word to search the catalog.')}</p></div>{debounced ? page.loading ? <LoadingState label="Searching products…" /> : page.error && page.products.length === 0 ? <ErrorState message={page.error} /> : <><ProductGrid products={page.products} emptyTitle={t('No products found')} emptyDescription={t('Try a shorter search or browse the active categories.')} /><ProductLoadMore loading={page.loadingMore} hasMore={page.hasMore} onLoad={page.loadMore} /></> : <div className="search-suggestions">{categories.map((category) => <Link key={category.id} to={`/categories/${category.slug}`}>{t(category.name)}<ArrowRight size={15} /></Link>)}</div>}</div>
}
