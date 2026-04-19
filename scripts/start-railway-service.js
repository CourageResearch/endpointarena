const { spawn } = require('child_process')
const http = require('http')

const ROLE_COMMANDS = new Map([
  ['season4-indexer-worker', ['run', 'season4:indexer:worker']],
  ['season4-model-cycle-worker', ['run', 'season4:model-cycle:worker']],
])

const role = (process.env.ENDPOINT_ARENA_SERVICE_ROLE || '').trim()
const args = ROLE_COMMANDS.get(role) || ['exec', 'next', 'start']
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
let healthServer = null

if (ROLE_COMMANDS.has(role)) {
  const port = Number.parseInt(process.env.PORT || '8080', 10)
  healthServer = http.createServer((request, response) => {
    if (request.url === '/api/health' || request.url === '/api/health/') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      })
      response.end(JSON.stringify({
        ok: true,
        service: role,
        timestamp: new Date().toISOString(),
      }))
      return
    }

    response.writeHead(404, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    })
    response.end(JSON.stringify({ ok: false, error: 'not_found' }))
  })
  healthServer.listen(port, '0.0.0.0')
}

const child = spawn(npmCommand, args, {
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  healthServer?.close()

  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
