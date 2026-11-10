import { useEffect, useMemo, useState } from 'react'
import { Clock3, Store } from 'lucide-react'
import { loadStoreSettings, type StoreSettings } from '../../services/store/storeSettingsService'

type Hours = StoreSettings['marketplaceHours']
type Status = { open: boolean; target: number; label: string; closingLabel?: string }

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const DAY_INDEX: Record<string, number> = Object.fromEntries(DAYS.map((day, index) => [day, index]))

function localWallParts(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function toWallTimestamp(timestamp: number) {
  const p = localWallParts(timestamp)
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
}

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function calculateStatus(hours: Hours, now: number): Status | null {
  if (!hours || typeof hours !== 'object') return null
  const p = localWallParts(now)
  const todayIndex = DAY_INDEX[String(p.weekday).toLowerCase()]
  const baseDate = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))
  const wallNow = toWallTimestamp(now)
  const candidates: Array<{ start: number; end: number; open: boolean; close: string }> = []

  for (let offset = -1; offset <= 8; offset += 1) {
    const day = DAYS[(todayIndex + offset + 7) % 7]
    const rule = hours[day]
    if (!rule?.enabled || typeof rule.open !== 'string' || typeof rule.close !== 'string') continue
    const dayStart = baseDate + offset * 86400000
    const start = dayStart + clockMinutes(rule.open) * 60000
    const end = dayStart + (Number(rule.close_day_offset || 0) * 1440 + clockMinutes(rule.close)) * 60000
    if (end > start) candidates.push({ start, end, open: wallNow >= start && wallNow < end, close: rule.close })
  }

  const active = candidates.find((item) => item.open)
  if (active) return { open: true, target: active.end, label: 'Closes in', closingLabel: active.close }
  const next = candidates.filter((item) => item.start > wallNow).sort((a, b) => a.start - b.start)[0]
  return next ? { open: false, target: next.start, label: 'Next opening in' } : null
}

function countdown(target: number, now: number) {
  const seconds = Math.max(0, Math.floor((target - toWallTimestamp(now)) / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  return days > 0
    ? `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
}

function formatClock(value?: string) {
  if (!value) return ''
  const [hour, minute] = value.split(':').map(Number)
  const date = new Date(Date.UTC(2020, 0, 1, hour, minute))
  return new Intl.DateTimeFormat('en-PK', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(date)
}

export function MarketplaceHoursStatus() {
  const [hours, setHours] = useState<Hours | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let active = true
    void loadStoreSettings().then((settings) => { if (active) setHours(settings.marketplaceHours) })
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  const status = useMemo(() => hours ? calculateStatus(hours, now) : null, [hours, now])
  if (!status) return null

  return (
    <section className={`marketplace-hours-card ${status.open ? 'is-open' : 'is-closed'}`} aria-live="polite">
      <div className="marketplace-hours-card__identity">
        <span className="marketplace-hours-card__icon"><Store size={21} /></span>
        <div><p>JTBazar Food &amp; Shops</p><span><i /> {status.open ? 'OPEN NOW' : 'SHOP CLOSED'}</span></div>
      </div>
      <div className="marketplace-hours-card__count">
        <span>{status.label}</span>
        <strong><Clock3 size={18} /> {countdown(status.target, now)}</strong>
      </div>
      <div className="marketplace-hours-card__detail">
        {status.open ? <>Closing time: <strong>{formatClock(status.closingLabel)}</strong></> : <>Next opening: <strong>{new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(status.target - 5 * 3600000))}</strong></>}
        <small>Pakistan Standard Time</small>
      </div>
      <style>{`
        .marketplace-hours-card{display:grid;grid-template-columns:1.3fr 1fr 1fr;align-items:center;gap:18px;max-width:1240px;margin:22px auto;padding:18px 22px;border-radius:20px;color:#fff;background:linear-gradient(112deg,#f97316 0%,#c2410c 48%,#581c87 100%);box-shadow:0 14px 35px #7c2d121f}
        .marketplace-hours-card__identity{display:flex;align-items:center;gap:12px}.marketplace-hours-card__icon{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:#ffffff25}
        .marketplace-hours-card__identity p{margin:0 0 5px;font-size:15px;font-weight:800}.marketplace-hours-card__identity span:not(.marketplace-hours-card__icon){font-size:11px;font-weight:800;letter-spacing:.09em}
        .marketplace-hours-card__identity i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#86efac;margin-right:5px;box-shadow:0 0 0 3px #86efac33}.marketplace-hours-card.is-closed .marketplace-hours-card__identity i{background:#fecaca;box-shadow:0 0 0 3px #fecaca33}
        .marketplace-hours-card__count{display:grid;gap:5px}.marketplace-hours-card__count span,.marketplace-hours-card__detail{font-size:12px;color:#ffedd5}.marketplace-hours-card__count strong{display:flex;align-items:center;gap:8px;font-size:clamp(22px,3vw,30px);font-variant-numeric:tabular-nums;letter-spacing:.04em}
        .marketplace-hours-card__detail{display:grid;gap:5px}.marketplace-hours-card__detail strong{color:#fff}.marketplace-hours-card__detail small{font-size:10px;color:#fed7aa}
        @media(max-width:680px){.marketplace-hours-card{grid-template-columns:1fr 1fr;margin:16px 12px;padding:16px;gap:14px}.marketplace-hours-card__detail{grid-column:1/-1;padding-top:10px;border-top:1px solid #ffffff35}}
      `}</style>
    </section>
  )
}
