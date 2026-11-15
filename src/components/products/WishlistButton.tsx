import { Heart } from 'lucide-react'
import { useI18n } from '../../i18n/LocaleContext'
import { useToast } from '../../contexts/ToastContext'
import { useWishlist } from '../../contexts/WishlistContext'

export function WishlistButton({ productId, productName, variantId }: { productId: string; productName: string; variantId?: string }) {
  const { has, toggle } = useWishlist()
  const { t } = useI18n()
  const { push } = useToast()
  const saved = has(productId, variantId)
  async function handleToggle() {
    const updated = await toggle(productId, variantId)
    push(t(updated ? (saved ? 'Removed from wishlist.' : 'Added to wishlist.') : 'Wishlist update failed. Please try again.'), updated ? 'success' : 'error')
  }
  return (
    <button className={`icon-button wishlist-button${saved ? ' is-saved' : ''}`} type="button" onClick={() => { void handleToggle() }} aria-pressed={saved} aria-label={`${saved ? t('Remove') : t('Add')} ${productName} ${saved ? t('from') : t('to')} ${t('wishlist')}`}>
      <Heart size={17} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  )
}
