/**
 * Shared JTBazar password policy for every password creation/update flow.
 * Minimum 8 characters with uppercase, lowercase, number and a non-space symbol.
 */
export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number and a special symbol.'

export function isStrongPassword(password: string): boolean {
  return password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9\s]/.test(password)
}
