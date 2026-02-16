import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

// Token format validation (basic alphanumeric check)
const TOKEN_REGEX = /^[a-zA-Z0-9_-]{20,100}$/

/** Rate limit: 10 invite-validation requests per IP per 15 minutes */
const INVITE_RATE_LIMIT = {
  maxRequests: 10,
  windowMs: 15 * 60 * 1000,
} as const

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    // Rate limit check (brute-force protection for token enumeration)
    const clientIp = getClientIp(request)
    const rateLimitKey = `invite:${clientIp}`
    const rateResult = checkRateLimit(rateLimitKey, INVITE_RATE_LIMIT)

    if (!rateResult.allowed) {
      return NextResponse.json(
        { valid: false, error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(
              Math.ceil((rateResult.resetAt - Date.now()) / 1000)
            ),
          },
        }
      )
    }

    const { token } = await params

    // Token format validation
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
      // Do not leak error details (token enumeration attack protection)
      console.error('Validate invite RPC error:', error.message)
      return NextResponse.json(
        { valid: false },
        { status: 400 }
      )
    }

    // Only return details for valid invites
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
