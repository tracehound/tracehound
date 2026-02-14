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
})
