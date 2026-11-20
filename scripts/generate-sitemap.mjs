import { writeFile } from 'node:fs/promises'

const siteUrl = (process.env.VITE_SITE_URL || 'https://www.jt-bazar.com').replace(/\/$/, '')
const today = new Date().toISOString().slice(0, 10)
const routes = [
  '/', '/shop', '/categories', '/discover', '/budget', '/sellers', '/about', '/contact',
  '/faq', '/shipping', '/returns', '/privacy', '/terms',
]
const entries = new Map(routes.map((route) => [route, today]))
const supabaseUrl = process.env.VITE_SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Always regenerate the checked-in sitemap, even when catalog API credentials
// are not available during the build. This prevents stale preview-domain URLs.
if (supabaseUrl && publishableKey) {
  const headers = { apikey: publishableKey }
  const getRows = async (table, query) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, { headers })
    if (!response.ok) throw new Error(`Sitemap fetch failed for ${table}: ${response.status}`)
    return response.json()
  }
  const requests = await Promise.allSettled([
    getRows('products', 'select=slug,updated_at&publication_status=eq.published&moderation_status=eq.approved&limit=50000'),
    getRows('categories', 'select=slug,updated_at&is_active=eq.true&limit=1000'),
    fetch(`${supabaseUrl}/rest/v1/rpc/list_public_shops`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' }).then(async (response) => {
      if (!response.ok) throw new Error(`Sitemap fetch failed for shops: ${response.status}`)
      return response.json()
    }),
  ])
  const [products, categories, shops] = requests.map((result) => result.status === 'fulfilled' ? result.value : [])
  if (requests.some((result) => result.status === 'rejected')) console.warn('Some dynamic routes were omitted from sitemap because the public catalog API denied the request.')
  for (const row of products) if (row.slug) entries.set(`/products/${row.slug}`, row.updated_at?.slice(0, 10) || today)
  for (const row of categories) if (row.slug) entries.set(`/categories/${row.slug}`, row.updated_at?.slice(0, 10) || today)
  for (const row of shops) if (row.slug && Number(row.product_count) > 0) entries.set(`/shops/${row.slug}`, row.created_at?.slice(0, 10) || today)
} else {
  console.warn('Supabase public credentials are missing; generating a clean core-route sitemap without dynamic catalog URLs.')
}

const xml = [...entries].map(([route, lastmod]) => `  <url><loc>${siteUrl}${route.replaceAll('&', '&amp;')}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')
await writeFile('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xml}\n</urlset>\n`)
console.log(`Generated sitemap with ${entries.size} URLs on ${siteUrl}.`)
