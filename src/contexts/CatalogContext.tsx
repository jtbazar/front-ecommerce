import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { catalogService } from '../services/products/productService'
import type { Category } from '../types/category'
import type { Product } from '../types/product'
import type { PublicShop } from '../types/shop'

type CatalogStatus = 'loading' | 'ready' | 'error' | 'unconfigured'
type CatalogSnapshot = { products: Product[]; categories: Category[]; shops: PublicShop[] }

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
    catalogService.loadCatalog()
      .then((catalog) => {
        if (cancelled) return
        setProducts(catalog.products)
        setCategories(catalog.categories)
        setShops(catalog.shops)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'The catalog could not be loaded.')
        setStatus('error')
      })

    return () => { cancelled = true }
  }, [refreshToken])

  // Admin category status changes are broadcast through Supabase Realtime.
  // A refresh replaces the full catalog so products in newly inactive collections disappear too.
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
  }), [products, categories, shops, status, error, refresh])

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog() {
  const context = useContext(CatalogContext)
  if (!context) throw new Error('useCatalog must be used inside CatalogProvider')
  return context
}
