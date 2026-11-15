export interface ResolvedPostalAddress {
  displayName: string
  street: string
  area: string
  city: string
  province: string
}

type ReverseGeocodeResponse = {
  display_name?: string
  address?: Record<string, string | undefined>
}

export async function reverseGeocodeCoordinates(latitude: number, longitude: number): Promise<ResolvedPostalAddress | null> {
  const endpoint = import.meta.env.VITE_GEOCODER_REVERSE_ENDPOINT?.trim()
  if (!endpoint) return null
  const url = new URL(endpoint)
  url.searchParams.set('lat', String(latitude))
  url.searchParams.set('lon', String(longitude))
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')

  const headers: HeadersInit = { Accept: 'application/json' }
  const apiKey = import.meta.env.VITE_GEOCODER_API_KEY?.trim()
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error('Address lookup is temporarily unavailable.')
  const result = await response.json() as ReverseGeocodeResponse
  const address = result.address ?? {}
  const city = address.city || address.town || address.village || address.municipality || address.county || ''
  const street = [address.house_number, address.road || address.pedestrian || address.residential].filter(Boolean).join(' ')
  const area = address.neighbourhood || address.suburb || address.city_district || address.quarter || address.hamlet || ''
  return {
    displayName: result.display_name || [street, area, city].filter(Boolean).join(', '),
    street: street || result.display_name || '',
    area,
    city,
    province: address.state || address.region || '',
  }
}
