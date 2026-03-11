import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL, MODEL_IDS, MODEL_INFO, type ModelId } from '@/lib/constants'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'

export const dynamic = 'force-dynamic'

const RESEARCH_LINKS = [
  {
    label: 'RTTNews Corporate Calendar',
    href: 'https://www.rttnews.com/corpinfo/fdacalendar.aspx',
    external: true,
  },
  {
    label: 'Public FDA Calendar View',
    href: '/fda-calendar',
    external: false,
  },
  {
    label: 'Brand Preview Page',
    href: '/brand',
    external: false,
  },
] as const

const MODEL_RUNTIME_BINDINGS: Record<ModelId, {
  service: string
  endpoint: string
  deployedModel: string
  envKey: string
}> = {
  'claude-opus': {
    service: 'Anthropic API',
    endpoint: 'https://api.anthropic.com/v1/messages',
    deployedModel: 'claude-opus-4-6',
    envKey: 'ANTHROPIC_API_KEY',
  },
  'gpt-5.2': {
    service: 'OpenAI Responses API',
    endpoint: 'https://api.openai.com/v1/responses',
    deployedModel: 'gpt-5.2',
    envKey: 'OPENAI_API_KEY',
  },
  'grok-4': {
    service: 'xAI API (OpenAI-compatible)',
    endpoint: 'https://api.x.ai/v1',
    deployedModel: 'grok-4-1-fast-reasoning',
    envKey: 'XAI_API_KEY',
  },
  'gemini-2.5': {
    service: 'Google GenAI API',
    endpoint: 'https://generativelanguage.googleapis.com',
    deployedModel: 'gemini-2.5-pro',
    envKey: 'GOOGLE_API_KEY',
  },
  'gemini-3-pro': {
    service: 'Google GenAI API',
    endpoint: 'https://generativelanguage.googleapis.com',
    deployedModel: 'gemini-3-pro-preview',
    envKey: 'GOOGLE_API_KEY',
  },
  'deepseek-v3.2': {
    service: 'Baseten Inference API (OpenAI-compatible)',
    endpoint: 'https://inference.baseten.co/v1',
    deployedModel: 'deepseek-ai/DeepSeek-V3.1',
    envKey: 'BASETEN_DEEPSEEK_API_KEY',
  },
  'glm-5': {
    service: 'Baseten Inference API (OpenAI-compatible)',
    endpoint: 'https://inference.baseten.co/v1',
    deployedModel: 'zai-org/GLM-5',
    envKey: 'BASETEN_GLM_API_KEY',
  },
  'llama-4': {
    service: 'Groq API (OpenAI-compatible)',
    endpoint: 'https://api.groq.com/openai/v1',
    deployedModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    envKey: 'GROQ_API_KEY',
  },
  'kimi-k2.5': {
    service: 'Baseten Inference API (OpenAI-compatible)',
    endpoint: 'https://inference.baseten.co/v1',
    deployedModel: 'moonshotai/Kimi-K2.5',
    envKey: 'BASETEN_KIMI_API_KEY',
  },
  'minimax-m2.5': {
    service: 'MiniMax API (OpenAI-compatible)',
    endpoint: 'https://api.minimax.io/v1',
    deployedModel: 'MiniMax-M2.5',
    envKey: 'MINIMAX_API_KEY',
  },
}

export default async function AdminResourcesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const runnerService = process.env.RAILWAY_SERVICE_NAME?.trim() || 'Railway web service (this Next.js app)'
  const modelRows = MODEL_IDS.map((modelId) => {
    const info = MODEL_INFO[modelId]
    const runtime = MODEL_RUNTIME_BINDINGS[modelId]
    const enabled = Boolean(process.env[runtime.envKey])

    return {
      modelId,
      modelName: info.fullName,
      provider: info.provider,
      runtime,
      enabled,
    }
  })

  return (
    <AdminConsoleLayout
      title="Research Links"
      description="Keep external sources and internal reference pages in one place for fast admin workflows."
      activeTab="resources"
    >
      <section className="mb-4">
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Reference Hub</h2>
        <p className="text-sm text-[#8a8075] mt-1">Open links quickly while running predictions, resolving outcomes, or reviewing event metadata.</p>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h3 className="text-sm font-semibold text-[#1a1a1a]">Sources & Tools</h3>
        <p className="text-xs text-[#8a8075] mt-1">Includes public calendars and internal views used during event operations.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {RESEARCH_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              className="block rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#8a8075] hover:text-[#1a1a1a] hover:border-[#d8ccb9] transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h3 className="text-sm font-semibold text-[#1a1a1a]">Model Runtime Inventory</h3>
        <p className="mt-1 text-xs text-[#8a8075]">
          All model calls are executed by this app service on Railway, then routed to the provider services below.
        </p>
        <p className="mt-2 text-xs text-[#8a8075]">
          Runner service: <span className="font-mono text-[#6f6559]">{runnerService}</span>
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead>
              <tr className="border-b border-[#e8ddd0] text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">
                <th className="px-2 py-2 text-left font-medium">Model</th>
                <th className="px-2 py-2 text-left font-medium">Provider</th>
                <th className="px-2 py-2 text-left font-medium">Inference Service</th>
                <th className="px-2 py-2 text-left font-medium">Deployed Model + Key</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.map((row) => (
                <tr key={row.modelId} className="border-b border-[#e8ddd0] align-top hover:bg-[#f3ebe0]/30">
                  <td className="px-2 py-2">
                    <p className="font-medium text-[#1a1a1a]">{row.modelName}</p>
                    <p className="mt-0.5 text-[11px] text-[#8a8075]">{row.modelId}</p>
                  </td>
                  <td className="px-2 py-2 text-[#8a8075]">{row.provider}</td>
                  <td className="px-2 py-2">
                    <p className="text-[#1a1a1a]">{row.runtime.service}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-[#8a8075]">{row.runtime.endpoint}</p>
                  </td>
                  <td className="px-2 py-2">
                    <p className="font-mono text-[12px] text-[#1a1a1a]">{row.runtime.deployedModel}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-[#8a8075]">{row.runtime.envKey}</p>
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        row.enabled
                          ? 'bg-[#e6f3df] text-[#3a8a2e]'
                          : 'bg-[#f3ebe0] text-[#8a8075]'
                      }`}
                    >
                      {row.enabled ? 'Enabled' : 'Missing Key'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[#8a8075]">
          Status is based on whether the required environment variable is present in the current deployment.
        </p>
      </section>
    </AdminConsoleLayout>
  )
}
