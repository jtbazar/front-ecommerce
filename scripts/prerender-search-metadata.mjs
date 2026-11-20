import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const apiUrl = process.env.VITE_SUPABASE_URL
const apiKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const siteUrl = (process.env.VITE_SITE_URL || 'https://www.jt-bazar.com').replace(/\/$/, '')
if (!apiUrl || !apiKey) {
  console.warn('Skipping route metadata prerender; set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY on the build environment.')
  process.exit(0)
}

const headers = { apikey: apiKey }
const rows = async (table, query) => {
  const response = await fetch(`${apiUrl}/rest/v1/${table}?${query}`, { headers })
  if (!response.ok) throw new Error(`SEO prerender request failed for ${table}: ${response.status}`)
  return response.json()
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c')
const template = await readFile('dist/index.html', 'utf8')

function htmlFor({ title, description, path, image, schema, type = 'website' }) {
  const cleanTitle = String(title ?? '').trim()
  const fullTitle = /\|\s*JTBazar$/i.test(cleanTitle) ? cleanTitle : `${cleanTitle} | JTBazar`
  const rawDescription = String(description ?? '').replace(/\s+/g, ' ').trim()
  const fallbackDescription = `Discover ${cleanTitle.replace(/\s*\|\s*JTBazar$/i, '')} at JTBazar. Explore product details, pricing and availability, and shop online in Pakistan.`
  const candidateDescription = rawDescription.length >= 70 ? rawDescription : fallbackDescription
  const metaDescription = candidateDescription.length > 160 ? `${candidateDescription.slice(0, 157).replace(/\s+\S*$/, '')}...` : candidateDescription
  const canonical = `${siteUrl}${path}`
  const imageUrl = image || `${siteUrl}/jtbazar-social-card.png`
  const meta = (key, value, attribute = 'name') => `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(fullTitle)}</title>`)
    .replace(/<meta name="description"[^>]*>/i, meta('description', metaDescription))
    .replace(/<meta name="robots"[^>]*>/i, meta('robots', 'index,follow,max-image-preview:large'))
    .replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${escapeHtml(canonical)}" />`)
    .replace(/<meta property="og:site_name"[^>]*>/i, meta('og:site_name', 'JTBazar', 'property'))
    .replace(/<meta property="og:url"[^>]*>/i, meta('og:url', canonical, 'property'))
    .replace(/<meta property="og:title"[^>]*>/i, meta('og:title', fullTitle, 'property'))
    .replace(/<meta property="og:description"[^>]*>/i, meta('og:description', metaDescription, 'property'))
    .replace(/<meta property="og:image"[^>]*>/i, meta('og:image', imageUrl, 'property'))
    .replace(/<meta property="og:image:alt"[^>]*>/i, meta('og:image:alt', `${fullTitle} — JTBazar`, 'property'))
    .replace(/<meta property="og:type"[^>]*>/i, meta('og:type', type, 'property'))
    .replace(/<meta name="twitter:title"[^>]*>/i, meta('twitter:title', fullTitle))
    .replace(/<meta name="twitter:description"[^>]*>/i, meta('twitter:description', metaDescription))
    .replace(/<meta name="twitter:image"[^>]*>/i, meta('twitter:image', imageUrl))
  if (schema) html = html.replace('</head>', `<script type="application/ld+json">${safeJson(schema)}</script>\n  </head>`)
  return html
}

const requests = await Promise.allSettled([
  rows('products', 'select=id,slug,name,short_description,description,price,currency,seo_title,seo_description,updated_at&publication_status=eq.published&moderation_status=eq.approved&stock_verification_status=neq.paused&vendor_hidden=eq.false&limit=50000'),
  rows('categories', 'select=slug,name,description,seo_title,seo_description,updated_at&is_active=eq.true&limit=1000'),
  fetch(`${apiUrl}/rest/v1/rpc/list_public_shops`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' }).then(async (response) => {
    if (!response.ok) throw new Error(`SEO prerender request failed for shops: ${response.status}`)
    return response.json()
  }),
])
const [productsResult, categories, shops] = requests.map((result) => result.status === 'fulfilled' ? result.value : [])
const products = (Array.isArray(productsResult) ? productsResult : []).filter((product) =>
  !['kinza-test-27deb9', 'testinf-prodict'].includes(product.slug) &&
  Boolean(product.short_description?.trim() || product.description?.trim())
)
if (requests.some((result) => result.status === 'rejected')) console.warn('Some SEO pages were skipped because the public catalog API denied a request.')

const productIds = products.map((product) => product.id)
let imageRows = []
for (let index = 0; index < productIds.length; index += 200) {
  const chunk = productIds.slice(index, index + 200)
  try { imageRows.push(...await rows('product_images', `select=product_id,image_url,storage_path,sort_order&product_id=in.(${chunk.join(',')})&order=sort_order.asc`)) }
  catch { console.warn('Product images could not be fetched for some prerendered pages.') }
}
const imagesByProduct = new Map()
for (const image of imageRows) {
  const src = image.image_url || (image.storage_path ? `${apiUrl}/storage/v1/object/public/product-images/${image.storage_path.split('/').map(encodeURIComponent).join('/')}` : null)
  if (src) imagesByProduct.set(image.product_id, [...(imagesByProduct.get(image.product_id) ?? []), src])
}

const writeRoute = async (path, meta) => {
  const output = join('dist', path.replace(/^\//, ''), 'index.html')
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, htmlFor({ ...meta, path }))
}

for (const product of products) {
  const path = `/products/${product.slug}`
  const name = product.seo_title || product.name
  const description = product.seo_description || product.short_description || product.description || `Shop ${product.name} online in Pakistan from JTBazar.`
  await writeRoute(path, {
    title: `${name} | JTBazar`, description, image: imagesByProduct.get(product.id)?.[0], type: 'product',
    schema: {
      '@context': 'https://schema.org', '@type': 'Product', name: product.name,
      description: product.short_description || product.description, image: imagesByProduct.get(product.id) ?? [],
      offers: { '@type': 'Offer', url: `${siteUrl}${path}`, priceCurrency: product.currency || 'PKR', price: Number(product.price), itemCondition: 'https://schema.org/NewCondition' },
    },
  })
}
for (const category of categories) {
  const path = `/categories/${category.slug}`
  await writeRoute(path, { title: `${category.seo_title || category.name} | JTBazar`, description: category.seo_description || category.description || `Shop ${category.name} online in Pakistan at JTBazar.`, path })
}
for (const shop of (Array.isArray(shops) ? shops : []).filter((entry) => entry.slug && Number(entry.product_count) > 0)) {
  const path = `/shops/${shop.slug}`
  await writeRoute(path, { title: `${shop.shop_name} | JTBazar`, description: shop.description || `Discover ${shop.shop_name} products at JTBazar.`, image: shop.shop_image_url || undefined })
}
console.log(`Generated SEO metadata pages for ${products.length} products, ${categories.length} categories, and ${(Array.isArray(shops) ? shops : []).filter((entry) => Number(entry.product_count) > 0).length} shops.`)
