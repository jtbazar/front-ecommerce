import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { catalogService } from '../services/products/productService'
import { loadPublicProductsByIds, loadPublicProductBySlug } from '../services/products/supabaseCatalogService'
import type { Category } from '../types/category'
import type { Product } from '../types/product'
import type { PublicShop } from '../types/shop'
import { toUserErrorMessage } from '../utils/errorMessage'

type CatalogStatus = 'loading' | 'ready' | 'error' | 'unconfigured'

interface CatalogValue {
  products: Product[]
  categories: Category[]
  shops: PublicShop[]
  status: CatalogStatus
  error: string | null
  refresh: () => void
  findProductById: (id: string) => Product | undefined
  findProductBySlug: (slug: string) => Product | undefined
  findCategoryBySlug: (slug: string) => Category | undefined
  findShopBySlug: (slug: string) => PublicShop | undefined
  productsBySeller: (sellerId: string) => Product[]
  ensureProductsByIds: (ids: string[]) => Promise<Product[]>
  ensureProductBySlug: (slug: string) => Promise<Product | null>
}

const CatalogContext = createContext<CatalogValue | null>(null)

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [shops, setShops] = useState<PublicShop[]>([])
  // Catalog data is fetched from the live database; never serialize the full catalogue into browser storage.
  const [status, setStatus] = useState<CatalogStatus>(isSupabaseConfigured ? 'loading' : 'unconfigured')
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const refresh = useCallback(() => setRefreshToken((current) => current + 1), [])

  const productsRef = useRef(products)
  const pendingProductLoadsRef = useRef(new Map<string, Promise<Product[]>>())
  useEffect(() => { productsRef.current = products }, [products])

  const ensureProductsByIds = useCallback(async (ids: string[]) => {
    const wanted = [...new Set(ids.filter(Boolean))]
    if (!wanted.length) return []
    const cached = new Set(productsRef.current.map((product) => product.id))
    const missing = wanted.filter((id) => !cached.has(id))
    const newIds = missing.filter((id) => !pendingProductLoadsRef.current.has(id))
    let newRequest: Promise<Product[]> = Promise.resolve([])
    if (newIds.length) {
      newRequest = loadPublicProductsByIds(newIds).then((fetched) => {
        const merged = new Map(productsRef.current.map((product) => [product.id, product]))
        for (const product of fetched) merged.set(product.id, product)
        productsRef.current = [...merged.values()]
        setProducts(productsRef.current)
        return fetched
      }).finally(() => { for (const id of newIds) pendingProductLoadsRef.current.delete(id) })
      for (const id of newIds) pendingProductLoadsRef.current.set(id, newRequest)
    }
    const pending = missing.filter((id) => !newIds.includes(id)).map((id) => pendingProductLoadsRef.current.get(id)).filter((request): request is Promise<Product[]> => Boolean(request))
    await Promise.all([newRequest, ...pending])
    const byId = new Map(productsRef.current.map((product) => [product.id, product]))
    return wanted.flatMap((id) => byId.has(id) ? [byId.get(id)!] : [])
  }, [])

  const ensureProductBySlug = useCallback(async (slug: string) => {
    const cached = productsRef.current.find((product) => product.slug === slug && product.isPublished)
    if (cached) return cached
    const fetched = await loadPublicProductBySlug(slug)
    if (fetched) {
      const merged = new Map(productsRef.current.map((product) => [product.id, product]))
      merged.set(fetched.id, fetched)
      productsRef.current = [...merged.values()]
      setProducts(productsRef.current)
    }
    return fetched
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)

    if (!isSupabaseConfigured) {
      setProducts([])
      setCategories([])
      setShops([])
      setStatus('unconfigured')
      return () => { cancelled = true }
    }

    setStatus('loading')
    catalogService.loadMetadata()
      .then((catalog) => {
        if (cancelled) return
        // Products are loaded only by page or explicit ID/slug lookups.
        setCategories(catalog.categories)
        setShops(catalog.shops)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(toUserErrorMessage(cause, 'The catalogue could not be loaded. Please try again.'))
        setStatus('error')
      })

    return () => { cancelled = true }
  }, [refreshToken])

  // Admin category status changes are broadcast through Supabase Realtime.
  // Category metadata refreshes independently; product pages revalidate their own bounded results.
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const client = getSupabase()
    const channel = client
      .channel('storefront-category-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => refresh())
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [refresh])

  const value = useMemo<CatalogValue>(() => ({
    products,
    categories,
    shops,
    status,
    error,
    refresh,
    findProductById: (id) => products.find((product) => product.id === id && product.isPublished),
    findProductBySlug: (slug) => products.find((product) => product.slug === slug && product.isPublished),
    findCategoryBySlug: (slug) => categories.find((category) => category.slug === slug && category.isActive !== false),
    findShopBySlug: (slug) => shops.find((shop) => shop.slug === slug),
    productsBySeller: (sellerId) => products.filter((product) => product.sellerId === sellerId),
    ensureProductsByIds,
    ensureProductBySlug,
  }), [products, categories, shops, status, error, refresh, ensureProductsByIds, ensureProductBySlug])

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog() {
  const context = useContext(CatalogContext)
  if (!context) throw new Error('useCatalog must be used inside CatalogProvider')
  return context
}
