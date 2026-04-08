const path = require('node:path')
const { spawn } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const forwardedArgs = process.argv.slice(2)

if (forwardedArgs.includes('--help') || forwardedArgs.includes('-h')) {
  console.log('Usage: node scripts/start-local-dev.js [--db-only] [extra next dev args...]')
  console.log('')
  console.log('Starts the project local Postgres cluster if needed, then launches Next dev on 127.0.0.1:3000.')
  process.exit(0)
}

const dbOnly = forwardedArgs.includes('--db-only')
const nextArgs = [
  'dev',
  '--hostname',
  '127.0.0.1',
  '--port',
  '3000',
  '--turbopack',
  ...forwardedArgs.filter((arg) => arg !== '--db-only'),
]

function localBin(name) {
  if (name === 'tsx') {
    return path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  }

  if (name === 'next') {
    return path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next')
  }

  throw new Error(`Unsupported local binary: ${name}`)
}

function spawnInherited(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })

  return child
}

function runStep(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawnInherited(command, args)

    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${label} exited due to signal ${signal}`))
        return
      }

      if ((code ?? 1) !== 0) {
        reject(new Error(`${label} exited with code ${code}`))
        return
      }

      resolve()
    })
  })
}

async function main() {
  await runStep(process.execPath, [localBin('tsx'), 'scripts/local-postgres.ts', 'start'], 'Local Postgres startup')

  if (dbOnly) {
    return
  }

  const nextChild = spawnInherited(process.execPath, [localBin('next'), ...nextArgs])

  const forwardSignal = (signal) => {
    if (!nextChild.killed) {
      nextChild.kill(signal)
    }
  }

  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  nextChild.on('error', (error) => {
    console.error(error)
    process.exit(1)
  })

  nextChild.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1)
      return
    }
    process.exit(code ?? 0)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
