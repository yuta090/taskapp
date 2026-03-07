import { NextRequest, NextResponse } from 'next/server'
import { getManifest } from '@/lib/cli-manifest'
import { createHash } from 'crypto'

export async function GET(request: NextRequest) {
  const manifest = getManifest()
  const body = JSON.stringify(manifest)
  const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`

  // Conditional request: 304 Not Modified
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag },
    })
  }

  return NextResponse.json(manifest, {
    headers: {
      ETag: etag,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
