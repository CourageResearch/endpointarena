import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildPublicCompanyReferenceFromDownloads,
  DEFAULT_PUBLIC_COMPANY_REFERENCE_FILE,
  type PublicCompanyReferenceFile,
} from './public-company-reference-utils'

type ParsedArgs = {
  outputFile: string
}

const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'
const NASDAQ_OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'

function parseArgs(argv: string[]): ParsedArgs {
  let outputFile = DEFAULT_PUBLIC_COMPANY_REFERENCE_FILE

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output-file') {
      outputFile = argv[index + 1]?.trim() || outputFile
      index += 1
    }
  }

  return { outputFile }
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'EndpointArena public-company-reference/1.0 (research@endpointarena.local)',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const downloadedAt = new Date().toISOString()

  const [secJsonText, nasdaqListedText, nasdaqOtherListedText] = await Promise.all([
    fetchText(SEC_COMPANY_TICKERS_URL),
    fetchText(NASDAQ_LISTED_URL),
    fetchText(NASDAQ_OTHER_LISTED_URL),
  ])

  const issuers = buildPublicCompanyReferenceFromDownloads({
    nasdaqListedText,
    nasdaqOtherListedText,
    secJsonText,
  })

  const payload: PublicCompanyReferenceFile = {
    generatedAt: downloadedAt,
    issuers,
    sources: [
      {
        downloadedAt,
        recordCount: JSON.parse(secJsonText).data?.length ?? 0,
        source: 'sec_company_tickers_exchange',
        url: SEC_COMPANY_TICKERS_URL,
      },
      {
        downloadedAt,
        recordCount: Math.max(nasdaqListedText.split(/\r?\n/).filter(Boolean).length - 2, 0),
        source: 'nasdaq_listed',
        url: NASDAQ_LISTED_URL,
      },
      {
        downloadedAt,
        recordCount: Math.max(nasdaqOtherListedText.split(/\r?\n/).filter(Boolean).length - 2, 0),
        source: 'nasdaq_other_listed',
        url: NASDAQ_OTHER_LISTED_URL,
      },
    ],
  }

  const outputPath = path.resolve(process.cwd(), args.outputFile)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    generatedAt: payload.generatedAt,
    issuers: payload.issuers.length,
    outputFile: outputPath,
    sources: payload.sources,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
