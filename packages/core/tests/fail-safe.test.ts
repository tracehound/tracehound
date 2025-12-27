/**
 * Fail-Safe Panic tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFailSafe, FailSafe } from '../src/core/fail-safe.js'

describe('FailSafe', () => {
  let failSafe: FailSafe

  beforeEach(() => {
    failSafe = createFailSafe()
  })

  describe('callbacks', () => {
    it('should register and call callbacks for specific level', () => {
      const handler = vi.fn()
      failSafe.on('warning', handler)

      failSafe.panic('warning', 'test')

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          reason: 'manual',
        })
      )
    })

    it('should not call callbacks for different levels', () => {
      const warningHandler = vi.fn()
      const criticalHandler = vi.fn()

      failSafe.on('warning', warningHandler)
      failSafe.on('critical', criticalHandler)

      failSafe.panic('warning')

      expect(warningHandler).toHaveBeenCalledTimes(1)
      expect(criticalHandler).not.toHaveBeenCalled()
    })

    it('should call onAny for all levels', () => {
      const handler = vi.fn()
      failSafe.onAny(handler)

      failSafe.panic('warning')
      failSafe.panic('critical')
      failSafe.panic('emergency')

      expect(handler).toHaveBeenCalledTimes(3)
    })
  })

  describe('checkMemory', () => {
    it('should trigger warning at 70%', () => {
      const handler = vi.fn()
      failSafe.on('warning', handler)

      failSafe.checkMemory(70, 100)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          reason: 'memory_threshold',
        })
      )
    })

    it('should trigger critical at 85%', () => {
      const handler = vi.fn()
      failSafe.on('critical', handler)

      failSafe.checkMemory(85, 100)

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should trigger emergency at 95%', () => {
      const handler = vi.fn()
      failSafe.on('emergency', handler)

      failSafe.checkMemory(95, 100)

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should not trigger below warning threshold', () => {
      const handler = vi.fn()
      failSafe.onAny(handler)

      failSafe.checkMemory(50, 100)

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('checkQuarantine', () => {
    it('should trigger based on capacity ratio', () => {
      const handler = vi.fn()
      failSafe.on('critical', handler)

      failSafe.checkQuarantine(850, 1000)

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'quarantine_capacity',
        })
      )
    })
  })

  describe('checkErrorRate', () => {
    it('should trigger based on errors per minute', () => {
      const handler = vi.fn()
      failSafe.on('warning', handler)

      failSafe.checkErrorRate(15) // > 10 = warning

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'error_rate',
        })
      )
    })
  })

  describe('history', () => {
    it('should track panic history', () => {
      failSafe.panic('warning')
      failSafe.panic('critical')

      expect(failSafe.history.length).toBe(2)
      expect(failSafe.lastPanic?.level).toBe('critical')
    })

    it('should limit history size', () => {
      const fs = createFailSafe()

      // Trigger more than maxHistory (100) panics
      for (let i = 0; i < 110; i++) {
        fs.panic('warning')
      }

      expect(fs.history.length).toBe(100)
    })
  })

  describe('error handling', () => {
    it('should not throw if callback throws', () => {
      failSafe.on('warning', () => {
        throw new Error('Callback error')
      })

      expect(() => failSafe.panic('warning')).not.toThrow()
    })

    it('should not throw if async callback rejects', async () => {
      failSafe.on('warning', async () => {
        throw new Error('Async error')
      })

      expect(() => failSafe.panic('warning')).not.toThrow()
    })
  })
})
