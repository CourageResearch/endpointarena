import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'

const DEBUG_PORT = Number(process.env.CLAUDE_CANARY_DEBUG_PORT || '9224')
const DEBUG_HTTP_URL = `http://127.0.0.1:${DEBUG_PORT}`
const START_URL = process.env.CLAUDE_CANARY_START_URL || 'https://claude.ai/new?incognito'
const CANARY_PATH = process.env.CLAUDE_CANARY_PATH || path.join(
  process.env.LOCALAPPDATA || '',
  'Google',
  'Chrome SxS',
  'Application',
  'chrome.exe',
)
const REQUIRED_MODEL_LABEL = (process.env.CLAUDE_CANARY_MODEL_LABEL || 'Opus 4.6').trim()
const PROFILE_DIR = process.env.CLAUDE_CANARY_PROFILE_DIR || path.join(
  process.cwd(),
  'tmp',
  'claude-canary-remote-profile',
)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }
  return response.json()
}

async function getDebugVersion() {
  return fetchJson(`${DEBUG_HTTP_URL}/json/version`)
}

async function getDebugTargets() {
  return fetchJson(`${DEBUG_HTTP_URL}/json/list`)
}

async function isDebugReady() {
  try {
    await getDebugVersion()
    return true
  } catch {
    return false
  }
}

function ensureCanaryInstalled() {
  if (!existsSync(CANARY_PATH)) {
    throw new Error(`Chrome Canary not found at ${CANARY_PATH}`)
  }
}

function ensureProfileDir() {
  mkdirSync(PROFILE_DIR, { recursive: true })
}

function findClaudePageTarget(targets) {
  return targets.find((target) => target.type === 'page' && target.url.startsWith('https://claude.ai'))
}

async function launchCanary() {
  ensureCanaryInstalled()
  ensureProfileDir()

  if (await isDebugReady()) {
    return getStatus()
  }

  const child = spawn(
    CANARY_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--new-window',
      START_URL,
    ],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    },
  )
  child.unref()

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isDebugReady()) {
      return getStatus()
    }
    await sleep(500)
  }

  throw new Error(`Chrome Canary did not expose a DevTools endpoint on port ${DEBUG_PORT}`)
}

async function getStatus() {
  ensureCanaryInstalled()
  ensureProfileDir()

  const [version, targets] = await Promise.all([getDebugVersion(), getDebugTargets()])
  const claudePage = findClaudePageTarget(targets)

  return {
    canaryPath: CANARY_PATH,
    profileDir: PROFILE_DIR,
    debugPort: DEBUG_PORT,
    browser: version.Browser,
    page: claudePage
      ? {
          id: claudePage.id,
          title: claudePage.title,
          url: claudePage.url,
        }
      : null,
  }
}

async function connectToCanary() {
  if (!(await isDebugReady())) {
    throw new Error('Chrome Canary debug session is not running. Start it with `npm run claude:canary:launch` first.')
  }

  return chromium.connectOverCDP(DEBUG_HTTP_URL)
}

async function findClaudePage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().startsWith('https://claude.ai')) {
        return page
      }
    }
  }

  const firstContext = browser.contexts()[0]
  if (!firstContext) {
    throw new Error('No browser context is available in the Canary debug session.')
  }

  const page = await firstContext.newPage()
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' })
  return page
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

async function ensureExpectedModel(page) {
  if (!REQUIRED_MODEL_LABEL) {
    return
  }

  const modelButton = page.getByTestId('model-selector-dropdown')
  await modelButton.waitFor({ timeout: 30000 })
  const currentLabel = normalizeWhitespace(await modelButton.innerText().catch(() => ''))
  if (currentLabel.toLowerCase().includes(REQUIRED_MODEL_LABEL.toLowerCase())) {
    return
  }

  await modelButton.click()
  const option = page.getByText(REQUIRED_MODEL_LABEL, { exact: true }).first()
  await option.waitFor({ timeout: 10000 })
  await option.click()
  await page.waitForTimeout(500)
}

async function getLatestAssistantState(page) {
  return page.evaluate(() => {
    const responses = Array.from(document.querySelectorAll('[data-is-streaming]'))
    const latest = responses[responses.length - 1]
    if (!latest) {
      return {
        count: 0,
        isStreaming: false,
        text: '',
      }
    }

    const contentNode = latest.querySelector('.row-start-2 .standard-markdown, .row-start-2 .progressive-markdown, .row-start-2 [class*="markdown"]')
      || latest.querySelector('.row-start-2')
      || latest
    const text = (contentNode?.innerText || contentNode?.textContent || '')
      .replace(/\u00a0/g, ' ')
      .trim()

    return {
      count: responses.length,
      isStreaming: latest.getAttribute('data-is-streaming') === 'true',
      text,
    }
  })
}

async function askClaude(prompt) {
  if (!prompt || !prompt.trim()) {
    throw new Error('Provide a prompt after `ask`.')
  }

  const browser = await connectToCanary()
  const page = await findClaudePage(browser)

  await page.goto(START_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

  if (page.url().includes('/login')) {
    throw new Error('Claude Canary is on the login page. Please log in once in the dedicated Canary window and try again.')
  }

  await ensureExpectedModel(page)
  await page.waitForSelector('[data-testid="chat-input"]', { timeout: 30000 })
  const previousAssistant = await getLatestAssistantState(page)
  await page.getByTestId('chat-input').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText(prompt)
  const sendButton = page.locator('button[aria-label="Send Message"], button[type="submit"]').last()
  if (await sendButton.count()) {
    await sendButton.click()
  } else {
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(1000)
  const conversationId = page.url().match(/\/chat\/([0-9a-f-]{36})/i)?.[1] ?? null

  let answer = ''
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const latestAssistant = await getLatestAssistantState(page)
    if (
      latestAssistant.text
      && !latestAssistant.isStreaming
      && (latestAssistant.count > previousAssistant.count || latestAssistant.text !== previousAssistant.text)
    ) {
      answer = latestAssistant.text
      break
    }
    await sleep(1000)
  }

  if (!answer) {
    throw new Error('Claude did not return a visible text answer before the timeout.')
  }

  console.log(JSON.stringify({
    conversationId,
    answer,
  }, null, 2))
}

async function main() {
  const [command = 'status', ...rest] = process.argv.slice(2)

  if (command === 'launch') {
    console.log(JSON.stringify(await launchCanary(), null, 2))
    return
  }

  if (command === 'status') {
    console.log(JSON.stringify(await getStatus(), null, 2))
    return
  }

  if (command === 'ask') {
    await askClaude(rest.join(' '))
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
