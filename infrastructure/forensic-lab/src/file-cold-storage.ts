import type {
  ColdStorageReadResult,
  ColdStorageWriteResult,
  IColdStorageAdapter,
} from '@tracehound/core'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface EncodedPayload {
  readonly compressed: Uint8Array
  readonly hash: string
  readonly originalSize: number
  readonly compressedSize: number
}

interface ArtifactMeta {
  id: string
  hash: string
  originalSize: number
  compressedSize: number
  writtenAt: number
}

function sanitizeId(id: string): string {
  const sanitized = id.replace(/[^A-Za-z0-9._-]/g, '_')
  return sanitized.length > 0 ? sanitized : 'artifact'
}

function payloadPath(dir: string, id: string): string {
  return join(dir, `${sanitizeId(id)}.bin`)
}

function metaPath(dir: string, id: string): string {
  return join(dir, `${sanitizeId(id)}.json`)
}

export function createFileColdStorage(dir: string): IColdStorageAdapter {
  let ready = false

  async function ensureDir(): Promise<void> {
    if (!ready) {
      await mkdir(dir, { recursive: true })
      ready = true
    }
  }

  return {
    async write(
      id: string,
      payload: EncodedPayload,
      signal?: AbortSignal,
    ): Promise<ColdStorageWriteResult> {
      if (signal?.aborted) {
        return { success: false, error: 'aborted' }
      }

      try {
        await ensureDir()
        const buffer = Buffer.alloc(payload.compressed.byteLength)
        buffer.set(payload.compressed)
        await writeFile(payloadPath(dir, id), buffer)

        const meta: ArtifactMeta = {
          id,
          hash: payload.hash,
          originalSize: payload.originalSize,
          compressedSize: payload.compressedSize,
          writtenAt: Date.now(),
        }
        await writeFile(metaPath(dir, id), JSON.stringify(meta, null, 2), 'utf8')
        return { success: true, id }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    async read(id: string): Promise<ColdStorageReadResult> {
      try {
        const [payload, metaRaw] = await Promise.all([
          readFile(payloadPath(dir, id)),
          readFile(metaPath(dir, id), 'utf8'),
        ])
        const meta = JSON.parse(metaRaw) as ArtifactMeta
        return {
          success: true,
          payload: {
            compressed: new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
            hash: meta.hash,
            originalSize: meta.originalSize,
            compressedSize: meta.compressedSize,
          },
        }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },

    async delete(id: string): Promise<boolean> {
      const results = await Promise.allSettled([
        unlink(payloadPath(dir, id)),
        unlink(metaPath(dir, id)),
      ])
      return results.every((result) => result.status === 'fulfilled')
    },

    async isAvailable(): Promise<boolean> {
      try {
        await ensureDir()
        return true
      } catch {
        return false
      }
    },
  }
}
