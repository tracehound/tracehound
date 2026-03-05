import { rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

async function main() {
  const target = process.argv[2]
  if (!target) {
    throw new Error('Usage: node scripts/build/clean-dist.mjs <path>')
  }

  await rm(path.resolve(process.cwd(), target), { recursive: true, force: true })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
