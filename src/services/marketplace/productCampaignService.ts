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

export async function fetchActiveProductCampaigns(): Promise<ProductCampaign[]> {
  const { data, error } = await (getSupabase() as any).rpc('list_active_product_campaigns')
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data as ProductCampaign[] : []
}
