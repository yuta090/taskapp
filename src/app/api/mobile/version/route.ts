import { NextResponse } from 'next/server'
import { MOBILE_MIN_SUPPORTED_VERSION } from '@/lib/mobile/version'

/** スマホアプリが起動時に読む。ログイン前にも呼ぶので認証なし（中身は公開してよい版番号だけ） */
export async function GET() {
  return NextResponse.json(
    { minSupportedVersion: MOBILE_MIN_SUPPORTED_VERSION },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
