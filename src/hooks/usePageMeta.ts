import { useEffect } from 'react'
import { SITE_URL, STORE_NAME } from '../config/store'

interface PageMetaOptions {
  image?: string | null
  type?: 'website' | 'product'
  structuredData?: Record<string, unknown> | null
  noIndex?: boolean
}

function normalizeMetaDescription(value: string, title: string) {
  const cleaned = String(value ?? '').replace(/\\s+/g, ' ').trim()
  const fallback = `Discover ${title.replace(/\\s*\\|\\s*JTBazar$/i, '')} at JTBazar. Explore useful shopping information, product details and customer support across Pakistan.`
  const candidate = cleaned.length >= 70 ? cleaned : fallback
  return candidate.length > 160 ? `${candidate.slice(0, 157).replace(/\\s+\\S*$/, '')}...` : candidate
}

function ensureMeta(selector: string, create: () => HTMLMetaElement) {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!element) { element = create(); document.head.append(element) }
  return element
}

export function usePageMeta(title: string, description: string, options: PageMetaOptions = {}) {
  const schemaJson = options.structuredData ? JSON.stringify(options.structuredData) : ''
  useEffect(() => {
    const cleanTitle = title.trim()
    const suffix = ` | ${STORE_NAME}`
    const fullTitle = cleanTitle.toLowerCase().endsWith(suffix.toLowerCase()) ? cleanTitle : `${cleanTitle}${suffix}`
    const metaDescription = normalizeMetaDescription(description, cleanTitle)
    const canonicalUrl = `${SITE_URL}${window.location.pathname}`
    const imageUrl = options.image ? new URL(options.image, SITE_URL).href : `${SITE_URL}/jtbazar-social-card.png`
    const path = window.location.pathname
    const privatePage = options.noIndex ?? (/^\/(account|cart|checkout|wishlist|vendor(?:\/|$)|login|register|logout|forgot-password|reset-password|verify-[^/]+|order-confirmation)(?:\/|$)/.test(path) || path === '/search')
    document.title = fullTitle

    ensureMeta('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' })).content = metaDescription
    ensureMeta('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' })).content = privatePage ? 'noindex,follow' : 'index,follow,max-image-preview:large'
    ensureMeta('meta[property="og:site_name"]', () => Object.assign(document.createElement('meta'), { property: 'og:site_name' })).content = STORE_NAME
    ensureMeta('meta[property="og:title"]', () => Object.assign(document.createElement('meta'), { property: 'og:title' })).content = fullTitle
    ensureMeta('meta[property="og:description"]', () => Object.assign(document.createElement('meta'), { property: 'og:description' })).content = metaDescription
    ensureMeta('meta[property="og:url"]', () => Object.assign(document.createElement('meta'), { property: 'og:url' })).content = canonicalUrl
    ensureMeta('meta[property="og:image"]', () => Object.assign(document.createElement('meta'), { property: 'og:image' })).content = imageUrl
    ensureMeta('meta[property="og:image:alt"]', () => Object.assign(document.createElement('meta'), { property: 'og:image:alt' })).content = `${title} — JTBazar`
    ensureMeta('meta[property="og:type"]', () => Object.assign(document.createElement('meta'), { property: 'og:type' })).content = options.type ?? 'website'
    ensureMeta('meta[name="twitter:card"]', () => Object.assign(document.createElement('meta'), { name: 'twitter:card' })).content = 'summary_large_image'
    ensureMeta('meta[name="twitter:title"]', () => Object.assign(document.createElement('meta'), { name: 'twitter:title' })).content = fullTitle
    ensureMeta('meta[name="twitter:description"]', () => Object.assign(document.createElement('meta'), { name: 'twitter:description' })).content = description
    ensureMeta('meta[name="twitter:image"]', () => Object.assign(document.createElement('meta'), { name: 'twitter:image' })).content = imageUrl

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical) }
    canonical.href = canonicalUrl

    let schema = document.getElementById('jtbazar-page-schema') as HTMLScriptElement | null
    if (schemaJson) {
      if (!schema) { schema = document.createElement('script'); schema.id = 'jtbazar-page-schema'; schema.type = 'application/ld+json'; document.head.append(schema) }
      schema.textContent = schemaJson
    } else schema?.remove()
  }, [title, description, options.image, options.type, options.noIndex, schemaJson])
}
