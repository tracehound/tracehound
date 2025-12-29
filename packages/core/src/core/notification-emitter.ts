/**
 * Universal Notification API - Event emission for all consumers.
 *
 * RFC-0000 COMPLIANCE:
 * - Read-only event emission (no backpressure)
 * - Fire-and-forget semantics
 * - No blocking on consumer processing
 */

// ─────────────────────────────────────────────────────────────────────────────
// Event Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All possible event types emitted by Tracehound.
 */
export type EventType =
  | 'threat.detected'
  | 'evidence.quarantined'
  | 'evidence.evicted'
  | 'rate_limit.exceeded'
  | 'system.panic'
  | 'license.validated'
  | 'license.expired'

/**
 * Base event structure.
 */
export interface TracehoundEvent<T = unknown> {
  /** Event type */
  type: EventType
  /** Unix timestamp (ms) */
  timestamp: number
  /** Event payload */
  payload: T
  /** Unique event ID */
  id: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ThreatDetectedPayload {
  scentId: string
  category: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  source: string
}

export interface EvidenceQuarantinedPayload {
  signature: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  sizeBytes: number
}

export interface EvidenceEvictedPayload {
  signature: string
  reason: 'capacity' | 'policy' | 'manual'
}

export interface RateLimitExceededPayload {
  source: string
  retryAfterMs: number
}

export interface SystemPanicPayload {
  level: 'warning' | 'critical' | 'fatal'
  reason: string
  context?: Record<string, unknown>
}

export interface LicenseValidatedPayload {
  tier: 'community' | 'pro' | 'enterprise'
  daysRemaining?: number
}

export interface LicenseExpiredPayload {
  tier: 'community' | 'pro' | 'enterprise'
  gracePeriod: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Config
// ─────────────────────────────────────────────────────────────────────────────

export interface WebhookConfig {
  /** Webhook URL */
  url: string
  /** Events to subscribe to (empty = all) */
  events?: EventType[]
  /** Custom headers */
  headers?: Record<string, string>
  /** Secret for HMAC signature */
  secret?: string
  /** Retry configuration */
  retry?: {
    maxAttempts: number
    delayMs: number
  }
}

interface RegisteredWebhook extends WebhookConfig {
  id: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

export type EventCallback<T = unknown> = (event: TracehoundEvent<T>) => void

/**
 * Notification Emitter interface.
 */
export interface INotificationEmitter {
  /**
   * Register a callback for an event type.
   */
  on<T = unknown>(event: EventType, callback: EventCallback<T>): void

  /**
   * Unregister a callback for an event type.
   */
  off<T = unknown>(event: EventType, callback: EventCallback<T>): void

  /**
   * Subscribe to events as an async iterable.
   * @param events - Event types to subscribe to (empty = all)
   */
  subscribe(events?: EventType[]): AsyncIterable<TracehoundEvent>

  /**
   * Register a webhook for event delivery.
   * @returns Webhook ID
   */
  registerWebhook(config: WebhookConfig): string

  /**
   * Unregister a webhook.
   */
  unregisterWebhook(id: string): void

  /**
   * Emit an event to all consumers.
   */
  emit<T>(type: EventType, payload: T): void

  /**
   * Get emitter statistics.
   */
  readonly stats: NotificationEmitterStats
}

export interface NotificationEmitterStats {
  totalEmitted: number
  byType: Record<EventType, number>
  activeCallbacks: number
  activeSubscribers: number
  activeWebhooks: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notification Emitter implementation.
 */
export class NotificationEmitter implements INotificationEmitter {
  private callbacks = new Map<EventType, Set<EventCallback>>()
  private subscribers: Array<{
    events: EventType[] | null
    push: (event: TracehoundEvent) => void
  }> = []
  private webhooks = new Map<string, RegisteredWebhook>()

  private _totalEmitted = 0
  private _byType = new Map<EventType, number>()
  private eventCounter = 0

  on<T = unknown>(event: EventType, callback: EventCallback<T>): void {
    let set = this.callbacks.get(event)
    if (!set) {
      set = new Set()
      this.callbacks.set(event, set)
    }
    set.add(callback as EventCallback)
  }

  off<T = unknown>(event: EventType, callback: EventCallback<T>): void {
    const set = this.callbacks.get(event)
    if (set) {
      set.delete(callback as EventCallback)
    }
  }

  subscribe(events?: EventType[]): AsyncIterable<TracehoundEvent> {
    const self = this
    const queue: TracehoundEvent[] = []
    let resolve: ((value: IteratorResult<TracehoundEvent>) => void) | null = null
    let closed = false

    const subscriber = {
      events: events ?? null,
      push: (event: TracehoundEvent) => {
        if (closed) return
        if (resolve) {
          const r = resolve
          resolve = null
          r({ value: event, done: false })
        } else {
          queue.push(event)
        }
      },
    }

    this.subscribers.push(subscriber)

    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<TracehoundEvent>> {
            if (closed) {
              return Promise.resolve({ value: undefined, done: true })
            }

            const queued = queue.shift()
            if (queued) {
              return Promise.resolve({ value: queued, done: false })
            }

            return new Promise((r) => {
              resolve = r
            })
          },
          return(): Promise<IteratorResult<TracehoundEvent>> {
            closed = true
            const idx = self.subscribers.indexOf(subscriber)
            if (idx !== -1) {
              self.subscribers.splice(idx, 1)
            }
            return Promise.resolve({ value: undefined, done: true })
          },
        }
      },
    }
  }

  registerWebhook(config: WebhookConfig): string {
    const id = `webhook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.webhooks.set(id, { ...config, id })
    return id
  }

  unregisterWebhook(id: string): void {
    this.webhooks.delete(id)
  }

  emit<T>(type: EventType, payload: T): void {
    const event: TracehoundEvent<T> = {
      type,
      timestamp: Date.now(),
      payload,
      id: `evt-${++this.eventCounter}`,
    }

    // Update stats
    this._totalEmitted++
    this._byType.set(type, (this._byType.get(type) ?? 0) + 1)

    // Notify callbacks (fire-and-forget)
    const callbacks = this.callbacks.get(type)
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(event)
        } catch {
          // Silently ignore callback errors
        }
      }
    }

    // Notify subscribers
    for (const sub of this.subscribers) {
      if (sub.events === null || sub.events.includes(type)) {
        sub.push(event)
      }
    }

    // Dispatch webhooks (async, fire-and-forget)
    for (const [, webhook] of this.webhooks) {
      if (!webhook.events || webhook.events.length === 0 || webhook.events.includes(type)) {
        this.dispatchWebhook(webhook, event).catch(() => {
          // Silently ignore webhook errors
        })
      }
    }
  }

  get stats(): NotificationEmitterStats {
    const byType: Record<string, number> = {}
    for (const [type, count] of this._byType) {
      byType[type] = count
    }

    return {
      totalEmitted: this._totalEmitted,
      byType: byType as Record<EventType, number>,
      activeCallbacks: Array.from(this.callbacks.values()).reduce((sum, set) => sum + set.size, 0),
      activeSubscribers: this.subscribers.length,
      activeWebhooks: this.webhooks.size,
    }
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  private async dispatchWebhook(webhook: RegisteredWebhook, event: TracehoundEvent): Promise<void> {
    const body = JSON.stringify(event)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Tracehound/1.0',
      ...webhook.headers,
    }

    // Add HMAC signature if secret provided
    if (webhook.secret) {
      const { createHmac } = await import('node:crypto')
      const signature = createHmac('sha256', webhook.secret).update(body).digest('hex')
      headers['X-Tracehound-Signature'] = `sha256=${signature}`
    }

    const maxAttempts = webhook.retry?.maxAttempts ?? 3
    const delayMs = webhook.retry?.delayMs ?? 1000

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body,
        })

        if (response.ok) {
          return
        }

        // Retry on 5xx errors
        if (response.status >= 500 && attempt < maxAttempts) {
          await this.sleep(delayMs * attempt)
          continue
        }

        return // Non-retryable error, give up silently
      } catch {
        if (attempt < maxAttempts) {
          await this.sleep(delayMs * attempt)
          continue
        }
        // Max attempts reached, give up silently
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Notification Emitter instance.
 */
export function createNotificationEmitter(): INotificationEmitter {
  return new NotificationEmitter()
}
