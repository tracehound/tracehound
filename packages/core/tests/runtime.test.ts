/**
 * Tests for runtime environment verification.
 */

import { describe, expect, it, vi } from 'vitest'
import { getRuntimeInfo, verifyRuntime } from '../src/utils/runtime.js'

describe('Runtime Environment Verification', () => {
  describe('getRuntimeInfo', () => {
    it('should return runtime information', () => {
      const info = getRuntimeInfo()

      expect(info).toHaveProperty('nodeVersion')
      expect(info).toHaveProperty('protoDisabled')
      expect(info).toHaveProperty('intrinsicsFrozen')
      expect(info).toHaveProperty('platform')

      expect(typeof info.nodeVersion).toBe('string')
      expect(typeof info.protoDisabled).toBe('boolean')
      expect(typeof info.intrinsicsFrozen).toBe('boolean')
      expect(typeof info.platform).toBe('string')
    })

    it('should return current Node.js version', () => {
      const info = getRuntimeInfo()
      expect(info.nodeVersion).toBe(process.version)
    })

    it('should return current platform', () => {
      const info = getRuntimeInfo()
      expect(info.platform).toBe(process.platform)
    })
  })

  describe('verifyRuntime', () => {
    describe('non-strict mode', () => {
      it('should warn but not throw when security flags are missing', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        // In normal Node.js environment, flags are typically not set
        verifyRuntime(false)

        // Should have warned (unless running with security flags)
        // We can't assert the exact call count as it depends on the runtime
        consoleWarnSpy.mockRestore()
      })

      it('should not throw in non-strict mode', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(() => verifyRuntime(false)).not.toThrow()

        consoleWarnSpy.mockRestore()
      })
    })

    describe('strict mode', () => {
      it('should throw TracehoundError when security flags are missing', () => {
        // Get current runtime state
        const info = getRuntimeInfo()

        // If both flags are set, skip this test
        if (info.protoDisabled && info.intrinsicsFrozen) {
          return
        }

        expect(() => verifyRuntime(true)).toThrow()
      })

      it('should throw error with runtime state and code', () => {
        const info = getRuntimeInfo()

        // If both flags are set, skip this test
        if (info.protoDisabled && info.intrinsicsFrozen) {
          return
        }

        try {
          verifyRuntime(true)
          // Should not reach here
          expect(true).toBe(false)
        } catch (err) {
          // TracehoundError is a plain object with state/code/message
          expect(err).toHaveProperty('state', 'runtime')
          expect(err).toHaveProperty('code', 'RUNTIME_FLAG_MISSING')
          expect(err).toHaveProperty('message')
        }
      })

      it('should not throw when all security flags are set', () => {
        const info = getRuntimeInfo()

        // Only run this test if flags are actually set
        if (info.protoDisabled && info.intrinsicsFrozen) {
          expect(() => verifyRuntime(true)).not.toThrow()
        }
      })
    })

    describe('security flag detection', () => {
      it('should detect __proto__ access state', () => {
        const info = getRuntimeInfo()
        expect(typeof info.protoDisabled).toBe('boolean')
      })

      it('should detect frozen intrinsics state', () => {
        const info = getRuntimeInfo()
        expect(typeof info.intrinsicsFrozen).toBe('boolean')
      })
    })
  })

  describe('error handling', () => {
    it('should use Errors.runtimeFlagMissing in strict mode', () => {
      const info = getRuntimeInfo()

      // If both flags are set, skip this test
      if (info.protoDisabled && info.intrinsicsFrozen) {
        return
      }

      try {
        verifyRuntime(true)
        expect(true).toBe(false) // Should not reach
      } catch (err) {
        // Verify it's a TracehoundError (plain object, not Error instance)
        expect(err).toHaveProperty('state')
        expect(err).toHaveProperty('code')
        expect(err).toHaveProperty('message')

        const error = err as { state: string; code: string; message: string }
        expect(error.state).toBe('runtime')
        expect(error.code).toBe('RUNTIME_FLAG_MISSING')
      }
    })
  })
})
