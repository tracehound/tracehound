/**
 * Quarantine tests (TDD).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditChain } from '../src/core/audit-chain.js'
import { MemoryColdStorage } from '../src/core/cold-storage.js'
import { Evidence } from '../src/core/evidence.js'
import { Quarantine } from '../src/core/quarantine.js'
import type { QuarantineConfig } from '../src/types/config.js'
import { hashBuffer } from '../src/utils/hash.js'

describe('Quarantine', () => {
  let quarantine: Quarantine
  let auditChain: AuditChain
  let config: QuarantineConfig

  function createEvidence(
    signature: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    size: number = 1024,
    captured: number = Date.now(),
  ): Evidence {
    const bytes = new ArrayBuffer(size)
    const view = new Uint8Array(bytes)
    // Fill with unique data based on signature
    for (let i = 0; i < size; i++) {
      view[i] = signature.charCodeAt(i % signature.length)
    }
    const contentHash = hashBuffer(bytes)
    return new Evidence(bytes, signature, contentHash, severity, captured, {
      ip: 'quarantine-test',
    })
  }

  function createDisposedEvidence(
    signature: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    size: number = 1024,
    captured: number = Date.now(),
  ): Evidence {
    const evidence = createEvidence(signature, severity, size, captured)
    evidence.transfer()
    return evidence
  }

  beforeEach(() => {
    config = {
      maxCount: 5,
      maxBytes: 10000,
      evictionPolicy: 'priority',
    }
    auditChain = new AuditChain()
    quarantine = new Quarantine(config, auditChain)
  })

  describe('construction', () => {
    it('initializes with empty store', () => {
      expect(quarantine.stats.count).toBe(0)
      expect(quarantine.stats.bytes).toBe(0)
    })

    it('accepts config and audit chain', () => {
      expect(quarantine).toBeDefined()
    })
  })

  describe('insert', () => {
    it('stores evidence by signature', () => {
      const evidence = createEvidence('sig1', 'high')
      const result = quarantine.insert(evidence)

      expect(result.status).toBe('inserted')
      expect(quarantine.has('sig1')).toBe(true)
    })

    it('increments count', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      expect(quarantine.stats.count).toBe(1)
    })

    it('increments total bytes', () => {
      quarantine.insert(createEvidence('sig1', 'high', 2048))
      expect(quarantine.stats.bytes).toBe(2048)
    })

    it('tracks multiple evidence', () => {
      quarantine.insert(createEvidence('sig1', 'high', 1000))
      quarantine.insert(createEvidence('sig2', 'medium', 2000))
      quarantine.insert(createEvidence('sig3', 'low', 3000))

      expect(quarantine.stats.count).toBe(3)
      expect(quarantine.stats.bytes).toBe(6000)
    })

    it('handles duplicate signature', () => {
      const e1 = createEvidence('sig1', 'high')
      const e2 = createEvidence('sig1-dup', 'high') // different content
      // Override signature to simulate duplicate
      Object.defineProperty(e2, '_signature', { value: 'sig1' })

      const r1 = quarantine.insert(e1)
      const r2 = quarantine.insert(e2) // different evidence, same signature

      expect(r1.status).toBe('inserted')
      expect(r2.status).toBe('duplicate')
      expect(quarantine.stats.count).toBe(1)
    })

    it('returns existing evidence on duplicate', () => {
      const e1 = createEvidence('sig1', 'high')
      quarantine.insert(e1)

      const result = quarantine.insert(e1)

      expect(result.status).toBe('duplicate')
      expect(result.existing).toBe(e1)
    })

    it('triggers eviction when count limit exceeded', () => {
      for (let i = 0; i < 6; i++) {
        quarantine.insert(createEvidence(`sig${i}`, 'low', 100))
      }
      expect(quarantine.stats.count).toBe(5)
    })

    it('triggers eviction when byte limit exceeded', () => {
      quarantine.insert(createEvidence('sig1', 'low', 6000))
      quarantine.insert(createEvidence('sig2', 'low', 5000))

      expect(quarantine.stats.bytes).toBeLessThanOrEqual(10000)
    })

    it('drops oversized evidence and increments drop counters', () => {
      const result = quarantine.insert(createEvidence('too-big', 'critical', 20_000))

      expect(result.status).toBe('dropped')
      expect(result.reason).toBe('oversized')
      expect(quarantine.has('too-big')).toBe(false)
      expect(quarantine.stats.count).toBe(0)
      expect(quarantine.stats.droppedCount).toBe(1)
      expect(quarantine.stats.droppedBytes).toBe(20_000)
    })

    it('drops incoming evidence when quarantine capacity is hard-capped to zero', () => {
      const zeroCapacityQuarantine = new Quarantine(
        {
          ...config,
          maxCount: 0,
        },
        auditChain,
      )

      const result = zeroCapacityQuarantine.insert(createEvidence('sig-zero', 'high', 256))

      expect(result.status).toBe('dropped')
      expect(result.reason).toBe('capacity')
      expect(zeroCapacityQuarantine.stats.droppedCount).toBe(1)
      expect(auditChain.export()[0]!.type).toBe('drop')
    })

    it('best-effort drops already disposed evidence under hard-cap pressure', () => {
      const zeroCapacityQuarantine = new Quarantine(
        {
          ...config,
          maxBytes: 0,
        },
        auditChain,
      )

      expect(() => {
        zeroCapacityQuarantine.insert(createDisposedEvidence('sig-disposed', 'low'))
      }).not.toThrow()
      expect(zeroCapacityQuarantine.stats.droppedCount).toBe(1)
    })

    it('drops incoming low-priority evidence under count pressure deterministically', () => {
      quarantine.insert(createEvidence('crit-1', 'critical', 100))
      quarantine.insert(createEvidence('high-1', 'high', 100))
      quarantine.insert(createEvidence('med-1', 'medium', 100))
      quarantine.insert(createEvidence('med-2', 'medium', 100))
      quarantine.insert(createEvidence('high-2', 'high', 100))

      const result = quarantine.insert(createEvidence('low-new', 'low', 100))

      expect(result.status).toBe('dropped')
      expect(result.reason).toBe('pressure')
      expect(quarantine.has('low-new')).toBe(false)
      expect(quarantine.stats.count).toBe(5)
      expect(quarantine.stats.droppedCount).toBe(1)
      expect(auditChain.export().at(-1)?.type).toBe('drop')
      expect(JSON.parse(auditChain.export().at(-1)!.eventData)).toMatchObject({
        type: 'drop',
        signature: 'low-new',
        details: { reason: 'pressure' },
      })
    })
  })

  describe('get', () => {
    it('returns evidence by signature', () => {
      const evidence = createEvidence('sig1', 'high')
      quarantine.insert(evidence)

      const retrieved = quarantine.get('sig1')
      expect(retrieved).toBe(evidence)
    })

    it('returns null for unknown signature', () => {
      expect(quarantine.get('unknown')).toBeNull()
    })
  })

  describe('has', () => {
    it('returns true for stored signature', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      expect(quarantine.has('sig1')).toBe(true)
    })

    it('returns false for unknown signature', () => {
      expect(quarantine.has('unknown')).toBe(false)
    })
  })

  describe('neutralize', () => {
    it('neutralizes and removes evidence', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      const record = quarantine.neutralize('sig1')

      expect(record).toBeDefined()
      expect(quarantine.has('sig1')).toBe(false)
    })

    it('decrements count', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'high'))
      quarantine.neutralize('sig1')

      expect(quarantine.stats.count).toBe(1)
    })

    it('decrements total bytes', () => {
      quarantine.insert(createEvidence('sig1', 'high', 2048))
      quarantine.neutralize('sig1')

      expect(quarantine.stats.bytes).toBe(0)
    })

    it('returns neutralization record', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      const record = quarantine.neutralize('sig1')

      expect(record?.signature).toBe('sig1')
      expect(record?.status).toBe('neutralized')
    })

    it('returns null for unknown signature', () => {
      expect(quarantine.neutralize('unknown')).toBeNull()
    })

    it('cannot neutralize twice', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.neutralize('sig1')

      expect(quarantine.neutralize('sig1')).toBeNull()
    })

    it('appends to audit chain', () => {
      const initialLength = auditChain.length
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.neutralize('sig1')

      expect(auditChain.length).toBe(initialLength + 1)
    })
  })

  describe('flush', () => {
    it('neutralizes all evidence', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'medium'))
      quarantine.insert(createEvidence('sig3', 'low'))

      const records = quarantine.flush()

      expect(records).toHaveLength(3)
      expect(quarantine.stats.count).toBe(0)
    })

    it('returns all neutralization records', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'medium'))

      const records = quarantine.flush()

      expect(records.every((r) => r.status === 'neutralized')).toBe(true)
    })

    it('clears store', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'high'))
      quarantine.flush()

      expect(quarantine.has('sig1')).toBe(false)
      expect(quarantine.has('sig2')).toBe(false)
    })

    it('resets byte counter', () => {
      quarantine.insert(createEvidence('sig1', 'high', 5000))
      quarantine.flush()

      expect(quarantine.stats.bytes).toBe(0)
    })

    it('handles empty quarantine', () => {
      const records = quarantine.flush()
      expect(records).toEqual([])
    })
  })

  describe('purge', () => {
    it('appends purge events to the audit chain', () => {
      quarantine.insert(createEvidence('sig1', 'high'))

      const record = quarantine.purge('sig1', 'timeout')

      expect(record?.status).toBe('purged')
      expect(auditChain.length).toBe(1)
      expect(auditChain.export()[0]!.type).toBe('purge')
    })

    it('returns null when purging unknown evidence', () => {
      expect(quarantine.purge('missing', 'panic')).toBeNull()
    })

    it('should record original scent ID in purge record, not evidence signature', () => {
      const originalScentId = 'scent-original-id-abc123'
      const size = 64
      const bytes = new ArrayBuffer(size)
      const view = new Uint8Array(bytes)
      for (let i = 0; i < size; i++) view[i] = i
      const contentHash = hashBuffer(bytes)
      // Pass scentId as 8th arg (after compressed=false)
      const evidence = new Evidence(bytes, 'injection:sig-scent-test', contentHash, 'high', Date.now(), { ip: '1.2.3.4' }, false, originalScentId)
      quarantine.insert(evidence)

      const record = quarantine.purge('injection:sig-scent-test', 'timeout')

      expect(record).not.toBeNull()
      expect(record!.scent.id).toBe(originalScentId)
      expect(record!.scent.id).not.toBe(record!.signature)
    })

    it('best-effort purges already disposed evidence still present in quarantine', () => {
      const disposed = createDisposedEvidence('sig-disposed', 'medium')
      quarantine.insert(disposed)

      expect(() => quarantine.purge('sig-disposed', 'abort')).not.toThrow()
      expect(quarantine.has('sig-disposed')).toBe(false)
    })
  })

  describe('decay', () => {
    it('returns no decay work when TTL is disabled', async () => {
      const result = await quarantine.decayExpired(10_000)

      expect(result).toEqual({
        decayedCount: 0,
        archivedCount: 0,
        archiveFailureCount: 0,
        retainedCount: 0,
      })
    })

    it('decays expired evidence and archives it to cold storage', async () => {
      const coldStorage = new MemoryColdStorage()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          decayBatchSize: 10,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
        },
        auditChain,
        {
          coldStorage,
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createEvidence('sig-expired', 'high', 256, 1_000))

      const result = await expiringQuarantine.decayExpired()
      const archived = await coldStorage.read('sig-expired')

      expect(result.decayedCount).toBe(1)
      expect(result.archivedCount).toBe(1)
      expect(expiringQuarantine.stats.count).toBe(0)
      expect(expiringQuarantine.stats.decayedCount).toBe(1)
      expect(archived.success).toBe(true)
      expect(auditChain.export().at(-1)?.type).toBe('decay')
    })

    it('retains expired evidence when archival fails under retain mode', async () => {
      const unavailableStorage = {
        write: async () => ({ success: false, error: 'offline' }),
        read: async () => ({ success: false, error: 'offline' }),
        delete: async () => false,
        isAvailable: async () => false,
      }
      const retainingQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          decayBatchSize: 10,
          archiveOnDecay: true,
          archiveFailureMode: 'retain',
        },
        auditChain,
        {
          coldStorage: unavailableStorage,
          now: () => 1_500,
        },
      )

      retainingQuarantine.insert(createEvidence('sig-retain', 'high', 256, 1_000))

      const result = await retainingQuarantine.decayExpired()

      expect(result.retainedCount).toBe(1)
      expect(result.decayedCount).toBe(0)
      expect(retainingQuarantine.has('sig-retain')).toBe(true)
    })

    it('does not re-track retain failures when evidence is removed during in-flight archival', async () => {
      let releaseWrite: (() => void) | null = null
      let notifyWriteStarted: (() => void) | null = null
      const writeStarted = new Promise<void>((resolve) => {
        notifyWriteStarted = resolve
      })

      const delayedFailingStorage = {
        isAvailable: async () => true,
        write: async () => {
          notifyWriteStarted?.()
          await new Promise<void>((resolve) => {
            releaseWrite = resolve
          })
          return {
            success: false,
            error: 'offline',
          }
        },
        read: async () => ({ success: false, error: 'offline' }),
        delete: async () => false,
      }

      const retainingQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          decayBatchSize: 10,
          archiveOnDecay: true,
          archiveFailureMode: 'retain',
        },
        auditChain,
        {
          coldStorage: delayedFailingStorage,
          now: () => 1_500,
        },
      )

      retainingQuarantine.insert(createEvidence('sig-race', 'high', 256, 1_000))

      const decayPromise = retainingQuarantine.decayExpired()
      await writeStarted

      const neutralized = retainingQuarantine.neutralize('sig-race')
      // After awaiting writeStarted, the write callback has captured resolve into
      // releaseWrite — non-null assertion is safe here.
      releaseWrite!()

      const result = await decayPromise
      const internals = retainingQuarantine as unknown as {
        expirations: Map<string, number>
      }

      expect(neutralized).not.toBeNull()
      expect(result).toEqual({
        decayedCount: 0,
        archivedCount: 0,
        archiveFailureCount: 0,
        retainedCount: 0,
      })
      expect(retainingQuarantine.stats.archiveFailureCount).toBe(0)
      expect(internals.expirations.has('sig-race')).toBe(false)
    })

    it('does not emit decay or mutate bytes when evidence is neutralized during in-flight archival', async () => {
      let releaseWrite: (() => void) | null = null
      let notifyWriteStarted: (() => void) | null = null
      const writeStarted = new Promise<void>((resolve) => {
        notifyWriteStarted = resolve
      })

      const delayedSuccessfulStorage = {
        isAvailable: async () => true,
        write: async () => {
          notifyWriteStarted?.()
          await new Promise<void>((resolve) => {
            releaseWrite = resolve
          })
          return {
            success: true,
            id: 'archive-id',
          }
        },
        read: async () => ({ success: false }),
        delete: async () => false,
      }

      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
        },
        localAuditChain,
        {
          coldStorage: delayedSuccessfulStorage,
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createEvidence('sig-neutralize-race', 'high', 256, 1_000))

      const decayPromise = expiringQuarantine.decayExpired()
      await writeStarted

      const neutralized = expiringQuarantine.neutralize('sig-neutralize-race')
      // After awaiting writeStarted, the write callback has captured resolve into
      // releaseWrite — non-null assertion is safe here.
      releaseWrite!()

      const result = await decayPromise
      const events = localAuditChain
        .export()
        .map((record) => JSON.parse(record.eventData) as { type: string })

      expect(neutralized).not.toBeNull()
      expect(result).toEqual({
        decayedCount: 0,
        archivedCount: 0,
        archiveFailureCount: 0,
        retainedCount: 0,
      })
      expect(expiringQuarantine.stats.bytes).toBe(0)
      expect(events.some((event) => event.type === 'decay')).toBe(false)
    })

    it('decays in expiry order and floors the decay batch size', async () => {
      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          decayBatchSize: 2.9,
          archiveOnDecay: false,
        },
        localAuditChain,
        {
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createEvidence('sig-b', 'low', 64, 1_000))
      expiringQuarantine.insert(createEvidence('sig-a', 'low', 64, 1_000))
      expiringQuarantine.insert(createEvidence('sig-c', 'high', 64, 1_000))

      const result = await expiringQuarantine.decayExpired()
      const decays = localAuditChain.export().map((record) => JSON.parse(record.eventData))

      expect(result.decayedCount).toBe(2)
      expect(decays.map((record: { signature: string }) => record.signature)).toEqual([
        'sig-a',
        'sig-b',
      ])
      expect(expiringQuarantine.has('sig-c')).toBe(true)
    })

    it('uses the default decay batch size when the configured value is invalid', async () => {
      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 200,
          maxBytes: 1_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          decayBatchSize: Number.NaN,
          archiveOnDecay: false,
        },
        localAuditChain,
        {
          now: () => 200,
        },
      )

      for (let index = 0; index < 130; index++) {
        expiringQuarantine.insert(createEvidence(`sig-${index}`, 'low', 1, 0))
      }

      const result = await expiringQuarantine.decayExpired()

      expect(result.decayedCount).toBe(128)
      expect(expiringQuarantine.stats.count).toBe(2)
    })

    it('self-heals stale expiry entries that have no backing evidence', async () => {
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: false,
        },
        auditChain,
        {
          now: () => 1_500,
        },
      )

      const internals = expiringQuarantine as unknown as {
        expirations: Map<string, number>
      }
      internals.expirations.set('ghost-signature', 1_000)

      const result = await expiringQuarantine.decayExpired()

      expect(result).toEqual({
        decayedCount: 0,
        archivedCount: 0,
        archiveFailureCount: 0,
        retainedCount: 0,
      })
      expect(internals.expirations.has('ghost-signature')).toBe(false)
    })

    it('records a sanitized archive failure when cold storage is not configured', async () => {
      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
        },
        localAuditChain,
        {
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createEvidence('sig-no-storage', 'high', 64, 1_000))

      const result = await expiringQuarantine.decayExpired()
      const decay = JSON.parse(localAuditChain.export().at(-1)!.eventData) as {
        details: { storageError: string | null }
      }

      expect(result.archiveFailureCount).toBe(1)
      expect(decay.details.storageError).toBe('cold storage not configured')
    })

    it('records archive timeouts without leaking internal adapter details', async () => {
      const hangingStorage = {
        isAvailable: async () => true,
        write: async () => new Promise<never>(() => {}),
        read: async () => ({ success: false }),
        delete: async () => false,
      }
      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
          archiveTimeoutMs: 100,
        },
        localAuditChain,
        {
          coldStorage: hangingStorage,
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createEvidence('sig-timeout', 'high', 64, 1_000))

      const result = await expiringQuarantine.decayExpired()
      const decay = JSON.parse(localAuditChain.export().at(-1)!.eventData) as {
        details: { storageError: string | null }
      }

      expect(result.archiveFailureCount).toBe(1)
      expect(decay.details.storageError).toContain('archive timed out after 100ms')
    })

    it('cancels write via AbortSignal when archive timeout fires', async () => {
      let receivedSignal: AbortSignal | undefined
      const signalAwareStorage = {
        isAvailable: async () => true,
        write: async (_id: string, _payload: unknown, signal?: AbortSignal) => {
          receivedSignal = signal
          // Simulate slow write that respects cancellation.
          await new Promise<void>((resolve, reject) => {
            const tid = setTimeout(resolve, 10_000)
            signal?.addEventListener('abort', () => {
              clearTimeout(tid)
              reject(new Error('aborted'))
            })
          })
          return { success: true }
        },
        read: async () => ({ success: false }),
        delete: async () => false,
      }

      const localAuditChain = new AuditChain()
      const q = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
          archiveTimeoutMs: 100,
        },
        localAuditChain,
        { coldStorage: signalAwareStorage, now: () => 1_500 },
      )

      q.insert(createEvidence('sig-abort', 'high', 64, 1_000))
      const result = await q.decayExpired()

      expect(receivedSignal).toBeDefined()
      expect(receivedSignal!.aborted).toBe(true)
      expect(result.archiveFailureCount).toBe(1)

      const decay = JSON.parse(localAuditChain.export().at(-1)!.eventData) as {
        details: { storageError: string }
      }
      expect(decay.details.storageError).toContain('archive timed out after 100ms')
    })

    it('treats adapter errors named archive timeout as regular storage errors', async () => {
      const timeoutNamedErrorStorage = {
        isAvailable: async () => true,
        write: async () => {
          throw new Error('archive timeout')
        },
        read: async () => ({ success: false }),
        delete: async () => false,
      }
      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
          archiveTimeoutMs: 100,
        },
        localAuditChain,
        {
          coldStorage: timeoutNamedErrorStorage,
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createEvidence('sig-timeout-message', 'high', 64, 1_000))

      const result = await expiringQuarantine.decayExpired()
      const decay = JSON.parse(localAuditChain.export().at(-1)!.eventData) as {
        details: { storageError: string | null }
      }

      expect(result.archiveFailureCount).toBe(1)
      expect(decay.details.storageError).toBe('archive timeout')
      expect(decay.details.storageError).not.toContain('timed out after 100ms')
    })

    it('sanitizes archive adapter errors before recording them', async () => {
      const mockedAccessKeyFragment = `AKIA${'ABCDEFGHIJKLMNOP'}`
      const noisyStorage = {
        isAvailable: async () => true,
        write: async () => ({
          success: false,
          error: `https://s3.internal.example/upload arn:aws:s3:::tracehound ${mockedAccessKeyFragment} extra-detail`,
        }),
        read: async () => ({ success: false }),
        delete: async () => false,
      }
      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
        },
        localAuditChain,
        {
          coldStorage: noisyStorage,
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createEvidence('sig-sanitize', 'high', 64, 1_000))

      await expiringQuarantine.decayExpired()
      const decay = JSON.parse(localAuditChain.export().at(-1)!.eventData) as {
        details: { storageError: string | null }
      }

      expect(decay.details.storageError).toContain('[endpoint]')
      expect(decay.details.storageError).toContain('[arn]')
      expect(decay.details.storageError).toContain('[key]')
      expect(decay.details.storageError).not.toContain('https://s3.internal.example/upload')
    })

    it('falls back to a generic archive error when the adapter returns an empty error message', async () => {
      const noisyStorage = {
        isAvailable: async () => true,
        write: async () => ({
          success: false,
          error: '',
        }),
        read: async () => ({ success: false }),
        delete: async () => false,
      }
      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
        },
        localAuditChain,
        {
          coldStorage: noisyStorage,
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createEvidence('sig-generic-error', 'high', 64, 1_000))

      await expiringQuarantine.decayExpired()
      const decay = JSON.parse(localAuditChain.export().at(-1)!.eventData) as {
        details: { storageError: string | null }
      }

      expect(decay.details.storageError).toBe('storage write failed')
    })

    it('best-effort decays already disposed evidence still tracked by TTL', async () => {
      const localAuditChain = new AuditChain()
      const expiringQuarantine = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: false,
        },
        localAuditChain,
        {
          now: () => 1_500,
        },
      )

      expiringQuarantine.insert(createDisposedEvidence('sig-decayed', 'low', 64, 1_000))

      const result = await expiringQuarantine.decayExpired()

      expect(result.decayedCount).toBe(1)
      expect(expiringQuarantine.stats.count).toBe(0)
    })

    it('returns archive cancelled when signal aborts after availability check', async () => {
      const controller = new AbortController()
      const coldStorage = {
        isAvailable: async () => {
          controller.abort()
          return true
        },
        write: vi.fn(async () => ({ success: true })),
        read: async () => ({ success: false }),
        delete: async () => false,
      }
      const q = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
        },
        auditChain,
        { coldStorage, now: () => 1_500 },
      )
      const internals = q as unknown as {
        runArchive: (
          signature: string,
          bytes: Uint8Array,
          signal: AbortSignal,
        ) => Promise<{ archived: boolean; storageId?: string; storageError?: string }>
      }

      const result = await internals.runArchive(
        'sig-abort-after-availability',
        new Uint8Array([1, 2, 3]),
        controller.signal,
      )

      expect(result).toEqual({
        archived: false,
        storageError: 'archive cancelled',
      })
      expect(coldStorage.write).not.toHaveBeenCalled()
    })

    it('returns archive cancelled when signal aborts during async encoding', async () => {
      const writeSpy = vi.fn(async () => ({ success: true }))
      const coldStorage = {
        isAvailable: async () => true,
        write: writeSpy,
        read: async () => ({ success: false }),
        delete: async () => false,
      }
      const q = new Quarantine(
        {
          maxCount: 5,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
          ttlMs: 100,
          archiveOnDecay: true,
          archiveFailureMode: 'drop',
        },
        auditChain,
        { coldStorage, now: () => 1_500 },
      )
      const internals = q as unknown as {
        runArchive: (
          signature: string,
          bytes: Uint8Array,
          signal: AbortSignal,
        ) => Promise<{ archived: boolean; storageId?: string; storageError?: string }>
      }
      const controller = new AbortController()
      const largePayload = new Uint8Array(4 * 1024 * 1024).fill(65)
      const abortTimer = setTimeout(() => controller.abort(), 0)

      const result = await internals.runArchive(
        'sig-abort-after-encode',
        largePayload,
        controller.signal,
      )
      clearTimeout(abortTimer)

      expect(result).toEqual({
        archived: false,
        storageError: 'archive cancelled',
      })
      expect(writeSpy).not.toHaveBeenCalled()
    })
  })

  describe('replace', () => {
    it('inserts new evidence when the old signature does not exist', () => {
      const replacement = createEvidence('sig-new', 'high')

      const result = quarantine.replace('missing', replacement)

      expect(result).toEqual({
        status: 'inserted_only',
        inserted: true,
      })
      expect(quarantine.has('sig-new')).toBe(true)
    })

    it('returns duplicate metadata when replacement insertion collides with existing evidence', () => {
      quarantine.insert(createEvidence('sig-old', 'medium'))
      const duplicate = createEvidence('sig-duplicate', 'high')
      quarantine.insert(duplicate)

      const replacement = createEvidence('sig-new', 'critical')
      Object.defineProperty(replacement, '_signature', {
        value: 'sig-duplicate',
      })

      const result = quarantine.replace('sig-old', replacement)

      expect(result.status).toBe('replaced')
      expect(result.inserted).toBe(false)
      expect(result.duplicate).toBe(duplicate)
    })
  })

  describe('eviction', () => {
    it('evicts lowest severity first', () => {
      quarantine.insert(createEvidence('low1', 'low', 100))
      quarantine.insert(createEvidence('med1', 'medium', 100))
      quarantine.insert(createEvidence('high1', 'high', 100))
      quarantine.insert(createEvidence('crit1', 'critical', 100))
      quarantine.insert(createEvidence('low2', 'low', 100))
      quarantine.insert(createEvidence('low3', 'low', 100)) // triggers eviction

      expect(quarantine.has('low1')).toBe(false) // evicted
      expect(quarantine.has('high1')).toBe(true)
      expect(quarantine.has('crit1')).toBe(true)
    })

    it('records displaced stored evidence as pressure eviction', () => {
      quarantine.insert(createEvidence('low1', 'low', 100))
      quarantine.insert(createEvidence('med1', 'medium', 100))
      quarantine.insert(createEvidence('high1', 'high', 100))
      quarantine.insert(createEvidence('crit1', 'critical', 100))
      quarantine.insert(createEvidence('low2', 'low', 100))
      quarantine.insert(createEvidence('low3', 'low', 100)) // triggers eviction

      const latest = JSON.parse(auditChain.export().at(-1)!.eventData) as {
        type: string
        signature: string
        details: { reason: string }
      }

      expect(latest).toMatchObject({
        type: 'eviction',
        signature: 'low1',
        details: { reason: 'pressure' },
      })
    })

    it('does not count evictions as dropped stats', () => {
      quarantine.insert(createEvidence('low1', 'low', 100))
      quarantine.insert(createEvidence('med1', 'medium', 100))
      quarantine.insert(createEvidence('high1', 'high', 100))
      quarantine.insert(createEvidence('crit1', 'critical', 100))
      quarantine.insert(createEvidence('low2', 'low', 100))
      quarantine.insert(createEvidence('low3', 'low', 100)) // triggers eviction

      expect(quarantine.stats.droppedCount).toBe(0)
      expect(quarantine.stats.droppedBytes).toBe(0)
    })

    it('respects count limit', () => {
      for (let i = 0; i < 10; i++) {
        quarantine.insert(createEvidence(`sig${i}`, 'low', 100))
      }
      expect(quarantine.stats.count).toBe(5)
    })

    it('respects byte limit', () => {
      for (let i = 0; i < 20; i++) {
        quarantine.insert(createEvidence(`sig${i}`, 'low', 1000))
      }
      expect(quarantine.stats.bytes).toBeLessThanOrEqual(10000)
    })

    it('evicts multiple if needed', () => {
      for (let i = 0; i < 5; i++) {
        quarantine.insert(createEvidence(`small${i}`, 'low', 500))
      }
      quarantine.insert(createEvidence('large', 'high', 8000))

      expect(quarantine.stats.bytes).toBeLessThanOrEqual(10000)
      expect(quarantine.has('large')).toBe(true)
    })

    it('best-effort evicts already disposed evidence without aborting rebalancing', () => {
      const tinyQuarantine = new Quarantine(
        {
          maxCount: 1,
          maxBytes: 10_000,
          evictionPolicy: 'priority',
        },
        auditChain,
      )

      tinyQuarantine.insert(createDisposedEvidence('sig-evict', 'low'))

      expect(() => {
        tinyQuarantine.insert(createEvidence('sig-keep', 'high', 64))
      }).not.toThrow()
      expect(tinyQuarantine.has('sig-keep')).toBe(true)
    })
  })

  describe('stats', () => {
    it('reports current count', () => {
      quarantine.insert(createEvidence('sig1', 'high'))
      quarantine.insert(createEvidence('sig2', 'medium'))

      expect(quarantine.stats.count).toBe(2)
    })

    it('reports current bytes', () => {
      quarantine.insert(createEvidence('sig1', 'high', 2000))
      quarantine.insert(createEvidence('sig2', 'medium', 3000))

      expect(quarantine.stats.bytes).toBe(5000)
    })

    it('reports by severity', () => {
      quarantine.insert(createEvidence('sig1', 'high', 100))
      quarantine.insert(createEvidence('sig2', 'high', 100))
      quarantine.insert(createEvidence('sig3', 'low', 100))

      const stats = quarantine.stats
      expect(stats.bySeverity.high).toBe(2)
      expect(stats.bySeverity.low).toBe(1)
      expect(stats.bySeverity.medium).toBe(0)
    })

    it('updates after operations', () => {
      quarantine.insert(createEvidence('sig1', 'high', 1000))
      expect(quarantine.stats.count).toBe(1)

      quarantine.neutralize('sig1')
      expect(quarantine.stats.count).toBe(0)
      expect(quarantine.stats.bytes).toBe(0)
    })

    it('tracks dropped count and bytes monotonically', () => {
      quarantine.insert(createEvidence('keep-1', 'critical', 100))
      quarantine.insert(createEvidence('keep-2', 'critical', 100))
      quarantine.insert(createEvidence('keep-3', 'critical', 100))
      quarantine.insert(createEvidence('keep-4', 'critical', 100))
      quarantine.insert(createEvidence('keep-5', 'critical', 100))

      const firstDrop = quarantine.insert(createEvidence('drop-low-1', 'low', 100))
      const secondDrop = quarantine.insert(createEvidence('drop-low-2', 'low', 100))
      const oversizedDrop = quarantine.insert(createEvidence('drop-oversized', 'low', 20_000))

      expect(firstDrop.status).toBe('dropped')
      expect(secondDrop.status).toBe('dropped')
      expect(oversizedDrop.status).toBe('dropped')

      const stats = quarantine.stats
      expect(stats.droppedCount).toBe(3)
      expect(stats.droppedBytes).toBe(20_200)
    })
  })
})
