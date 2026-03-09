/**
 * Universal Notification API - Event emission for all consumers.
 *
 * RFC-0000 COMPLIANCE:
 * - Read-only event emission (no backpressure)
 * - Fire-and-forget semantics
 * - No blocking on consumer processing
 */

import { generateSecureId } from '../utils/id.js'
import { Errors } from '../types/errors.js'
import { isIP } from 'node:net'

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
  tier: 'starter' | 'pro' | 'enterprise'
  daysRemaining?: number
}

export interface LicenseExpiredPayload {
  tier: 'starter' | 'pro' | 'enterprise'
  gracePeriod: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Config
// ─────────────────────────────────────────────────────────────────────────────

export interface WebhookConfig {
  /** Webhook URL. Embedded credentials are rejected; pass auth via headers instead. */
  url: string
  /** Events to subscribe to (empty = all) */
  events?: EventType[]
  /** Custom headers */
  headers?: Record<string, string>
  /** Secret for HMAC signature (minimum 16 characters) */
  secret?: string
  /** Retry configuration */
  retry?: {
    maxAttempts: number
    delayMs: number
  }
}

const MIN_SECRET_LENGTH = 16
const DEFAULT_SUBSCRIBER_QUEUE_LIMIT = 64
const DEFAULT_WEBHOOK_QUEUE_LIMIT = 256
const DEFAULT_WEBHOOK_MAX_INFLIGHT = 4
const WEBHOOK_REQUEST_TIMEOUT_MS = 5_000

function isAllowedWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return false
    }

    const hostname = normalizeHostname(parsed.hostname)
    if (isBlockedHostname(hostname)) {
      return false
    }

    const ipFamily = isIP(hostname)
    if (ipFamily !== 0) {
      return !isBlockedIpAddress(hostname)
    }

    return true
  } catch {
    return false
  }
}

interface RegisteredWebhook extends WebhookConfig {
  id: string
}

export interface NotificationEmitterOptions {
  subscriberQueueLimit?: number
  webhookQueueLimit?: number
  webhookMaxInflight?: number
}

interface SubscriberEntry {
  events: EventType[] | null
  push: (event: TracehoundEvent) => void
}

interface WebhookDispatchJob {
  webhook: RegisteredWebhook
  event: TracehoundEvent
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
  subscriberQueueLimit: number
  droppedSubscriberEvents: number
  queuedWebhookDeliveries: number
  inflightWebhookDeliveries: number
  webhookQueueLimit: number
  webhookMaxInflight: number
  droppedWebhookDeliveries: number
  rejectedWebhookDeliveries: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notification Emitter implementation.
 */
export class NotificationEmitter implements INotificationEmitter {
  private callbacks = new Map<EventType, Set<EventCallback>>()
  private subscribers: SubscriberEntry[] = []
  private webhooks = new Map<string, RegisteredWebhook>()
  private readonly subscriberQueueLimit: number
  private readonly webhookQueueLimit: number
  private readonly webhookMaxInflight: number
  private readonly webhookQueue: WebhookDispatchJob[] = []
  private activeWebhookDispatches = 0

  private _totalEmitted = 0
  private _byType = new Map<EventType, number>()
  private _droppedSubscriberEvents = 0
  private _droppedWebhookDeliveries = 0
  private _rejectedWebhookDeliveries = 0

  constructor(options: NotificationEmitterOptions = {}) {
    this.subscriberQueueLimit = normalizeBound(
      options.subscriberQueueLimit,
      DEFAULT_SUBSCRIBER_QUEUE_LIMIT,
    )
    this.webhookQueueLimit = normalizeBound(options.webhookQueueLimit, DEFAULT_WEBHOOK_QUEUE_LIMIT)
    this.webhookMaxInflight = normalizeBound(
      options.webhookMaxInflight,
      DEFAULT_WEBHOOK_MAX_INFLIGHT,
    )
  }

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
          if (queue.length >= self.subscriberQueueLimit) {
            queue.shift()
            self._droppedSubscriberEvents++
          }
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
    if (!isAllowedWebhookUrl(config.url)) {
      throw Errors.invalidConfigWebhookUrl(config.url)
    }
    if (config.secret !== undefined && config.secret.length < MIN_SECRET_LENGTH) {
      throw Errors.invalidConfigWebhookSecret(MIN_SECRET_LENGTH)
    }
    const id = generateSecureId()
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
      id: generateSecureId(),
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
        this.enqueueWebhookDispatch(webhook, event)
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
      subscriberQueueLimit: this.subscriberQueueLimit,
      droppedSubscriberEvents: this._droppedSubscriberEvents,
      queuedWebhookDeliveries: this.webhookQueue.length,
      inflightWebhookDeliveries: this.activeWebhookDispatches,
      webhookQueueLimit: this.webhookQueueLimit,
      webhookMaxInflight: this.webhookMaxInflight,
      droppedWebhookDeliveries: this._droppedWebhookDeliveries,
      rejectedWebhookDeliveries: this._rejectedWebhookDeliveries,
    }
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  private enqueueWebhookDispatch(webhook: RegisteredWebhook, event: TracehoundEvent): void {
    if (this.webhookQueue.length >= this.webhookQueueLimit) {
      this._droppedWebhookDeliveries++
      return
    }

    this.webhookQueue.push({ webhook, event })
    this.drainWebhookQueue()
  }

  private drainWebhookQueue(): void {
    while (this.activeWebhookDispatches < this.webhookMaxInflight && this.webhookQueue.length > 0) {
      const job = this.webhookQueue.shift()
      if (!job) {
        return
      }

      this.activeWebhookDispatches++
      this.dispatchWebhook(job.webhook, job.event)
        .catch(() => {
          // Silently ignore webhook errors
        })
        .finally(() => {
          this.activeWebhookDispatches--
          this.drainWebhookQueue()
        })
    }
  }

  private async dispatchWebhook(webhook: RegisteredWebhook, event: TracehoundEvent): Promise<void> {
    const destinationAllowed = await this.isWebhookDestinationAllowed(webhook.url)
    if (!destinationAllowed) {
      this._rejectedWebhookDeliveries++
      return
    }

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
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_REQUEST_TIMEOUT_MS)
      if (typeof timeoutId.unref === 'function') {
        timeoutId.unref()
      }

      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body,
          redirect: 'error',
          signal: controller.signal,
        })
        this.discardResponseBody(response)

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
      } finally {
        clearTimeout(timeoutId)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private discardResponseBody(response: Response): void {
    void response.body?.cancel().catch(() => {
      // Ignore cancel errors; body is never consumed in webhook mode.
    })
  }

  private async isWebhookDestinationAllowed(url: string): Promise<boolean> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }

    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return false
    }

    const normalizedHostname = normalizeHostname(parsed.hostname)
    if (isBlockedHostname(normalizedHostname)) {
      return false
    }

    const ipFamily = isIP(normalizedHostname)
    if (ipFamily !== 0) {
      return !isBlockedIpAddress(normalizedHostname)
    }

    try {
      const { lookup } = await import('node:dns/promises')
      const resolved = await lookup(normalizedHostname, { all: true, verbatim: true })
      if (resolved.length === 0) {
        return false
      }

      for (const entry of resolved) {
        if (isBlockedIpAddress(entry.address)) {
          return false
        }
      }

      return true
    } catch {
      return false
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Notification Emitter instance.
 */
export function createNotificationEmitter(
  options: NotificationEmitterOptions = {},
): INotificationEmitter {
  return new NotificationEmitter(options)
}

function normalizeBound(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.floor(value)
}

function normalizeHostname(hostname: string): string {
  let normalized = hostname.toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  normalized = normalized.replace(/\.+$/, '')
  return normalized
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal' ||
    hostname === '0.0.0.0'
  )
}

function isBlockedIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address)

  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpAddress(normalized.slice(7))
  }

  const family = isIP(normalized)
  if (family === 4) {
    return isBlockedIpv4(normalized)
  }
  if (family === 6) {
    return isBlockedIpv6(normalized)
  }

  return true
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => parseInt(part, 10))
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }

  const [a, b] = parts
  if (a === undefined || b === undefined) {
    return true
  }

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isBlockedIpv6(address: string): boolean {
  return (
    address === '::' ||
    address === '::1' ||
    address === '0:0:0:0:0:0:0:1' ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('fe8') ||
    address.startsWith('fe9') ||
    address.startsWith('fea') ||
    address.startsWith('feb')
  )
}
