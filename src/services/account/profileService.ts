import { getSupabase } from '../../lib/supabase'
import { isValidPakistaniMobile, normalizePakistaniMobile } from '../../utils/contactValidation'
const BUCKET = 'customer-avatars'
const MAX_BYTES = 5 * 1024 * 1024
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function previousPath(url: string | null, userId: string): string | null {
  if (!url) return null
  try {
    const marker = '/storage/v1/object/public/' + BUCKET + '/'
    const path = new URL(url).pathname
    const index = path.indexOf(marker)
    if (index < 0) return null
    const value = decodeURIComponent(path.slice(index + marker.length))
    return value.startsWith(userId + '/') ? value : null
  } catch { return null }
}

export async function saveMyProfile(input: { fullName: string; phone: string; avatarFile?: File | null }) {
  const supabase = getSupabase()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError
  const user = auth.user
  if (!user) throw new Error('Please sign in to update your profile.')
  const fullName = input.fullName.trim()
  const phone = input.phone.trim()
  if (phone && !isValidPakistaniMobile(phone)) throw new Error('Enter exactly 03001234567 or +923001234567.')
  if (!fullName || fullName.length > 120) throw new Error('Enter a name of up to 120 characters.')
  if (phone.length > 30) throw new Error('Phone number must be 30 characters or fewer.')
  const { data: oldProfile } = await supabase.from('profiles').select('avatar_url').eq('id', user.id).maybeSingle()
  let uploadedPath: string | null = null
  let avatarUrl: string | undefined
  if (input.avatarFile) {
    if (!TYPES.has(input.avatarFile.type)) throw new Error('Choose a JPG, PNG or WebP image.')
    if (input.avatarFile.size > MAX_BYTES) throw new Error('Profile photo must be 5 MB or smaller.')
    const ext = input.avatarFile.type === 'image/jpeg' ? 'jpg' : input.avatarFile.type === 'image/png' ? 'png' : 'webp'
    uploadedPath = user.id + '/' + crypto.randomUUID() + '.' + ext
    const upload = await supabase.storage.from(BUCKET).upload(uploadedPath, input.avatarFile, { contentType: input.avatarFile.type, cacheControl: '3600', upsert: false })
    if (upload.error) throw upload.error
    avatarUrl = supabase.storage.from(BUCKET).getPublicUrl(uploadedPath).data.publicUrl
  }
  const result = await supabase.from('profiles').upsert({
    id: user.id,
    full_name: fullName,
    phone: phone ? normalizePakistaniMobile(phone) : null,
    ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select('id').single()
  if (result.error || !result.data) {
    if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath])
    if (result.error) throw result.error
    throw new Error('Your profile could not be saved. Please try again.')
  }
  const oldPath = previousPath(oldProfile?.avatar_url ?? null, user.id)
  if (uploadedPath && oldPath && oldPath !== uploadedPath) await supabase.storage.from(BUCKET).remove([oldPath])
}
