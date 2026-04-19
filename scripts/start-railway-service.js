const { spawn } = require('child_process')

const ROLE_COMMANDS = new Map([
  ['season4-indexer-worker', ['run', 'season4:indexer:worker']],
  ['season4-model-cycle-worker', ['run', 'season4:model-cycle:worker']],
])

const role = (process.env.ENDPOINT_ARENA_SERVICE_ROLE || '').trim()
const args = ROLE_COMMANDS.get(role) || ['exec', 'next', 'start']
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const child = spawn(npmCommand, args, {
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
