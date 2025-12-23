/**
 * Integration tests for Phase 2.
 * These are placeholders until Evidence and Quarantine are implemented.
 */

import { describe, it } from 'vitest'

describe('Phase 2: Evidence', () => {
  it.todo('Evidence.transfer() moves ownership')
  it.todo('Evidence.neutralize() atomically destroys')
  it.todo('Evidence.evacuate() moves to cold storage')
  it.todo('Evidence rejects operations after dispose')
  it.todo('Evidence.transfer() can only be called once')
})

describe('Phase 2: Quarantine', () => {
  it.todo('Quarantine.insert() adds threat')
  it.todo('Quarantine.get() retrieves by signature')
  it.todo('Quarantine.evict() removes lowest priority')
  it.todo('Quarantine respects maxCount limit')
  it.todo('Quarantine respects maxBytes limit')
  it.todo('Quarantine evicts low severity before high')
  it.todo('Quarantine evicts older before newer (same severity)')
})

describe('Phase 2: Agent', () => {
  it.todo('intercept() returns clean for no threat')
  it.todo('intercept() quarantines threat')
  it.todo('intercept() ignores duplicate signature')
  it.todo('intercept() rejects oversized payload')
  it.todo('intercept() rate limits excessive requests')
})

describe('Phase 2: Rate Limiter', () => {
  it.todo('RateLimiter.check() allows within limit')
  it.todo('RateLimiter.check() blocks over limit')
  it.todo('RateLimiter respects window duration')
  it.todo('RateLimiter.reset() clears source')
})

describe('Phase 2: Full Flow', () => {
  it.todo('scent → threat → quarantine → neutralize works')
  it.todo('eviction under memory pressure works')
  it.todo('concurrent requests handled correctly')
  it.todo('panic mode shreds all in-flight')
})
