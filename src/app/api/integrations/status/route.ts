import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revokeToken } from '@/lib/integrations'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * GET /api/integrations/status
 * 現在のユーザーの接続状態一覧を返す
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ユーザー自身の接続を取得
    const { data: connections, error } = await (supabase as SupabaseClient)
      .from('integration_connections')
      .select('id, provider, owner_type, owner_id, org_id, scopes, metadata, status, token_expires_at, last_refreshed_at, created_at, updated_at')
      .eq('owner_type', 'user')
      .eq('owner_id', user.id)

    if (error) {
      console.error('Failed to fetch integration connections:', error)
      return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 })
    }

    return NextResponse.json({
      connections: (connections || []).map((conn: Record<string, unknown>) => ({
        id: conn.id,
        provider: conn.provider,
        owner_type: conn.owner_type,
        owner_id: conn.owner_id,
        org_id: conn.org_id,
        scopes: conn.scopes,
        metadata: conn.metadata ?? {},
        status: conn.status,
        token_expires_at: conn.token_expires_at,
        last_refreshed_at: conn.last_refreshed_at,
        created_at: conn.created_at,
        updated_at: conn.updated_at,
      })),
    })
  } catch (err) {
    console.error('Integration status error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/integrations/status?connectionId=...
 * 接続を削除（revoke）する
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get('connectionId')

    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
    }

    // Verify ownership: ensure this connection belongs to the current user
    const { data: connection } = await (supabase as SupabaseClient)
      .from('integration_connections')
      .select('id, owner_type, owner_id')
      .eq('id', connectionId)
      .eq('owner_type', 'user')
      .eq('owner_id', user.id)
      .single()

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const success = await revokeToken(connectionId)
    if (!success) {
      return NextResponse.json({ error: 'Failed to revoke connection' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Integration delete error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
