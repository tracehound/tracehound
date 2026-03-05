import { describe, expect, it } from 'vitest'
import { HOUND_PRESSURE_ERRORS, isHoundPressureError } from '../src/index.js'
import type { HoundPressureErrorCode } from '../src/index.js'

describe('public api exports', () => {
  it('should expose canonical hound pressure helpers from package index', () => {
    const pressureError: HoundPressureErrorCode = HOUND_PRESSURE_ERRORS.POOL_EXHAUSTED

    expect(pressureError).toBe('pool_exhausted')
    expect(HOUND_PRESSURE_ERRORS.POOL_EXHAUSTED).toBe('pool_exhausted')
    expect(isHoundPressureError(HOUND_PRESSURE_ERRORS.POOL_EXHAUSTED_ESCALATED)).toBe(true)
    expect(isHoundPressureError('non_pressure_error')).toBe(false)
  })
})
