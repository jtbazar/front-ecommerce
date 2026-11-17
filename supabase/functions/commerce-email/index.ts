import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@^9'

const smtpUser = Deno.env.get('SMTP_USERNAME') ?? Deno.env.get('SMTP_USER') ?? Deno.env.get('SMTP_LOGIN') ?? ''
const smtpPassword = Deno.env.get('SMTP_PASSWORD') ?? Deno.env.get('SMTP_PASS') ?? Deno.env.get('SMTP_APP_PASSWORD') ?? ''
const smtpHost = Deno.env.get('SMTP_HOSTNAME') ?? Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com'
const smtpPort = Number(Deno.env.get('SMTP_PORT') ?? '465')
const smtpFrom = Deno.env.get('SMTP_FROM') || Deno.env.get('SMTP_FROM_EMAIL') || (smtpUser ? '"JTBazar" <' + smtpUser + '>' : '')

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!smtpUser || !smtpPassword) throw new Error('SMTP credentials are not configured for this Edge Function.')
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPassword },
  })
  await transport.sendMail({ from: smtpFrom, to, subject, html })
  return true
}

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const variantLabel = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => key + ': ' + (typeof item === 'string' || typeof item === 'number' ? String(item) : JSON.stringify(item))).join(' · ')
}
type EmailOrderItem = { product_name_snapshot: string; sku_snapshot: string | null; quantity: number; unit_price: number; line_total: number; variant_snapshot: unknown }
type Input = { event?: string; order_id?: string; status?: string; order_item_id?: string; seller_profile_id?: string }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Sign-in is required.' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const inbox = Deno.env.get('SUPPORT_INBOX_EMAIL')
  if (!url || !anon || !serviceKey) return json({ error: 'Email service is not configured.' }, 503)
  const missingSmtp = [!smtpUser ? 'SMTP_USERNAME (or SMTP_USER)' : '', !smtpPassword ? 'SMTP_PASSWORD (or SMTP_PASS)' : ''].filter(Boolean)
  if (missingSmtp.length) return json({ error: 'SMTP credentials are missing from Supabase Edge Function secrets.', missing: missingSmtp }, 503)

  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: authData, error: authError } = await caller.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Your sign-in session is invalid.' }, 401)

  let input: Input
  try { input = await request.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const event = input.event
  let entityId = ''
  let eventType = event ?? ''
  let subject = ''
  let body = ''
  let recipients: string[] = []
  let emailOrderNumber = ''
  let emailTotal = 0
  let emailItems: EmailOrderItem[] = []
  let sellerShopImageUrl = ''
  let sellerShopName = ''
  let sellerReviewNote = ''
  let sellerEmailActionUrl = ''
  let sellerEmailActionLabel = ''
  let deliveryOtpCode = ''
  let eventDedupeSuffix = ''

  const requireAdmin = async () => {
    const { data, error } = await caller.rpc('current_user_is_admin')
    return !error && data === true
  }
  const userEmail = async (id: string | null) => {
    if (!id) return null
    const { data } = await admin.auth.admin.getUserById(id)
    return data.user?.email ?? null
  }

  const resolveShopImage = async (seller: { user_id: string; shop_image_url: string | null }) => {
    const savedImage = seller.shop_image_url?.trim()
    if (savedImage) {
      if (savedImage.startsWith('https://') || savedImage.startsWith('http://')) return savedImage
      return admin.storage.from('shop-images').getPublicUrl(savedImage).data.publicUrl
    }
    // Resolve only files belonging to this seller; never use another shop's image.
    const { data: files, error } = await admin.storage.from('shop-images').list(seller.user_id, {
      limit: 1,
      sortBy: { column: 'created_at', order: 'desc' },
    })
    if (error || !files?.length) return null
    return admin.storage.from('shop-images').getPublicUrl(seller.user_id + '/' + files[0].name).data.publicUrl
  }

  if (event === 'delivery_otp') {
    if (!input.order_id) return json({ error: 'Order is required.' }, 400)
    entityId = input.order_id
    const { data: order, error: orderError } = await admin.from('orders')
      .select('id,order_number,customer_id,customer_email')
      .eq('id', entityId).maybeSingle()
    if (orderError || !order) return json({ error: 'Order was not found.' }, 404)
    if (order.customer_id !== authData.user.id) return json({ error: 'You can only request a delivery code for your own order.' }, 403)

    const customerEmail = order.customer_email ?? await userEmail(order.customer_id)
    if (!customerEmail) return json({ error: 'No registered email address is available for this order.' }, 409)

    // The existing database RPC checks ownership and requires the driver to have picked up the parcel.
    // The generated code is never returned to the browser; it is sent only to the registered customer email.
    const { data: code, error: otpError } = await caller.rpc('customer_generate_delivery_otp', { p_order_id: entityId })
    if (otpError || typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
      return json({ error: otpError?.message || 'A delivery code is not available yet. The driver must pick up the parcel first.' }, 409)
    }
    const { data: assignment } = await admin.from('driver_assignments')
      .select('delivery_otp_expires_at').eq('order_id', entityId).maybeSingle()
    deliveryOtpCode = code
    eventDedupeSuffix = assignment?.delivery_otp_expires_at ?? new Date().toISOString()
    emailOrderNumber = order.order_number
    recipients.push(customerEmail)
    subject = 'Your JTBazar delivery verification code'
    body = 'Use this one-time code to confirm that you received your JTBazar delivery. It expires in 30 minutes. Share it only with the JTBazar delivery driver at the time of handover.'
    eventType = 'delivery_otp'
  } else if (event === 'order_placed' || event === 'order_status') {
    if (!input.order_id) return json({ error: 'Order is required.' }, 400)
    entityId = input.order_id
    const { data: order, error } = await admin.from('orders')
      .select('id,order_number,customer_id,customer_email,customer_name,total,order_status,confirmation_status')
      .eq('id', entityId).maybeSingle()
    if (error || !order) return json({ error: 'Order was not found.' }, 404)

    if (event === 'order_placed' && order.customer_id !== authData.user.id) {
      return json({ error: 'You can only notify about your own order.' }, 403)
    }
    if (event === 'order_status') {
      if (!(await requireAdmin())) return json({ error: 'Administrator access is required.' }, 403)
      const status = input.status ?? ''
      const validStatuses = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'rejected']
      const isRejected = status === 'rejected' && order.order_status === 'cancelled' && order.confirmation_status === 'not_reachable'
      if (!validStatuses.includes(status) || (!isRejected && order.order_status !== status)) {
        return json({ error: 'Order status event is invalid or stale.' }, 409)
      }
    }

    const { data: items, error: itemsError } = await admin.from('order_items')
      .select('seller_id,product_name_snapshot,sku_snapshot,variant_snapshot,quantity,unit_price,line_total')
      .eq('order_id', entityId).order('created_at')
    if (itemsError) return json({ error: 'Order items could not be loaded.' }, 500)
    emailOrderNumber = order.order_number
    emailTotal = Number(order.total)
    emailItems = (items ?? []) as EmailOrderItem[]

    const customerEmail = order.customer_email ?? await userEmail(order.customer_id)
    if (customerEmail) recipients.push(customerEmail)

    if (event === 'order_placed') {
      if (inbox) recipients.push(inbox)
      const sellerIds = [...new Set((items ?? []).map((item) => item.seller_id).filter((id): id is string => Boolean(id)))]
      for (const sellerId of sellerIds) {
        const { data: seller } = await admin.from('seller_profiles').select('user_id').eq('id', sellerId).maybeSingle()
        const email = await userEmail(seller?.user_id ?? null)
        if (email) recipients.push(email)
      }
      subject = 'We received your JTBazar order ' + order.order_number
      body = 'Thank you ' + order.customer_name + '. We received your order for PKR ' + Number(order.total).toLocaleString('en-PK') + '. Our team will contact you to confirm it.'
      eventType = 'order_placed'
    } else {
      const labels: Record<string, string> = {
        confirmed: 'confirmed', processing: 'being prepared', shipped: 'shipped',
        delivered: 'delivered', cancelled: 'cancelled', rejected: 'not confirmed',
      }
      subject = input.status === 'rejected'
        ? 'Your JTBazar order could not be confirmed: ' + order.order_number
        : 'JTBazar order ' + labels[input.status!] + ': ' + order.order_number
      body = input.status === 'rejected'
        ? 'We could not confirm your order ' + order.order_number + '. Please contact JTBazar support if you need help.'
        : 'Your order ' + order.order_number + ' is now ' + labels[input.status!] + '.'
      eventType = 'order_' + input.status
    }
  } else if (event === 'vendor_fulfillment') {
    if (!input.order_item_id || !['accepted', 'shipped', 'delivered'].includes(input.status ?? '')) {
      return json({ error: 'Fulfilment event is invalid.' }, 400)
    }
    entityId = input.order_item_id
    const { data: item, error } = await admin.from('order_items')
      .select('id,order_id,seller_id,vendor_fulfillment_status,product_name_snapshot,sku_snapshot,variant_snapshot,quantity,unit_price,line_total')
      .eq('id', entityId).maybeSingle()
    if (error || !item) return json({ error: 'Order item was not found.' }, 404)
    const { data: seller } = await admin.from('seller_profiles').select('id,user_id').eq('id', item.seller_id).maybeSingle()
    if (!seller || seller.user_id !== authData.user.id) return json({ error: 'Only the assigned seller can send this update.' }, 403)
    if (item.vendor_fulfillment_status !== input.status) return json({ error: 'Fulfilment status event is stale.' }, 409)

    const { data: order } = await admin.from('orders')
      .select('id,order_number,customer_id,customer_email,total').eq('id', item.order_id).maybeSingle()
    if (order) {
      entityId = order.id
      emailOrderNumber = order.order_number
      emailTotal = Number(order.total)
      const { data: relatedItems } = await admin.from('order_items')
        .select('product_name_snapshot,sku_snapshot,variant_snapshot,quantity,unit_price,line_total')
        .eq('order_id', order.id).order('created_at')
      emailItems = (relatedItems ?? []) as EmailOrderItem[]
    } else emailItems = [item as EmailOrderItem]

    const email = order?.customer_email ?? await userEmail(order?.customer_id ?? null)
    if (email) recipients.push(email)
    const label = input.status === 'accepted' ? 'accepted by the seller' : input.status
    subject = 'Order update: ' + (order?.order_number ?? '')
    body = 'The seller has ' + label + ' your order ' + (order?.order_number ?? '') + '.'
    eventType = input.status === 'accepted' ? 'vendor_accepted_' + seller.user_id : 'order_' + input.status
  } else if (event === 'seller_approved' || event === 'seller_rejected') {
    if (!input.seller_profile_id) return json({ error: 'Seller application is required.' }, 400)
    if (!(await requireAdmin())) return json({ error: 'Administrator access is required.' }, 403)
    entityId = input.seller_profile_id
    const { data: seller, error } = await admin.from('seller_profiles')
      .select('id,user_id,shop_name,status,shop_image_url,rejection_reason').eq('id', entityId).maybeSingle()
    if (error || !seller) return json({ error: 'Seller application was not found.' }, 404)
    if (event === 'seller_approved' && seller.status !== 'approved') return json({ error: 'Seller application is not approved.' }, 409)
    if (event === 'seller_rejected' && seller.status !== 'rejected') return json({ error: 'Seller application is not rejected.' }, 409)
    const email = await userEmail(seller.user_id)
    if (email) recipients.push(email)
    sellerShopName = seller.shop_name
    sellerShopImageUrl = await resolveShopImage({ user_id: seller.user_id, shop_image_url: seller.shop_image_url })
    sellerReviewNote = seller.rejection_reason ?? ''
    if (event === 'seller_approved') {
      subject = 'Your JTBazar seller shop is approved'
      body = 'Congratulations! ' + seller.shop_name + ' has been approved. Your seller dashboard is now ready, and you can start managing your shop and products.'
      sellerEmailActionUrl = 'https://front-ecommerce-gamma.vercel.app/vendor'
      sellerEmailActionLabel = 'Open Seller Dashboard'
      eventType = 'seller_approved'
    } else {
      subject = 'An update about your JTBazar seller application'
      body = 'Thank you for your interest in selling on JTBazar. After reviewing your application for ' + seller.shop_name + ', our marketplace team could not approve it at this time. Please review the note below and contact our team if you need clarification.'
      sellerEmailActionUrl = 'https://front-ecommerce-gamma.vercel.app/account'
      sellerEmailActionLabel = 'View Application'
      eventType = 'seller_rejected'
    }
  } else {
    return json({ error: 'Unsupported email event.' }, 400)
  }

  const uniqueRecipients = [...new Set(recipients.filter(Boolean))]
  if (uniqueRecipients.length === 0) return json({ sent: false, reason: 'recipient_missing' })

  let sent = 0
  let deliveryFailures = 0
  for (const recipient of uniqueRecipients) {
    const eventKey = eventType + ':' + entityId + ':' + recipient.toLowerCase() + (eventDedupeSuffix ? ':' + eventDedupeSuffix : '')
    const { error: claimError } = await admin.from('email_notification_events').insert({
      event_key: eventKey, event_type: eventType, entity_id: entityId, recipient_email: recipient,
    })
    if (claimError?.code === '23505') { sent++; continue }
    if (claimError) {
      console.error('JTBazar email event could not be claimed:', claimError.message)
      deliveryFailures++
      continue
    }

    try {
      const statusLabel = eventType === 'order_placed' ? 'Order received' : eventType === 'seller_approved' ? 'Application approved' : eventType === 'seller_rejected' ? 'Application update' : eventType.replace('order_', '').replace(/_/g, ' ')
      const statusColors: Record<string, { bg: string; fg: string }> = {
        'order received': { bg: '#fff4db', fg: '#8a5a00' },
        confirmed: { bg: '#e8f7ee', fg: '#176b3a' },
        processing: { bg: '#fff4db', fg: '#8a5a00' },
        shipped: { bg: '#eaf2ff', fg: '#2456a6' },
        delivered: { bg: '#e8f7ee', fg: '#176b3a' },
        cancelled: { bg: '#fff0ee', fg: '#a83224' },
        rejected: { bg: '#fff0ee', fg: '#a83224' },
        'application approved': { bg: '#e8f7ee', fg: '#176b3a' },
        'application update': { bg: '#fff4db', fg: '#8a5a00' },
      }
      const tone = statusColors[statusLabel] ?? { bg: '#eef2f7', fg: '#344054' }
      const itemRows = emailItems.map((item) => {
        const variant = variantLabel(item.variant_snapshot)
        const details = [item.sku_snapshot ? 'SKU: ' + item.sku_snapshot : '', variant].filter(Boolean).join(' · ')
        const amount = Number(item.line_total ?? Number(item.unit_price) * Number(item.quantity))
        return '<tr><td style="padding:13px 10px;border-bottom:1px solid #edf0f4"><strong>' +
          escapeHtml(item.product_name_snapshot || 'Product') + '</strong>' +
          (details ? '<div style="font-size:11px;color:#667085;margin-top:4px">' + escapeHtml(details) + '</div>' : '') +
          '</td><td align="center" style="padding:13px 8px;border-bottom:1px solid #edf0f4">' +
          Number(item.quantity) + '</td><td align="right" style="padding:13px 10px;border-bottom:1px solid #edf0f4">PKR ' +
          amount.toLocaleString('en-PK') + '</td></tr>'
      }).join('')
      const itemsTable = '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:16px">' +
        '<thead><tr style="background:#f7f8fa;color:#667085;font-size:11px;text-transform:uppercase">' +
        '<th align="left" style="padding:10px">Item</th><th align="center" style="padding:10px">Qty</th>' +
        '<th align="right" style="padding:10px">Amount</th></tr></thead><tbody>' +
        (itemRows || '<tr><td colspan="3" style="padding:14px">Order items are being prepared.</td></tr>') +
        '</tbody></table>'
      const orderReference = emailOrderNumber || entityId
      let html = '<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#182230">' +
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + escapeHtml(body) + '</div>' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f8;padding:28px 10px"><tr><td align="center">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #e6eaf0;border-radius:16px;overflow:hidden">' +
        '<tr><td style="padding:25px 30px;background:#243b2a;color:#fff"><div style="font-size:25px;font-weight:800;letter-spacing:-.5px">JTBazar</div>' +
        '<div style="font-size:11px;color:#d9e4d7;margin-top:5px;letter-spacing:1px">SHOP SMART. LIVE BETTER.</div></td></tr>' +
        '<tr><td style="padding:28px 30px"><span style="display:inline-block;padding:7px 11px;border-radius:20px;background:' + tone.bg +
        ';color:' + tone.fg + ';font-size:11px;font-weight:700;text-transform:uppercase">' + escapeHtml(statusLabel) + '</span>' +
        '<h1 style="font-size:23px;line-height:1.3;margin:17px 0 9px;color:#243b2a">' + escapeHtml(subject) + '</h1>' +
        '<p style="font-size:14px;line-height:1.7;color:#526071;margin:0">' + escapeHtml(body) + '</p>' +
        (deliveryOtpCode ? '<div style="margin-top:22px;padding:22px 16px;text-align:center;border:1px solid #dce8df;border-radius:12px;background:#f4faf5"><div style="font-size:10px;color:#667085;text-transform:uppercase;letter-spacing:1.5px">Your delivery code</div><div style="font-size:34px;font-weight:800;letter-spacing:9px;color:#173f32;margin-top:10px">' + escapeHtml(deliveryOtpCode) + '</div><div style="font-size:11px;color:#667085;margin-top:10px">Valid for 30 minutes · One-time use</div></div>' : '') +
        '<div style="margin-top:22px;padding:14px 16px;border:1px solid #e6eaf0;border-radius:10px;background:#fafbfc">' +
        '<div style="font-size:10px;color:#667085;text-transform:uppercase;letter-spacing:1px">Order number</div>' +
        '<div style="font-size:17px;font-weight:700;color:#243b2a;margin-top:6px">' + escapeHtml(orderReference) + '</div></div>' +
        itemsTable + '<div style="display:flex;justify-content:flex-end;margin-top:16px;padding-top:14px;border-top:1px solid #e6eaf0">' +
        '<strong style="font-size:15px;color:#243b2a">Order total: PKR ' + Number(emailTotal).toLocaleString('en-PK') + '</strong></div>' +
        '<p style="font-size:12px;line-height:1.6;color:#667085;margin:23px 0 0">We will keep you updated as your order moves through each stage. Thank you for shopping with JTBazar.</p>' +
        '</td></tr><tr><td style="padding:18px 30px;border-top:1px solid #edf0f4;background:#fafbfc;font-size:11px;color:#98a2b3">' +
        'This is an automated order notification from JTBazar.</td></tr></table></td></tr></table></body></html>'

      if (eventType === 'seller_approved' || eventType === 'seller_rejected') {
        const shopImageBlock = sellerShopImageUrl
          ? '<div style="margin:0 0 24px;text-align:center"><img src="' + escapeHtml(sellerShopImageUrl) + '" alt="' + escapeHtml(sellerShopName) + '" width="520" style="display:block;width:100%;max-width:520px;max-height:250px;object-fit:cover;border-radius:12px;border:1px solid #e7ece7"></div>'
          : ''
        const reviewNoteBlock = eventType === 'seller_rejected' && sellerReviewNote
          ? '<div style="margin-top:20px;padding:16px 18px;border:1px solid #f1dfb8;border-radius:10px;background:#fffaf0"><div style="font-size:10px;color:#8a5a00;text-transform:uppercase;letter-spacing:1px;font-weight:700">Marketplace team note</div><p style="font-size:13px;line-height:1.7;color:#684b1c;margin:8px 0 0">' + escapeHtml(sellerReviewNote) + '</p></div>'
          : ''
        const ctaBlock = '<div style="text-align:center;margin:28px 0 8px"><a href="' + escapeHtml(sellerEmailActionUrl) + '" style="display:inline-block;background:#173f32;color:#fff;text-decoration:none;padding:14px 26px;border-radius:8px;font-size:14px;font-weight:700">' + escapeHtml(sellerEmailActionLabel) + '</a></div>'
        html = '<!doctype html><html><body style="margin:0;padding:0;background:#f4f6f3;font-family:Arial,Helvetica,sans-serif;color:#26352d">' +
          '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + escapeHtml(body) + '</div>' +
          '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f3;padding:32px 12px"><tr><td align="center">' +
          '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e7ece7;border-radius:16px;overflow:hidden">' +
          '<tr><td style="background:#173f32;padding:28px 30px;text-align:center"><div style="font-size:29px;line-height:1.2;font-weight:800;letter-spacing:-.6px;color:#fff">JTBazar</div><div style="margin-top:7px;color:#d8e7dc;font-size:12px;letter-spacing:.5px">Your marketplace, your choice</div></td></tr>' +
          '<tr><td style="padding:32px 30px 34px">' +
          '<div style="text-align:center;margin-bottom:22px"><span style="display:inline-block;padding:7px 13px;border-radius:30px;background:' + tone.bg + ';color:' + tone.fg + ';font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase">' + escapeHtml(statusLabel) + '</span></div>' +
          shopImageBlock +
          '<h1 style="font-size:25px;line-height:1.3;text-align:center;color:#173f32;margin:0 0 14px">' + escapeHtml(subject) + '</h1>' +
          '<p style="font-size:14px;line-height:1.8;color:#647168;margin:0;text-align:center">' + escapeHtml(body) + '</p>' +
          '<div style="margin:24px 0 0;padding:17px 18px;border:1px solid #e7ece7;border-radius:11px;background:#f8faf8"><div style="font-size:10px;color:#89938c;text-transform:uppercase;letter-spacing:1px">Shop application</div><div style="font-size:18px;font-weight:700;color:#173f32;margin-top:6px">' + escapeHtml(sellerShopName) + '</div></div>' +
          reviewNoteBlock + ctaBlock +
          '<p style="font-size:12px;line-height:1.7;color:#89938c;text-align:center;margin:25px 0 0">If you have questions, please contact the JTBazar marketplace team. This is an automated notification; please do not reply directly.</p>' +
          '</td></tr><tr><td style="background:#f7f9f7;border-top:1px solid #e7ece7;padding:18px 24px;text-align:center;color:#89938c;font-size:11px">© JTBazar. All rights reserved.</td></tr></table>' +
          '</td></tr></table></body></html>'
      }

      const provider = await sendEmail(recipient, subject, html)
      if (provider) {
        sent++
        await admin.from('email_notification_events').update({ sent_at: new Date().toISOString() }).eq('event_key', eventKey)
      } else {
        await admin.from('email_notification_events').delete().eq('event_key', eventKey)
      }
    } catch (cause) {
      deliveryFailures++
      console.error('JTBazar order email delivery failed:', cause instanceof Error ? cause.message : String(cause))
      await admin.from('email_notification_events').delete().eq('event_key', eventKey)
    }
  }

  return json({ sent: sent > 0, recipients_sent: sent, delivery_failures: deliveryFailures })
})
