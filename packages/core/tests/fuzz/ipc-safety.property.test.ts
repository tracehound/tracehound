import { describe, expect, it } from 'vitest'
import { createMessageParser, decodeHoundMessage } from '../../src/core/hound-ipc.js'
import { FUZZ_SEED, runDeterministicProperty } from './helpers.js'

describe('Fuzz Invariant: IPC Safety', () => {
  it('malformed frames never leave parser in corrupted buffered state', () => {
    // eslint-disable-next-line no-console
    console.info(`[fuzz] ipc-safety seed=${FUZZ_SEED}`)

    runDeterministicProperty(
      'ipc-safety',
      (candidate) => {
        const parser = createMessageParser()

        const payload = Buffer.from(JSON.stringify(candidate))
        const lengthPrefix = Buffer.alloc(4)
        lengthPrefix.writeUInt32BE(payload.length + 10_000_000, 0)
        const malformedChunk = Buffer.concat([lengthPrefix, payload])

        try {
          const messages = parser.feed(malformedChunk)
          for (const msg of messages) {
            try {
              decodeHoundMessage(msg)
            } catch {
              // malformed payload is expected during fuzzing
            }
          }
        } catch {
          // expected for malformed length; parser must reset
          expect(parser.bufferedBytes).toBe(0)
          return
        }

        expect(parser.bufferedBytes).toBeLessThanOrEqual(malformedChunk.length)
      },
      { runs: 60 },
    )
  })
})
