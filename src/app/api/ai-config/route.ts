import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SLACK_CONFIG } from '@/lib/slack/config'

export const runtime = 'nodejs'

let _supabaseAdmin: ReturnType<typeof createSupabaseClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

/**
 * GET /api/ai-config?orgId=xxx
 * AI設定を取得（復号化キーは返さない）
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('orgId')

    if (!orgId) {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }

    // org_ai_configを取得（RLSでowner制限）
    const { data, error } = await (supabase as SupabaseClient)
      .from('org_ai_config')
      .select('id, org_id, provider, model, enabled, api_key_encrypted, created_at, updated_at')
      .eq('org_id', orgId)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Failed to fetch ai config:', error)
      return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ config: null })
    }

    // キーのプレフィックスのみ返す（復号化せずに暗号化済み文字列からは取れないため、保存時に別途保持が必要）
    // ここでは復号化してプレフィックスだけ返す
    let keyPrefix = ''
    try {
      const { data: decrypted } = await (getSupabaseAdmin() as SupabaseClient)
        .rpc('decrypt_slack_token', {
          encrypted: data.api_key_encrypted,
          secret: SLACK_CONFIG.clientSecret,
        })

      if (decrypted && typeof decrypted === 'string') {
        keyPrefix = decrypted.substring(0, 8) + '...'
      }
    } catch {
      keyPrefix = '****...'
    }

    return NextResponse.json({
      config: {
        id: data.id,
        orgId: data.org_id,
        provider: data.provider,
        model: data.model,
        enabled: data.enabled,
        keyPrefix,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    })
  } catch (err) {
    console.error('AI config fetch error:', err)
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 })
  }
}

/**
 * POST /api/ai-config
 * { orgId, provider, apiKey, model? }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { orgId, provider, apiKey, model } = body

    if (!orgId || !provider || !apiKey) {
      return NextResponse.json(
        { error: 'orgId, provider, apiKey are required' },
        { status: 400 },
      )
    }

    // プロバイダー検証
    if (!['openai', 'anthropic'].includes(provider)) {
      return NextResponse.json(
        { error: 'provider must be "openai" or "anthropic"' },
        { status: 400 },
      )
    }

    // APIキー形式検証
    if (provider === 'openai' && !apiKey.startsWith('sk-')) {
      return NextResponse.json(
        { error: 'OpenAI APIキーは sk- で始まる必要があります' },
        { status: 400 },
      )
    }
    if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
      return NextResponse.json(
        { error: 'Anthropic APIキーは sk-ant- で始まる必要があります' },
        { status: 400 },
      )
    }

    // org owner権限チェック
    const { data: membership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only org owners can configure AI settings' },
        { status: 403 },
      )
    }

    // APIキーを暗号化
    const { data: encryptedKey, error: encryptError } = await (getSupabaseAdmin() as SupabaseClient)
      .rpc('encrypt_slack_token', {
        token: apiKey,
        secret: SLACK_CONFIG.clientSecret,
      })

    if (encryptError || !encryptedKey) {
      console.error('API key encryption failed:', encryptError)
      return NextResponse.json(
        { error: 'Failed to encrypt API key' },
        { status: 500 },
      )
    }

    // DB保存（upsert）
    const { error: upsertError } = await (getSupabaseAdmin() as SupabaseClient)
      .from('org_ai_config')
      .upsert(
        {
          org_id: orgId,
          provider,
          api_key_encrypted: encryptedKey,
          model: model || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-5-20250929'),
          enabled: true,
          created_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id' },
      )

    if (upsertError) {
      console.error('AI config save failed:', upsertError)
      return NextResponse.json(
        { error: 'Failed to save AI config' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      config: {
        provider,
        model: model || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-5-20250929'),
        keyPrefix: apiKey.substring(0, 8) + '...',
      },
    })
  } catch (err) {
    console.error('AI config save error:', err)
    return NextResponse.json(
      { error: 'Failed to save config' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/ai-config?orgId=xxx
 * AI設定を削除
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('orgId')

    if (!orgId) {
      return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
    }

    // org owner権限チェック
    const { data: membership } = await (supabase as SupabaseClient)
      .from('org_memberships')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership || membership.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only org owners can delete AI config' },
        { status: 403 },
      )
    }

    const { error } = await (getSupabaseAdmin() as SupabaseClient)
      .from('org_ai_config')
      .delete()
      .eq('org_id', orgId)

    if (error) {
      console.error('Failed to delete AI config:', error)
      return NextResponse.json(
        { error: 'Failed to delete AI config' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('AI config delete error:', err)
    return NextResponse.json(
      { error: 'Failed to delete config' },
      { status: 500 },
    )
  }
}
