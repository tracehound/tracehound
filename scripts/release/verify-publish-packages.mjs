import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const ALL_PACKAGES = [
  { key: 'core', dir: 'packages/core', name: '@tracehound/core' },
  { key: 'express', dir: 'packages/express', name: '@tracehound/express' },
  { key: 'fastify', dir: 'packages/fastify', name: '@tracehound/fastify' },
  { key: 'cli', dir: 'packages/cli', name: '@tracehound/cli' },
]
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function parseArgs(argv) {
  let outDir = path.join('security', 'artifacts', 'generated', 'release-packages')
  let selected = ALL_PACKAGES.map((entry) => entry.key)

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out-dir') {
      const next = argv[i + 1]
      if (!next) {
        throw new Error('Missing value for --out-dir')
      }
      outDir = next
      i += 1
      continue
    }

    if (arg === '--packages') {
      const next = argv[i + 1]
      if (!next) {
        throw new Error('Missing value for --packages')
      }
      selected = next
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      i += 1
      continue
    }
  }

  return { outDir, selected }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const spawnError = result.error instanceof Error ? result.error.message : ''
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}\n${stderr || stdout || spawnError || 'Unknown error'}`,
    )
  }

  return typeof result.stdout === 'string' ? result.stdout : ''
}

function hasRuntimeEntry(pkgJson) {
  return Boolean(pkgJson.exports || pkgJson.main || pkgJson.bin)
}

function findLeakPaths(files) {
  return files
    .map((entry) => entry.path)
    .filter((file) =>
      /(^|\/)(src|tests|scenarios|coverage)(\/|$)|\.tsbuildinfo$|\.map$/u.test(file),
    )
}

async function verifyPackage(entry, outputRoot) {
  const packageDir = path.resolve(entry.dir)
  const packageJsonPath = path.join(packageDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

  if (packageJson.name !== entry.name) {
    throw new Error(`Package name mismatch for ${entry.dir}: expected ${entry.name}`)
  }

  if (!packageJson.files || !Array.isArray(packageJson.files) || packageJson.files.length === 0) {
    throw new Error(`${entry.name} must declare a non-empty files allowlist`)
  }

  if (!hasRuntimeEntry(packageJson)) {
    throw new Error(`${entry.name} must expose exports, main, or bin for publish verification`)
  }

  const distDir = path.join(packageDir, 'dist')
  if (!existsSync(distDir)) {
    throw new Error(`${entry.name} is missing dist/; run pnpm build before verification`)
  }

  const packStdout = run(NPM_COMMAND, ['pack', '--dry-run', '--json'], packageDir).trim()
  const packEntries = JSON.parse(packStdout)

  if (!Array.isArray(packEntries) || packEntries.length !== 1) {
    throw new Error(`${entry.name} produced unexpected npm pack output`)
  }

  const packEntry = packEntries[0]
  const files = Array.isArray(packEntry.files) ? packEntry.files : []
  if (files.length === 0) {
    throw new Error(`${entry.name} produced an empty package tarball`)
  }

  const leakedPaths = findLeakPaths(files)
  if (leakedPaths.length > 0) {
    throw new Error(`${entry.name} pack leak detected: ${leakedPaths.join(', ')}`)
  }

  const report = {
    package: entry.name,
    version: packageJson.version,
    tarball: packEntry.filename,
    unpackedSize: packEntry.unpackedSize,
    fileCount: files.length,
    files: files.map((file) => file.path),
  }

  await writeFile(
    path.join(outputRoot, `${entry.key}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )

  return report
}

async function main() {
  const { outDir, selected } = parseArgs(process.argv.slice(2))
  const selectedPackages = ALL_PACKAGES.filter((entry) => selected.includes(entry.key))

  if (selectedPackages.length === 0) {
    throw new Error(`No packages selected. Available keys: ${ALL_PACKAGES.map((entry) => entry.key).join(', ')}`)
  }

  const outputRoot = path.resolve(outDir)
  await mkdir(outputRoot, { recursive: true })

  const reports = []
  for (const entry of selectedPackages) {
    const report = await verifyPackage(entry, outputRoot)
    reports.push(report)
  }

  console.log('Verified publish packages:')
  for (const report of reports) {
    console.log(
      `- ${report.package}@${report.version}: ${report.fileCount} files, ${report.unpackedSize} bytes`,
    )
  }
  console.log(`Artifacts: ${outputRoot}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
