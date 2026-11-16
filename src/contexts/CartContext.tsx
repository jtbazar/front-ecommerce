import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { useCatalog } from './CatalogContext'
import { getSupabase } from '../lib/supabase'
import type { CartLine } from '../types/cart'
import type { Product } from '../types/product'
import { getCartLineMaxQuantity } from '../utils/cart'
import { toUserErrorMessage } from '../utils/errorMessage'

interface CartContextValue {
  lines: CartLine[]
  itemCount: number
  message: string
  loading: boolean
  add: (product: Product, quantity: number, variantId?: string, variantLabel?: string) => Promise<boolean>
  setQuantity: (productId: string, variantId: string | undefined, quantity: number) => Promise<void>
  remove: (productId: string, variantId?: string) => Promise<void>
  clear: () => Promise<void>
}

const CART_STORAGE_KEY = 'jtbazar-guest-cart-v2'
function readGuestCart(): CartLine[] { try { const parsed: unknown = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is CartLine => Boolean(item) && typeof item.productId === 'string' && Number.isFinite(item.quantity)).map((item) => ({ ...item, quantity: Math.max(1, Math.min(99, Math.floor(item.quantity))) })) : [] } catch { return [] } }
const CartContext = createContext<CartContextValue | null>(null)


export function CartProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const { findProductById, ensureProductsByIds, status: catalogStatus } = useCatalog()
  const [lines, setLines] = useState<CartLine[]>(readGuestCart)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const guestLinesRef = useRef<CartLine[]>(readGuestCart())
  const previousUserIdRef = useRef<string | null>(null)
  const skipGuestPersistRef = useRef(false)

  useEffect(() => {
    if (catalogStatus !== 'ready') return
    const ids = lines.map((line) => line.productId)
    if (ids.length) void ensureProductsByIds(ids).catch(() => setMessage('Some cart items could not be refreshed. Please try again.'))
  }, [catalogStatus, lines, ensureProductsByIds])

  const loadCart = useCallback(async (userId: string) => {
    const client = getSupabase()
    const { data, error } = await client.from('cart_items')
      .select('product_id, variant_id, quantity')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
    if (error) throw new Error(toUserErrorMessage(error, 'Your cart could not be updated. Please try again.'))
    return (data ?? []).map((row) => ({
      productId: row.product_id,
      quantity: row.quantity,
      ...(row.variant_id ? { variantId: row.variant_id } : {}),
    }))
  }, [])

  useEffect(() => {
    let active = true
    if (authLoading) return () => { active = false }
    if (!user) {
      if (previousUserIdRef.current) {
        skipGuestPersistRef.current = true
        const guest = readGuestCart()
        setLines(guest)
        guestLinesRef.current = guest
      }
      previousUserIdRef.current = null
      setLoading(false)
      return () => { active = false }
    }

    if (catalogStatus !== 'ready') { setLoading(catalogStatus === 'loading'); if (catalogStatus === 'error') setMessage('Stock could not be checked. Refresh the catalog before using your cart.'); return () => { active = false } }
    previousUserIdRef.current = user.id
    setLoading(true)
    void (async () => {
      try {
        const client = getSupabase()
        const guestLines = guestLinesRef.current.length ? guestLinesRef.current : readGuestCart()
        const { data: existingRows, error: readError } = await client.from('cart_items')
          .select('product_id, variant_id, quantity').eq('user_id', user.id)
        if (readError) throw new Error(toUserErrorMessage(readError, 'Your saved cart could not be loaded. Please try again.'))
        const hydrated = await ensureProductsByIds([...(existingRows ?? []).map((row) => row.product_id), ...guestLines.map((line) => line.productId)])
        const hydratedById = new Map(hydrated.map((product) => [product.id, product]))
        const merged = new Map<string, { user_id: string; product_id: string; variant_id: string | null; quantity: number }>()
        for (const row of existingRows ?? []) {
          const product = hydratedById.get(row.product_id)
          const rowLine = { productId: row.product_id, variantId: row.variant_id ?? undefined, quantity: row.quantity }
          const max = product ? getCartLineMaxQuantity(product, rowLine) : row.quantity
          if (product && max < 1) {
            let removeQuery = client.from('cart_items').delete().eq('user_id', user.id).eq('product_id', row.product_id)
            removeQuery = row.variant_id ? removeQuery.eq('variant_id', row.variant_id) : removeQuery.is('variant_id', null)
            const { error: removeError } = await removeQuery
            if (removeError) throw new Error(toUserErrorMessage(removeError, 'An unavailable cart item could not be removed. Please try again.'))
            continue
          }
          merged.set(row.product_id + ':' + (row.variant_id ?? ''), {
            user_id: user.id, product_id: row.product_id, variant_id: row.variant_id, quantity: Math.max(1, Math.min(max || row.quantity, row.quantity)),
          })
        }
        for (const line of guestLines) {
          const product = hydratedById.get(line.productId)
          if (!product || (line.variantId && !product.variants.some((variant) => variant.id === line.variantId)) || (product.variants.length > 0 && !line.variantId)) continue
          const max = getCartLineMaxQuantity(product, line)
          if (max < 1) continue
          const key = line.productId + ':' + (line.variantId ?? '')
          const current = merged.get(key)
          merged.set(key, {
            user_id: user.id, product_id: line.productId, variant_id: line.variantId ?? null,
            quantity: Math.min(max, (current?.quantity ?? 0) + line.quantity),
          })
        }
        if (merged.size) {
          const { error: upsertError } = await client.from('cart_items').upsert([...merged.values()], { onConflict: 'user_id,product_id,variant_id' })
          if (upsertError) throw new Error(toUserErrorMessage(upsertError, 'Your cart could not be synchronized. Please try again.'))
        }
        const saved = await loadCart(user.id)
        if (!active) return
        setLines(saved)
        guestLinesRef.current = []
        try { localStorage.removeItem(CART_STORAGE_KEY) } catch { /* ignore */ }
        setMessage('')
      } catch (cause) {
        if (!active) return
        setMessage(cause instanceof Error ? cause.message : 'Your saved cart could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [user?.id, authLoading, catalogStatus, loadCart, ensureProductsByIds])

  useEffect(() => { if (!user && !authLoading) { if (skipGuestPersistRef.current) { skipGuestPersistRef.current = false; return } guestLinesRef.current = lines; try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines)) } catch { /* guest storage is optional */ } } }, [lines, user, authLoading])

  const add = useCallback<CartContextValue['add']>(async (product, requested, variantId, variantLabel) => {
    if (authLoading) {
      setMessage('Please wait while your account is checked.')
      return false
    }
    const currentProduct = findProductById(product.id)
    const selectedVariant = currentProduct?.variants.find((variant) => variant.id === variantId)
    const availability = selectedVariant?.availabilityStatus ?? currentProduct?.availabilityStatus
    if (!currentProduct || !currentProduct.isPublished || (variantId && !selectedVariant) || availability === 'unavailable' || availability === 'out-of-stock') {
      setMessage(`${product.name} is not currently available to add.`)
      return false
    }
    if (currentProduct.variants.length > 0 && (!variantId || !selectedVariant)) {
      setMessage(`Choose an option for ${product.name} before adding it.`)
      return false
    }
    const stockLine: CartLine = { productId: product.id, quantity: 1, ...(variantId ? { variantId } : {}), ...(variantLabel ? { variantLabel } : {}) }
    const maxStock = getCartLineMaxQuantity(currentProduct, stockLine)
    if (maxStock < 1) { setMessage('This option is out of stock.'); return false }
    const quantity = Math.max(1, Math.min(maxStock, Math.floor(requested) || 1))
    const newLine: CartLine = { productId: product.id, quantity, ...(variantId ? { variantId } : {}), ...(variantLabel ? { variantLabel } : {}) }

    if (!user) {
      const current = guestLinesRef.current
      const existing = current.find((line) => line.productId === product.id && line.variantId === variantId)
      const next = existing
        ? current.map((line) => line === existing ? { ...line, quantity: Math.min(maxStock, line.quantity + quantity) } : line)
        : [...current, newLine]
      guestLinesRef.current = next
      setLines(next)
      setMessage('Guest cart saved in this browser. It will merge into your account when you sign in.')
      return true
    }

    try {
      const client = getSupabase()
      const ensureSession = async (forceRefresh = false) => {
        let sessionResult = forceRefresh
          ? await client.auth.refreshSession()
          : await client.auth.getSession()
        if (sessionResult.error) throw sessionResult.error
        let session = sessionResult.data.session
        if (!forceRefresh && (!session || session.user.id !== user.id || (session.expires_at ?? 0) * 1000 < Date.now() + 60_000)) {
          sessionResult = await client.auth.refreshSession()
          if (sessionResult.error) throw sessionResult.error
          session = sessionResult.data.session
        }
        if (!session?.access_token || session.user.id !== user.id) {
          throw new Error('Your sign-in session has expired. Please sign in again and retry adding this item.')
        }
      }
      const saveCartLine = async () => {
        await ensureSession()
        let query = client.from('cart_items').select('quantity').eq('user_id', user.id).eq('product_id', product.id)
        query = variantId ? query.eq('variant_id', variantId) : query.is('variant_id', null)
        const { data: existing, error: readError } = await query.maybeSingle()
        if (readError) throw readError
        const nextQuantity = Math.min(maxStock, (existing?.quantity ?? 0) + quantity)
        const { error } = await client.from('cart_items').upsert({
          user_id: user.id, product_id: product.id, variant_id: variantId ?? null, quantity: nextQuantity,
        }, { onConflict: 'user_id,product_id,variant_id' })
        if (error) throw error
      }
      try {
        await saveCartLine()
      } catch (cause) {
        if ((cause as { status?: number })?.status !== 401) throw cause
        await ensureSession(true)
        await saveCartLine()
      }
      setLines(await loadCart(user.id))
      setMessage(`${product.name} added to your saved cart.`)
      return true
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The item could not be saved to your account cart.')
      return false
    }
  }, [authLoading, findProductById, user, loadCart])

  const setQuantity = useCallback<CartContextValue['setQuantity']>(async (productId, variantId, quantity) => {
    if (quantity <= 0) {
      if (!user) {
        const next = guestLinesRef.current.filter((line) => !(line.productId === productId && line.variantId === variantId))
        guestLinesRef.current = next
        setLines(next)
        return
      }
      let removeQuery = getSupabase().from('cart_items').delete().eq('user_id', user.id).eq('product_id', productId)
      removeQuery = variantId ? removeQuery.eq('variant_id', variantId) : removeQuery.is('variant_id', null)
      const { error } = await removeQuery
      if (error) setMessage(toUserErrorMessage(error, 'Your cart could not be updated. Please try again.'))
      else setLines(await loadCart(user.id))
      return
    }
    const product = findProductById(productId)
    const maxStock = getCartLineMaxQuantity(product, { productId, variantId, quantity })
    if (maxStock < 1) { setMessage('This option is out of stock.'); return }
    const safeQuantity = Math.max(1, Math.min(maxStock, 99, Math.floor(quantity)))
    if (safeQuantity < quantity) setMessage('Quantity adjusted to the available stock: ' + maxStock + '.')
    else setMessage('')
    if (!user) {
      const next = guestLinesRef.current.map((line) => line.productId === productId && line.variantId === variantId ? { ...line, quantity: safeQuantity } : line)
      guestLinesRef.current = next
      setLines(next)
      return
    }
    try {
      let update = getSupabase().from('cart_items').update({ quantity: safeQuantity }).eq('user_id', user.id).eq('product_id', productId)
      update = variantId ? update.eq('variant_id', variantId) : update.is('variant_id', null)
      const { error } = await update
      if (error) throw new Error(error.message)
      setLines(await loadCart(user.id))
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The cart could not be updated.') }
  }, [user, loadCart, findProductById])

  const remove = useCallback<CartContextValue['remove']>(async (productId, variantId) => {
    if (!user) {
      const next = guestLinesRef.current.filter((line) => !(line.productId === productId && line.variantId === variantId))
      guestLinesRef.current = next
      setLines(next)
      setMessage('Item removed from your temporary cart.')
      return
    }
    try {
      const client = getSupabase()
      let query = client.from('cart_items').delete().eq('user_id', user.id).eq('product_id', productId)
      query = variantId ? query.eq('variant_id', variantId) : query.is('variant_id', null)
      const { error } = await query
      if (error) throw new Error(error.message)
      setLines(await loadCart(user.id))
      setMessage('Item removed from your cart.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The item could not be removed.')
    }
  }, [user, loadCart])

  const clear = useCallback<CartContextValue['clear']>(async () => {
    if (!user) {
      guestLinesRef.current = []
      setLines([])
      setMessage('Your temporary cart is clear.')
      return
    }
    try {
      const { error } = await getSupabase().from('cart_items').delete().eq('user_id', user.id)
      if (error) throw new Error(error.message)
      setLines([])
      setMessage('Your saved cart is clear.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The cart could not be cleared.')
    }
  }, [user])

  const value = useMemo(() => ({
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    message,
    loading,
    add,
    setQuantity,
    remove,
    clear,
  }), [lines, message, loading, add, setQuantity, remove, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used inside CartProvider')
  return context
}
