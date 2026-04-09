import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse } from '@/lib/api-response'
import { getAi2BatchState } from '@/lib/admin-ai2'
import { NotFoundError } from '@/lib/errors'

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_: Request, context: RouteContext) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { id } = await context.params
    const initial = await getAi2BatchState(id)
    if (!initial) {
      throw new NotFoundError('Batch not found')
    }

    const encoder = new TextEncoder()
    let interval: NodeJS.Timeout | null = null
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false

        const send = async () => {
          const batch = await getAi2BatchState(id)
          if (!batch) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'missing' })}\n\n`))
            controller.close()
            closed = true
            return
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'state', batch })}\n\n`))
          if (batch.status === 'cleared' || batch.status === 'failed' || batch.status === 'reset') {
            controller.close()
            closed = true
          }
        }

        await send()
        interval = setInterval(() => {
          void send().catch((error) => {
            if (closed) return
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Stream error' })}\n\n`))
            if (interval != null) {
              clearInterval(interval)
            }
            controller.close()
            closed = true
          })
        }, 1000)
      },
      cancel() {
        if (interval != null) {
          clearInterval(interval)
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to stream AI batch state')
  }
}
