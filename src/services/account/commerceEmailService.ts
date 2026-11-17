import { getSupabase } from '../../lib/supabase'

export type CommerceEmailEvent =
  | { event: 'order_placed'; order_id: string }
  | { event: 'order_status'; order_id: string; status: string }
  | { event: 'vendor_fulfillment'; order_item_id: string; status: string }
  | { event: 'seller_approved' | 'seller_rejected'; seller_profile_id: string }
  | { event: 'delivery_otp'; order_id: string }

export async function sendCommerceEmail(payload: CommerceEmailEvent): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().functions.invoke('commerce-email', { body: payload })
    return !error && (data as { sent?: boolean } | null)?.sent === true
  } catch {
    return false
  }
}
