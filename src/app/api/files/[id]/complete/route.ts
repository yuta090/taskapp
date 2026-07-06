import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

import { UUID_REGEX } from '@/lib/uuid'

// POST: アップロード完了確認。Storage上の実体を確認してから status='ready' に更新し、
// origin='client' の場合のみ内部メンバーへ通知する。
// 二重実行(同じ完了リクエストの再送)しても副作用が増えないよう、
// 既に ready な行は何もせず ok:true を返す(re-run しても通知が重複しない)。
export async function POST(
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
      .select('id, uploaded_by, org_id, space_id, origin, client_visible, name, storage_path, status')
      .eq('id', id)
      .single()

    if (fileError || !file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (file.uploaded_by !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // 既に完了処理済みなら再実行しても何もしない(通知の重複送信を防止)。
    if (file.status === 'ready') {
      return NextResponse.json({ ok: true })
    }

    const admin = createAdminClient()

    const lastSlash = file.storage_path.lastIndexOf('/')
    const folder = file.storage_path.slice(0, lastSlash)
    const fileName = file.storage_path.slice(lastSlash + 1)

    const { data: listing, error: listError } = await admin.storage.from('space-files').list(folder)

    if (listError) {
      console.error('Storage list error:', listError)
      return NextResponse.json({ error: 'Failed to verify upload' }, { status: 500 })
    }

    const exists = (listing || []).some((entry: { name: string }) => entry.name === fileName)
    if (!exists) {
      return NextResponse.json({ error: 'アップロードが完了していません' }, { status: 400 })
    }

    const { error: updateError } = await (supabase as SupabaseClient)
      .from('files')
      .update({ status: 'ready' })
      .eq('id', id)

    if (updateError) {
      console.error('File status update error:', updateError)
      return NextResponse.json({ error: 'Failed to mark file as ready' }, { status: 500 })
    }

    if (file.origin === 'client') {
      await notifyInternalMembers(admin, file, user.id)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Complete upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface FileData {
  id: string
  org_id: string
  space_id: string
  name: string
}

// 内部メンバーへの通知はベストエフォート(失敗してもアップロード完了自体は成功させる)。
async function notifyInternalMembers(
  admin: ReturnType<typeof createAdminClient>,
  file: FileData,
  uploaderId: string,
) {
  try {
    const { data: internalMembers } = await (admin as SupabaseClient)
      .from('space_memberships')
      .select('user_id')
      .eq('space_id', file.space_id)
      .neq('role', 'client')
      .neq('role', 'vendor')

    const recipients = (internalMembers || []).map((m: { user_id: string }) => m.user_id)
    if (recipients.length === 0) return

    const { data: profile } = await (admin as SupabaseClient)
      .from('profiles')
      .select('display_name')
      .eq('id', uploaderId)
      .single()

    const uploaderName = profile?.display_name || 'クライアント'

    // title/message/link は InboxClient/NotificationInspector の表示規約に合わせる
    // (scheduling_reminder 等と同じく payload.link が「詳細を見る」ボタンのリンク先になる)。
    const rows = recipients.map((toUserId: string) => ({
      org_id: file.org_id,
      space_id: file.space_id,
      to_user_id: toUserId,
      channel: 'in_app',
      type: 'file_uploaded',
      dedupe_key: `file_uploaded:${file.id}:${toUserId}`,
      payload: {
        file_id: file.id,
        file_name: file.name,
        space_id: file.space_id,
        uploader_name: uploaderName,
        title: 'ファイル: クライアントから資料が届きました',
        message: `${uploaderName}さんが「${file.name}」をアップロードしました`,
        link: `/${file.org_id}/project/${file.space_id}/files`,
      },
    }))

    const { error } = await (admin as SupabaseClient).from('notifications').insert(rows)
    if (error) {
      console.error('File upload notification insert error:', error)
    }
  } catch (error) {
    console.error('File upload notification unexpected error:', error)
  }
}
