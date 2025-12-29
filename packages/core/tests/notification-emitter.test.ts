import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NotificationEmitter,
  createNotificationEmitter,
  type TracehoundEvent,
} from '../src/core/notification-emitter.js'

describe('NotificationEmitter', () => {
  let emitter: NotificationEmitter

  beforeEach(() => {
    emitter = new NotificationEmitter()
  })

  describe('callback registry', () => {
    it('calls registered callbacks on emit', () => {
      const callback = vi.fn()
      emitter.on('threat.detected', callback)

      emitter.emit('threat.detected', { test: true })

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'threat.detected',
          payload: { test: true },
        })
      )
    })

    it('does not call callbacks for other event types', () => {
      const callback = vi.fn()
      emitter.on('threat.detected', callback)

      emitter.emit('rate_limit.exceeded', { source: 'test' })

      expect(callback).not.toHaveBeenCalled()
    })

    it('allows multiple callbacks per event', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      emitter.on('threat.detected', cb1)
      emitter.on('threat.detected', cb2)

      emitter.emit('threat.detected', {})

      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).toHaveBeenCalledTimes(1)
    })

    it('removes callback with off()', () => {
      const callback = vi.fn()
      emitter.on('threat.detected', callback)
      emitter.off('threat.detected', callback)

      emitter.emit('threat.detected', {})

      expect(callback).not.toHaveBeenCalled()
    })

    it('silently ignores callback errors', () => {
      const badCallback = vi.fn(() => {
        throw new Error('Callback error')
      })
      const goodCallback = vi.fn()

      emitter.on('threat.detected', badCallback)
      emitter.on('threat.detected', goodCallback)

      // Should not throw
      expect(() => emitter.emit('threat.detected', {})).not.toThrow()
      expect(goodCallback).toHaveBeenCalled()
    })
  })

  describe('async iterable (subscribe)', () => {
    it('yields emitted events', async () => {
      const subscription = emitter.subscribe()
      const events: TracehoundEvent[] = []

      emitter.emit('threat.detected', { id: 1 })
      emitter.emit('threat.detected', { id: 2 })

      const iterator = subscription[Symbol.asyncIterator]()
      events.push((await iterator.next()).value)
      events.push((await iterator.next()).value)

      expect(events).toHaveLength(2)
      expect(events[0]?.payload).toEqual({ id: 1 })
      expect(events[1]?.payload).toEqual({ id: 2 })
    })

    it('filters events by type', async () => {
      const subscription = emitter.subscribe(['threat.detected'])
      const iterator = subscription[Symbol.asyncIterator]()

      emitter.emit('rate_limit.exceeded', { source: 'test' })
      emitter.emit('threat.detected', { id: 1 })

      const result = await iterator.next()
      expect(result.value.type).toBe('threat.detected')
    })

    it('cleans up on return', async () => {
      const subscription = emitter.subscribe()
      const iterator = subscription[Symbol.asyncIterator]()

      expect(emitter.stats.activeSubscribers).toBe(1)

      await iterator.return?.()

      expect(emitter.stats.activeSubscribers).toBe(0)
    })
  })

  describe('webhook registration', () => {
    it('registers webhooks and returns ID', () => {
      const id = emitter.registerWebhook({ url: 'https://example.com/webhook' })

      expect(id).toMatch(/^webhook-/)
      expect(emitter.stats.activeWebhooks).toBe(1)
    })

    it('unregisters webhooks', () => {
      const id = emitter.registerWebhook({ url: 'https://example.com/webhook' })
      emitter.unregisterWebhook(id)

      expect(emitter.stats.activeWebhooks).toBe(0)
    })
  })

  describe('stats', () => {
    it('tracks total emitted events', () => {
      emitter.emit('threat.detected', {})
      emitter.emit('threat.detected', {})
      emitter.emit('rate_limit.exceeded', {})

      expect(emitter.stats.totalEmitted).toBe(3)
    })

    it('tracks events by type', () => {
      emitter.emit('threat.detected', {})
      emitter.emit('threat.detected', {})
      emitter.emit('rate_limit.exceeded', {})

      expect(emitter.stats.byType['threat.detected']).toBe(2)
      expect(emitter.stats.byType['rate_limit.exceeded']).toBe(1)
    })

    it('tracks active callbacks', () => {
      emitter.on('threat.detected', () => {})
      emitter.on('threat.detected', () => {})
      emitter.on('rate_limit.exceeded', () => {})

      expect(emitter.stats.activeCallbacks).toBe(3)
    })
  })

  describe('event structure', () => {
    it('includes timestamp and id', () => {
      let capturedEvent: TracehoundEvent | null = null
      emitter.on('threat.detected', (e) => {
        capturedEvent = e
      })

      emitter.emit('threat.detected', { test: true })

      expect(capturedEvent).not.toBeNull()
      expect(capturedEvent!.timestamp).toBeGreaterThan(0)
      expect(capturedEvent!.id).toMatch(/^evt-/)
    })
  })

  describe('factory function', () => {
    it('creates an emitter instance', () => {
      const em = createNotificationEmitter()
      expect(em.stats.totalEmitted).toBe(0)
    })
  })
})
