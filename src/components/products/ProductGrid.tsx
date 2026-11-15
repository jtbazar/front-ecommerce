import type { Product } from '../../types/product'
import { EmptyState } from '../common/States'
import { ProductCard } from './ProductCard'

export function ProductGrid({ products, emptyTitle = 'Nothing on this page yet', emptyDescription = 'Try another category or clear your filters.' }: { products: Product[]; emptyTitle?: string; emptyDescription?: string }) {
  if (products.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />
  return <div className="product-grid product-grid--uniform">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div>
}
