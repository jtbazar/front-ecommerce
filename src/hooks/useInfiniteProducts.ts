import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPublicProductsPage, type PublicProductPageOptions } from '../services/products/supabaseCatalogService'
import type { Product } from '../types/product'

type State = { products: Product[]; count: number; loading: boolean; loadingMore: boolean; error: string | null; hasMore: boolean }

export function useInfiniteProducts(options: Omit<PublicProductPageOptions, 'page' | 'pageSize'> & { enabled?: boolean; pageSize?: number }) {
  const [state, setState] = useState<State>({ products: [], count: 0, loading: true, loadingMore: false, error: null, hasMore: true })
  const [revision, setRevision] = useState(0)
  const pageRef = useRef(0)
  const busyRef = useRef(false)
  const key = [options.categoryId ?? '', options.sellerId ?? '', options.search ?? '', options.sort ?? 'newest', options.enabled !== false, options.pageSize ?? 12].join('|')

  useEffect(() => {
    let cancelled = false
    pageRef.current = 0
    busyRef.current = true
    setState((old) => ({ ...old, products: [], count: 0, loading: true, loadingMore: false, error: null, hasMore: true }))
    if (options.enabled === false) { busyRef.current = false; setState((old) => ({ ...old, loading: false, hasMore: false })); return }
    loadPublicProductsPage({ ...options, page: 0, pageSize: options.pageSize ?? 12 })
      .then((result) => { if (!cancelled) setState({ products: result.products, count: result.count, loading: false, loadingMore: false, error: null, hasMore: result.hasMore }) })
      .catch(() => { if (!cancelled) setState({ products: [], count: 0, loading: false, loadingMore: false, error: 'Products could not be loaded. Please try again.', hasMore: false }) })
      .finally(() => { busyRef.current = false })
    return () => { cancelled = true }
  }, [key, revision])

  const loadMore = useCallback(async () => {
    if (busyRef.current || state.loading || !state.hasMore || options.enabled === false) return
    busyRef.current = true
    setState((old) => ({ ...old, loadingMore: true }))
    const nextPage = pageRef.current + 1
    try {
      const result = await loadPublicProductsPage({ ...options, page: nextPage, pageSize: options.pageSize ?? 12 })
      pageRef.current = nextPage
      setState((old) => {
        const seen = new Set(old.products.map((product) => product.id))
        return { ...old, products: [...old.products, ...result.products.filter((product) => !seen.has(product.id))], count: result.count, loadingMore: false, hasMore: result.hasMore, error: null }
      })
    } catch {
      setState((old) => ({ ...old, loadingMore: false, error: 'More products could not be loaded. Please try again.' }))
    } finally { busyRef.current = false }
  }, [key, state.loading, state.hasMore])

  const retry = useCallback(() => { setRevision((value) => value + 1) }, [])
  return { ...state, loadMore, retry }
}
