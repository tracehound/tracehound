/**
 * Tests for result.ts type guards
 */

import { describe, expect, it } from 'vitest'
import type { InterceptResult } from '../src/types/result.js'
import { isClean, isError, isIgnored, isQuarantined, isRateLimited } from '../src/types/result.js'

describe('Result Type Guards', () => {
  describe('isQuarantined', () => {
    it('should return true for quarantined result', () => {
      const result: InterceptResult = {
        status: 'quarantined',
        handle: { signature: 'sig-123', disposed: false } as any,
      }
      expect(isQuarantined(result)).toBe(true)
    })

    it('should return false for non-quarantined results', () => {
      expect(isQuarantined({ status: 'clean' })).toBe(false)
      expect(isQuarantined({ status: 'error', error: {} as any })).toBe(false)
    })
  })

  describe('isError', () => {
    it('should return true for error result', () => {
      const result: InterceptResult = {
        status: 'error',
        error: { state: 'agent', code: 'TEST', message: 'test', recoverable: true },
      }
      expect(isError(result)).toBe(true)
    })

    it('should return false for non-error results', () => {
      expect(isError({ status: 'clean' })).toBe(false)
      expect(isError({ status: 'rate_limited', retryAfter: 1000 })).toBe(false)
    })
  })

  describe('isClean', () => {
    it('should return true for clean result', () => {
      const result: InterceptResult = { status: 'clean' }
      expect(isClean(result)).toBe(true)
    })

    it('should return false for non-clean results', () => {
      expect(isClean({ status: 'error', error: {} as any })).toBe(false)
      expect(isClean({ status: 'quarantined', handle: {} as any })).toBe(false)
    })
  })

  describe('isRateLimited', () => {
    it('should return true for rate_limited result', () => {
      const result: InterceptResult = { status: 'rate_limited', retryAfter: 5000 }
      expect(isRateLimited(result)).toBe(true)
    })

    it('should return false for non-rate-limited results', () => {
      expect(isRateLimited({ status: 'clean' })).toBe(false)
      expect(isRateLimited({ status: 'ignored', signature: 'sig' })).toBe(false)
    })
  })

  describe('isIgnored', () => {
    it('should return true for ignored result', () => {
      const result: InterceptResult = { status: 'ignored', signature: 'sig-456' }
      expect(isIgnored(result)).toBe(true)
    })

    it('should return false for non-ignored results', () => {
      expect(isIgnored({ status: 'clean' })).toBe(false)
      expect(isIgnored({ status: 'payload_too_large', limit: 1000 })).toBe(false)
    })
  })
})
