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
    // Use Reflect.get to probe __proto__ without bypassing TypeScript's type system.
    // If --disable-proto=throw is active, this throws at runtime.
    void Reflect.get({}, '__proto__')
    return false
  } catch {
    return true
  }
}

/**
 * Check if intrinsics are frozen.
 * Returns true if --frozen-intrinsics is set.
 */
function areIntrinsicsFrozen(): boolean {
  // If Object.prototype is frozen, flag is likely set
  return Object.isFrozen(Object.prototype)
}

/**
 * Verify runtime environment meets security requirements.
 *
 * Checks:
 * - --disable-proto=throw: Prevents prototype pollution via __proto__
 * - --frozen-intrinsics: Freezes built-in prototypes
 *
 * @param strict - If true, throw on missing flags. If false, warn only.
 * @throws {TracehoundError} if strict mode and flags missing
 */
export function verifyRuntime(strict: boolean): void {
  const issues: string[] = []

  if (!isProtoDisabled()) {
    issues.push('--disable-proto=throw not set. Prototype pollution via __proto__ possible.')
  }

  if (!areIntrinsicsFrozen()) {
    issues.push('--frozen-intrinsics not set. Built-in prototypes can be modified.')
  }

  if (issues.length > 0) {
    const message = `[tracehound] Runtime security issues:\n  - ${issues.join('\n  - ')}`

    if (strict) {
      throw Errors.runtimeFlagMissing(issues.join(', '))
    } else {
      console.warn(message)
    }
  }
}

/**
 * Get runtime environment info.
 */
export function getRuntimeInfo(): {
  nodeVersion: string
  protoDisabled: boolean
  intrinsicsFrozen: boolean
  platform: string
} {
  return {
    nodeVersion: process.version,
    protoDisabled: isProtoDisabled(),
    intrinsicsFrozen: areIntrinsicsFrozen(),
    platform: process.platform,
  }
}
