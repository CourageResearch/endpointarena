import { NextResponse } from 'next/server'
import { inferGeoFromHeaders } from '@/lib/geo-country'

export async function GET(request: Request) {
  const geo = await inferGeoFromHeaders(request.headers)
  return NextResponse.json({ country: geo.country, region: geo.state, state: geo.state }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
