import { getSupabase } from '../../lib/supabase'
import { isValidPakistaniMobile, normalizePakistaniMobile } from '../../utils/contactValidation'

export interface SavedAddress {
  id: string
  recipient_name: string
  phone: string
  address_line_1: string
  address_line_2: string | null
  city: string
  province: string | null
  postal_code: string | null
  delivery_instructions: string | null
  location_label: string | null
  latitude: number | null
  longitude: number | null
  is_default: boolean
}

export interface AddressInput {
  recipient_name: string
  phone: string
  address_line_1: string
  address_line_2: string | null
  city: string
  province: string | null
  postal_code: string | null
  delivery_instructions: string | null
  location_label?: string | null
  latitude?: number | null
  longitude?: number | null
  is_default: boolean
}

const ADDRESS_COLUMNS = 'id, recipient_name, phone, address_line_1, address_line_2, city, province, postal_code, delivery_instructions, location_label, latitude, longitude, is_default'

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function listMyAddresses(): Promise<SavedAddress[]> {
  const { data, error } = await getSupabase()
    .from('customer_addresses')
    .select(ADDRESS_COLUMNS)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []) as SavedAddress[]
}

export async function createAddress(input: AddressInput): Promise<SavedAddress> {
  if (!isValidPakistaniMobile(input.phone)) throw new Error('Enter exactly 03001234567 or +923001234567.')
  const { data: auth } = await getSupabase().auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('Sign in before saving an address.')
  if (input.is_default) {
    await getSupabase().from('customer_addresses').update({ is_default: false }).eq('user_id', userId).eq('is_default', true)
  }
  const { data, error } = await getSupabase()
    .from('customer_addresses')
    .insert({ ...input, phone: normalizePakistaniMobile(input.phone), user_id: userId })
    .select(ADDRESS_COLUMNS)
    .single()
  throwIfError(error)
  if (!data) throw new Error('The address was not saved.')
  return data as SavedAddress
}

export async function updateAddress(id: string, input: AddressInput): Promise<SavedAddress> {
  if (!isValidPakistaniMobile(input.phone)) throw new Error('Enter exactly 03001234567 or +923001234567.')
  const client = getSupabase()
  const user = (await client.auth.getUser()).data.user
  if (!user) throw new Error('Sign in before updating an address.')
  if (input.is_default) {
    await client.from('customer_addresses').update({ is_default: false }).eq('user_id', user.id).eq('is_default', true)
  }
  const { data, error } = await client
    .from('customer_addresses')
    .update({ ...input, phone: normalizePakistaniMobile(input.phone) })
    .eq('id', id)
    .select(ADDRESS_COLUMNS)
    .single()
  throwIfError(error)
  if (!data) throw new Error('The address was not updated.')
  return data as SavedAddress
}

export async function setDefaultAddress(id: string): Promise<void> {
  const client = getSupabase()
  const user = (await client.auth.getUser()).data.user
  if (!user) throw new Error('Sign in before updating an address.')
  const clear = await client.from('customer_addresses').update({ is_default: false }).eq('user_id', user.id).eq('is_default', true)
  throwIfError(clear.error)
  const update = await client.from('customer_addresses').update({ is_default: true }).eq('id', id)
  throwIfError(update.error)
}

export async function deleteAddress(id: string): Promise<void> {
  const { error } = await getSupabase().from('customer_addresses').delete().eq('id', id)
  throwIfError(error)
}
