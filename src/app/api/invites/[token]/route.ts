import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// Token format validation (basic alphanumeric check)
const TOKEN_REGEX = /^[a-zA-Z0-9_-]{20,100}$/

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // トークン形式の基本検証
    if (!token || !TOKEN_REGEX.test(token)) {
      return NextResponse.json(
        { valid: false },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data, error } = await (supabase as SupabaseClient).rpc('rpc_validate_invite', {
      p_token: token,
    })

    if (error) {
      // エラー詳細を漏らさない（トークン列挙攻撃対策）
      console.error('Validate invite RPC error:', error.message)
      return NextResponse.json(
        { valid: false },
        { status: 400 }
      )
    }

    // 有効な招待の場合のみ詳細を返す
    if (data?.valid) {
      return NextResponse.json(data)
    }

    return NextResponse.json({ valid: false }, { status: 400 })
  } catch (err) {
    console.error('Validate invite error:', err)
    return NextResponse.json(
      { valid: false },
      { status: 500 }
    )
  }
}
