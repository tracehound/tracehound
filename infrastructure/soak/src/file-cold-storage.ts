/**
 * File-backed cold storage adapter for the soak harness.
 *
 * Each archived evidence artifact is written as two files under `dir/`:
 *   <id>.bin        — raw compressed bytes (gzip)
 *   <id>.meta.json  — { id, hash, originalSize, compressedSize, ts }
 *
 * This is a soak-test mock. Not for production use.
 */

import type {
  ColdStorageReadResult,
  ColdStorageWriteResult,
  IColdStorageAdapter,
} from '@tracehound/core'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// EncodedPayload is not exported from the @tracehound/core public index.
// Mirror the shape structurally so TypeScript resolves the implementation types correctly.
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
  ts: number
}

const PKG_ROOT = join(fileURLToPath(import.meta.url), '..', '..') // packages/soak/
export const DEFAULT_COLD_STORAGE_DIR = join(PKG_ROOT, 'logs', 'cold-storage')

function sanitizeId(id: string): string {
  // Signature format is "category:sha256hex" — the colon is a drive letter
  // separator on Windows and must be stripped from the filename component.
  return id.replace(/:/g, '_')
}

function binPath(dir: string, id: string): string {
  return join(dir, `${sanitizeId(id)}.bin`)
}

function metaPath(dir: string, id: string): string {
  return join(dir, `${sanitizeId(id)}.meta.json`)
}

export function createFileColdStorage(dir: string = DEFAULT_COLD_STORAGE_DIR): IColdStorageAdapter {
  let dirReady = false

  async function ensureDir(): Promise<void> {
    if (!dirReady) {
      await mkdir(dir, { recursive: true })
      dirReady = true
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

        if (signal?.aborted) {
          return { success: false, error: 'aborted' }
        }

        // Write compressed bytes directly — use Buffer.alloc copy to satisfy
        // the Buffer.alloc-only rule and avoid sharing the quarantine's Uint8Array.
        const buf = Buffer.alloc(payload.compressed.byteLength)
        buf.set(payload.compressed)
        await writeFile(binPath(dir, id), buf)

        const meta: ArtifactMeta = {
          id,
          hash: payload.hash,
          originalSize: payload.originalSize,
          compressedSize: payload.compressedSize,
          ts: Date.now(),
        }
        await writeFile(metaPath(dir, id), JSON.stringify(meta), 'utf8')

        return { success: true, id }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async read(id: string): Promise<ColdStorageReadResult> {
      try {
        const [binBuf, metaRaw] = await Promise.all([
          readFile(binPath(dir, id)),
          readFile(metaPath(dir, id), 'utf8'),
        ])
        const meta = JSON.parse(metaRaw) as ArtifactMeta
        const payload: EncodedPayload = {
          compressed: new Uint8Array(binBuf.buffer, binBuf.byteOffset, binBuf.byteLength),
          hash: meta.hash,
          originalSize: meta.originalSize,
          compressedSize: meta.compressedSize,
        }
        return { success: true, payload }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async delete(id: string): Promise<boolean> {
      try {
        await Promise.allSettled([unlink(binPath(dir, id)), unlink(metaPath(dir, id))])
        return true
      } catch {
        return false
      }
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
