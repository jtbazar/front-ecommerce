import { getSupabase } from '../../lib/supabase'
import type { Database, Json } from '../../types/database'
import { notifySupportEmail } from '../account/supportService'

export type SellerProfile = Database['public']['Tables']['seller_profiles']['Row']
export type VendorProduct = Database['public']['Tables']['products']['Row']
export type VendorInventory = Database['public']['Tables']['product_inventory']['Row'] & { product_name: string; variant_name: string | null }
export type MarketplaceCase = Database['public']['Tables']['marketplace_cases']['Row']
export type VendorOrderItem = Database['public']['Functions']['vendor_order_items']['Returns'][number]
export type VendorSupportTicket = Database['public']['Tables']['support_tickets']['Row']

const SELLER_COLUMNS = 'id, user_id, shop_name, slug, description, current_address, complete_address, contact_email, phone, document_path, shop_image_url, shop_lat, shop_lng, shop_location_label, show_shop_on_map, vendor_type, owner_full_name, cnic_number, cnic_front_path, cnic_back_path, shop_location_text, status, rejection_reason, reviewed_by, reviewed_at, vendor_locked, vendor_locked_at, vendor_locked_by, vendor_lock_reason, created_at, updated_at'
const CASE_COLUMNS = 'id, order_id, order_item_id, buyer_id, seller_id, case_type, status, reason, evidence_path, seller_response, admin_decision, decided_by, decided_at, created_at, updated_at'

export interface VendorShopInput {
  shop_name: string
  slug: string
  description: string
  current_address?: string
  complete_address?: string
  contact_email: string | null
  phone: string | null
  shop_image_url?: string | null
  shop_lat?: number | null
  shop_lng?: number | null
  shop_location_label?: string
  show_shop_on_map?: boolean
  vendor_type?: string
  owner_full_name?: string
  cnic_number?: string
  cnic_front_path?: string | null
  cnic_back_path?: string | null
  shop_location_text?: string
}

export async function uploadVendorShopImage(file: File): Promise<{ path: string; url: string }> {
  if (file.size > 5 * 1024 * 1024) throw new Error('Shop images must be 5 MB or smaller.')
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) throw new Error('Choose a JPG, PNG, WebP or AVIF shop image.')
  const client = getSupabase()
  const user = (await client.auth.getUser()).data.user
  if (!user) throw new Error('Sign in before uploading a shop image.')
  const path = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
  const { error } = await client.storage.from('shop-images').upload(path, file, { upsert: false, contentType: file.type })
  assertError(error)
  return { path, url: client.storage.from('shop-images').getPublicUrl(path).data.publicUrl }
}

export async function removeVendorShopImage(path: string): Promise<void> {
  const { error } = await getSupabase().storage.from('shop-images').remove([path])
  assertError(error)
}

export async function removeVendorDocument(path: string): Promise<void> {
  const { error } = await getSupabase().storage.from('vendor-documents').remove([path])
  assertError(error)
}

function assertError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function uploadVendorDocument(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Verification documents must be 10 MB or smaller.')
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Verification documents must be a PDF, JPG, PNG or WebP file.')
  }
  const client = getSupabase()
  const user = (await client.auth.getUser()).data.user
  if (!user) throw new Error('Sign in required before uploading verification documents.')

  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`

  const { error } = await client.storage.from('vendor-documents').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  })

  assertError(error)
  return path
}

export async function uploadVendorCnicImage(file: File, side: 'cnic-front' | 'cnic-back'): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('CNIC images must be 10 MB or smaller.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('CNIC images must be JPG, PNG or WebP.')
  const client = getSupabase()
  const user = (await client.auth.getUser()).data.user
  if (!user) throw new Error('Sign in before uploading CNIC images.')
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
  const path = `${user.id}/${side}-${Date.now()}-${crypto.randomUUID()}.${ext}`
  const { error } = await client.storage.from('vendor-documents').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
  assertError(error)
  return path
}

export async function getOwnSellerDocumentUrls(paths: { cnicFront?: string | null; cnicBack?: string | null; verification?: string | null }): Promise<{ cnicFront: string | null; cnicBack: string | null; verification: string | null }> {
  const client = getSupabase()
  const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    if (!path) return [key, null] as const
    const { data, error } = await client.storage.from('vendor-documents').createSignedUrl(path, 300)
    if (error) return [key, null] as const
    return [key, data.signedUrl] as const
  }))
  return Object.fromEntries(entries) as { cnicFront: string | null; cnicBack: string | null; verification: string | null }
}

export async function getOwnSellerProfile(): Promise<SellerProfile | null> {
  const client = getSupabase()
  const user = (await client.auth.getUser()).data.user
  if (!user) return null
  const { data, error } = await client.from('seller_profiles').select(SELLER_COLUMNS).eq('user_id', user.id).maybeSingle()
  assertError(error)
  return data as SellerProfile | null
}

export async function applyAsSeller(input: VendorShopInput & { current_address: string; complete_address: string; document_path?: string | null }): Promise<SellerProfile> {
  const user = (await getSupabase().auth.getUser()).data.user
  if (!user) throw new Error('Sign in before applying as a vendor.')
  const accountEmail = (user.email ?? '').trim().toLowerCase()
  if (!accountEmail || !user.email_confirmed_at) throw new Error('Verify your JTBazar account email before applying as a seller.')
  if ((input.contact_email ?? '').trim().toLowerCase() !== accountEmail) {
    throw new Error('Seller application email must match the email address of your signed-in JTBazar account.')
  }
  const existing = await getOwnSellerProfile()
  if (existing) {
    throw new Error(`A seller application already exists with status: ${existing.status}. Open your seller application to review or update it.`)
  }
  const { data, error } = await (getSupabase() as any).from('seller_profiles').insert({
    user_id: user.id,
    shop_name: input.shop_name,
    slug: input.slug,
    description: input.description,
    current_address: input.current_address,
    complete_address: input.complete_address,
    shop_location_label: input.current_address,
    contact_email: input.contact_email,
    phone: input.phone,
    ...(input.shop_image_url !== undefined ? { shop_image_url: input.shop_image_url } : {}),
    ...(input.shop_lat !== undefined ? { shop_lat: input.shop_lat } : {}),
    ...(input.shop_lng !== undefined ? { shop_lng: input.shop_lng } : {}),
    ...(input.shop_location_label !== undefined ? { shop_location_label: input.shop_location_label } : {}),
    ...(input.show_shop_on_map !== undefined ? { show_shop_on_map: input.show_shop_on_map } : {}),
    document_path: input.document_path ?? null,
    vendor_type: input.vendor_type,
    owner_full_name: input.owner_full_name,
    cnic_number: input.cnic_number,
    cnic_front_path: input.cnic_front_path,
    cnic_back_path: input.cnic_back_path,
    shop_location_text: input.shop_location_text,
  }).select(SELLER_COLUMNS).single()
  assertError(error)
  if (!data) throw new Error('The seller application was not created.')
  return data as SellerProfile
}

export async function updateOwnShop(input: VendorShopInput & { document_path?: string | null }): Promise<SellerProfile> {
  const user = (await getSupabase().auth.getUser()).data.user
  if (!user) throw new Error('Sign in before updating your shop.')
  const accountEmail = (user.email ?? '').trim().toLowerCase()
  if (!accountEmail || !user.email_confirmed_at) throw new Error('Verify your JTBazar account email before updating seller details.')
  if ((input.contact_email ?? '').trim().toLowerCase() !== accountEmail) {
    throw new Error('Seller contact email must match the email address of your signed-in JTBazar account.')
  }
  const { data, error } = await (getSupabase() as any).from('seller_profiles').update({
    shop_name: input.shop_name,
    slug: input.slug,
    description: input.description,
    ...(input.current_address !== undefined ? { current_address: input.current_address } : {}),
    ...(input.complete_address !== undefined ? { complete_address: input.complete_address } : {}),
    contact_email: input.contact_email,
    phone: input.phone,
    ...(input.shop_image_url !== undefined ? { shop_image_url: input.shop_image_url } : {}),
    ...(input.shop_lat !== undefined ? { shop_lat: input.shop_lat } : {}),
    ...(input.shop_lng !== undefined ? { shop_lng: input.shop_lng } : {}),
    ...(input.shop_location_label !== undefined ? { shop_location_label: input.shop_location_label } : {}),
    ...(input.show_shop_on_map !== undefined ? { show_shop_on_map: input.show_shop_on_map } : {}),
    ...(input.document_path ? { document_path: input.document_path } : {}),
    ...(input.vendor_type !== undefined ? { vendor_type: input.vendor_type } : {}),
    ...(input.owner_full_name !== undefined ? { owner_full_name: input.owner_full_name } : {}),
    ...(input.cnic_number !== undefined ? { cnic_number: input.cnic_number } : {}),
    ...(input.cnic_front_path !== undefined ? { cnic_front_path: input.cnic_front_path } : {}),
    ...(input.cnic_back_path !== undefined ? { cnic_back_path: input.cnic_back_path } : {}),
    ...(input.shop_location_text !== undefined ? { shop_location_text: input.shop_location_text } : {}),
  }).eq('user_id', user.id).select(SELLER_COLUMNS).single()
  assertError(error)
  if (!data) throw new Error('The shop profile was not updated.')
  return data as SellerProfile
}

export async function resubmitSellerApplication(): Promise<SellerProfile> {
  const { data, error } = await getSupabase().rpc('seller_resubmit_application')
  assertError(error)
  const row = data as SellerProfile | null
  if (!row) throw new Error('The application could not be resubmitted.')
  return row
}

export async function listOwnProducts(): Promise<VendorProduct[]> {
  const { data, error } = await getSupabase().rpc('vendor_list_products')
  assertError(error)
  return (data ?? []).map((product: any) => {
    const multiplier = 1 + Number(product.commission_percent ?? 0) / 100
    return {
      ...product,
      price: Number(product.vendor_base_price ?? product.price),
      food_unit_price: product.food_unit_price == null ? null : Number((Number(product.food_unit_price) / multiplier).toFixed(2)),
    }
  }) as VendorProduct[]
}

export async function listOwnProductImageUrls(productId: string): Promise<string[]> {
  const client = getSupabase()
  const { data, error } = await client.from('product_images')
    .select('image_url, storage_path, sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .limit(8)
  assertError(error)
  return (data ?? []).map((image) => image.image_url || (image.storage_path
    ? client.storage.from('product-images').getPublicUrl(image.storage_path).data.publicUrl
    : '')).filter(Boolean)
}

export type VendorProductVariantInput = {
  id?: string | null
  option_label: string
  option_value: string
  sku: string | null
  price_override: number | null
  attributes?: Record<string, unknown>
  quantity: number
}

export async function listOwnProductVariants(productId: string): Promise<VendorProductVariantInput[]> {
  const client = getSupabase()
  const [variants, inventory, product] = await Promise.all([
    client.from('product_variants').select('id, option_label, option_value, sku, price_override, attributes, sort_order')
      .eq('product_id', productId).order('sort_order').limit(100),
    client.from('product_inventory').select('variant_id, quantity').eq('product_id', productId).limit(100),
    (client as any).from('products').select('commission_percent').eq('id', productId).maybeSingle(),
  ])
  assertError(variants.error)
  assertError(inventory.error)
  assertError(product.error)
  const stockByVariant = new Map((inventory.data ?? []).map((row) => [row.variant_id, row.quantity]))
  const commissionMultiplier = 1 + Number(product.data?.commission_percent ?? 0) / 100
  return (variants.data ?? []).map((row) => ({
    id: row.id,
    option_label: row.option_label,
    option_value: row.option_value,
    sku: row.sku,
    price_override: row.price_override == null ? null : Number((Number(row.price_override) / commissionMultiplier).toFixed(2)),
    attributes: row.attributes as unknown as Record<string, unknown>,
    quantity: stockByVariant.get(row.id) ?? 0,
  }))
}

export async function saveOwnProductVariants(productId: string, variants: VendorProductVariantInput[]): Promise<void> {
  if (variants.length > 100) throw new Error('A product can have no more than 100 variants.')
  const seen = new Set<string>()
  for (const variant of variants) {
    const label = variant.option_label.trim()
    const value = variant.option_value.trim()
    const key = `${label.toLocaleLowerCase()}::${value.toLocaleLowerCase()}`
    if (!label || !value) throw new Error('Every variant needs an option name and value.')
    if (seen.has(key)) throw new Error('Duplicate variant option and value. Please make each variant unique.')
    seen.add(key)
    if (!Number.isInteger(variant.quantity) || variant.quantity < 0) throw new Error('Variant stock must be a whole number of zero or more.')
    if (variant.price_override !== null && (!Number.isFinite(variant.price_override) || variant.price_override < 0)) throw new Error('Enter a valid variant price.')
  }
  const { error } = await (getSupabase() as any).rpc('vendor_save_product_variants', {
    p_product_id: productId,
    p_variants: variants.map((variant) => ({
      id: variant.id && !variant.id.startsWith('new-') ? variant.id : null,
      option_label: variant.option_label.trim(),
      option_value: variant.option_value.trim(),
      sku: variant.sku?.trim() || null,
      price_override: variant.price_override,
      attributes: variant.attributes ?? {},
      quantity: variant.quantity,
    })),
  })
  assertError(error)
}

export async function createVendorProduct(input: {
  category_id: string | null
  name: string
  slug: string
  sku: string | null
  short_description: string
  description: string
  price: number
  supplier_cost: number | null
  fulfillment_expense: number
  minimum_profit: number
  track_inventory: boolean
  discount_percent: number
  weight_grams: number | null
  specifications: Json
  dimensions: Json
  seo_title: string | null
  seo_description: string | null
  initial_stock: number
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('vendor_create_product', {
    p_category_id: input.category_id,
    p_name: input.name,
    p_slug: input.slug,
    p_sku: input.sku,
    p_short_description: input.short_description,
    p_description: input.description,
    p_price: input.price,
    p_supplier_cost: input.supplier_cost,
    p_fulfillment_expense: input.fulfillment_expense,
    p_minimum_profit: input.minimum_profit,
    p_track_inventory: input.track_inventory,
    p_discount_percent: input.discount_percent,
    p_weight_grams: input.weight_grams,
    p_specifications: input.specifications,
    p_dimensions: input.dimensions,
    p_seo_title: input.seo_title,
    p_seo_description: input.seo_description,
    p_initial_stock: input.initial_stock,
  })
  assertError(error)
  if (!data) throw new Error('The product was not created.')
  return data
}

export async function uploadOwnProductImage(productId: string, file: File, altText: string): Promise<void> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Product images must be 10 MB or smaller.')
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG, WebP or AVIF product image.')
  }

  const client = getSupabase()
  const user = (await client.auth.getUser()).data.user
  if (!user) throw new Error('Sign in before uploading a product image.')

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  const path = `${user.id}/${productId}/${crypto.randomUUID()}-${safeName}`
  const { error: uploadError } = await client.storage.from('product-images').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  })
  assertError(uploadError)

  const { data: lastImage, error: listError } = await client.from('product_images')
    .select('sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (listError) {
    await client.storage.from('product-images').remove([path])
    throw new Error(listError.message)
  }

  const { error: imageError } = await client.from('product_images').insert({
    product_id: productId,
    storage_path: path,
    alt_text: altText.slice(0, 200),
    sort_order: (lastImage?.sort_order ?? -1) + 1,
    is_primary: !lastImage,
  })
  if (imageError) {
    await client.storage.from('product-images').remove([path])
    if (imageError.code === '42501') {
      throw new Error('The image uploaded, but Supabase blocked attaching it to this seller listing. The vendor product-image permissions must be applied first.')
    }
    throw new Error(imageError.message)
  }
}

export async function updateVendorProduct(productId: string, input: {
  category_id: string | null
  name: string
  slug: string
  sku: string | null
  short_description: string
  description: string
  price: number
  supplier_cost: number | null
  fulfillment_expense: number
  minimum_profit: number
  discount_percent: number
  weight_grams: number | null
  specifications: Json
  dimensions: Json
  seo_title: string | null
  seo_description: string | null
}): Promise<VendorProduct> {
  const { data, error } = await getSupabase().rpc('vendor_update_product', {
    p_product_id: productId,
    p_category_id: input.category_id,
    p_name: input.name,
    p_slug: input.slug,
    p_sku: input.sku,
    p_short_description: input.short_description,
    p_description: input.description,
    p_price: input.price,
    p_supplier_cost: input.supplier_cost,
    p_fulfillment_expense: input.fulfillment_expense,
    p_minimum_profit: input.minimum_profit,
    p_discount_percent: input.discount_percent,
    p_weight_grams: input.weight_grams,
    p_specifications: input.specifications,
    p_dimensions: input.dimensions,
    p_seo_title: input.seo_title,
    p_seo_description: input.seo_description,
  })
  assertError(error)
  if (!data) throw new Error('The product was not updated.')
  return data as VendorProduct
}

export async function setVendorProductVisibility(productId: string, hidden: boolean): Promise<VendorProduct> {
  const { data, error } = await getSupabase().rpc('vendor_set_product_visibility', {
    p_product_id: productId,
    p_hidden: hidden,
  })
  assertError(error)
  if (!data) throw new Error('Product visibility could not be updated.')
  return data as VendorProduct
}

export async function setVendorDailyAvailability(input: {
  productId: string
  isDailyItem: boolean
  availableQuantity: number
  minimumQuantity?: number
  minimumOrderValue?: number | null
  shopIsOpen?: boolean | null
}): Promise<VendorProduct> {
  if (!Number.isInteger(input.availableQuantity) || input.availableQuantity < 0) {
    throw new Error('Daily availability must be a whole number of zero or more.')
  }
  if (!Number.isInteger(input.minimumQuantity ?? 1) || (input.minimumQuantity ?? 1) < 1) {
    throw new Error('Minimum quantity must be at least one.')
  }
  if (input.minimumOrderValue != null && input.minimumOrderValue < 0) {
    throw new Error('Minimum order value cannot be negative.')
  }
  const { data, error } = await getSupabase().rpc('vendor_set_daily_availability', {
    p_product_id: input.productId,
    p_is_daily_item: input.isDailyItem,
    p_available_quantity: input.availableQuantity,
    p_minimum_quantity: input.minimumQuantity ?? 1,
    p_minimum_order_value: input.minimumOrderValue ?? null,
    p_shop_is_open: input.shopIsOpen ?? null,
  })
  assertError(error)
  if (!data) throw new Error('Daily availability could not be saved.')
  return data as VendorProduct
}

export async function markVendorOrderReady(orderId: string, note?: string): Promise<void> {
  const { data, error } = await getSupabase().rpc('vendor_mark_order_ready', {
    p_order_id: orderId,
    p_vendor_note: note?.trim() || null,
  })
  assertError(error)
  if (!data) throw new Error('Order could not be marked ready for pickup.')
}

export async function listOwnInventory(): Promise<VendorInventory[]> {
  const { data, error } = await getSupabase().from('product_inventory')
    .select('id, product_id, variant_id, quantity, low_stock_threshold, updated_at, products!inner(name, seller_id), product_variants(option_label, option_value)')
    .order('updated_at', { ascending: false })
    .limit(200)
  assertError(error)
  return (data ?? []).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products
    const variant = Array.isArray(row.product_variants) ? row.product_variants[0] : row.product_variants
    return {
      id: row.id,
      product_id: row.product_id,
      variant_id: row.variant_id,
      quantity: row.quantity,
      low_stock_threshold: row.low_stock_threshold,
      updated_at: row.updated_at,
      product_name: product?.name ?? 'Unknown product',
      variant_name: variant ? `${variant.option_label}: ${variant.option_value}` : null,
    }
  })
}

export async function adjustOwnInventory(id: string, quantity: number, note: string): Promise<void> {
  const { error } = await getSupabase().rpc('vendor_adjust_inventory', { p_inventory_id: id, p_new_quantity: quantity, p_note: note })
  assertError(error)
}

export async function setOwnProductInventory(productId: string, quantity: number, note: string, variantId: string | null = null): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error('Stock must be a whole number of zero or more.')
  const { error } = await getSupabase().rpc('vendor_set_product_inventory', {
    p_product_id: productId, p_variant_id: variantId, p_new_quantity: quantity, p_note: note.trim(),
  })
  assertError(error)
}

export async function requestOwnProductDeletion(productId: string, reason: string): Promise<void> {
  if (reason.trim().length < 3) throw new Error('Please provide a reason for the deletion request.')
  const { error } = await getSupabase().rpc('vendor_request_product_deletion', { p_product_id: productId, p_reason: reason.trim() })
  assertError(error)
}

export async function listOwnProductDeletionRequests(): Promise<Array<{ product_id: string; status: string }>> {
  const { data, error } = await getSupabase().from('product_deletion_requests').select('product_id,status').order('created_at', { ascending: false }).limit(200)
  assertError(error)
  return data ?? []
}

export async function listOwnCases(): Promise<MarketplaceCase[]> {
  const { data, error } = await getSupabase().from('marketplace_cases').select(CASE_COLUMNS).order('created_at', { ascending: false }).limit(100)
  assertError(error)
  return (data ?? []) as MarketplaceCase[]
}

export async function respondToCase(id: string, sellerResponse: string): Promise<void> {
  if (sellerResponse.trim().length < 3) throw new Error('Add a short response before sending.')
  const { error } = await getSupabase().from('marketplace_cases')
    .update({ seller_response: sellerResponse.trim(), status: 'seller_responded' })
    .eq('id', id)
  assertError(error)
}

export async function listOwnSupportTickets(): Promise<VendorSupportTicket[]> {
  const { data, error } = await getSupabase().from('support_tickets').select('*').order('created_at', { ascending: false }).limit(100)
  assertError(error)
  return data ?? []
}

export async function createOwnSupportTicket(sellerId: string, subject: string, message: string): Promise<boolean> {
  const client = getSupabase()
  const user = (await client.auth.getUser()).data.user
  if (!user) throw new Error('Sign in before creating a support ticket.')
  const { data, error } = await client.from('support_tickets').insert({ seller_id: sellerId, created_by: user.id, subject: subject.trim(), message: message.trim() }).select('id').single()
  assertError(error)
  if (!data) throw new Error('Support ticket could not be confirmed.')
  return notifySupportEmail(data.id, 'seller', 'created')
}

export async function getCaseEvidenceUrl(path: string): Promise<string | null> {
  const { data, error } = await getSupabase().storage.from('complaint-evidence').createSignedUrl(path, 600)
  if (error || !data) return null
  return data.signedUrl
}

export async function listOwnOrderItems(options: { page?: number; pageSize?: number; search?: string; status?: string } = {}): Promise<VendorOrderItem[]> {
  const pageSize = Math.max(1, Math.min(15, options.pageSize ?? 12))
  const page = Math.max(0, options.page ?? 0)
  const { data, error } = await getSupabase().rpc('vendor_order_items_page', {
    p_limit: pageSize,
    p_offset: page * pageSize,
    p_search: options.search?.trim() || null,
    p_status: options.status && options.status !== 'all' ? options.status : null,
  })
  assertError(error)
  return (data ?? []) as VendorOrderItem[]
}



export async function setVendorFoodProductDetails(input: { productId: string; sellingUnit: string; unitPrice: number; quantityIncrement: number; minimumQuantity: number }): Promise<void> {
  const { error } = await getSupabase().rpc('vendor_set_food_product_details', {
    p_product_id: input.productId,
    p_selling_unit: input.sellingUnit,
    p_unit_price: input.unitPrice,
    p_quantity_increment: input.quantityIncrement,
    p_minimum_quantity: input.minimumQuantity,
  })
  assertError(error)
}


export async function getVendorCommissionPreview(categoryId: string | null): Promise<number> {
  const { data, error } = await getSupabase().rpc('vendor_get_commission_preview', {
    p_category_id: categoryId,
  })
  assertError(error)
  const rate = Number(data ?? 0)
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('The commission rate could not be verified.')
  return rate
}
