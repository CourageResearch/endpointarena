export const LOCAL_DATABASE_NAME = 'endpointarena_local_main'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const PROHIBITED_HOST_SNIPPETS = ['railway', 'rlwy', 'amazonaws', 'render', 'supabase', 'neon']

export function getDatabaseName(url: URL): string {
  return url.pathname.replace(/^\//, '')
}

export function assertLocalDatabaseUrl(connectionString: string, expectedDatabaseName?: string): URL {
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

  const databaseName = getDatabaseName(url)
  if (expectedDatabaseName && databaseName !== expectedDatabaseName) {
    throw new Error(`Refusing to run against database "${databaseName}". Expected "${expectedDatabaseName}".`)
  }

  return url
}

export function assertLocalProjectDatabaseUrl(connectionString: string): URL {
  return assertLocalDatabaseUrl(connectionString, LOCAL_DATABASE_NAME)
}

export function getAdminDatabaseUrl(targetUrl: URL, adminDatabaseName = 'postgres'): string {
  const adminUrl = new URL(targetUrl.toString())
  adminUrl.pathname = `/${adminDatabaseName}`
  return adminUrl.toString()
}
