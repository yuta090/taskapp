import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createClient as createBrowserClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeAllowedActions } from '@/lib/api-keys/actionOptions'
import { isInternalSpaceRole } from '@/lib/roles/spaceRoles'
import { generateApiKey, STALE_CLIENT_KEY_MESSAGE } from '@/lib/api-keys/generateKey'

// 一覧（GET）と発行直後の応答（POST）は同じ列だけを返す。key_hash など画面が使わない列は返さない。
// space_id: プロジェクト設定で作った鍵（scope=space）も持ち主が入ってここに並ぶ。
// allowed_space_ids が空なので、どのプロジェクトの鍵かを返さないと「全スペース」と誤表示される
const USER_KEY_COLUMNS =
  'id, name, key_prefix, created_at, last_used_at, expires_at, is_active, scope, space_id, allowed_space_ids, allowed_actions'

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

// Get current user from session（二要素認証で弾く場合は blocked にレスポンスを入れて返す）
async function getCurrentUser(): Promise<{ user: User; blocked?: undefined } | { user?: undefined; blocked: NextResponse } | null> {
  const supabase = await createBrowserClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return null
  }
  // 二要素認証: 登録済み × コード未入力(aal1) は service role で触る前に弾く（403 mfa_required）
  const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
  if (mfaBlock) return { blocked: mfaBlock }
  return { user }
}

// POST /api/keys/user - Create a new user-scoped API key
export async function POST(request: NextRequest) {
  try {
    const current = await getCurrentUser()
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (current.blocked) return current.blocked
    const user = current.user

    const body = await request.json()
    const { name, allowedSpaceIds, allowedActions } = body

    // キーは必ずサーバーで作る。keyHash/keyPrefix が入っているのは、本番切り替え前に開いたままの
    // 古い画面（ブラウザ側でキーを自分で作る旧版）からの送信。その画面は失敗時に決まった文言
    // 「APIキーの作成に失敗しました」を出すだけなので、この応答の文言そのものは利用者に見えない。
    // 狙いは文言を見せることではなく、保存できない・画面に出せないキーを黙って作らないこと。
    // 再読み込みして今の画面を使えば、キーはサーバーで作られて直る
    if (body.keyHash || body.keyPrefix) {
      return NextResponse.json({ error: STALE_CLIENT_KEY_MESSAGE }, { status: 400 })
    }

    if (!name || !allowedSpaceIds || allowedSpaceIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // 知らない操作は DB の CHECK 制約に任せず、ここで 400 にする（プロジェクト設定の /api/keys と同じ）
    const normalizedActions = normalizeAllowedActions(allowedActions)
    if (!normalizedActions) {
      return NextResponse.json({ error: 'Invalid allowedActions' }, { status: 400 })
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

    // Verify user has access to all selected spaces（役割も取り、相手先としての所属を見分ける）
    const { data: userSpaces, error: spacesError } = await adminClient
      .from('space_memberships')
      .select('space_id, role')
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

    // API キーは社内メンバー（admin / editor / viewer）専用。それ以外の役割（相手先の client / vendor・不明な役割）で
    // 所属するプロジェクトが1つでも含まれていたら全体を断る（一部だけ発行すると、画面で選んだ内容と食い違うため）
    if (userSpaces.some((s) => !isInternalSpaceRole(s.role as string | undefined))) {
      return NextResponse.json(
        { error: 'API keys are available to internal members only' },
        { status: 403 }
      )
    }

    // キーの本体は画面から受け取らず、ここ（サーバー）で推測できない乱数から作る。
    // 保存するのはハッシュと prefix だけで、平文はこの応答でしか返さない
    const { key, keyHash, keyPrefix } = generateApiKey()

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
        allowed_actions: normalizedActions,
      })
      .select(USER_KEY_COLUMNS)
      .single()

    if (error) {
      console.error('Failed to create API key:', error)
      // DB のエラー文（制約名など）は画面に返さない。詳細はサーバーログだけに出す
      return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
    }

    // 平文キーはこの応答でしか返らないので、ブラウザやCDNにキャッシュさせない
    return NextResponse.json({ data, key }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('API key creation error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/keys/user?id=xxx - Delete a user's API key
export async function DELETE(request: NextRequest) {
  try {
    const current = await getCurrentUser()
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (current.blocked) return current.blocked
    const user = current.user

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
      return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('API key deletion error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/keys/user - List current user's API keys
export async function GET(_request: NextRequest) {
  try {
    const current = await getCurrentUser()
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (current.blocked) return current.blocked
    const user = current.user

    const adminClient = createAdminClient()

    const { data, error } = await adminClient
      .from('api_keys')
      .select(USER_KEY_COLUMNS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch API keys:', error)
      return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (err) {
    console.error('API key fetch error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
