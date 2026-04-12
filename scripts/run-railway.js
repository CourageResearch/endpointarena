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
    quiet: true,
  })
  return true
}

function resolveRailwayInvocation() {
  if (process.platform === 'win32') {
    const globalCliJs = path.join(
      process.env.APPDATA || '',
      'npm',
      'node_modules',
      '@railway',
      'cli',
      'bin',
      'railway.js',
    )

    if (existsSync(globalCliJs)) {
      return {
        command: process.execPath,
        argsPrefix: [globalCliJs],
      }
    }
  }

  return {
    command: 'railway',
    argsPrefix: [],
  }
}

const repoRoot = path.resolve(__dirname, '..')
const commandCwd = process.cwd()
const args = process.argv.slice(2)

loadEnvFile(path.join(repoRoot, '.env'))
loadEnvFile(path.join(repoRoot, '.env.local'), true)
loadEnvFile(path.join(repoRoot, '.env.railway.local'), true)

const railway = resolveRailwayInvocation()

const child = spawn(railway.command, [...railway.argsPrefix, ...args], {
  cwd: commandCwd,
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
