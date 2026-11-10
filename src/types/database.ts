export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
export type PublicationStatus = 'draft' | 'published' | 'archived'
export type AppRole = 'customer' | 'admin' | 'vendor'
export type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
export type PaymentMethod = 'unconfirmed' | 'cod' | 'card' | 'bank_transfer'
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'failed' | 'partially_refunded' | 'refunded'
export type InventoryMovementType = 'initial' | 'sale' | 'restock' | 'adjustment' | 'return' | 'correction'
export type NotificationKind = 'order' | 'account' | 'store'
export type NotificationAudience = 'customer' | 'vendor' | 'admin'
export type SellerStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type ModerationStatus = 'pending_review' | 'approved' | 'rejected' | 'hidden' | 'archived'
export type VendorFulfillmentStatus = 'pending' | 'accepted' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
export type CaseStatus = 'open' | 'seller_responded' | 'under_review' | 'approved' | 'rejected' | 'resolved'
export type CaseType = 'return' | 'refund' | 'complaint'

type Table<Row, Required extends keyof Row = never> = {
  Row: Row
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>
  Update: Partial<Row>
  Relationships: []
}

type ProfileRow = { id: string; full_name: string | null; phone: string | null; avatar_url: string | null; created_at: string; updated_at: string }
type UserRoleRow = { user_id: string; role: AppRole; assigned_at: string; assigned_by: string | null }
type CategoryRow = { id: string; parent_id: string | null; name: string; slug: string; description: string; eyebrow: string | null; image_url: string | null; is_active: boolean; is_coming_soon: boolean; is_food_category: boolean; sort_order: number; seo_title: string | null; seo_description: string | null; created_at: string; updated_at: string }
type ProductRow = { id: string; category_id: string | null; seller_id: string | null; name: string; slug: string; sku: string | null; short_description: string; description: string; price: number; discount_percent: number; currency: string; specifications: Json; publication_status: PublicationStatus; moderation_status: ModerationStatus; moderated_by: string | null; moderated_at: string | null; moderation_reason: string | null; supplier_cost: number | null; fulfillment_expense: number; minimum_profit: number; cost_updated_at: string | null; food_selling_unit: string | null; food_unit_price: number | null; food_quantity_increment: number | null; food_minimum_quantity: number | null; is_daily_item: boolean; daily_available_quantity: number; daily_minimum_quantity: number; daily_available_on: string | null; daily_status: 'available' | 'not_today' | 'coming_soon'; vendor_hidden: boolean; vendor_hidden_at: string | null; stock_verification_status: 'unverified' | 'verified' | 'stale' | 'paused'; is_featured: boolean; track_inventory: boolean; weight_grams: number | null; dimensions: Json; seo_title: string | null; seo_description: string | null; created_at: string; updated_at: string }
type ProductImageRow = { id: string; product_id: string; image_url: string | null; storage_path: string | null; alt_text: string; sort_order: number; is_primary: boolean; created_at: string }
type ProductVariantRow = { id: string; product_id: string; option_label: string; option_value: string; sku: string | null; price_override: number | null; attributes: Json; is_active: boolean; sort_order: number; created_at: string; updated_at: string }
type ProductInventoryRow = { id: string; product_id: string; variant_id: string | null; quantity: number; low_stock_threshold: number | null; updated_at: string }
type InventoryMovementRow = { id: string; product_id: string; variant_id: string | null; quantity_delta: number; movement_type: InventoryMovementType; reference_id: string | null; note: string | null; actor_id: string | null; created_at: string }
type ProductDeletionRequestRow = { id: string; product_id: string; seller_id: string; requested_by: string; reason: string; status: 'pending' | 'approved' | 'rejected'; admin_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string; updated_at: string }
type CustomerAddressRow = { id: string; user_id: string; recipient_name: string; phone: string; address_line_1: string; address_line_2: string | null; city: string; province: string | null; postal_code: string | null; delivery_instructions: string | null; is_default: boolean; created_at: string; updated_at: string }
type WishlistItemRow = { id: string; user_id: string; product_id: string; variant_id: string | null; added_at: string }
type CartItemRow = { id: string; user_id: string; product_id: string; variant_id: string | null; quantity: number; created_at: string; updated_at: string }
type OrderRow = { id: string; order_number: string; customer_id: string | null; customer_name: string; customer_phone: string; customer_email: string | null; shipping_address_snapshot: Json; customer_note: string | null; currency: string; subtotal: number; delivery_fee: number; discount_amount: number; total: number; order_status: OrderStatus; payment_method: PaymentMethod; payment_status: PaymentStatus; delivery_lat: number | null; delivery_lng: number | null; delivery_location_name: string | null; delivery_location_captured_at: string | null; idempotency_key: string | null; confirmation_status: 'pending' | 'confirmed' | 'not_reachable' | 'cancelled'; confirmed_at: string | null; confirmed_by: string | null; confirmation_note: string | null; created_at: string; updated_at: string }
type OrderItemRow = { id: string; order_id: string; product_id: string | null; variant_id: string | null; seller_id: string | null; seller_name_snapshot: string | null; vendor_fulfillment_status: VendorFulfillmentStatus; tracking_number: string | null; tracking_url: string | null; vendor_note: string | null; vendor_updated_at: string | null; product_name_snapshot: string; sku_snapshot: string | null; variant_snapshot: Json; product_snapshot: Json; quantity: number; unit_price: number; line_total: number; created_at: string }
type PaymentTransactionRow = { id: string; order_id: string; provider: string; provider_reference: string | null; amount: number; currency: string; status: PaymentStatus; safe_metadata: Json; created_at: string; updated_at: string }
type AdminOrderNoteRow = { id: string; order_id: string; created_by: string; note: string; created_at: string }
type NotificationRow = { id: string; user_id: string; kind: NotificationKind; title: string; body: string; related_order_id: string | null; read_at: string | null; created_at: string; audience: NotificationAudience }
type AdminAuditLogRow = { id: string; actor_id: string | null; action: 'INSERT' | 'UPDATE' | 'DELETE'; entity: string; entity_id: string | null; details: Json; created_at: string }
type SellerProfileRow = { id: string; user_id: string; shop_name: string; slug: string; description: string; current_address: string | null; complete_address: string | null; contact_email: string | null; phone: string | null; document_path: string | null; shop_image_url: string | null; shop_lat: number | null; shop_lng: number | null; shop_location_label: string; show_shop_on_map: boolean; vendor_type: 'individual_seller' | 'registered_business' | 'sole_proprietor' | 'partnership' | 'company' | null; owner_full_name: string | null; cnic_number: string | null; cnic_front_path: string | null; cnic_back_path: string | null; shop_location_text: string | null; minimum_order_value: number; shop_is_open: boolean; preparation_minutes: number; vendor_locked: boolean; vendor_locked_at: string | null; vendor_locked_by: string | null; vendor_lock_reason: string | null; status: SellerStatus; rejection_reason: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string; updated_at: string }
type MarketplaceCaseRow = { id: string; order_id: string; order_item_id: string | null; buyer_id: string; seller_id: string | null; case_type: CaseType; status: CaseStatus; reason: string; evidence_path: string | null; seller_response: string | null; admin_decision: string | null; decided_by: string | null; decided_at: string | null; created_at: string; updated_at: string }
type SupportTicketRow = { id: string; seller_id: string; created_by: string; subject: string; message: string; status: 'open' | 'in_progress' | 'resolved'; admin_response: string | null; created_at: string; updated_at: string }
type CustomerSupportTicketRow = { id: string; user_id: string; requester_name: string; requester_email: string; subject: string; message: string; status: 'open' | 'in_progress' | 'resolved'; admin_response: string | null; created_at: string; updated_at: string }
type VendorOrderItemRow = { id: string; product_id: string | null; order_id: string; order_number: string; shop_name: string; customer_name: string; customer_phone: string; shipping_address_snapshot: Json; delivery_lat: number | null; delivery_lng: number | null; delivery_location_name: string | null; payment_method: PaymentMethod; order_created_at: string; product_name_snapshot: string; product_image_url: string | null; sku_snapshot: string | null; variant_snapshot: Json; quantity: number; unit_price: number; line_total: number; vendor_fulfillment_status: VendorFulfillmentStatus; tracking_number: string | null; tracking_url: string | null; vendor_note: string | null; vendor_updated_at: string | null; created_at: string; total_orders: number }
type VendorOrderPickupRow = { id: string; order_id: string; seller_id: string; status: 'awaiting_vendor' | 'ready_for_pickup' | 'picked_up' | 'cancelled'; ready_at: string | null; picked_up_at: string | null; vendor_note: string | null; updated_at: string }
type VendorPickupAdminRow = { pickup_id: string; order_id: string; order_number: string; order_status: string; customer_name: string; customer_phone: string; shipping_address: Json; delivery_lat: number | null; delivery_lng: number | null; shop_name: string; pickup_status: string; ready_at: string | null; picked_up_at: string | null; item_count: number; items: Json }
type StoreSettingsRow = { id: string; store_name: string; support_email: string | null; support_phone: string | null; support_whatsapp: string | null; delivery_fee: number; free_delivery_enabled: boolean; additional_delivery_fee: number; cod_enabled: boolean; return_window_days: number; updated_at: string }
type NewsletterSubscriberRow = { id: string; email: string; source: string; subscribed_at: string; unsubscribed_at: string | null }
type HomepageHeroRow = { id: string; title: string; subtitle: string | null; cta_text: string | null; cta_destination: string | null; image_url: string; mobile_image_url: string | null; image_alt_text: string | null; status: 'draft' | 'published' | 'archived'; display_order: number; start_date: string | null; end_date: string | null; created_by: string | null; created_at: string; updated_at: string }
type PromotionRow = { id: string; title: string; description: string | null; banner_image_url: string | null; banner_image_urls: string[]; cta_text: string | null; cta_destination: string | null; is_platform_wide: boolean; seller_id: string | null; status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'hidden' | 'archived'; rejection_reason: string | null; reviewed_by: string | null; reviewed_at: string | null; display_position: string; priority: number; coupon_code: string | null; discount_percent: number | null; start_date: string | null; end_date: string | null; target_platform: 'website' | 'android' | 'both'; campaign_type: 'banner' | 'popup'; show_on_launch: boolean; starts_at: string | null; ends_at: string | null; created_at: string; updated_at: string }

type ProductReviewRow = { id: string; product_id: string; order_id: string; buyer_id: string; rating: number; title: string | null; comment: string | null; status: string; created_at: string; updated_at: string }
type SellerReviewRow = { id: string; seller_id: string; order_id: string; buyer_id: string; rating: number; comment: string | null; status: string; created_at: string; updated_at: string }

type PublicShopRow = { id: string; shop_name: string; slug: string; description: string; created_at: string; product_count: number; shop_image_url: string | null; shop_location_label: string | null; shop_lat: number | null; shop_lng: number | null }
type PlacedOrderRow = { order_id: string; order_number: string; subtotal: number; delivery_fee: number; total: number }
type AdminCustomerRow = { id: string; full_name: string | null; phone: string | null; avatar_url: string | null; email: string | null; order_count: number; lifetime_value: number; created_at: string; updated_at: string }
type AdminSummaryRow = { total_products: number; published_products: number; active_categories: number; pending_orders: number; open_orders: number; paid_delivered_value: number }

type PlaceOrderArgs = {
  p_customer_name: string
  p_customer_phone: string
  p_customer_email: string | null
  p_shipping_address: Json
  p_items: Json
  p_idempotency_key: string
  p_customer_note?: string | null
  p_delivery_lat?: number | null
  p_delivery_lng?: number | null
  p_delivery_location_name?: string | null
  p_delivery_location_captured_at?: string | null
}

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow, 'id'>
      user_roles: Table<UserRoleRow, 'user_id' | 'role'>
      seller_profiles: Table<SellerProfileRow, 'user_id' | 'shop_name' | 'slug'>
      categories: Table<CategoryRow, 'name' | 'slug'>
      products: Table<ProductRow, 'name' | 'slug' | 'price'>
      product_images: Table<ProductImageRow, 'product_id'>
      product_variants: Table<ProductVariantRow, 'product_id' | 'option_label' | 'option_value'>
      product_inventory: Table<ProductInventoryRow, 'product_id'>
      product_deletion_requests: Table<ProductDeletionRequestRow>
      inventory_movements: Table<InventoryMovementRow, 'product_id' | 'quantity_delta' | 'movement_type'>
      customer_addresses: Table<CustomerAddressRow, 'user_id' | 'recipient_name' | 'phone' | 'address_line_1' | 'city'>
      wishlist_items: Table<WishlistItemRow, 'user_id' | 'product_id'>
      cart_items: Table<CartItemRow, 'user_id' | 'product_id'>
      orders: Table<OrderRow, 'customer_name' | 'customer_phone' | 'shipping_address_snapshot' | 'subtotal'>
      order_items: Table<OrderItemRow, 'order_id' | 'product_name_snapshot' | 'quantity' | 'unit_price'>
      marketplace_cases: Table<MarketplaceCaseRow, 'order_id' | 'buyer_id' | 'case_type' | 'reason'>
      support_tickets: Table<SupportTicketRow, 'seller_id' | 'created_by' | 'subject' | 'message'>
      customer_support_tickets: Table<CustomerSupportTicketRow, 'user_id' | 'subject' | 'message'>
      payment_transactions: Table<PaymentTransactionRow, 'order_id' | 'provider' | 'amount'>
      admin_order_notes: Table<AdminOrderNoteRow, 'order_id' | 'created_by' | 'note'>
      notifications: Table<NotificationRow, 'user_id' | 'title'>
      admin_audit_logs: Table<AdminAuditLogRow, 'action' | 'entity'>
      store_settings: Table<StoreSettingsRow>
      newsletter_subscribers: Table<NewsletterSubscriberRow, 'email'>
      homepage_heroes: Table<HomepageHeroRow, 'title' | 'image_url'>
      promotions: Table<PromotionRow, 'title'>
      product_reviews: Table<ProductReviewRow, "product_id" | "order_id" | "buyer_id" | "rating">
      seller_reviews: Table<SellerReviewRow, "seller_id" | "order_id" | "buyer_id" | "rating">
    }
    Views: Record<string, never>
    Functions: {
      vendor_get_commission_preview: { Args: { p_category_id: string | null }; Returns: number }
      current_user_is_admin: { Args: Record<string, never>; Returns: boolean }
      get_public_availability: { Args: { product_ids: string[] }; Returns: { product_id: string; variant_id: string | null; is_available: boolean }[] }
      get_public_inventory: { Args: { product_ids: string[] }; Returns: { product_id: string; variant_id: string | null; available_quantity: number | null }[] }
      list_public_shops: { Args: Record<string, never>; Returns: PublicShopRow[] }
      subscribe_newsletter: { Args: { p_email: string; p_source?: string }; Returns: boolean }
      place_order: { Args: PlaceOrderArgs; Returns: PlacedOrderRow[] }
      admin_dashboard_summary: { Args: Record<string, never>; Returns: AdminSummaryRow[] }
      admin_list_products: { Args: { p_search?: string }; Returns: ProductRow[] }
      admin_customer_summary: { Args: Record<string, never>; Returns: AdminCustomerRow[] }
      admin_update_store_settings: { Args: { p_settings: Json }; Returns: StoreSettingsRow }
      admin_adjust_inventory: { Args: { p_inventory_id: string; p_new_quantity: number; p_note: string }; Returns: ProductInventoryRow }
      create_order: { Args: { p_customer_id: string | null; p_customer_name: string; p_customer_phone: string; p_shipping_address: Json; p_items: Json; p_customer_email?: string | null; p_delivery_fee?: number; p_payment_method?: PaymentMethod; p_customer_note?: string | null }; Returns: string }
      vendor_create_product: { Args: { p_category_id: string | null; p_name: string; p_slug: string; p_sku: string | null; p_short_description: string; p_description: string; p_price: number; p_supplier_cost: number | null; p_fulfillment_expense: number; p_minimum_profit: number; p_track_inventory?: boolean; p_discount_percent?: number; p_weight_grams?: number | null; p_specifications?: Json; p_dimensions?: Json; p_seo_title?: string | null; p_seo_description?: string | null; p_initial_stock?: number }; Returns: string }
      vendor_list_products: { Args: Record<string, never>; Returns: ProductRow[] }
      vendor_adjust_inventory: { Args: { p_inventory_id: string; p_new_quantity: number; p_note: string }; Returns: ProductInventoryRow }
      vendor_set_product_inventory: { Args: { p_product_id: string; p_variant_id: string | null; p_new_quantity: number; p_note: string }; Returns: ProductInventoryRow }
      vendor_request_product_deletion: { Args: { p_product_id: string; p_reason: string }; Returns: Json }
      admin_list_product_deletion_requests: { Args: Record<string, never>; Returns: { id: string; product_id: string; product_name: string; product_image_url: string | null; seller_id: string; shop_name: string; reason: string; status: 'pending' | 'approved' | 'rejected'; admin_note: string | null; created_at: string }[] }
      admin_delete_product: { Args: { p_product_id: string }; Returns: undefined }
      admin_review_product_deletion: { Args: { p_request_id: string; p_approve: boolean; p_admin_note?: string | null }; Returns: Json }
      vendor_update_product: { Args: { p_product_id: string; p_category_id: string | null; p_name: string; p_slug: string; p_sku: string | null; p_short_description: string; p_description: string; p_price: number; p_supplier_cost: number | null; p_fulfillment_expense: number; p_minimum_profit: number; p_discount_percent?: number; p_weight_grams?: number | null; p_specifications?: Json; p_dimensions?: Json; p_seo_title?: string | null; p_seo_description?: string | null }; Returns: ProductRow }
      vendor_order_items: { Args: Record<string, never>; Returns: VendorOrderItemRow[] }
      vendor_order_items_page: { Args: { p_limit?: number; p_offset?: number; p_search?: string | null; p_status?: string | null }; Returns: VendorOrderItemRow[] }
      vendor_update_order_item: { Args: { p_item_id: string; p_status: string; p_tracking_number?: string | null; p_tracking_url?: string | null; p_vendor_note?: string | null }; Returns: boolean }
      vendor_set_food_product_details: { Args: { p_product_id: string; p_selling_unit: string; p_unit_price: number; p_quantity_increment: number; p_minimum_quantity: number }; Returns: ProductRow }
      vendor_set_product_visibility: { Args: { p_product_id: string; p_hidden: boolean }; Returns: ProductRow }
      vendor_set_daily_availability: { Args: { p_product_id: string; p_is_daily_item: boolean; p_available_quantity: number; p_minimum_quantity?: number; p_minimum_order_value?: number | null; p_shop_is_open?: boolean | null }; Returns: ProductRow }
      vendor_mark_order_ready: { Args: { p_order_id: string; p_vendor_note?: string | null }; Returns: VendorOrderPickupRow }
      admin_confirm_customer_order: { Args: { p_order_id: string; p_decision: string; p_note?: string | null }; Returns: OrderRow }
      admin_list_vendor_pickups: { Args: { p_order_id?: string | null }; Returns: VendorPickupAdminRow[] }
      admin_mark_vendor_picked_up: { Args: { p_pickup_id: string }; Returns: VendorOrderPickupRow }
      admin_review_seller: { Args: { p_seller_id: string; p_status: SellerStatus; p_reason?: string | null }; Returns: SellerProfileRow }
      admin_set_vendor_lock: { Args: { p_seller_id: string; p_locked: boolean; p_reason?: string | null }; Returns: SellerProfileRow }
      seller_resubmit_application: { Args: Record<string, never>; Returns: SellerProfileRow }
      admin_decide_marketplace_case: { Args: { p_case_id: string; p_status: string; p_decision: string }; Returns: MarketplaceCaseRow }
      admin_moderate_product: { Args: { p_product_id: string; p_status: ModerationStatus; p_reason?: string | null }; Returns: ProductRow }
      cancel_customer_order: { Args: { p_order_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: AppRole
      publication_status: PublicationStatus
      inventory_movement_type: InventoryMovementType
      order_status: OrderStatus
      payment_method: PaymentMethod
      payment_status: PaymentStatus
      notification_kind: NotificationKind
      seller_status: SellerStatus
    }
    CompositeTypes: Record<string, never>
  }
}
