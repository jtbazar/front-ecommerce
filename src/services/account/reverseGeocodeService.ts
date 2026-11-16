export interface ResolvedPostalAddress {
  displayName: string
  street: string
  area: string
  city: string
  province: string
}

type ReverseGeocodeResponse = {
  display_name?: string
  name?: string
  address?: Record<string, string | undefined>
}

const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse'
const lookupCache = new Map<string, Promise<ResolvedPostalAddress | null>>()
let nextRequestAt = 0

export function reverseGeocodeCoordinates(latitude: number, longitude: number): Promise<ResolvedPostalAddress | null> {
  const endpoint = import.meta.env.VITE_GEOCODER_REVERSE_ENDPOINT?.trim() || DEFAULT_ENDPOINT
  const cacheKey = `${endpoint}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`
  const cached = lookupCache.get(cacheKey)
  if (cached) return cached

  const request = resolveAddress(endpoint, latitude, longitude)
  lookupCache.set(cacheKey, request)
  void request.catch(() => lookupCache.delete(cacheKey))
  return request
}

async function resolveAddress(endpoint: string, latitude: number, longitude: number): Promise<ResolvedPostalAddress | null> {
  const now = Date.now()
  const delay = Math.max(0, nextRequestAt - now)
  nextRequestAt = Math.max(now, nextRequestAt) + 1100
  if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))

  const url = new URL(endpoint)
  url.searchParams.set('lat', String(latitude))
  url.searchParams.set('lon', String(longitude))
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')

  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = import.meta.env.VITE_GEOCODER_API_KEY?.trim()
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetch(url, { headers, referrerPolicy: 'strict-origin-when-cross-origin', signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('Address lookup is temporarily unavailable.')
  const result = await response.json() as ReverseGeocodeResponse
  const address = result.address ?? {}
  const city = address.city || address.town || address.village || address.municipality || address.county || address.state_district || ''
  const road = address.road || address.pedestrian || address.residential || address.footway || ''
  const street = [address.house_number, road].filter(Boolean).join(' ')
    || result.name
    || result.display_name?.split(',').slice(0, 2).join(',').trim()
    || ''
  const area = address.neighbourhood || address.suburb || address.city_district || address.quarter || address.hamlet || ''
  if (!street && !area && !city && !result.display_name) return null
  return {
    displayName: result.display_name || [street, area, city].filter(Boolean).join(', '),
    street,
    area,
    city,
    province: address.state || address.region || '',
  }
}
