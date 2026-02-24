import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

const PDF_PATH = join(process.cwd(), 'public', 'pdf', 'endpointarena-app-summary.pdf')

export async function GET() {
  try {
    const file = await readFile(PDF_PATH)
    return new Response(file, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Endpoint-Arena.pdf"',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new Response('PDF not found', { status: 404 })
  }
}
