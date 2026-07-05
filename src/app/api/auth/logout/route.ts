import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  // 303 (See Other) でGETに変換して/loginへ。307(既定)だとPOSTのまま/loginに再送されうる。
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), 303)
}
