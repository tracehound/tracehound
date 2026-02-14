/**
 * Tests for threat.ts helper functions
 */

import { describe, expect, it } from 'vitest'
import type { Scent } from '../src/types/scent.js'
import { createThreatInput } from '../src/types/threat.js'

describe('Threat Helpers', () => {
  describe('createThreatInput', () => {
    it('should return ThreatInput when scent has threat signal', () => {
      const scent: Scent = {
        id: 'scent-1',
        source: 'test',
        payload: { data: 'test' },
        timestamp: Date.now(),
        threat: {
          category: 'injection',
          severity: 'high',
        },
      }

      const result = createThreatInput(scent)

      expect(result).not.toBeNull()
      expect(result?.category).toBe('injection')
      expect(result?.severity).toBe('high')
      expect(result?.scent).toBe(scent)
    })

    it('should return null when scent has no threat signal', () => {
      const scent: Scent = {
        id: 'scent-2',
        source: 'test',
        payload: { data: 'clean' },
        timestamp: Date.now(),
      }

      const result = createThreatInput(scent)

      expect(result).toBeNull()
    })

    it('should handle different threat categories', () => {
      const categories = ['injection', 'ddos', 'flood', 'spam', 'malware'] as const

      categories.forEach((category) => {
        const scent: Scent = {
          id: `scent-${category}`,
          source: 'test',
          payload: { data: 'test' },
          timestamp: Date.now(),
          threat: { category, severity: 'critical' },
        }

        const result = createThreatInput(scent)
        expect(result?.category).toBe(category)
      })
    })

    it('should handle different severity levels', () => {
      const severities = ['critical', 'high', 'medium', 'low'] as const

      severities.forEach((severity) => {
        const scent: Scent = {
          id: `scent-${severity}`,
          source: 'test',
          payload: { data: 'test' },
          timestamp: Date.now(),
          threat: { category: 'injection', severity },
        }

        const result = createThreatInput(scent)
        expect(result?.severity).toBe(severity)
      })
    })
  })
})
