import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useCatalog } from './CatalogContext'
import { useAuth } from './AuthContext'
import { addWishlistProduct, listMyWishlistItems, removeWishlistProduct, type WishlistEntry } from '../services/account/wishlistService'
import { toUserErrorMessage } from '../utils/errorMessage'

interface WishlistValue { ids: string[]; items: WishlistEntry[]; syncError: string | null; toggle: (productId: string, variantId?: string) => Promise<boolean>; has: (productId: string, variantId?: string) => boolean; refresh: () => Promise<void> }
const WISHLIST_KEY = 'jtbazar-guest-wishlist-v2'
const WishlistContext = createContext<WishlistValue | null>(null)
function entryKey(productId: string, variantId?: string) { return productId + ':' + (variantId ?? '') }
function readGuestWishlist(): WishlistEntry[] {
  try { const parsed: unknown = JSON.parse(localStorage.getItem(WISHLIST_KEY) || localStorage.getItem('meridion-wishlist-v1') || '[]'); if (!Array.isArray(parsed)) return []; const entries = parsed.flatMap((entry): WishlistEntry[] => { if (typeof entry === 'string') return [{ productId: entry }]; if (!entry || typeof entry !== 'object' || typeof (entry as WishlistEntry).productId !== 'string') return []; const item = entry as WishlistEntry; return [{ productId: item.productId, ...(typeof item.variantId === 'string' ? { variantId: item.variantId } : {}) }] }); return [...new Map(entries.map((entry) => [entryKey(entry.productId, entry.variantId), entry])).values()] } catch { return [] }
}
function writeGuestWishlist(items: WishlistEntry[]) { try { localStorage.setItem(WISHLIST_KEY, JSON.stringify(items)) } catch { /* guest storage is optional */ } }
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { status, ensureProductsByIds } = useCatalog()
  const { user } = useAuth()
  const [items, setItems] = useState<WishlistEntry[]>(readGuestWishlist)
  const [syncError, setSyncError] = useState<string | null>(null)
  const previousUserIdRef = useRef<string | null>(null)
  const refresh = useCallback(async () => {
    if (!user) { const guest = readGuestWishlist(); await ensureProductsByIds(guest.map((item) => item.productId)); setItems(guest); return }
    try {
      const guest = readGuestWishlist()
      const remote = await listMyWishlistItems()
      const hydrated = await ensureProductsByIds([...guest, ...remote].map((item) => item.productId))
      const hydratedById = new Map(hydrated.map((product) => [product.id, product]))
      for (const item of guest) { const product = hydratedById.get(item.productId); if (product && (!item.variantId || product.variants.some((variant) => variant.id === item.variantId))) await addWishlistProduct(item.productId, item.variantId) }
      if (guest.length) { writeGuestWishlist([]); try { localStorage.removeItem('meridion-wishlist-v1') } catch { /* ignore */ } }
      setItems(remote); setSyncError(null)
    } catch (cause) { setSyncError(toUserErrorMessage(cause, 'Saved items could not be synchronized. Please try again.')) }
  }, [user, ensureProductsByIds])
  useEffect(() => { if (status === 'ready') void refresh() }, [refresh, status])
  useEffect(() => { if (user) { previousUserIdRef.current = user.id; return } if (previousUserIdRef.current) { previousUserIdRef.current = null; setItems(readGuestWishlist()); return } writeGuestWishlist(items) }, [items, user])
  const toggle = useCallback(async (productId: string, variantId?: string) => {
    const key = entryKey(productId, variantId)
    const wasSaved = items.some((item) => entryKey(item.productId, item.variantId) === key)
    if (!wasSaved) {
      try {
        const [product] = await ensureProductsByIds([productId])
        if (!product?.isPublished || (variantId && !product.variants.some((variant) => variant.id === variantId))) {
          setSyncError('This product is no longer available to save.')
          return false
        }
      } catch (cause) {
        setSyncError(toUserErrorMessage(cause, 'Saved items could not be updated. Please try again.'))
        return false
      }
    }
    setItems((current) => wasSaved ? current.filter((item) => entryKey(item.productId, item.variantId) !== key) : [...current, { productId, ...(variantId ? { variantId } : {}) }])
    if (!user) { setSyncError(null); return true }
    try { if (wasSaved) await removeWishlistProduct(productId, variantId); else await addWishlistProduct(productId, variantId); setSyncError(null); return true }
    catch (cause) { setItems((current) => wasSaved ? [...current, { productId, ...(variantId ? { variantId } : {}) }] : current.filter((item) => entryKey(item.productId, item.variantId) !== key)); setSyncError(toUserErrorMessage(cause, 'Saved items could not be updated. Please try again.')); return false }
  }, [ensureProductsByIds, items, user])
  const ids = [...new Set(items.map((item) => item.productId))]
  const value = useMemo(() => ({ ids, items, syncError, toggle, has: (productId: string, variantId?: string) => items.some((item) => entryKey(item.productId, item.variantId) === entryKey(productId, variantId)), refresh }), [ids.join('|'), items, syncError, toggle, refresh])
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}
export function useWishlist(): WishlistValue { const context = useContext(WishlistContext); if (!context) throw new Error('useWishlist must be used inside WishlistProvider'); return context }
