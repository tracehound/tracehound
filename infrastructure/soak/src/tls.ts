import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface LoopbackTlsMaterial {
  readonly cert: Buffer
  readonly key: Buffer
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const TLS_DIR = resolve(__dirname, '..', 'logs', 'tls')
const CERT_PATH = resolve(TLS_DIR, 'loopback-cert.pem')
const KEY_PATH = resolve(TLS_DIR, 'loopback-key.pem')

let cachedMaterial: LoopbackTlsMaterial | null = null

function ensureTlsDir(): void {
  mkdirSync(TLS_DIR, { recursive: true })
}

function writeUnixOpenSslConfig(path: string): void {
  writeFileSync(
    path,
    [
      '[req]',
      'distinguished_name = req_distinguished_name',
      'x509_extensions = v3_req',
      'prompt = no',
      '',
      '[req_distinguished_name]',
      'CN = 127.0.0.1',
      '',
      '[v3_req]',
      'subjectAltName = @alt_names',
      '',
      '[alt_names]',
      'DNS.1 = localhost',
      'IP.1 = 127.0.0.1',
      '',
    ].join('\n'),
    'utf8',
  )
}

function generateWithOpenSsl(): void {
  ensureTlsDir()
  const configPath = resolve(TLS_DIR, 'openssl-loopback.cnf')
  writeUnixOpenSslConfig(configPath)
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '3650',
      '-keyout',
      KEY_PATH,
      '-out',
      CERT_PATH,
      '-config',
      configPath,
      '-extensions',
      'v3_req',
    ],
    {
      stdio: 'ignore',
    },
  )
  chmodSync(KEY_PATH, 0o600)
}

function generateWithPwsh(): void {
  ensureTlsDir()
  const scriptPath = resolve(TLS_DIR, 'generate-loopback-cert.ps1')
  writeFileSync(
    scriptPath,
    [
      'param([string]$CertPath, [string]$KeyPath)',
      '$rsa = [System.Security.Cryptography.RSA]::Create(2048)',
      "$subject = [System.Security.Cryptography.X509Certificates.X500DistinguishedName]::new('CN=127.0.0.1')",
      '$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new($subject, $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)',
      '$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $false))',
      '$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment, $false))',
      '$sanBuilder = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()',
      "$sanBuilder.AddDnsName('localhost')",
      "$sanBuilder.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))",
      '$request.CertificateExtensions.Add($sanBuilder.Build())',
      '$cert = $request.CreateSelfSigned([System.DateTimeOffset]::UtcNow.AddDays(-1), [System.DateTimeOffset]::UtcNow.AddYears(5))',
      '[System.IO.File]::WriteAllText($CertPath, $cert.ExportCertificatePem())',
      '[System.IO.File]::WriteAllText($KeyPath, $rsa.ExportPkcs8PrivateKeyPem())',
      '',
    ].join('\n'),
    'utf8',
  )

  execFileSync('pwsh', ['-NoProfile', '-File', scriptPath, CERT_PATH, KEY_PATH], {
    stdio: 'ignore',
  })
}

function generateLoopbackCertificate(): void {
  try {
    if (process.platform === 'win32') {
      generateWithPwsh()
      return
    }
    generateWithOpenSsl()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `failed to generate soak loopback TLS material; requires ${
        process.platform === 'win32' ? 'pwsh' : 'openssl'
      }: ${reason}`,
    )
  }
}

function ensureLoopbackTlsMaterial(): void {
  if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
    return
  }
  generateLoopbackCertificate()
}

export function getLoopbackTlsMaterial(): LoopbackTlsMaterial {
  if (cachedMaterial !== null) {
    return cachedMaterial
  }

  ensureLoopbackTlsMaterial()
  const cert = readFileSync(CERT_PATH)
  const key = readFileSync(KEY_PATH)

  cachedMaterial = { cert, key }
  return cachedMaterial
}
