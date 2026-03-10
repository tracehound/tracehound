import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  NotificationEmitter,
  createNotificationEmitter,
  type TracehoundEvent,
} from '../src/core/notification-emitter.js'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

async function drainMicrotasks(iterations = 8): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await Promise.resolve()
  }
}

async function waitForCondition(
  predicate: () => boolean,
  message: string,
  iterations = 16,
): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    if (predicate()) {
      return
    }
    await drainMicrotasks()
  }

  throw new Error(message)
}

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

    it('treats an empty event filter as a subscription to all events', async () => {
      const subscription = emitter.subscribe([])
      const iterator = subscription[Symbol.asyncIterator]()

      emitter.emit('rate_limit.exceeded', { source: 'test' })

      const result = await iterator.next()
      expect(result.value.type).toBe('rate_limit.exceeded')
      await iterator.return?.()
    })

    it('cleans up on return', async () => {
      const subscription = emitter.subscribe()
      const iterator = subscription[Symbol.asyncIterator]()

      expect(emitter.stats.activeSubscribers).toBe(1)

      await iterator.return?.()

      expect(emitter.stats.activeSubscribers).toBe(0)
    })

    it('returns done when next() is called after the iterator is closed', async () => {
      const subscription = emitter.subscribe()
      const iterator = subscription[Symbol.asyncIterator]()

      await iterator.return?.()

      const result = await iterator.next()
      expect(result).toEqual({ value: undefined, done: true })
    })

    it('resolves pending next() when a new event is emitted', async () => {
      const subscription = emitter.subscribe()
      const iterator = subscription[Symbol.asyncIterator]()
      const pending = iterator.next()

      emitter.emit('threat.detected', { delayed: true })
      const result = await pending

      expect(result.done).toBe(false)
      expect(result.value.type).toBe('threat.detected')
      expect(result.value.payload).toEqual({ delayed: true })
      await iterator.return?.()
    })

    it('resolves a pending next() as done when iterator return() is called', async () => {
      const subscription = emitter.subscribe()
      const iterator = subscription[Symbol.asyncIterator]()
      const pending = iterator.next()

      await iterator.return?.()

      await expect(pending).resolves.toEqual({ value: undefined, done: true })
      expect(emitter.stats.activeSubscribers).toBe(0)
    })

    it('handles repeated return() calls without throwing', async () => {
      const subscription = emitter.subscribe()
      const iterator = subscription[Symbol.asyncIterator]()

      await expect(iterator.return?.()).resolves.toEqual({ value: undefined, done: true })
      await expect(iterator.return?.()).resolves.toEqual({ value: undefined, done: true })
      expect(emitter.stats.activeSubscribers).toBe(0)
    })

    it('drops oldest queued subscriber events when the slow-consumer queue is full', async () => {
      emitter = new NotificationEmitter({ subscriberQueueLimit: 2 })
      const subscription = emitter.subscribe()
      const iterator = subscription[Symbol.asyncIterator]()

      emitter.emit('threat.detected', { id: 1 })
      emitter.emit('threat.detected', { id: 2 })
      emitter.emit('threat.detected', { id: 3 })

      const first = await iterator.next()
      const second = await iterator.next()

      expect(first.value.payload).toEqual({ id: 2 })
      expect(second.value.payload).toEqual({ id: 3 })
      expect(emitter.stats.droppedSubscriberEvents).toBe(1)
      await iterator.return?.()
    })
  })

  describe('webhook registration', () => {
    it('registers webhooks and returns ID', () => {
      const id = emitter.registerWebhook({
        url: 'https://example.com/webhook',
      })

      expect(id).toMatch(/^[0-9a-f-]+$/)
      expect(emitter.stats.activeWebhooks).toBe(1)
    })

    it('unregisters webhooks', () => {
      const id = emitter.registerWebhook({
        url: 'https://example.com/webhook',
      })
      emitter.unregisterWebhook(id)

      expect(emitter.stats.activeWebhooks).toBe(0)
    })

    it('rejects private/internal webhook URLs (SSRF protection)', () => {
      const blocked = [
        'http://127.0.0.1/hook',
        'http://localhost/hook',
        'http://0.0.0.0/hook',
        'http://10.0.0.1/hook',
        'http://100.64.0.1/hook',
        'http://172.16.0.1/hook',
        'http://172.31.255.255/hook',
        'http://192.0.0.1/hook',
        'http://192.0.2.1/hook',
        'http://192.88.99.1/hook',
        'http://192.168.1.1/hook',
        'http://198.18.0.1/hook',
        'http://198.51.100.1/hook',
        'http://203.0.113.10/hook',
        'http://224.0.0.1/hook',
        'http://240.0.0.1/hook',
        'http://169.254.169.254/latest/meta-data/',
        'http://metadata.google.internal/computeMetadata/v1/',
        'http://[::]/hook',
        'http://[::1]/hook',
        'http://[fc00::1]/hook',
        'http://[fe80::1]/hook',
        'http://[ff02::1]/hook',
        'http://[2001:db8::1]/hook',
        'http://[2001:db8:1:2:3:4:5:6]/hook',
        'http://[2001:2::1]/hook',
      ]
      for (const url of blocked) {
        expect(() => emitter.registerWebhook({ url })).toThrow(/private\/internal/)
      }
    })

    it('allows public webhook URLs', () => {
      const allowed = [
        'https://example.com/webhook',
        'https://hooks.slack.com/services/T/B/X',
        'https://8.8.8.8/hook',
      ]
      for (const url of allowed) {
        expect(() => emitter.registerWebhook({ url })).not.toThrow()
      }
    })

    it('rejects webhook secrets shorter than 16 characters', () => {
      expect(() =>
        emitter.registerWebhook({
          url: 'https://example.com/hook',
          secret: 'short',
        }),
      ).toThrow(/at least 16 characters/)
    })

    it('accepts webhook secrets of 16+ characters', () => {
      expect(() =>
        emitter.registerWebhook({
          url: 'https://example.com/hook',
          secret: randomBytes(16).toString('hex'),
        }),
      ).not.toThrow()
    })

    it('rejects malformed webhook URLs', () => {
      expect(() => emitter.registerWebhook({ url: 'not-a-url' })).toThrow(/private\/internal/)
    })

    it('rejects localhost hostnames with trailing dot notation', () => {
      expect(() => emitter.registerWebhook({ url: 'https://localhost./hook' })).toThrow(
        /private\/internal/,
      )
    })

    describe('dispatch', () => {
      let mockFetch: Mock
      let lookupMock: Mock

      beforeEach(() => {
        vi.useFakeTimers()
        mockFetch = vi.fn()
        vi.stubGlobal('fetch', mockFetch)
        mockFetch.mockResolvedValue({ ok: true, status: 200 })
        lookupMock = vi.mocked(lookup) as unknown as Mock
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
      })

      afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
      })

      it('dispatches webhooks on event emit', async () => {
        emitter.registerWebhook({ url: 'https://webhook.site/test' })

        emitter.emit('threat.detected', { foo: 'bar' })

        // Wait for async dispatch
        await vi.runAllTimersAsync()

        expect(mockFetch).toHaveBeenCalledTimes(1)
        const [url, init] = mockFetch.mock.calls[0] as [unknown, RequestInit]
        expect(String(url)).toBe('https://webhook.site/test')
        expect(init.method).toBe('POST')
        expect(String(init.body)).toContain('threat.detected')
        expect(init.redirect).toBe('error')
        expect(init.signal).toBeInstanceOf(AbortSignal)
      })

      it('filters webhooks by event type', async () => {
        emitter.registerWebhook({
          url: 'https://threats.only',
          events: ['threat.detected'],
        })

        emitter.emit('rate_limit.exceeded', {})
        await vi.runAllTimersAsync()
        expect(mockFetch).not.toHaveBeenCalled()

        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()
        expect(mockFetch).toHaveBeenCalled()
      })

      it('includes HMAC signature if secret provided', async () => {
        emitter.registerWebhook({
          url: 'https://secure.webhook',
          secret: randomBytes(16).toString('hex'),
        })

        emitter.emit('threat.detected', { data: 1 })
        await vi.runAllTimersAsync() // Hashing takes a bit more time with dynamic import

        expect(mockFetch).toHaveBeenCalledTimes(1)
        const [url, init] = mockFetch.mock.calls[0] as [unknown, RequestInit]
        expect(String(url)).toBe('https://secure.webhook/')
        const headers = init.headers as Record<string, string>
        expect(headers['X-Tracehound-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
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
        await vi.runAllTimersAsync()

        expect(mockFetch).toHaveBeenCalledTimes(2)
      })

      it('gives up after max attempts', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500 })

        emitter.registerWebhook({
          url: 'https://fail.me',
          retry: { maxAttempts: 2, delayMs: 1 },
        })

        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).toHaveBeenCalledTimes(2)
      })

      it('retries and gives up silently on repeated fetch exceptions', async () => {
        mockFetch.mockRejectedValue(new Error('network down'))

        emitter.registerWebhook({
          url: 'https://throw.me',
          retry: { maxAttempts: 2, delayMs: 1 },
        })

        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).toHaveBeenCalledTimes(2)
      })

      it('rejects unsupported protocols at registration', () => {
        expect(() => emitter.registerWebhook({ url: 'ftp://example.com/hook' })).toThrow(
          /private\/internal/,
        )
      })

      it('blocks webhook delivery when DNS resolves to a private address', async () => {
        lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
        emitter.registerWebhook({ url: 'https://public-name.example/hook' })

        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).not.toHaveBeenCalled()
        expect(emitter.stats.rejectedWebhookDeliveries).toBe(1)
      })

      it('rejects webhook delivery when destination resolution fails before dispatch', async () => {
        lookupMock.mockRejectedValueOnce(new Error('dns unavailable during dispatch'))
        emitter.registerWebhook({ url: 'https://dispatch-fail.example/hook' })

        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).not.toHaveBeenCalled()
        expect(emitter.stats.rejectedWebhookDeliveries).toBe(1)
      })

      it('blocks webhook delivery when DNS resolves to a special-use address', async () => {
        lookupMock.mockResolvedValue([{ address: '100.64.0.10', family: 4 }])
        emitter.registerWebhook({ url: 'https://edge-name.example/hook' })

        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).not.toHaveBeenCalled()
        expect(emitter.stats.rejectedWebhookDeliveries).toBe(1)
      })

      it('validates dispatch destinations defensively for malformed and blocked URLs', async () => {
        const internals = emitter as unknown as {
          isWebhookDestinationAllowed: (url: string) => Promise<boolean>
        }

        await expect(internals.isWebhookDestinationAllowed('not-a-url')).resolves.toBe(false)
        await expect(internals.isWebhookDestinationAllowed('ftp://example.com/hook')).resolves.toBe(
          false,
        )
        await expect(
          internals.isWebhookDestinationAllowed('https://user:pass@example.com/hook'),
        ).resolves.toBe(false)
        await expect(internals.isWebhookDestinationAllowed('https://localhost/hook')).resolves.toBe(
          false,
        )
        await expect(
          internals.isWebhookDestinationAllowed('https://service.localhost/hook'),
        ).resolves.toBe(false)
        await expect(
          internals.isWebhookDestinationAllowed('https://100.64.0.1/hook'),
        ).resolves.toBe(false)
        await expect(
          internals.isWebhookDestinationAllowed('https://[::ffff:127.0.0.1]/hook'),
        ).resolves.toBe(false)
        await expect(
          internals.isWebhookDestinationAllowed('https://93.184.216.34/hook'),
        ).resolves.toBe(true)
        // IPv4-in-IPv6 notation: exercises parseIpv6SegmentGroup dot-segment path
        await expect(
          internals.isWebhookDestinationAllowed('https://[2001:db8::1.2.3.4]/hook'),
        ).resolves.toBe(false)
      })

      it('rejects dispatch destinations when dns lookup is empty or fails', async () => {
        const internals = emitter as unknown as {
          isWebhookDestinationAllowed: (url: string) => Promise<boolean>
        }

        lookupMock.mockResolvedValueOnce([])
        await expect(
          internals.isWebhookDestinationAllowed('https://no-records.example/hook'),
        ).resolves.toBe(false)

        lookupMock.mockRejectedValueOnce(new Error('dns unavailable'))
        await expect(
          internals.isWebhookDestinationAllowed('https://lookup-fails.example/hook'),
        ).resolves.toBe(false)
      })

      it('covers ipv4/ipv6 parser edge cases for destination validation', async () => {
        const internals = emitter as unknown as {
          isWebhookDestinationAllowed: (url: string) => Promise<boolean>
        }

        await expect(
          internals.isWebhookDestinationAllowed('https://[2606:4700:4700::1111]/hook'),
        ).resolves.toBe(true)
        await expect(
          internals.isWebhookDestinationAllowed('https://[2001::db8::1]/hook'),
        ).resolves.toBe(false)
        await expect(
          internals.isWebhookDestinationAllowed('https://[2001:db8:0:0:0:0:0]/hook'),
        ).resolves.toBe(false)
        await expect(
          internals.isWebhookDestinationAllowed('https://[::ffff:999.1.1.1]/hook'),
        ).resolves.toBe(false)
        await expect(internals.isWebhookDestinationAllowed('https://256.1.1.1/hook')).resolves.toBe(
          false,
        )
      })

      it('blocks delivery when hostname resolution drifts away from initial allow-set', async () => {
        lookupMock
          .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
          .mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }])

        emitter.registerWebhook({ url: 'https://rebind.example/hook' })
        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).not.toHaveBeenCalled()
        expect(emitter.stats.rejectedWebhookDeliveries).toBe(1)
      })

      it('blocks delivery when follow-up resolution contains blocked addresses', async () => {
        lookupMock
          .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
          .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])

        emitter.registerWebhook({ url: 'https://rebind-private.example/hook' })
        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).not.toHaveBeenCalled()
        expect(emitter.stats.rejectedWebhookDeliveries).toBe(1)
      })

      it('blocks delivery when follow-up resolution lookup fails', async () => {
        lookupMock
          .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
          .mockRejectedValueOnce(new Error('dns outage'))

        emitter.registerWebhook({ url: 'https://rebind-error.example/hook' })
        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).not.toHaveBeenCalled()
        expect(emitter.stats.rejectedWebhookDeliveries).toBe(1)
      })

      it('blocks delivery when follow-up resolution is empty', async () => {
        lookupMock
          .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
          .mockResolvedValueOnce([])

        emitter.registerWebhook({ url: 'https://rebind-empty.example/hook' })
        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).not.toHaveBeenCalled()
        expect(emitter.stats.rejectedWebhookDeliveries).toBe(1)
      })

      it('allows ip-literal webhook dispatch without dns re-resolution', async () => {
        const lookupCallsBefore = lookupMock.mock.calls.length
        emitter.registerWebhook({ url: 'https://8.8.8.8/hook' })
        emitter.emit('threat.detected', {})
        await vi.runAllTimersAsync()

        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(lookupMock.mock.calls.length).toBe(lookupCallsBefore)
      })

      it('returns early when queue shift yields no dispatch job', async () => {
        const internals = emitter as unknown as {
          drainWebhookQueue: () => void
          webhookQueue: unknown[]
          activeWebhookDispatches: number
          webhookMaxInflight: number
        }

        internals.activeWebhookDispatches = 0
        internals.webhookMaxInflight = 1
        internals.webhookQueue = [undefined]

        expect(() => internals.drainWebhookQueue()).not.toThrow()
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('validates resolution helper branches directly', async () => {
        const internals = emitter as unknown as {
          isWebhookResolutionStillAllowed: (destination: {
            url: URL
            hostname: string
            ipLiteral: boolean
            initialAddresses: ReadonlySet<string>
          }) => Promise<boolean>
        }

        await expect(
          internals.isWebhookResolutionStillAllowed({
            url: new URL('https://8.8.8.8/hook'),
            hostname: '8.8.8.8',
            ipLiteral: true,
            initialAddresses: new Set(['8.8.8.8']),
          }),
        ).resolves.toBe(true)

        lookupMock.mockResolvedValueOnce([
          { address: '93.184.216.34', family: 4 },
          { address: '93.184.216.35', family: 4 },
        ])
        await expect(
          internals.isWebhookResolutionStillAllowed({
            url: new URL('https://multi.example/hook'),
            hostname: 'multi.example',
            ipLiteral: false,
            initialAddresses: new Set(['93.184.216.34']),
          }),
        ).resolves.toBe(true)
      })

      it('drains inflight webhook state even when dispatcher rejects unexpectedly', async () => {
        emitter = new NotificationEmitter({ webhookMaxInflight: 1, webhookQueueLimit: 1 })
        emitter.registerWebhook({ url: 'https://rejection.example/hook' })

        const internals = emitter as unknown as {
          dispatchWebhook: (webhook: unknown, event: TracehoundEvent) => Promise<void>
        }
        vi.spyOn(internals, 'dispatchWebhook').mockRejectedValue(new Error('dispatch failed'))

        emitter.emit('threat.detected', { id: 1 })

        await waitForCondition(
          () =>
            emitter.stats.inflightWebhookDeliveries === 0 &&
            emitter.stats.queuedWebhookDeliveries === 0,
          'expected rejected dispatch to release inflight bookkeeping',
        )
      })

      it('rejects credentialed webhook URLs at registration', () => {
        expect(() =>
          emitter.registerWebhook({ url: 'https://user:pass@example.com/hook' }),
        ).toThrow(/private\/internal/)
      })

      it('aborts slow webhook requests after the timeout window', async () => {
        let capturedSignal: AbortSignal | null = null
        mockFetch.mockImplementation(
          (_url: string, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, _reject) => {
              capturedSignal = init?.signal ?? null
            }),
        )

        emitter.registerWebhook({
          url: 'https://timeout.example/hook',
          retry: { maxAttempts: 1, delayMs: 1 },
        })
        emitter.emit('threat.detected', {})

        await waitForCondition(
          () => capturedSignal !== null,
          'expected webhook dispatch to start before timeout assertion',
        )
        const signal = capturedSignal as unknown as AbortSignal
        expect(signal.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(5_000)
        expect(signal.aborted).toBe(true)
      })

      it('bounds webhook inflight work and queue backlog under burst emission', async () => {
        emitter = new NotificationEmitter({ webhookMaxInflight: 1, webhookQueueLimit: 1 })
        let releaseFirst: (() => void) | null = null
        mockFetch.mockImplementation(
          () =>
            new Promise((resolve) => {
              if (!releaseFirst) {
                releaseFirst = () => resolve({ ok: true, status: 200 })
                return
              }
              resolve({ ok: true, status: 200 })
            }),
        )

        emitter.registerWebhook({ url: 'https://bounded.queue/test' })

        emitter.emit('threat.detected', { id: 1 })
        emitter.emit('threat.detected', { id: 2 })
        emitter.emit('threat.detected', { id: 3 })

        expect(emitter.stats.inflightWebhookDeliveries).toBe(1)
        expect(emitter.stats.queuedWebhookDeliveries).toBe(1)
        expect(emitter.stats.droppedWebhookDeliveries).toBe(1)

        await waitForCondition(
          () => releaseFirst !== null && mockFetch.mock.calls.length === 1,
          'expected first webhook delivery to enter fetch before release',
        )
        ;(releaseFirst as unknown as () => void)()
        await waitForCondition(
          () =>
            mockFetch.mock.calls.length === 2 &&
            emitter.stats.inflightWebhookDeliveries === 0 &&
            emitter.stats.queuedWebhookDeliveries === 0,
          'expected queued webhook delivery to fully drain after inflight completion',
        )
        expect(mockFetch).toHaveBeenCalledTimes(2)
        expect(emitter.stats.inflightWebhookDeliveries).toBe(0)
        expect(emitter.stats.queuedWebhookDeliveries).toBe(0)
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

    it('returns zero counts for event types that have not been emitted', () => {
      emitter.emit('threat.detected', {})

      expect(emitter.stats.byType['system.panic']).toBe(0)
      expect(emitter.stats.byType['license.expired']).toBe(0)
    })

    it('tracks active callbacks', () => {
      emitter.on('threat.detected', () => {})
      emitter.on('threat.detected', () => {})
      emitter.on('rate_limit.exceeded', () => {})

      expect(emitter.stats.activeCallbacks).toBe(3)
    })

    it('exposes bounded notification configuration and counters', () => {
      emitter = new NotificationEmitter({
        subscriberQueueLimit: 2,
        webhookQueueLimit: 3,
        webhookMaxInflight: 1,
      })

      expect(emitter.stats.subscriberQueueLimit).toBe(2)
      expect(emitter.stats.webhookQueueLimit).toBe(3)
      expect(emitter.stats.webhookMaxInflight).toBe(1)
      expect(emitter.stats.droppedSubscriberEvents).toBe(0)
      expect(emitter.stats.droppedWebhookDeliveries).toBe(0)
      expect(emitter.stats.rejectedWebhookDeliveries).toBe(0)
    })

    it('normalizes invalid bounds to defaults and floors fractional limits', () => {
      emitter = new NotificationEmitter({
        subscriberQueueLimit: 0,
        webhookQueueLimit: Number.NaN,
        webhookMaxInflight: 2.9,
      })

      expect(emitter.stats.subscriberQueueLimit).toBe(64)
      expect(emitter.stats.webhookQueueLimit).toBe(256)
      expect(emitter.stats.webhookMaxInflight).toBe(2)
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
      expect(capturedEvent!.id).toMatch(/^[0-9a-f-]+$/)
    })
  })

  describe('factory function', () => {
    it('creates an emitter instance', () => {
      const em = createNotificationEmitter()
      expect(em.stats.totalEmitted).toBe(0)
    })

    it('passes configuration through the factory', () => {
      const em = createNotificationEmitter({ subscriberQueueLimit: 3 })
      expect(em.stats.subscriberQueueLimit).toBe(3)
    })
  })
})
