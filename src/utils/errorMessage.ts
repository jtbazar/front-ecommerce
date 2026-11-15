type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; details?: unknown; hint?: unknown }

export function toUserErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const value = (error && typeof error === 'object' ? error : {}) as ErrorLike
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : ''
  const code = typeof value.code === 'string' ? value.code : ''
  const status = Number(value.status)

  if (/network|failed to fetch|fetch failed|load failed|timeout|timed out/.test(message)) {
    return 'Connection problem. Check your internet and try again.'
  }
  if (code === '23505' || /duplicate key|already exists/.test(message)) {
    return 'This record already exists. Refresh the page and try again.'
  }
  if (code === '23503' || /foreign key/.test(message)) {
    return 'This item is linked to another record and cannot be changed right now.'
  }
  if (code === '23514' || /check constraint/.test(message)) {
    return 'Some information is invalid. Review the fields and try again.'
  }
  if (code === '22P02' || /invalid input syntax/.test(message)) {
    return 'Some information has an invalid format. Review the fields and try again.'
  }
  if (code === '42501' || status === 401 || status === 403 || /permission denied|not authorized|row-level security|jwt/.test(message)) {
    return 'You do not have permission to complete this action. Sign in again if needed.'
  }
  if (status === 404 || code === 'PGRST116') {
    return 'The requested information is no longer available. Refresh and try again.'
  }
  if (/stock|availability|out of stock/.test(message)) {
    return 'Stock or availability changed. Refresh the product and try again.'
  }
  return fallback
}
