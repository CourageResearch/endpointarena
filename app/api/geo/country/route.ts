import { NextResponse } from 'next/server'
import { inferCountryFromHeaders } from '@/lib/geo-country'

export async function GET(request: Request) {
  const country = await inferCountryFromHeaders(request.headers)
  return NextResponse.json({ country }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
