import { getSupabase } from '../../lib/supabase'
import type { Database } from '../../types/database'

export type CustomerSupportTicket = Database['public']['Tables']['customer_support_tickets']['Row']
export type SupportTicketKind = 'customer' | 'seller'
export type SupportTicketEmailEvent = 'created' | 'admin_reply'
export type CustomerSupportMessage = { id: string; ticket_id: string; sender_id: string; sender_role: 'customer' | 'admin'; message: string; created_at: string }

export async function listMyCustomerSupportTickets(): Promise<CustomerSupportTicket[]> {
  const { data, error } = await getSupabase().from('customer_support_tickets')
    .select('*').order('updated_at', { ascending: false }).limit(30)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createCustomerSupportTicket(subject: string, message: string): Promise<CustomerSupportTicket> {
  const client = getSupabase()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) throw new Error('Sign in to send and track a support request.')
  const { data, error } = await client.from('customer_support_tickets')
    .insert({ user_id: user.id, requester_name: String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? 'Customer'), requester_email: user.email ?? '', subject: subject.trim(), message: message.trim() })
    .select('*').single()
  if (error) throw new Error(error.message)
  return data
}

export async function notifySupportEmail(ticketId: string, ticketKind: SupportTicketKind, event: SupportTicketEmailEvent): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().functions.invoke('support-email', {
      body: { ticket_id: ticketId, ticket_kind: ticketKind, event },
    })
    return !error && (data as { sent?: boolean } | null)?.sent === true
  } catch {
    return false
  }
}

export async function listMyCustomerSupportMessages(ticketId: string): Promise<CustomerSupportMessage[]> {
  const { data, error } = await (getSupabase() as any).from('customer_support_messages')
    .select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true }).limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as CustomerSupportMessage[]
}

export async function sendCustomerSupportMessage(ticketId: string, message: string): Promise<CustomerSupportMessage> {
  const client = getSupabase()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) throw new Error('Sign in to reply to support.')
  const { data, error } = await (client as any).from('customer_support_messages')
    .insert({ ticket_id: ticketId, sender_id: user.id, sender_role: 'customer', message: message.trim() })
    .select('*').single()
  if (error) throw new Error(error.message)
  return data as CustomerSupportMessage
}
