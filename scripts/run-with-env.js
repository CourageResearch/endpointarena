const { existsSync } = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const dotenv = require('dotenv')

function loadEnvFile(filePath, override = false) {
  if (!existsSync(filePath)) {
    return false
  }

  dotenv.config({
    path: filePath,
    override,
  })
  return true
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

const child = spawn(command, commandArgs, {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
