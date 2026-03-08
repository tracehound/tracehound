/**
 * Agent tests - core intercept flow.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Agent, createAgent } from '../src/core/agent.js'
import { AuditChain } from '../src/core/audit-chain.js'
import { Evidence } from '../src/core/evidence.js'
import type { EvidenceCreationResult, IEvidenceFactory } from '../src/core/evidence-factory.js'
import { createEvidenceFactory } from '../src/core/evidence-factory.js'
import type { IHoundPool } from '../src/core/hound-pool.js'
import type { INotificationEmitter } from '../src/core/notification-emitter.js'
import { SYSTEM_PANIC_REASONS } from '../src/core/operational-events.js'
import { Quarantine } from '../src/core/quarantine.js'
import type { IRateLimiter, RateLimitResult } from '../src/core/rate-limiter.js'
import { createRateLimiter } from '../src/core/rate-limiter.js'
import type { IWatcher } from '../src/core/watcher.js'
import type {
  CoordinationFeature,
  CoordinationHealth,
  CoordinationProvider,
} from '../src/types/coordination.js'
import { Errors } from '../src/types/errors.js'
import type { JsonSerializable, QuarantineConfig, RateLimitConfig } from '../src/types/index.js'
import type { Scent, ScentSource } from '../src/types/scent.js'
import { hashBuffer } from '../src/utils/hash.js'

describe('Agent', () => {
  let agent: Agent
  let quarantine: Quarantine
  let auditChain: AuditChain
  let mockWatcher: IWatcher
  let mockNotifications: INotificationEmitter

  const rateLimitConfig: RateLimitConfig = {
    windowMs: 60_000,
    maxRequests: 100,
    blockDurationMs: 300_000,
  }

  const quarantineConfig: QuarantineConfig = {
    maxCount: 1000,
    maxBytes: 10_000_000,
    evictionPolicy: 'priority',
  }

  const agentConfig = {
    maxPayloadSize: 1_000_000,
  }

  function createScent(
    payload: JsonSerializable,
    threat?: { category: 'injection' | 'ddos'; severity: 'low' | 'high' },
  ): Scent {
    return {
      id: `scent-${Date.now()}-${Math.random()}`,
      payload,
      source: { ip: '127.0.0.1' },
      timestamp: Date.now(),
      ...(threat ? { threat } : {}),
    }
  }

  beforeEach(() => {
    auditChain = new AuditChain()
    quarantine = new Quarantine(quarantineConfig, auditChain)
    const rateLimiter = createRateLimiter(rateLimitConfig)
    const evidenceFactory = createEvidenceFactory()

    mockWatcher = {
      recordThreat: vi.fn(),
      updateQuarantine: vi.fn(),
      alert: vi.fn(),
      setOverloaded: vi.fn(),
      snapshot: vi.fn(),
    } as unknown as IWatcher

    mockNotifications = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      subscribe: vi.fn(),
      registerWebhook: vi.fn(),
      unregisterWebhook: vi.fn(),
      get stats() {
        return {
          totalEmitted: 0,
          byType: {},
          activeCallbacks: 0,
          activeSubscribers: 0,
          activeWebhooks: 0,
        } as any
      },
    } as unknown as INotificationEmitter

    agent = new Agent(
      agentConfig,
      quarantine,
      rateLimiter,
      evidenceFactory,
      undefined,
      mockWatcher,
      mockNotifications,
    )
  })

  describe('construction', () => {
    it('creates with valid config', () => {
      expect(agent).toBeDefined()
    })

    it('throws on non-positive maxPayloadSize', () => {
      expect(() => {
        new Agent(
          { maxPayloadSize: 0 },
          quarantine,
          createRateLimiter(rateLimitConfig),
          createEvidenceFactory(),
        )
      }).toThrow('maxPayloadSize must be positive')
    })
  })

  describe('coordination health fail-open', () => {
    it('returns local coordination health when provider is absent', () => {
      const health = agent.getCoordinationHealth()

      expect(health.mode).toBe('local')
      expect(health.provider).toBe('local')
      expect(health.lastSyncAt).toBeNull()
      expect(health.syncLagMs).toBeNull()
    })

    it('keeps intercept behavior unchanged when provider reports degraded', () => {
      const provider: CoordinationProvider = {
        providerId: 'degraded-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
        health: (): CoordinationHealth => ({
          mode: 'degraded',
          lastSyncAt: null,
          syncLagMs: null,
          provider: 'degraded-provider',
        }),
      }

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
      )

      const health = localAgent.getCoordinationHealth()
      const result = localAgent.intercept(
        createScent({ attack: 'degraded path' }, { category: 'injection', severity: 'high' }),
      )

      expect(health.mode).toBe('degraded')
      expect(result.status).toBe('quarantined')
    })

    it('increments coordinationFallbackCount only once for repeated degraded reads', () => {
      const provider: CoordinationProvider = {
        providerId: 'stable-degraded-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
        health: (): CoordinationHealth => ({
          mode: 'degraded',
          lastSyncAt: null,
          syncLagMs: null,
          provider: 'stable-degraded-provider',
        }),
      }

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
      )

      localAgent.getCoordinationHealth()
      localAgent.getCoordinationHealth()
      localAgent.getCoordinationHealth()

      expect(localAgent.getStats().coordinationFallbackCount).toBe(1)
    })

    it('tracks coordination fallback transitions when fallback reason changes', () => {
      let state: 'degraded' | 'synchronized' | 'throwing' = 'degraded'
      const provider: CoordinationProvider = {
        providerId: 'transition-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
        health: (): CoordinationHealth => {
          if (state === 'throwing') {
            throw new Error('provider unavailable')
          }
          return {
            mode: state,
            lastSyncAt: null,
            syncLagMs: null,
            provider: 'transition-provider',
          }
        },
      }

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
      )

      localAgent.getCoordinationHealth() // degraded -> +1
      localAgent.getCoordinationHealth() // degraded again -> +0

      state = 'synchronized'
      localAgent.getCoordinationHealth() // clear fallback state

      state = 'degraded'
      localAgent.getCoordinationHealth() // degraded transition -> +1

      state = 'throwing'
      localAgent.getCoordinationHealth() // health failure transition -> +1
      localAgent.getCoordinationHealth() // same reason -> +0

      expect(localAgent.getStats().coordinationFallbackCount).toBe(3)
    })

    it('degrades to fail-open health and emits warning when provider health throws', () => {
      const provider: CoordinationProvider = {
        providerId: 'throwing-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
        health: (): CoordinationHealth => {
          throw new Error('provider unavailable')
        },
      }

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        mockNotifications,
      )

      const health = localAgent.getCoordinationHealth()

      expect(health.mode).toBe('degraded')
      expect(health.provider).toBe('throwing-provider')
      expect(mockNotifications.emit).toHaveBeenCalledWith(
        'system.panic',
        expect.objectContaining({
          level: 'warning',
          reason: SYSTEM_PANIC_REASONS.COORDINATION_HEALTH_FAILURE,
          context: expect.objectContaining({
            providerId: 'throwing-provider',
            error: 'provider unavailable',
          }),
        }),
      )
    })

    it('degrades and emits warning when provider does not implement health API', () => {
      const provider = {
        providerId: 'invalid-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
      } as unknown as CoordinationProvider

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        mockNotifications,
      )

      const health = localAgent.getCoordinationHealth()

      expect(health.mode).toBe('degraded')
      expect(health.provider).toBe('invalid-provider')
      expect(mockNotifications.emit).toHaveBeenCalledWith(
        'system.panic',
        expect.objectContaining({
          level: 'warning',
          reason: SYSTEM_PANIC_REASONS.COORDINATION_INVALID_CONTRACT,
          context: expect.objectContaining({
            providerId: 'invalid-provider',
            error: Errors.coordinationContractInvalid('invalid-provider', 'health() is required')
              .message,
          }),
        }),
      )
    })

    it('degrades and emits warning when provider returns malformed health payload', () => {
      const provider: CoordinationProvider = {
        providerId: 'malformed-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
        health: (): CoordinationHealth =>
          ({
            mode: 'unknown',
            lastSyncAt: 'never',
            syncLagMs: -1,
            provider: '',
          }) as unknown as CoordinationHealth,
      }

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        mockNotifications,
      )

      const health = localAgent.getCoordinationHealth()

      expect(health.mode).toBe('degraded')
      expect(health.provider).toBe('malformed-provider')
      expect(mockNotifications.emit).toHaveBeenCalledWith(
        'system.panic',
        expect.objectContaining({
          level: 'warning',
          reason: SYSTEM_PANIC_REASONS.COORDINATION_INVALID_CONTRACT,
          context: expect.objectContaining({
            providerId: 'malformed-provider',
            error: Errors.coordinationContractInvalid(
              'malformed-provider',
              'health() returned invalid payload',
            ).message,
          }),
        }),
      )
    })

    it('emits coordination warning once per reason/provider tuple', () => {
      const provider = {
        providerId: 'dedupe-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
      } as unknown as CoordinationProvider

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        mockNotifications,
      )

      localAgent.getCoordinationHealth()
      localAgent.getCoordinationHealth()

      const warningCalls = (
        mockNotifications.emit as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.filter(
        ([event, payload]) =>
          event === 'system.panic' &&
          typeof payload === 'object' &&
          payload !== null &&
          'reason' in (payload as Record<string, unknown>) &&
          (payload as { reason?: string }).reason ===
            SYSTEM_PANIC_REASONS.COORDINATION_INVALID_CONTRACT,
      )

      expect(warningCalls).toHaveLength(1)
      expect(localAgent.getStats().coordinationWarningCount).toBe(1)
    })

    it('includes object error message when provider health throws non-Error object', () => {
      const provider: CoordinationProvider = {
        providerId: 'object-message-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
        health: (): CoordinationHealth => {
          throw { message: 'object-failure' } as { message: string }
        },
      }

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        mockNotifications,
      )

      localAgent.getCoordinationHealth()

      expect(mockNotifications.emit).toHaveBeenCalledWith(
        'system.panic',
        expect.objectContaining({
          reason: SYSTEM_PANIC_REASONS.COORDINATION_HEALTH_FAILURE,
          context: expect.objectContaining({
            providerId: 'object-message-provider',
            error: 'object-failure',
          }),
        }),
      )
    })

    it('omits error message when provider health throws object with non-string message', () => {
      const provider: CoordinationProvider = {
        providerId: 'non-string-message-provider',
        features: new Set<CoordinationFeature>(['shared_blocklist']),
        start: async (): Promise<void> => {},
        stop: async (): Promise<void> => {},
        health: (): CoordinationHealth => {
          throw { message: 42 } as { message: number }
        },
      }

      const localAgent = new Agent(
        {
          maxPayloadSize: 1_000_000,
          coordinationProvider: provider,
        },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        mockNotifications,
      )

      localAgent.getCoordinationHealth()

      expect(mockNotifications.emit).toHaveBeenCalledWith(
        'system.panic',
        expect.objectContaining({
          reason: SYSTEM_PANIC_REASONS.COORDINATION_HEALTH_FAILURE,
          context: expect.objectContaining({
            providerId: 'non-string-message-provider',
            error: undefined,
          }),
        }),
      )
    })
  })
  describe('intercept - clean flow', () => {
    it('returns clean when no threat signal', () => {
      const scent = createScent({ data: 'test' })
      const result = agent.intercept(scent)

      expect(result.status).toBe('clean')
    })

    it('does not quarantine clean scents', () => {
      const scent = createScent({ data: 'test' })
      agent.intercept(scent)

      expect(quarantine.stats.count).toBe(0)
    })
  })

  describe('intercept - rate limiting', () => {
    it('returns rate_limited when source blocked', () => {
      const limitedConfig: RateLimitConfig = {
        windowMs: 60_000,
        maxRequests: 2,
        blockDurationMs: 1000,
      }

      const rateLimiter = createRateLimiter(limitedConfig)
      const localAgent = new Agent(
        agentConfig,
        quarantine,
        rateLimiter,
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        mockNotifications,
      )

      // Use up limit
      localAgent.intercept(createScent({ data: 1 }))
      localAgent.intercept(createScent({ data: 2 }))

      // Third should be rate limited
      const result = localAgent.intercept(createScent({ data: 3 }))
      expect(result.status).toBe('rate_limited')
      if (result.status === 'rate_limited') {
        expect(result.retryAfter).toBeGreaterThan(0)
      }
    })

    it('emits rate_limit.exceeded event when source blocked', () => {
      const limitedConfig: RateLimitConfig = {
        windowMs: 60_000,
        maxRequests: 1,
        blockDurationMs: 1000,
      }

      const rateLimiter = createRateLimiter(limitedConfig)
      const localAgent = new Agent(
        agentConfig,
        quarantine,
        rateLimiter,
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        mockNotifications,
      )

      // Use up limit
      localAgent.intercept(createScent({ data: 1 }))

      // Second should be rate limited
      localAgent.intercept(createScent({ data: 2 }))

      expect(mockNotifications.emit).toHaveBeenCalledWith(
        'rate_limit.exceeded',
        expect.objectContaining({
          retryAfterMs: expect.any(Number),
        }),
      )
    })

    it('keeps rate_limited outcome when telemetry emitter throws', () => {
      const limitedConfig: RateLimitConfig = {
        windowMs: 60_000,
        maxRequests: 1,
        blockDurationMs: 1000,
      }
      const throwingNotifications = {
        ...mockNotifications,
        emit: vi.fn(() => {
          throw new Error('telemetry emit failure')
        }),
      } as unknown as INotificationEmitter
      const localAgent = new Agent(
        agentConfig,
        quarantine,
        createRateLimiter(limitedConfig),
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        throwingNotifications,
      )

      localAgent.intercept(createScent({ data: 1 }))
      const result = localAgent.intercept(createScent({ data: 2 }))

      expect(result.status).toBe('rate_limited')
      if (result.status === 'rate_limited') {
        expect(result.retryAfter).toBeGreaterThan(0)
      }
    })
  })

  describe('intercept - payload validation', () => {
    it('returns payload_too_large for oversized payload', () => {
      const smallAgent = new Agent(
        { maxPayloadSize: 10 },
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
      )

      const scent = createScent(
        { data: 'x'.repeat(100) },
        { category: 'injection', severity: 'high' },
      )

      const result = smallAgent.intercept(scent)
      expect(result.status).toBe('payload_too_large')
      if (result.status === 'payload_too_large') {
        expect(result.limit).toBe(10)
      }
    })

    it('returns error for invalid payload', () => {
      const scent: Scent = {
        id: 'test',
        payload: { value: NaN } as any,
        source: { ip: '127.0.0.1' },
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }

      const result = agent.intercept(scent)
      expect(result.status).toBe('error')
    })
  })

  describe('intercept - quarantine flow', () => {
    function createMockEvidence(signature: string): Evidence {
      const bytes = new TextEncoder().encode(`mock-evidence-${signature}`)
      const hash = hashBuffer(bytes)
      const evidenceBytes = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer

      return new Evidence(evidenceBytes, signature, hash, 'high', Date.now(), { ip: '127.0.0.1' })
    }

    it('returns quarantined for new threat', () => {
      const scent = createScent(
        { attack: 'sql injection' },
        { category: 'injection', severity: 'high' },
      )

      const result = agent.intercept(scent)
      expect(result.status).toBe('quarantined')
      if (result.status === 'quarantined') {
        expect(result.handle).toBeDefined()
        expect(result.handle.disposed).toBe(false)
      }
    })

    it('keeps quarantined outcome when watcher and notification hooks throw', () => {
      const throwingWatcher = {
        ...mockWatcher,
        recordThreat: vi.fn(() => {
          throw new Error('watcher failure')
        }),
        updateQuarantine: vi.fn(() => {
          throw new Error('watcher failure')
        }),
      } as unknown as IWatcher
      const throwingNotifications = {
        ...mockNotifications,
        emit: vi.fn(() => {
          throw new Error('notification failure')
        }),
      } as unknown as INotificationEmitter
      const localAgent = new Agent(
        agentConfig,
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        undefined,
        throwingWatcher,
        throwingNotifications,
      )

      const result = localAgent.intercept(
        createScent({ attack: 'telemetry-fail-open' }, { category: 'injection', severity: 'high' }),
      )

      expect(result.status).toBe('quarantined')
    })

    it('returns ignored when quarantine insert becomes duplicate after pre-check', () => {
      const evidence = createMockEvidence('race-duplicate-sig')
      const rateLimiter: IRateLimiter = {
        check: vi.fn((_source: ScentSource): RateLimitResult => ({ allowed: true })),
        reset: vi.fn(),
        cleanup: vi.fn(() => 0),
        resetSourceFingerprint: vi.fn(),
        resetIpCeiling: vi.fn(),
        stats: {
          sources: 0,
          blocked: 0,
          totalChecks: 0,
          totalRejections: 0,
          totalEvictions: 0,
        },
      }
      const evidenceFactory: IEvidenceFactory = {
        create: vi.fn(
          (_scent, _threat, _maxPayloadSize): EvidenceCreationResult => ({
            ok: true,
            evidence,
            signature: evidence.signature,
            hash: evidence.hash,
            size: evidence.size,
            compressed: evidence.compressed,
          }),
        ),
      }
      const quarantineMock = {
        has: vi.fn(() => false),
        insert: vi.fn(() => ({
          status: 'duplicate' as const,
          existing: evidence,
        })),
      } as unknown as Quarantine

      const localAgent = new Agent(
        agentConfig,
        quarantineMock,
        rateLimiter,
        evidenceFactory,
        undefined,
        mockWatcher,
        mockNotifications,
      )

      const result = localAgent.intercept(
        createScent({ race: true }, { category: 'injection', severity: 'high' }),
      )

      expect(result.status).toBe('ignored')
      if (result.status === 'ignored') {
        expect(result.signature).toBe(evidence.signature)
      }
    })

    it('returns ignored when quarantine drops due to pressure containment', () => {
      const evidence = createMockEvidence('pressure-drop-sig')
      const rateLimiter: IRateLimiter = {
        check: vi.fn((_source: ScentSource): RateLimitResult => ({ allowed: true })),
        reset: vi.fn(),
        cleanup: vi.fn(() => 0),
        resetSourceFingerprint: vi.fn(),
        resetIpCeiling: vi.fn(),
        stats: {
          sources: 0,
          blocked: 0,
          totalChecks: 0,
          totalRejections: 0,
          totalEvictions: 0,
        },
      }
      const evidenceFactory: IEvidenceFactory = {
        create: vi.fn(
          (_scent, _threat, _maxPayloadSize): EvidenceCreationResult => ({
            ok: true,
            evidence,
            signature: evidence.signature,
            hash: evidence.hash,
            size: evidence.size,
            compressed: evidence.compressed,
          }),
        ),
      }
      const quarantineMock = {
        has: vi.fn(() => false),
        insert: vi.fn(() => ({
          status: 'dropped' as const,
          reason: 'pressure' as const,
        })),
      } as unknown as Quarantine

      const localAgent = new Agent(
        agentConfig,
        quarantineMock,
        rateLimiter,
        evidenceFactory,
        undefined,
        mockWatcher,
        mockNotifications,
      )

      const result = localAgent.intercept(
        createScent({ pressure: true }, { category: 'injection', severity: 'high' }),
      )

      expect(result.status).toBe('ignored')
      if (result.status === 'ignored') {
        expect(result.signature).toBe(evidence.signature)
      }
    })

    it('activates hound pool on successful quarantine insert', () => {
      const activate = vi.fn()
      const houndPool: IHoundPool = {
        activate,
        terminate: vi.fn(),
        onResult: vi.fn(),
        shutdown: vi.fn(),
        stats: {
          activeProcesses: 0,
          totalProcesses: 0,
          totalActivations: 0,
          totalTimeouts: 0,
          totalErrors: 0,
          avgProcessingMs: 0,
        },
      }
      const localAgent = new Agent(
        agentConfig,
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        houndPool,
        mockWatcher,
        mockNotifications,
      )

      const result = localAgent.intercept(
        createScent({ attack: 'hound-activation' }, { category: 'injection', severity: 'high' }),
      )

      expect(result.status).toBe('quarantined')
      expect(activate).toHaveBeenCalledTimes(1)
    })

    it('rejects runtime payload egress from quarantined handle', () => {
      const scent = createScent(
        { attack: 'membrane-test' },
        { category: 'injection', severity: 'high' },
      )

      const result = agent.intercept(scent)
      expect(result.status).toBe('quarantined')

      if (result.status === 'quarantined') {
        expect(result.handle.membrane).toBe('metadata_only')
        expect(() => result.handle.transfer()).toThrow()
        expect(() => result.handle.bytes).toThrow()
        expect(() => result.handle.neutralize('prev-hash')).toThrow()

        expect(mockNotifications.emit).toHaveBeenCalledWith(
          'system.panic',
          expect.objectContaining({
            level: 'warning',
            reason: SYSTEM_PANIC_REASONS.MEMBRANE_PAYLOAD_EGRESS_BLOCKED,
            context: expect.objectContaining({
              signature: result.handle.signature,
            }),
          }),
        )
      }
    })

    it('exposes an immutable runtime source snapshot', () => {
      const source = {
        ip: '203.0.113.10',
        userAgent: 'immutable-ua',
        tls: { cipherSuite: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3', alpn: 'h2' },
      }
      const scent: Scent = {
        id: 'source-snapshot-test',
        payload: { attack: 'source-snapshot' },
        source: source as ScentSource,
        timestamp: Date.now(),
        threat: { category: 'injection', severity: 'high' },
      }

      const result = agent.intercept(scent)
      expect(result.status).toBe('quarantined')
      if (result.status !== 'quarantined') {
        return
      }

      source.userAgent = 'mutated-ua'
      if (source.tls) {
        source.tls.cipherSuite = 'TLS_CHACHA20_POLY1305_SHA256'
      }

      expect(result.handle.source).toEqual({
        ip: '203.0.113.10',
        userAgent: 'immutable-ua',
        tls: { cipherSuite: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3', alpn: 'h2' },
      })
      expect(Object.isFrozen(result.handle.source)).toBe(true)
      expect(Object.isFrozen(result.handle.source.tls)).toBe(true)
      if (result.handle.source.tls !== undefined) {
        expect(() => {
          ;(result.handle.source.tls as { cipherSuite: string }).cipherSuite =
            'TLS_CHACHA20_POLY1305_SHA256'
        }).toThrow()
      }
    })

    it('throws runtime membrane violation even if panic telemetry emit fails', () => {
      const throwingNotifications = {
        ...mockNotifications,
        emit: vi.fn(() => {
          throw new Error('panic emitter down')
        }),
      } as unknown as INotificationEmitter
      const localAgent = new Agent(
        agentConfig,
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
        undefined,
        mockWatcher,
        throwingNotifications,
      )
      const result = localAgent.intercept(
        createScent(
          { attack: 'membrane-panic-failure' },
          { category: 'injection', severity: 'high' },
        ),
      )

      expect(result.status).toBe('quarantined')
      if (result.status !== 'quarantined') {
        return
      }

      let thrown: unknown
      try {
        result.handle.transfer()
      } catch (error: unknown) {
        thrown = error
      }

      expect(thrown).toMatchObject({
        state: 'runtime',
        code: 'RUNTIME_MEMBRANE_VIOLATION',
      })
    })

    it('keeps quarantined handle serializable without membrane violations', () => {
      const scent = createScent(
        { attack: 'serialization-safe' },
        { category: 'injection', severity: 'high' },
      )

      const result = agent.intercept(scent)
      expect(result.status).toBe('quarantined')

      if (result.status === 'quarantined') {
        expect(() => ({ ...result.handle })).not.toThrow()
        expect(() => JSON.stringify(result.handle)).not.toThrow()

        const spreadHandle = { ...result.handle }
        expect(spreadHandle).toMatchObject({
          membrane: 'metadata_only',
          signature: result.handle.signature,
        })
        expect(spreadHandle).not.toHaveProperty('bytes')
        expect(spreadHandle).not.toHaveProperty('transfer')
        expect(spreadHandle).not.toHaveProperty('neutralize')
        expect(spreadHandle).not.toHaveProperty('evacuate')

        const json = JSON.parse(JSON.stringify(result.handle)) as Record<string, unknown>
        expect(json).toMatchObject({
          membrane: 'metadata_only',
          signature: result.handle.signature,
        })
        expect(json).not.toHaveProperty('bytes')

        const membraneWarnings = (
          mockNotifications.emit as unknown as { mock: { calls: unknown[][] } }
        ).mock.calls.filter(
          ([event, payload]) =>
            event === 'system.panic' &&
            typeof payload === 'object' &&
            payload !== null &&
            'reason' in (payload as Record<string, unknown>) &&
            (payload as { reason?: string }).reason ===
              SYSTEM_PANIC_REASONS.MEMBRANE_PAYLOAD_EGRESS_BLOCKED,
        )
        expect(membraneWarnings).toHaveLength(0)
      }
    })
    it('inserts evidence into quarantine', () => {
      const scent = createScent({ attack: 'test' }, { category: 'injection', severity: 'high' })

      agent.intercept(scent)
      expect(quarantine.stats.count).toBe(1)
    })

    it('appends to audit chain', () => {
      // Note: Audit chain is only updated on neutralize, not on insert
      // This test verifies the quarantine → audit chain connection works
      const scent = createScent({ attack: 'test' }, { category: 'injection', severity: 'high' })

      const result = agent.intercept(scent)
      if (result.status === 'quarantined') {
        // Neutralize to trigger audit chain
        quarantine.neutralize(result.handle.signature)
        expect(auditChain.length).toBe(1)
      }
    })

    it('calls observability hooks on quarantine', () => {
      const scent = createScent(
        { attack: 'sql injection' },
        { category: 'injection', severity: 'high' },
      )

      agent.intercept(scent)

      expect(mockWatcher.recordThreat).toHaveBeenCalledWith('injection', 'high')
      expect(mockNotifications.emit).toHaveBeenCalledWith(
        'threat.detected',
        expect.objectContaining({
          category: 'injection',
          severity: 'high',
        }),
      )
      expect(mockNotifications.emit).toHaveBeenCalledWith(
        'evidence.quarantined',
        expect.objectContaining({
          severity: 'high',
        }),
      )
      expect(mockWatcher.updateQuarantine).toHaveBeenCalledWith(
        1,
        expect.any(Number),
        quarantineConfig.maxBytes,
      )
    })
  })

  describe('intercept - duplicate detection', () => {
    it('returns ignored for duplicate signature', () => {
      const payload = { attack: 'same payload' }

      const scent1 = createScent(payload, {
        category: 'injection',
        severity: 'high',
      })
      const scent2 = createScent(payload, {
        category: 'injection',
        severity: 'high',
      })

      const result1 = agent.intercept(scent1)
      const result2 = agent.intercept(scent2)

      expect(result1.status).toBe('quarantined')
      expect(result2.status).toBe('ignored')
      if (result2.status === 'ignored') {
        expect(result2.signature).toBeDefined()
      }
    })

    it('does not add duplicate to quarantine', () => {
      const payload = { attack: 'duplicate' }

      agent.intercept(createScent(payload, { category: 'injection', severity: 'high' }))
      agent.intercept(createScent(payload, { category: 'injection', severity: 'high' }))

      expect(quarantine.stats.count).toBe(1)
    })

    // CRITICAL: Deterministic duplicate test
    it('produces identical signature for deep-equal payloads with different key order', () => {
      const payload1 = { a: 1, b: { c: 2, d: 3 }, e: 4 }
      const payload2 = { e: 4, b: { d: 3, c: 2 }, a: 1 } // Same content, different order

      const scent1 = createScent(payload1, {
        category: 'injection',
        severity: 'high',
      })
      const scent2 = createScent(payload2, {
        category: 'injection',
        severity: 'high',
      })

      const result1 = agent.intercept(scent1)
      const result2 = agent.intercept(scent2)

      expect(result1.status).toBe('quarantined')
      expect(result2.status).toBe('ignored') // MUST match - deterministic signature
    })

    it('treats different categories as different signatures', () => {
      const payload = { attack: 'test' }

      const scent1 = createScent(payload, {
        category: 'injection',
        severity: 'high',
      })
      const scent2 = createScent(payload, {
        category: 'ddos',
        severity: 'high',
      })

      const result1 = agent.intercept(scent1)
      const result2 = agent.intercept(scent2)

      expect(result1.status).toBe('quarantined')
      expect(result2.status).toBe('quarantined') // Different category = different signature
      expect(quarantine.stats.count).toBe(2)
    })
  })

  describe('getStats', () => {
    it('tracks totalIntercepts', () => {
      agent.intercept(createScent({ a: 1 }))
      agent.intercept(createScent({ a: 2 }))

      expect(agent.getStats().totalIntercepts).toBe(2)
    })

    it('tracks cleanCount', () => {
      agent.intercept(createScent({ a: 1 })) // No threat = clean
      agent.intercept(createScent({ a: 2 })) // No threat = clean

      expect(agent.getStats().cleanCount).toBe(2)
    })

    it('tracks quarantinedCount', () => {
      agent.intercept(createScent({ a: 1 }, { category: 'injection', severity: 'high' }))
      agent.intercept(createScent({ a: 2 }, { category: 'injection', severity: 'high' }))

      expect(agent.getStats().quarantinedCount).toBe(2)
    })

    it('tracks ignoredCount', () => {
      const payload = { attack: 'dup' }
      agent.intercept(createScent(payload, { category: 'injection', severity: 'high' }))
      agent.intercept(createScent(payload, { category: 'injection', severity: 'high' }))

      expect(agent.getStats().ignoredCount).toBe(1)
    })
  })

  describe('intercept - typed error model', () => {
    it('returns AGENT_INTERCEPT_FAILED when unexpected runtime exception occurs', () => {
      vi.spyOn(quarantine, 'insert').mockImplementation(() => {
        throw new Error('forced-insert-failure')
      })

      const result = agent.intercept(
        createScent({ attack: 'runtime-throw' }, { category: 'injection', severity: 'high' }),
      )

      expect(result.status).toBe('error')
      if (result.status !== 'error') return
      expect(result.error.code).toBe('AGENT_INTERCEPT_FAILED')
      expect(result.error.state).toBe('agent')
      expect(result.error.context).toMatchObject({
        reason: 'forced-insert-failure',
        scentId: expect.any(String),
      })
    })
  })

  describe('createAgent factory', () => {
    it('creates an agent instance', () => {
      const agentInstance = createAgent(
        agentConfig,
        quarantine,
        createRateLimiter(rateLimitConfig),
        createEvidenceFactory(),
      )

      expect(agentInstance).toBeDefined()
    })
  })
})
