/**
 * Secure ID generation.
 */

import { randomBytes, randomUUID } from 'node:crypto'

/**
 * Generate a secure unique ID.
 * Combines UUIDv4 (crypto.randomUUID) with random suffix for additional entropy.
 *
 * Format: {uuidv4}-{random8chars}
 *
 * @returns Unique ID string
 */
export function generateSecureId(): string {
  const base = randomUUID()
  const randomSuffix = randomBytes(4).toString('hex')
  return `${base}-${randomSuffix}`
}

/**
 * Validate a secure ID format.
 *
 * @param id - ID to validate
 * @returns True if valid format
 */
export function isValidSecureId(id: string): boolean {
  // UUIDv4 (36 chars) + hyphen + 8 hex chars = 45 chars
  if (id.length !== 45) return false

  const [uuid, suffix] = id.split('-').reduce(
    (acc, part, i) => {
      if (i < 5) {
        acc[0] = acc[0] ? `${acc[0]}-${part}` : part
      } else {
        acc[1] = part
      }
      return acc
    },
    ['', ''] as [string, string],
  )

  // Validate UUIDv4 format
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(uuid)) return false

  // Validate suffix (8 hex chars)
  if (suffix === undefined || !/^[0-9a-f]{8}$/i.test(suffix)) return false

  return true
}
