export const ONE_DRUG_DATABASE_NAME = 'endpointarena_one_drug_local'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const PROHIBITED_HOST_SNIPPETS = ['railway', 'rlwy', 'amazonaws', 'render', 'supabase', 'neon']

export function assertLocalOneDrugDatabaseUrl(connectionString: string): URL {
  const trimmed = connectionString.trim()
  if (!trimmed) {
    throw new Error('DATABASE_URL is not set')
  }

  const url = new URL(trimmed)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`Expected postgres:// or postgresql:// DATABASE_URL, received ${url.protocol}`)
  }

  const hostname = url.hostname.toLowerCase()
  if (!LOCAL_HOSTS.has(hostname) || PROHIBITED_HOST_SNIPPETS.some((snippet) => hostname.includes(snippet))) {
    throw new Error(`Refusing to run against non-local host: ${hostname}`)
  }

  const databaseName = url.pathname.replace(/^\//, '')
  if (databaseName !== ONE_DRUG_DATABASE_NAME) {
    throw new Error(`Refusing to run against database "${databaseName}". Expected "${ONE_DRUG_DATABASE_NAME}".`)
  }

  return url
}

export function getAdminDatabaseUrl(targetUrl: URL, adminDatabaseName = 'postgres'): string {
  const adminUrl = new URL(targetUrl.toString())
  adminUrl.pathname = `/${adminDatabaseName}`
  return adminUrl.toString()
}
