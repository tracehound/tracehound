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
        }),
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

    describe('dispatch', () => {
      let mockFetch: any

      beforeEach(() => {
        mockFetch = vi.fn()
        vi.stubGlobal('fetch', mockFetch)
        mockFetch.mockResolvedValue({ ok: true, status: 200 })
      })

      it('dispatches webhooks on event emit', async () => {
        emitter.registerWebhook({ url: 'https://webhook.site/test' })

        emitter.emit('threat.detected', { foo: 'bar' })

        // Wait for async dispatch
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(mockFetch).toHaveBeenCalledWith(
          'https://webhook.site/test',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('threat.detected'),
          }),
        )
      })

      it('filters webhooks by event type', async () => {
        emitter.registerWebhook({
          url: 'https://threats.only',
          events: ['threat.detected'],
        })

        emitter.emit('rate_limit.exceeded', {})
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(mockFetch).not.toHaveBeenCalled()

        emitter.emit('threat.detected', {})
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(mockFetch).toHaveBeenCalled()
      })

      it('includes HMAC signature if secret provided', async () => {
        emitter.registerWebhook({
          url: 'https://secure.webhook',
          secret: 'test-secret',
        })

        emitter.emit('threat.detected', { data: 1 })
        await new Promise((resolve) => setTimeout(resolve, 50)) // Hashing takes a bit more time with dynamic import

        expect(mockFetch).toHaveBeenCalledWith(
          'https://secure.webhook',
          expect.objectContaining({
            headers: expect.objectContaining({
              'X-Tracehound-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
            }),
          }),
        )
      })

      it('retries on 5xx errors', async () => {
        mockFetch
          .mockResolvedValueOnce({ ok: false, status: 503 })
          .mockResolvedValueOnce({ ok: true, status: 200 })

        emitter.registerWebhook({
          url: 'https://retry.me',
          retry: { maxAttempts: 2, delayMs: 1 },
        })

        emitter.emit('threat.detected', {})
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(mockFetch).toHaveBeenCalledTimes(2)
      })

      it('gives up after max attempts', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500 })

        emitter.registerWebhook({
          url: 'https://fail.me',
          retry: { maxAttempts: 2, delayMs: 1 },
        })

        emitter.emit('threat.detected', {})
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(mockFetch).toHaveBeenCalledTimes(2)
      })
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
