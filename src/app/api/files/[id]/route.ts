import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'

const MAX_NAME_LENGTH = 255

function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.length >= 1 && name.length <= MAX_NAME_LENGTH
    && !name.includes('/') && !name.includes('\\')
}

// PATCH: 公開トグル・リネーム(内部ロールのみ)。storage_path は変更しない。
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 })
    }

    const body = await request.json()
    const { clientVisible, name } = body as { clientVisible?: unknown; name?: unknown }

    if (clientVisible === undefined && name === undefined) {
      return NextResponse.json({ error: 'clientVisible or name is required' }, { status: 400 })
    }
    if (clientVisible !== undefined && typeof clientVisible !== 'boolean') {
      return NextResponse.json({ error: 'clientVisible must be a boolean' }, { status: 400 })
    }
    if (name !== undefined && !isValidName(name)) {
      return NextResponse.json({ error: `name must be 1-${MAX_NAME_LENGTH} chars without path separators` }, { status: 400 })
    }

    const { data: file, error: fileError } = await (supabase as SupabaseClient)
      .from('files')
      .select('id, space_id')
      .eq('id', id)
      .single()

    if (fileError || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // 内部ロールのみ許可(client/vendorは403)
    const { data: internalMembership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id')
      .eq('space_id', file.space_id)
      .eq('user_id', user.id)
      .neq('role', 'client')
      .neq('role', 'vendor')
      .single()

    if (!internalMembership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const updates: Record<string, unknown> = {}
    if (clientVisible !== undefined) updates.client_visible = clientVisible
    if (name !== undefined) updates.name = name

    const { data: updated, error: updateError } = await (supabase as SupabaseClient)
      .from('files')
      .update(updates)
      .eq('id', id)
      .select('id, name, client_visible')
      .single()

    if (updateError) {
      console.error('File update error:', updateError)
      return NextResponse.json({ error: 'Failed to update file' }, { status: 500 })
    }

    return NextResponse.json({ file: updated })
  } catch (error) {
    console.error('Patch file error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: 内部ロールまたはアップローダ本人。Storage実体を削除してからDB行を削除する。
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 })
    }

    const { data: file, error: fileError } = await (supabase as SupabaseClient)
      .from('files')
      .select('id, uploaded_by, space_id, storage_path')
      .eq('id', id)
      .single()

    if (fileError || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    let authorized = file.uploaded_by === user.id

    if (!authorized) {
      const { data: internalMembership } = await (supabase as SupabaseClient)
        .from('space_memberships')
        .select('id')
        .eq('space_id', file.space_id)
        .eq('user_id', user.id)
        .neq('role', 'client')
        .neq('role', 'vendor')
        .single()

      authorized = !!internalMembership
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { error: removeError } = await admin.storage.from('space-files').remove([file.storage_path])

    if (removeError) {
      console.error('Storage remove error:', removeError)
      return NextResponse.json({ error: 'Failed to delete file from storage' }, { status: 500 })
    }

    const { error: deleteError } = await (supabase as SupabaseClient)
      .from('files')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('File delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete file record' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Delete file error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
