import { getSupabase } from '../../lib/supabase'

export interface ProductCampaign {
  id: string
  name: string
  campaign_type: 'flash_sale' | 'bogo' | 'bundle' | 'seasonal' | 'custom'
  display_title: string
  description: string | null
  discount_percent: number
  buy_quantity: number
  get_quantity: number
  bundle_price: number | null
  starts_at: string | null
  ends_at: string | null
  product_ids: string[]
}

let campaignsCache: { expiresAt: number; items: ProductCampaign[] } | null = null
let campaignsRequest: Promise<ProductCampaign[]> | null = null

export async function fetchActiveProductCampaigns(): Promise<ProductCampaign[]> {
  if (campaignsCache && campaignsCache.expiresAt > Date.now()) return campaignsCache.items
  if (campaignsRequest) return campaignsRequest
  campaignsRequest = (async () => {
    const { data, error } = await (getSupabase() as any).rpc('list_active_product_campaigns')
    if (error) throw new Error(error.message)
    return Array.isArray(data) ? data as ProductCampaign[] : []
  })()
  try {
    const items = await campaignsRequest
    campaignsCache = { items, expiresAt: Date.now() + 15000 }
    return items
  } finally { campaignsRequest = null }
}
