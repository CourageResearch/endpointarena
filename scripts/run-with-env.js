const { existsSync } = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')
const dotenv = require('dotenv')

function loadEnvFile(filePath, override = false) {
  if (!existsSync(filePath)) {
    return false
  }

  dotenv.config({
    path: filePath,
    override,
    quiet: true,
  })
  return true
}

function resolveCommand(command) {
  if (process.platform !== 'win32') {
    return command
  }

  if (command.includes('\\') || command.includes('/') || path.extname(command)) {
    return command
  }

  try {
    const resolved = execFileSync('where.exe', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)

    const preferred = resolved.find((entry) => /\.(exe|cmd|bat)$/i.test(entry))
    return preferred || resolved[0] || command
  } catch {
    return command
  }
}

function spawnCommand(command, args, options) {
  const resolvedCommand = resolveCommand(command)

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedCommand)) {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', resolvedCommand, ...args], options)
  }

  return spawn(resolvedCommand, args, options)
}

const args = process.argv.slice(2)
const separatorIndex = args.indexOf('--')

if (separatorIndex === -1) {
  console.error('Usage: node scripts/run-with-env.js <env-file> -- <command> [args...]')
  process.exit(1)
}

const requestedEnvFile = args[0]
const command = args[separatorIndex + 1]
const commandArgs = args.slice(separatorIndex + 2)

if (!requestedEnvFile || !command) {
  console.error('Missing env file or command.')
  process.exit(1)
}

const repoRoot = process.cwd()
const fallbackEnvFile = requestedEnvFile.endsWith('.local')
  ? requestedEnvFile.replace(/\.local$/, '.example')
  : null

loadEnvFile(path.join(repoRoot, '.env'))
loadEnvFile(path.join(repoRoot, '.env.local'), true)

const loadedRequested = loadEnvFile(path.join(repoRoot, requestedEnvFile), true)
if (!loadedRequested && fallbackEnvFile) {
  loadEnvFile(path.join(repoRoot, fallbackEnvFile), true)
}

// Keep Railway CLI auth in a dedicated local file so ops scripts can use a
// scoped token without depending on the interactive CLI session.
loadEnvFile(path.join(repoRoot, '.env.railway.local'), true)

const child = spawnCommand(command, commandArgs, {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
