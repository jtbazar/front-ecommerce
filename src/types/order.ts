import type { Json } from './database'

export interface CheckoutFormValues {
  fullName: string
  phone: string
  email: string
  city: string
  area: string
  address: string
  instructions: string
}

export interface PlaceOrderInput {
  customerName: string
  customerPhone: string
  customerEmail: string | null
  shippingAddress: Json
  items: { product_id: string; variant_id: string | null; quantity: number }[]
  idempotencyKey: string
  customerNote: string | null
  deliveryLat: number | null
  deliveryLng: number | null
  deliveryLocationName: string | null
  deliveryLocationCapturedAt: string | null
}

export interface PlacedOrder {
  orderId: string
  orderNumber: string
  subtotal: number
  deliveryFee: number
  total: number
}

export interface OrderRecord {
  id: string
  order_number: string
  customer_name: string
  customer_phone: string
  customer_email: string | null
  shipping_address_snapshot: Json
  customer_note: string | null
  currency: string
  subtotal: number
  delivery_fee: number
  discount_amount: number
  total: number
  order_status: string
  payment_method: string
  payment_status: string
  delivery_lat: number | null
  delivery_lng: number | null
  delivery_location_name: string | null
  delivery_location_captured_at: string | null
  expected_delivery_date: string | null
  delivery_window_start: string | null
  delivery_window_end: string | null
  delivery_note: string | null
  delivery_timing_confirmed_at: string | null
  created_at: string
  updated_at: string
  items?: OrderItemRecord[]
}

export interface OrderItemRecord {
  id: string
  order_id: string
  product_id: string | null
  product_image_url: string | null
  variant_id: string | null
  seller_id: string | null
  seller_name_snapshot: string | null
  product_name_snapshot: string
  sku_snapshot: string | null
  variant_snapshot: Json
  product_snapshot: Json
  quantity: number
  unit_price: number
  line_total: number
  vendor_fulfillment_status: string
  delivery_status: string | null
}

export interface MarketplaceCaseRecord {
  id: string
  order_id: string
  order_item_id: string | null
  buyer_id: string
  seller_id: string | null
  case_type: 'return' | 'refund' | 'complaint'
  status: string
  reason: string
  evidence_path: string | null
  seller_response: string | null
  admin_decision: string | null
  created_at: string
  updated_at: string
  order_number?: string
  product_name?: string | null
  product_sku?: string | null
  product_variant?: Json | null
  product_quantity?: number | null
  product_unit_price?: number | null
  product_line_total?: number | null
  product_image_url?: string | null
  evidence_url?: string | null
}

export interface NotificationRecord {
  id: string
  kind: string
  title: string
  body: string
  related_order_id: string | null
  read_at: string | null
  created_at: string
  audience?: 'customer' | 'vendor' | 'admin'
}
