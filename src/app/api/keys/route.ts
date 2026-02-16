import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

/** Rate limit: 20 API key operations per IP per 15 minutes */
const KEYS_RATE_LIMIT = {
  maxRequests: 20,
  windowMs: 15 * 60 * 1000,
} as const

function applyRateLimit(request: NextRequest): NextResponse | null {
  const clientIp = getClientIp(request)
  const result = checkRateLimit(`api-keys:${clientIp}`, KEYS_RATE_LIMIT)
  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(
            Math.ceil((result.resetAt - Date.now()) / 1000)
          ),
        },
      }
    )
  }
  return null
}

// Create admin client with service role key (bypasses RLS)
function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration')
  }

  return createSupabaseAdmin(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Verify the current user is authenticated and is a member of the given org.
 * Returns the user id on success, or a NextResponse error.
 */
async function authorizeOrgMember(
  orgId: string
): Promise<{ userId: string } | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify the user belongs to this org
  const { data: membership } = await (supabase as SupabaseClient)
    .from('org_memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  return { userId: user.id }
}

// POST /api/keys - Create a new API key
export async function POST(request: NextRequest) {
  const rateLimited = applyRateLimit(request)
  if (rateLimited) return rateLimited

  try {
    const body = await request.json()
    const { orgId, spaceId, name, keyHash, keyPrefix } = body

    if (!orgId || !spaceId || !name || !keyHash || !keyPrefix) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Authenticate and authorize: user must belong to the org
    const authResult = await authorizeOrgMember(orgId)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const adminClient = createAdminClient()

    // Verify the user also has access to the specific space
    const supabase = await createClient()
    const { data: spaceMembership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id')
      .eq('user_id', authResult.userId)
      .eq('space_id', spaceId)
      .single()

    if (!spaceMembership) {
      return NextResponse.json(
        { error: 'Access denied to this space' },
        { status: 403 }
      )
    }

    const { data, error } = await adminClient
      .from('api_keys')
      .insert({
        org_id: orgId,
        space_id: spaceId,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        created_by: authResult.userId,
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to create API key:', error)
      return NextResponse.json(
        { error: 'Failed to create API key' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('API key creation error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/keys?id=xxx&orgId=xxx - Delete an API key
export async function DELETE(request: NextRequest) {
  const rateLimited = applyRateLimit(request)
  if (rateLimited) return rateLimited

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const orgId = searchParams.get('orgId')

    if (!id || !orgId) {
      return NextResponse.json(
        { error: 'Missing key ID or orgId' },
        { status: 400 }
      )
    }

    // Authenticate and authorize: user must belong to the org
    const authResult = await authorizeOrgMember(orgId)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const adminClient = createAdminClient()

    // Verify the key belongs to this org before deleting
    const { data: existingKey } = await adminClient
      .from('api_keys')
      .select('org_id')
      .eq('id', id)
      .single()

    if (!existingKey) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 })
    }

    if (existingKey.org_id !== orgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { error } = await adminClient
      .from('api_keys')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) {
      console.error('Failed to delete API key:', error)
      return NextResponse.json(
        { error: 'Failed to delete API key' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('API key deletion error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET /api/keys?orgId=xxx&spaceId=xxx - List API keys
export async function GET(request: NextRequest) {
  const rateLimited = applyRateLimit(request)
  if (rateLimited) return rateLimited

  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('orgId')
    const spaceId = searchParams.get('spaceId')

    if (!orgId || !spaceId) {
      return NextResponse.json(
        { error: 'Missing orgId or spaceId' },
        { status: 400 }
      )
    }

    // Authenticate and authorize: user must belong to the org
    const authResult = await authorizeOrgMember(orgId)
    if (authResult instanceof NextResponse) {
      return authResult
    }

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('api_keys')
      .select('id, name, key_prefix, created_at, last_used_at, expires_at, is_active')
      .eq('org_id', orgId)
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch API keys:', error)
      return NextResponse.json(
        { error: 'Failed to fetch API keys' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('API key fetch error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
