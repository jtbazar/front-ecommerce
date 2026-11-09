import { getSupabase } from '../../lib/supabase'

export interface HomepageHeroItem {
  id: string
  title: string
  subtitle: string | null
  cta_text: string | null
  cta_destination: string | null
  image_url: string
  mobile_image_url: string | null
  image_alt_text: string | null
  display_order: number
}

export interface PromotionItem {
  id: string
  title: string
  description: string | null
  banner_image_url: string | null
  banner_image_urls: string[]
  cta_text: string | null
  cta_destination: string | null
  display_position: string
  priority: number
  coupon_code: string | null
  discount_percent: number | null
  target_platform: 'website' | 'android' | 'both'
  campaign_type: 'banner' | 'popup'
  show_on_launch: boolean
  starts_at: string | null
  ends_at: string | null
}

export async function fetchActiveHomepageHeroes(): Promise<HomepageHeroItem[]> {
  const client = getSupabase()
  const { data, error } = await client
    .from('homepage_heroes')
    .select('id, title, subtitle, cta_text, cta_destination, image_url, mobile_image_url, image_alt_text, display_order')
    .eq('status', 'published')
    .order('display_order', { ascending: true })

  if (error || !data) return []
  return data as HomepageHeroItem[]
}

export async function fetchActivePromotions(position?: string): Promise<PromotionItem[]> {
  const client = getSupabase()
  let query = client
    .from('promotions')
    .select('id, title, description, banner_image_url, banner_image_urls, cta_text, cta_destination, display_position, priority, coupon_code, discount_percent, target_platform, campaign_type, show_on_launch, starts_at, ends_at')
    .eq('status', 'approved')
    .order('priority', { ascending: false })

  if (position) {
    query = query.eq('display_position', position)
  }

  const { data, error } = await query
  if (error || !data) return []
  return data as PromotionItem[]
}
