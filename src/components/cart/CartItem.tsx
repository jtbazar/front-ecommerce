import { BookOpen, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n/LocaleContext'
import { useToast } from '../../contexts/ToastContext'
import type { CartLine } from '../../types/cart'
import { useCatalog } from '../../contexts/CatalogContext'
import { formatPKR } from '../../utils/money'
import { QuantitySelector } from '../products/QuantitySelector'
import { getCartLineMaxQuantity, getFoodQuantityLabel, isCartLineAvailable } from '../../utils/cart'
import { getCartLineUnitPrice } from '../../utils/cart'

export function CartItem({ line, onQuantity, onRemove, compact = false }: { line: CartLine; onQuantity?: (quantity: number) => void; onRemove: () => void; compact?: boolean }) {
  const { findProductById } = useCatalog()
  const product = findProductById(line.productId)
  const variant = product?.variants.find((item) => item.id === line.variantId)
  const unitPrice = getCartLineUnitPrice(product, line)
  const [imageFailed, setImageFailed] = useState(false)
  const { t } = useI18n()
  const { push } = useToast()
  const available = isCartLineAvailable(product, line)

  function handleRemove() {
    onRemove()
    push(t('Removed from your cart.'))
  }

  if (!product) {
    return <article className="cart-item cart-item--unavailable">
      <div className="cart-item__image cart-item__image--fallback"><BookOpen size={24} aria-hidden="true" /></div>
      <div className="cart-item__body">
        <strong>{t('This item is no longer in the published catalog')}</strong>
        <p className="cart-item__note">{t('Remove it to continue with the rest of your cart.')}</p>
        <button type="button" className="text-button" onClick={handleRemove}><Trash2 size={14} /> {t('Remove')}</button>
      </div>
    </article>
  }

  const name = t(product.name)
  return <article className={`cart-item${compact ? ' cart-item--compact' : ''}`}>
    <Link to={`/products/${product.slug}`} className="cart-item__image">
      {imageFailed || !product.images[0]
        ? <span className="cart-item__fallback"><BookOpen size={24} aria-hidden="true" /></span>
        : <img src={product.images[0]} alt="" onError={() => setImageFailed(true)} />}
    </Link>
    <div className="cart-item__body">
      <div className="cart-item__topline">
        <div>
          <Link to={`/products/${product.slug}`} className="cart-item__name">{name}</Link>
          {variant && <p className="cart-item__variant">{t(variant.label)}: {t(variant.value)}</p>}
          {!available && <p className="cart-item__note cart-item__note--warning">{t('Unavailable at this time')}</p>}
        </div>
        <strong className="cart-item__price">{formatPKR(unitPrice * line.quantity)}</strong>
      </div>
      <div className="cart-item__controls">
        {onQuantity ? <QuantitySelector value={line.quantity} min={Math.min(product.foodMinimumQuantity ?? 1, getCartLineMaxQuantity(product, line) || 1)} max={getCartLineMaxQuantity(product, line)} displayValue={product.foodSellingUnit ? getFoodQuantityLabel(product, line.quantity) : undefined} onChange={onQuantity} label={`${t('Quantity for')} ${name}`} /> : <span className="cart-item__quantity-readonly">{t('Quantity')}: {product.foodSellingUnit ? getFoodQuantityLabel(product, line.quantity) : line.quantity}</span>}
        <button type="button" className="text-button" onClick={handleRemove}><Trash2 size={14} /> {t('Remove')}</button>
      </div>
    </div>
  </article>
}


export function CartItemGroup({ lines, onQuantity, onRemove }: { lines: CartLine[]; onQuantity: (line: CartLine, quantity: number) => void; onRemove: (line: CartLine) => void }) {
  const { findProductById } = useCatalog()
  const { t } = useI18n()
  const { push } = useToast()
  const product = findProductById(lines[0]?.productId ?? '')
  const [imageFailed, setImageFailed] = useState(false)
  if (!product) return <>{lines.map((line) => <CartItem key={line.productId + '-' + (line.variantId ?? 'default')} line={line} onQuantity={(quantity) => onQuantity(line, quantity)} onRemove={() => onRemove(line)} />)}</>
  const total = lines.reduce((sum, line) => sum + getCartLineUnitPrice(product, line) * line.quantity, 0)
  return <article className="cart-item cart-item--group">
    <Link to={'/products/' + product.slug} className="cart-item__image">
      {imageFailed || !product.images[0] ? <span className="cart-item__fallback"><BookOpen size={24} aria-hidden="true" /></span> : <img src={product.images[0]} alt="" onError={() => setImageFailed(true)} />}
    </Link>
    <div className="cart-item__body">
      <div className="cart-item__topline"><div><Link to={'/products/' + product.slug} className="cart-item__name">{t(product.name)}</Link><p className="cart-item__variant">{lines.length} {t('selected option(s)')}</p></div><strong className="cart-item__price">{formatPKR(total)}</strong></div>
      <div className="cart-item-group__options">
        {lines.map((line) => {
          const variant = product.variants.find((entry) => entry.id === line.variantId)
          const max = getCartLineMaxQuantity(product, line)
          const available = isCartLineAvailable(product, line)
          return <div className="cart-item-group__option" key={line.productId + '-' + (line.variantId ?? 'default')}>
            <div className="cart-item-group__option-info"><span>{variant ? t(variant.label) + ': ' + t(variant.value) : t('Standard item')}{!available && <small className="cart-item__note cart-item__note--warning">{t('Unavailable at this time')}</small>}</span><strong>{formatPKR(getCartLineUnitPrice(product, line) * line.quantity)}</strong></div>
            <div className="cart-item__controls"><QuantitySelector value={line.quantity} min={variant ? 1 : Math.min(product.foodMinimumQuantity ?? 1, max || 1)} max={max} displayValue={!variant && product.foodSellingUnit ? getFoodQuantityLabel(product, line.quantity) : undefined} onChange={(quantity) => onQuantity(line, quantity)} label={t('Quantity for') + ' ' + product.name + (variant ? ' ' + variant.value : '')} /><button type="button" className="text-button" onClick={() => { onRemove(line); push(t('Removed from your cart.')) }}><Trash2 size={14} /> {t('Remove option')}</button></div>
          </div>
        })}
      </div>
    </div>
  </article>
}
