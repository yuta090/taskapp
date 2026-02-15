import { createClient } from '@supabase/supabase-js'
import { createClient as createBrowserClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Create admin client with service role key (bypasses RLS)
function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase configuration')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// Get current user from session
async function getCurrentUser() {
  const supabase = await createBrowserClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return null
  }
  return user
}

// POST /api/keys/user - Create a new user-scoped API key
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, keyHash, keyPrefix, allowedSpaceIds, allowedActions } = body

    if (!name || !keyHash || !keyPrefix || !allowedSpaceIds || allowedSpaceIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()

    // Get user's org from their first space membership
    const { data: membership, error: memberError } = await adminClient
      .from('space_memberships')
      .select('spaces(org_id)')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    if (memberError || !membership) {
      return NextResponse.json(
        { error: 'User has no space memberships' },
        { status: 400 }
      )
    }

    const spaces = membership.spaces as unknown as { org_id: string } | { org_id: string }[]
    const orgId = Array.isArray(spaces) ? spaces[0]?.org_id : spaces?.org_id

    // Verify user has access to all selected spaces
    const { data: userSpaces, error: spacesError } = await adminClient
      .from('space_memberships')
      .select('space_id')
      .eq('user_id', user.id)
      .in('space_id', allowedSpaceIds)

    if (spacesError) {
      return NextResponse.json(
        { error: 'Failed to verify space access' },
        { status: 500 }
      )
    }

    const accessibleSpaceIds = userSpaces.map((s) => s.space_id)
    const invalidSpaces = allowedSpaceIds.filter(
      (id: string) => !accessibleSpaceIds.includes(id)
    )

    if (invalidSpaces.length > 0) {
      return NextResponse.json(
        { error: 'Access denied to some selected spaces' },
        { status: 403 }
      )
    }

    // Create the API key with user scope
    const { data, error } = await adminClient
      .from('api_keys')
      .insert({
        org_id: orgId,
        space_id: allowedSpaceIds[0], // Primary space (for backward compatibility)
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        created_by: user.id,
        user_id: user.id,
        scope: 'user',
        allowed_space_ids: allowedSpaceIds,
        allowed_actions: allowedActions || ['read'],
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to create API key:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('API key creation error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/keys/user?id=xxx - Delete a user's API key
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing key ID' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Verify the key belongs to this user
    const { data: key, error: keyError } = await adminClient
      .from('api_keys')
      .select('user_id')
      .eq('id', id)
      .single()

    if (keyError || !key) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 })
    }

    if (key.user_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { error } = await adminClient.from('api_keys').delete().eq('id', id)

    if (error) {
      console.error('Failed to delete API key:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('API key deletion error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/keys/user - List current user's API keys
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('api_keys')
      .select(
        'id, name, key_prefix, created_at, last_used_at, expires_at, is_active, scope, allowed_space_ids, allowed_actions'
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch API keys:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('API key fetch error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
