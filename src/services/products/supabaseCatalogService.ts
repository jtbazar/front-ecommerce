import { getSupabase } from '../../lib/supabase'
import type { Category } from '../../types/category'
import type { Database, Json } from '../../types/database'
import type { AvailabilityStatus, Product, ProductSpecification, ProductVariant } from '../../types/product'
import type { PublicShop } from '../../types/shop'

type ProductRow = Database['public']['Tables']['products']['Row']
type CategoryRow = Database['public']['Tables']['categories']['Row']
type ProductImageRow = Database['public']['Tables']['product_images']['Row']
type ProductVariantRow = Database['public']['Tables']['product_variants']['Row']
type AvailabilityRow = Database['public']['Functions']['get_public_availability']['Returns'][number]
type PublicInventoryRow = Database['public']['Functions']['get_public_inventory']['Returns'][number]
type PublicShopRow = Database['public']['Functions']['list_public_shops']['Returns'][number]

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

type JsonObject = { [key: string]: Json | undefined }

function jsonRecords(value: Json): JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is JsonObject => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
}

function mapSpecifications(value: Json): ProductSpecification[] {
  return jsonRecords(value).flatMap((entry) => {
    if (typeof entry.label !== 'string' || typeof entry.value !== 'string') return []
    return [{ label: entry.label, value: entry.value }]
  })
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    parentId: row.parent_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    eyebrow: row.eyebrow ?? 'Collection',
    image: row.image_url ?? undefined,
    isActive: row.is_active,
    isComingSoon: row.is_coming_soon,
    isFoodCategory: row.is_food_category,
    sortOrder: row.sort_order,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
  }
}

function mapShop(row: PublicShopRow): PublicShop {
  return {
    id: row.id,
    shopName: row.shop_name,
    slug: row.slug,
    description: row.description,
    createdAt: row.created_at,
    productCount: Number(row.product_count),
    shopImageUrl: row.shop_image_url,
    shopLocationLabel: row.shop_location_label,
    latitude: row.shop_lat,
    longitude: row.shop_lng,
  }
}

function mapImage(row: ProductImageRow): string {
  if (row.image_url) return /(?:placehold\.co|placehold\.it|via\.placeholder\.com)/i.test(row.image_url) ? '' : row.image_url
  if (row.storage_path) return getSupabase().storage.from('product-images').getPublicUrl(row.storage_path).data.publicUrl
  return ''
}

function productStatus(value: boolean | undefined, isKnown: boolean): Exclude<AvailabilityStatus, 'unavailable'> {
  if (!isKnown || value === undefined) return 'unknown'
  return value ? 'available' : 'out-of-stock'
}

function mapProduct(
  row: ProductRow,
  images: ProductImageRow[],
  variants: ProductVariantRow[],
  availabilityRows: AvailabilityRow[] | null,
  availabilityKnown: boolean,
  inventoryRows: PublicInventoryRow[] | null,
  shopsById: Map<string, PublicShop>,
): Product {
  const productAvailability = availabilityRows?.filter((item) => item.product_id === row.id) ?? []
  const availabilityByVariant = new Map(productAvailability.map((item) => [item.variant_id, item.is_available]))
  const inventoryByVariant = new Map((inventoryRows ?? []).filter((item) => item.product_id === row.id).map((item) => [item.variant_id, item.available_quantity]))
  const discountPercent = Number(row.discount_percent ?? 0)
  const originalProductPrice = row.food_unit_price === null ? Number(row.price) : Number(row.food_unit_price)
  const mappedVariants: ProductVariant[] = variants
    .filter((variant) => variant.is_active)
    .map((variant) => ({
      id: variant.id,
      label: variant.option_label,
      value: variant.option_value,
      ...(variant.price_override !== null ? { price: Number(variant.price_override) * (1 - discountPercent / 100), originalPrice: Number(variant.price_override) } : {}),
      ...(variant.sku ? { sku: variant.sku } : {}),
      availabilityStatus: productStatus(availabilityByVariant.get(variant.id), availabilityKnown),
      stockQuantity: inventoryByVariant.get(variant.id),
    }))

  let status: AvailabilityStatus
  if (mappedVariants.length) {
    if (!availabilityKnown) status = 'unknown'
    else if (mappedVariants.some((variant) => variant.availabilityStatus === 'available')) status = 'available'
    else if (mappedVariants.every((variant) => variant.availabilityStatus === 'out-of-stock')) status = 'out-of-stock'
    else status = 'unknown'
  } else {
    status = productStatus(availabilityByVariant.get(null), availabilityKnown)
  }

  const shop = row.seller_id ? shopsById.get(row.seller_id) : undefined

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.short_description,
    description: row.description,
    price: Number((originalProductPrice * (1 - discountPercent / 100)).toFixed(2)),
    originalPrice: originalProductPrice,
    discountPercent,
    foodSellingUnit: row.food_selling_unit as Product['foodSellingUnit'],
    foodUnitPrice: row.food_unit_price === null ? null : Number((Number(row.food_unit_price) * (1 - discountPercent / 100)).toFixed(2)),
    originalFoodUnitPrice: row.food_unit_price === null ? null : Number(row.food_unit_price),
    foodQuantityIncrement: row.food_quantity_increment,
    foodMinimumQuantity: row.food_minimum_quantity,
    isDailyItem: row.is_daily_item,
    dailyStatus: row.daily_status,
    dailyAvailableOn: row.daily_available_on,
    dailyAvailableQuantity: row.daily_available_quantity,
    currency: row.currency,
    categoryId: row.category_id ?? '',
    images: [...images].sort((a, b) => a.sort_order - b.sort_order).map(mapImage).filter(Boolean),
    specifications: mapSpecifications(row.specifications),
    variants: mappedVariants,
    isPublished: row.publication_status === 'published',
    availabilityStatus: status,
    isFeatured: row.is_featured,
    trackInventory: row.track_inventory,
    stockQuantity: mappedVariants.length ? undefined : inventoryByVariant.get(null),
    sellerId: row.seller_id,
    sellerName: shop?.shopName,
    sellerSlug: shop?.slug,
    createdAt: row.created_at,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
  }
}

async function loadSupabaseCatalog() {
  const client = getSupabase()
  const [productResult, categoryResult, shopResult] = await Promise.all([
    client.from('products')
      .select('id, category_id, seller_id, name, slug, sku, short_description, description, price, discount_percent, food_selling_unit, food_unit_price, food_quantity_increment, food_minimum_quantity, is_daily_item, daily_available_quantity, daily_minimum_quantity, daily_available_on, daily_status, currency, specifications, publication_status, moderation_status, stock_verification_status, is_featured, track_inventory, seo_title, seo_description, created_at')
      .eq('publication_status', 'published')
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: false }),
    client.from('categories')
      .select('id, parent_id, name, slug, description, eyebrow, image_url, is_active, is_coming_soon, is_food_category, sort_order, seo_title, seo_description, created_at, updated_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    client.rpc('list_public_shops'),
  ])
  throwIfError(productResult.error)
  throwIfError(categoryResult.error)

  const productRows = (productResult.data ?? []) as ProductRow[]
  const categories = (categoryResult.data ?? []).map(mapCategory)
  const shops = shopResult.error ? [] : (shopResult.data ?? []).map(mapShop)
  const shopsById = new Map(shops.map((shop) => [shop.id, shop]))
  if (productRows.length === 0) return { products: [] as Product[], categories, shops }

  const productIds = productRows.map((product) => product.id)
  const [imageResult, variantResult, availabilityResult, inventoryResult] = await Promise.all([
    client.from('product_images')
      .select('id, product_id, image_url, storage_path, alt_text, sort_order, is_primary, created_at')
      .in('product_id', productIds)
      .order('sort_order', { ascending: true }),
    client.from('product_variants')
      .select('id, product_id, option_label, option_value, sku, price_override, attributes, is_active, sort_order, created_at, updated_at')
      .in('product_id', productIds)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    client.rpc('get_public_availability', { product_ids: productIds }),
    client.rpc('get_public_inventory', { product_ids: productIds }),
  ])
  throwIfError(imageResult.error)
  throwIfError(variantResult.error)

  const images = (imageResult.data ?? []) as ProductImageRow[]
  const variants = (variantResult.data ?? []) as ProductVariantRow[]
  const availabilityRows = availabilityResult.error ? null : availabilityResult.data as AvailabilityRow[]
  const availabilityKnown = !availabilityResult.error
  const inventoryRows = inventoryResult.error ? null : inventoryResult.data as PublicInventoryRow[]
  const imagesByProduct = new Map<string, ProductImageRow[]>()
  const variantsByProduct = new Map<string, ProductVariantRow[]>()
  for (const image of images) imagesByProduct.set(image.product_id, [...(imagesByProduct.get(image.product_id) ?? []), image])
  for (const variant of variants) variantsByProduct.set(variant.product_id, [...(variantsByProduct.get(variant.product_id) ?? []), variant])

  return {
    products: productRows.map((product) => mapProduct(
      product,
      imagesByProduct.get(product.id) ?? [],
      variantsByProduct.get(product.id) ?? [],
      availabilityRows,
      availabilityKnown,
      inventoryRows,
      shopsById,
    )),
    categories,
    shops,
  }
}

export const catalogService = {
  loadCatalog: loadSupabaseCatalog,
}


export type PublicProductPageOptions = {
  page?: number
  pageSize?: number
  categoryId?: string | null
  search?: string
  maxPrice?: number
  sort?: 'featured' | 'newest' | 'price-low' | 'price-high'
}

export type PublicProductPage = {
  products: Product[]
  count: number
  page: number
  pageSize: number
  hasMore: boolean
}

/**
 * Fetch one bounded page of published products. Related records are queried only
 * for IDs in this page, so large catalogues never fan out into unbounded requests.
 */
export async function loadPublicProductsPage(options: PublicProductPageOptions = {}): Promise<PublicProductPage> {
  const client = getSupabase()
  const pageSize = Math.min(24, Math.max(1, Math.floor(options.pageSize ?? 12)))
  const page = Math.max(0, Math.floor(options.page ?? 0))
  const from = page * pageSize
  const to = from + pageSize - 1

  let query = client.from('products')
    .select('id, category_id, seller_id, name, slug, sku, short_description, description, price, discount_percent, food_selling_unit, food_unit_price, food_quantity_increment, food_minimum_quantity, is_daily_item, daily_available_quantity, daily_minimum_quantity, daily_available_on, daily_status, currency, specifications, publication_status, moderation_status, stock_verification_status, is_featured, track_inventory, seo_title, seo_description, created_at', { count: 'exact' })
    .eq('publication_status', 'published')
    .eq('moderation_status', 'approved')

  if (options.categoryId) query = query.eq('category_id', options.categoryId)
  const term = options.search?.trim().replace(/[,%]/g, ' ').slice(0, 80)
  if (term) query = query.or(`name.ilike.%${term}%,short_description.ilike.%${term}%`)
  if (Number.isFinite(options.maxPrice) && (options.maxPrice ?? 0) > 0) query = query.or(`and(price.lte.${options.maxPrice},food_unit_price.is.null),food_unit_price.lte.${options.maxPrice}`)
  if (options.sort === 'price-low') query = query.order('price', { ascending: true })
  else if (options.sort === 'price-high') query = query.order('price', { ascending: false })
  else if (options.sort === 'featured') query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: false })
  else query = query.order('created_at', { ascending: false })

  const { data, error, count } = await query.range(from, to)
  throwIfError(error)
  const rows = (data ?? []) as ProductRow[]
  if (!rows.length) return { products: [], count: count ?? 0, page, pageSize, hasMore: from + rows.length < (count ?? 0) }

  const ids = rows.map((row) => row.id)
  const sellerIds = [...new Set(rows.map((row) => row.seller_id).filter((id): id is string => Boolean(id)))]
  const [imageResult, variantResult, availabilityResult, inventoryResult, shopResult] = await Promise.all([
    client.from('product_images').select('id, product_id, image_url, storage_path, alt_text, sort_order, is_primary, created_at').in('product_id', ids).order('sort_order', { ascending: true }),
    client.from('product_variants').select('id, product_id, option_label, option_value, sku, price_override, attributes, is_active, sort_order, created_at, updated_at').in('product_id', ids).eq('is_active', true).order('sort_order', { ascending: true }),
    client.rpc('get_public_availability', { product_ids: ids }),
    client.rpc('get_public_inventory', { product_ids: ids }),
    client.rpc('list_public_shops'),
  ])
  throwIfError(imageResult.error)
  throwIfError(variantResult.error)
  const shops = shopResult.error ? [] : (shopResult.data ?? []).map(mapShop).filter((shop) => sellerIds.includes(shop.id))
  const shopsById = new Map(shops.map((shop) => [shop.id, shop]))
  const images = (imageResult.data ?? []) as ProductImageRow[]
  const variants = (variantResult.data ?? []) as ProductVariantRow[]
  const availabilityRows = availabilityResult.error ? null : availabilityResult.data as AvailabilityRow[]
  const inventoryRows = inventoryResult.error ? null : inventoryResult.data as PublicInventoryRow[]
  const imagesByProduct = new Map<string, ProductImageRow[]>()
  const variantsByProduct = new Map<string, ProductVariantRow[]>()
  for (const image of images) imagesByProduct.set(image.product_id, [...(imagesByProduct.get(image.product_id) ?? []), image])
  for (const variant of variants) variantsByProduct.set(variant.product_id, [...(variantsByProduct.get(variant.product_id) ?? []), variant])
  const products = rows.map((row) => mapProduct(row, imagesByProduct.get(row.id) ?? [], variantsByProduct.get(row.id) ?? [], availabilityRows, !availabilityResult.error, inventoryRows, shopsById))
  return { products, count: count ?? products.length, page, pageSize, hasMore: from + products.length < (count ?? products.length) }
}
