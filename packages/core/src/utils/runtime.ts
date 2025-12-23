/**
 * Runtime environment verification.
 */

import { Errors } from '../types/errors.js'

/**
 * Check if prototype access is disabled.
 * Returns true if --disable-proto=throw is set.
 */
function isProtoDisabled(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = {} as any
    // If __proto__ throws, flag is set correctly
    void obj.__proto__
    return false
  } catch {
    return true
  }
}

/**
 * Verify runtime environment meets security requirements.
 *
 * @param strict - If true, throw on missing flags. If false, warn only.
 * @throws {TracehoundError} if strict mode and flags missing
 */
export function verifyRuntime(strict: boolean): void {
  if (!isProtoDisabled()) {
    if (strict) {
      throw Errors.runtimeFlagMissing('--disable-proto=throw')
    } else {
      console.warn(
        '[tracehound] Warning: --disable-proto=throw not set. ' +
          'Prototype pollution attacks are possible.'
      )
    }
  }
}

/**
 * Get runtime environment info.
 */
export function getRuntimeInfo(): {
  nodeVersion: string
  protoDisabled: boolean
  platform: string
} {
  return {
    nodeVersion: process.version,
    protoDisabled: isProtoDisabled(),
    platform: process.platform,
  }
}
