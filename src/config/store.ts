export const STORE_NAME = 'JTBazar'
export const DEFAULT_SUPPORT_EMAIL = 'hunainhaider811@gmail.com'
export const SITE_URL = import.meta.env.VITE_SITE_URL || 'https://www.jt-bazar.com'
export const ANNOUNCEMENT_TEXT = 'Welcome to JTBazar — Discover quality finds from trusted sellers'
/** Optional social profiles. Add verified URLs in one place; empty entries are not rendered. */
export const SOCIAL_LINKS: { label: 'Facebook' | 'Instagram' | 'TikTok' | 'WhatsApp'; href: string }[] = [
  { label: 'TikTok', href: 'https://www.tiktok.com/@jtbazarofficial' },
  { label: 'Instagram', href: 'https://www.instagram.com/jtbazarofficial/' },
  { label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61595825413366' },
]
