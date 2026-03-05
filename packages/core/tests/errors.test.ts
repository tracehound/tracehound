/**
 * Error factory tests - Coverage for errors.ts
 */

import { describe, expect, it } from 'vitest'
import { Errors, createError } from '../src/types/errors.js'

describe('Error Factories', () => {
  describe('createError', () => {
    it('should create error with all fields', () => {
      const error = createError('config', 'TEST_ERROR', 'Test message', {
        context: { foo: 'bar' },
        recoverable: false,
      })

      expect(error.state).toBe('config')
      expect(error.code).toBe('TEST_ERROR')
      expect(error.message).toBe('Test message')
      expect(error.context).toEqual({ foo: 'bar' })
      expect(error.recoverable).toBe(false)
    })

    it('should default recoverable to true', () => {
      const error = createError('agent', 'TEST', 'Message')
      expect(error.recoverable).toBe(true)
    })
  })

  describe('Config Errors', () => {
    it('should create invalidConfigQuarantine', () => {
      const error = Errors.invalidConfigQuarantine('test')
      expect(error.state).toBe('config')
      expect(error.code).toBe('CONFIG_QUARANTINE_INVALID')
    })

    it('should create invalidConfigRateLimit', () => {
      const error = Errors.invalidConfigRateLimit('test')
      expect(error.state).toBe('config')
    })

    it('should create invalidConfigAgent', () => {
      const error = Errors.invalidConfigAgent('test')
      expect(error.state).toBe('config')
    })

    it('should create invalidConfigScheduler', () => {
      const error = Errors.invalidConfigScheduler('test')
      expect(error.state).toBe('config')
    })

    it('should create snapshot and webhook config errors', () => {
      const snapshotError = Errors.invalidConfigSnapshot('bad-interval')
      const secretError = Errors.snapshotSecretMissing()
      const webhookUrlError = Errors.invalidConfigWebhookUrl('http://127.0.0.1')
      const webhookSecretError = Errors.invalidConfigWebhookSecret(32)

      expect(snapshotError.code).toBe('CONFIG_SNAPSHOT_INVALID')
      expect(secretError.code).toBe('CONFIG_SNAPSHOT_SECRET_MISSING')
      expect(webhookUrlError.code).toBe('CONFIG_WEBHOOK_URL_INVALID')
      expect(webhookSecretError.code).toBe('CONFIG_WEBHOOK_SECRET_INVALID')
    })
  })

  describe('Scent Errors', () => {
    it('should create scent errors', () => {
      expect(Errors.scentPayloadInvalid('bad').code).toBe('SCENT_PAYLOAD_INVALID')
      expect(Errors.scentSourceMissing().code).toBe('SCENT_SOURCE_MISSING')
      expect(Errors.scentIdInvalid('!').code).toBe('SCENT_ID_INVALID')
    })
  })

  describe('Agent Errors', () => {
    it('should create payload, intercept, and coordination contract errors', () => {
      expect(Errors.payloadTooLarge(2, 1).code).toBe('AGENT_PAYLOAD_TOO_LARGE')
      expect(Errors.serializationFailed('json').code).toBe('AGENT_SERIALIZATION_FAILED')
      expect(Errors.interceptFailed('panic').code).toBe('AGENT_INTERCEPT_FAILED')
      expect(Errors.interceptFailed('panic', { scentId: 'scent-1' }).context).toEqual({
        reason: 'panic',
        scentId: 'scent-1',
      })
      expect(
        Errors.coordinationContractInvalid('provider-1', 'health() returned invalid payload').code,
      ).toBe('AGENT_COORDINATION_CONTRACT_INVALID')
      expect(
        Errors.coordinationContractInvalid('provider-1', 'health() is required').context,
      ).toEqual({
        providerId: 'provider-1',
        issue: 'health() is required',
      })
    })
  })

  describe('Quarantine Errors', () => {
    it('should create quarantineFull', () => {
      const error = Errors.quarantineFull(100, 100)
      expect(error.state).toBe('quarantine')
    })

    it('should create quarantineEvictFailed', () => {
      const error = Errors.quarantineEvictFailed('test')
      expect(error.state).toBe('quarantine')
    })
  })

  describe('Evidence Errors', () => {
    it('should create evidenceAlreadyDisposed', () => {
      const error = Errors.evidenceAlreadyDisposed('sig')
      expect(error.state).toBe('evidence')
    })

    it('should create evidenceTransferFailed', () => {
      const error = Errors.evidenceTransferFailed('sig')
      expect(error.state).toBe('evidence')
    })

    it('should create evidenceEmpty', () => {
      const error = Errors.evidenceEmpty()
      expect(error.state).toBe('evidence')
    })

    it('should create evidenceInvalidBytes', () => {
      const error = Errors.evidenceInvalidBytes()
      expect(error.state).toBe('evidence')
    })

    it('should create evidenceHashMismatch', () => {
      const error = Errors.evidenceHashMismatch('a', 'b')
      expect(error.state).toBe('evidence')
    })
  })

  describe('Codec Errors', () => {
    it('should create codecEncodeFailed', () => {
      const error = Errors.codecEncodeFailed('test')
      expect(error.state).toBe('codec')
    })

    it('should create codecDecodeFailed', () => {
      const error = Errors.codecDecodeFailed('test')
      expect(error.state).toBe('codec')
    })

    it('should create codecIntegrityFailed', () => {
      const error = Errors.codecIntegrityFailed()
      expect(error.state).toBe('codec')
    })
  })

  describe('Cold Storage Errors', () => {
    it('should create coldStorageWriteFailed', () => {
      const error = Errors.coldStorageWriteFailed('id', 'reason')
      expect(error.state).toBe('cold_storage')
    })

    it('should create coldStorageReadFailed', () => {
      const error = Errors.coldStorageReadFailed('id', 'reason')
      expect(error.state).toBe('cold_storage')
    })

    it('should create coldStorageNotFound', () => {
      const error = Errors.coldStorageNotFound('id')
      expect(error.state).toBe('cold_storage')
    })

    it('should create coldStorageUnavailable', () => {
      const error = Errors.coldStorageUnavailable()
      expect(error.state).toBe('cold_storage')
    })
  })

  describe('Process Errors', () => {
    it('should create processSpawnFailed', () => {
      const error = Errors.processSpawnFailed('reason')
      expect(error.state).toBe('process')
    })

    it('should create processTimeout', () => {
      const error = Errors.processTimeout('id', 5000)
      expect(error.state).toBe('process')
    })

    it('should create processCrashed', () => {
      const error = Errors.processCrashed('id', 1)
      expect(error.state).toBe('process')
    })

    it('should create processPoolExhausted', () => {
      const error = Errors.processPoolExhausted('drop')
      expect(error.state).toBe('process')
    })

    it('should create process IPC specific errors', () => {
      expect(Errors.processIpcInvalidAnalysisMessage().code).toBe('PROCESS_IPC_INVALID_ANALYSIS_MESSAGE')
      expect(Errors.processIpcUnknownMessageType(255).code).toBe('PROCESS_IPC_UNKNOWN_MESSAGE_TYPE')
      expect(Errors.processIpcUnknownStatusState(0).code).toBe('PROCESS_IPC_UNKNOWN_STATUS_STATE')
      expect(Errors.processIpcUnknownContentType(99).code).toBe('PROCESS_IPC_UNKNOWN_CONTENT_TYPE')
      expect(Errors.processIpcDecodeFailed('malformed').code).toBe('PROCESS_IPC_DECODE_FAILED')
    })
  })

  describe('Rate Limit Errors', () => {
    it('should create rateLimited', () => {
      const error = Errors.rateLimited('source', 1000)
      expect(error.state).toBe('ratelimit')
    })

    it('should create rateSourceBlocked', () => {
      const error = Errors.rateSourceBlocked('source', 5000)
      expect(error.state).toBe('ratelimit')
    })
  })

  describe('Runtime Errors', () => {
    it('should create runtimeFlagMissing', () => {
      const error = Errors.runtimeFlagMissing('flag')
      expect(error.state).toBe('runtime')
    })

    it('should create runtimeIntrinsicsNotFrozen', () => {
      const error = Errors.runtimeIntrinsicsNotFrozen()
      expect(error.state).toBe('runtime')
    })

    it('should create runtime membrane and snapshot errors', () => {
      expect(Errors.runtimeMembraneViolation('stdout').code).toBe('RUNTIME_MEMBRANE_VIOLATION')
      expect(Errors.snapshotWriteFailed('io').code).toBe('RUNTIME_SNAPSHOT_WRITE_FAILED')
      expect(Errors.snapshotReadFailed('io').code).toBe('RUNTIME_SNAPSHOT_READ_FAILED')
      expect(Errors.snapshotIntegrityViolation().code).toBe('RUNTIME_SNAPSHOT_INTEGRITY_VIOLATION')
    })
  })

  describe('Scheduler Errors', () => {
    it('should create schedulerTaskFailed', () => {
      const error = Errors.schedulerTaskFailed('task', 'reason')
      expect(error.state).toBe('scheduler')
    })

    it('should create schedulerAlreadyRunning', () => {
      const error = Errors.schedulerAlreadyRunning()
      expect(error.state).toBe('scheduler')
    })
  })

  describe('Legacy aliases', () => {
    it('should create legacy compatibility errors', () => {
      expect(Errors.houndTimeout('h1', 50).code).toBe('PROCESS_TIMEOUT')
      expect(Errors.hashMismatch('a', 'b').code).toBe('EVIDENCE_HASH_MISMATCH')
      expect(Errors.invalidBytesType().code).toBe('EVIDENCE_INVALID_BYTES')
      expect(Errors.emptyEvidence().code).toBe('EVIDENCE_EMPTY')
    })
  })
})
