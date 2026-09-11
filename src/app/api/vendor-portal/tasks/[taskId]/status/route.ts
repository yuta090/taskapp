import { after, NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
import { isValidUuid } from '@/lib/uuid'
import { VENDOR_TASK_STATUSES, isVendorTaskStatus } from '@/lib/vendor/vendorStatuses'
import type { SupabaseClient } from '@supabase/supabase-js'

interface StatusChangeBody {
  status?: unknown
}

/**
 * 協力会社（role='vendor'）によるタスクのステータス変更。本人のセッションで
 * 「そのタスクの space で role='vendor' か・その space が代理店モードか」
 * （役割の確認を先に行い、協力会社以外は常に403にそろえる）に続けて
 * 「今のステータスが変更可能な4状態か」を確かめたうえで、
 * サーバー側(service role)クライアントで書き込む。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params

  if (!isValidUuid(taskId)) {
    return NextResponse.json({ error: '無効なタスクIDです' }, { status: 400 })
  }

  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    // 二要素認証: 登録済み × コード未入力(aal1) は service role で触る前に弾く（RLS 経由でない経路の防衛）
    const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
    if (mfaBlock) return mfaBlock

    let body: StatusChangeBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 })
    }

    if (!isVendorTaskStatus(body.status)) {
      return NextResponse.json({ error: '無効なステータスです' }, { status: 400 })
    }
    const status = body.status

    // タスクの読み取りは本人のセッションで行う（書き込みには使わない）。

    const { data: task, error: taskError } = await (supabase as SupabaseClient)
      .from('tasks')
      .select('id, space_id, org_id, status')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 })
    }

    // 役割の確認を先にする: 協力会社（role='vendor'・代理店モードの space）で
    // なければ、タスクの今の状態に関わらず常に 403 にそろえる。
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id, role, spaces!inner(agency_mode)')
      .eq('space_id', task.space_id)
      .eq('user_id', user.id)
      .eq('role', 'vendor')
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 })
    }

    const spaces = membership.spaces as unknown as { agency_mode: boolean }
    if (!spaces?.agency_mode) {
      return NextResponse.json({ error: 'アクセス権限がありません' }, { status: 403 })
    }

    // 今のステータスが協力会社が変更できる4状態のどれでもなければ（完了済み・検討中
    // など）、対応不要な業務ルールで止める。書き込みの WHERE 条件にも同じ4状態を
    // 課すため、ここで弾いておかないと 0 行更新の 409 に埋もれて理由が伝わらない。
    if (!isVendorTaskStatus(task.status)) {
      return NextResponse.json(
        { error: 'このタスクは完了済み、または検討中のため変更できません' },
        { status: 409 }
      )
    }

    // 確認（ログイン・二要素認証・タスクの読み取り・vendor membership・代理店モード）
    // が全て終わったあとで、実際の書き込みに使うサーバー側(service role)クライアント
    // を作る。書き込む行は確認済みの id・space_id・「変更可能な4状態」の条件で固定する
    // （確認と書き込みの間に他の誰かが状態を変えていたら 0 行になる）。
    const admin = createAdminClient()

    const { data: updatedTask, error: updateError } = await (admin as SupabaseClient)
      .from('tasks')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .eq('space_id', task.space_id)
      .in('status', VENDOR_TASK_STATUSES)
      .select('id')
      .maybeSingle()

    if (updateError) {
      console.error('Error updating vendor task status:', updateError)
      return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 })
    }

    if (!updatedTask) {
      // 行が更新されなかったのは、読み取りから書き込みまでの間に他の誰かが
      // 先に状態を変えたため（例: 相手先の承認や社内の操作で「完了」になった）。
      return NextResponse.json(
        { error: 'タスクの状態が変更されました。ページを再読み込みしてください。' },
        { status: 409 }
      )
    }

    // 監査ログは応答を返したあとも確実に実行されるよう after() に回す
    // （await しない書き込みは応答送出後に打ち切られることがある）。
    after(() =>
      createAuditLog({
        supabase,
        orgId: task.org_id,
        spaceId: task.space_id,
        actorId: user.id,
        actorRole: 'vendor',
        eventType: 'task.status_changed',
        targetType: 'task',
        targetId: taskId,
        summary: generateAuditSummary('task.status_changed'),
        dataBefore: { status: task.status },
        dataAfter: { status },
        visibility: 'team',
      }).catch(err => console.error('Audit log failed (vendor status change):', err))
    )

    return NextResponse.json({
      success: true,
      message: 'ステータスを更新しました',
      taskId,
    })
  } catch (error) {
    console.error('Vendor task status change error:', error)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
