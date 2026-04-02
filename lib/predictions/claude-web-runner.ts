import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'

type ClaudeWebAskResponse = {
  conversationId: string
  answer: string
}

function normalizeAnswer(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('Claude.ai returned an empty response')
  }

  const parsed = JSON.parse(trimmed) as Partial<ClaudeWebAskResponse>
  if (typeof parsed.answer !== 'string' || parsed.answer.trim().length === 0) {
    throw new Error('Claude.ai response did not include answer text')
  }

  return parsed.answer.trim()
}

export async function askClaudeWeb(prompt: string): Promise<string> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Claude.ai browser runs are only supported in local development')
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'claude-canary-controller.mjs')

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath, 'ask', prompt],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLAUDE_CANARY_START_URL: process.env.CLAUDE_CANARY_START_URL || 'https://claude.ai/new?incognito',
          CLAUDE_CANARY_MODEL_LABEL: process.env.CLAUDE_CANARY_MODEL_LABEL || 'Opus 4.6',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        const errorText = stderr.trim() || stdout.trim() || `claude-canary-controller exited with code ${code}`
        reject(new Error(errorText))
        return
      }

      try {
        resolve(normalizeAnswer(stdout))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}
