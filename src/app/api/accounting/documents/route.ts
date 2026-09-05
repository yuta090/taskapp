import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { UUID_REGEX } from '@/lib/uuid'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { isImplementedAccountingProvider } from '@/lib/accounting/implemented'
import { connectionErrorResponse, resolveAccountingConnection } from '@/lib/accounting/connection'
import {
  buildLinesFromTasks,
  computeIdempotencyKey,
  MissingAmountError,
  subtotalOf,
  type IssuableTask,
  type TaxRate,
} from '@/lib/accounting/issue'
import type { AccountingProviderId, DocumentType } from '@/lib/accounting/types'

export const runtime = 'nodejs'

/**
 * 見積書・請求書の発行。
 *
 * ⚠ 扱うのは書類の作成だけ。仕訳・入出金・決算といった会計データには触れない。
 *
 * 二重発行の防止はこの経路の存在理由そのもの。守り方は2段:
 *   1. 発行前に発行記録を先に作る（idempotency_key の一意制約）。二度押しの2回目は
 *      ここで一意制約違反になり、**外部APIを叩く前に**止まる。
 *   2. 外部が成功したら同じ行を更新する。応答を取りこぼしても行は残るので、
 *      「送ったか分からない」状態にならず、状態同期が後から埋められる。
 *
 * 順序が逆（先に外部へ出してから記録する）だと、記録に失敗した瞬間に台帳から消えた
 * 請求書が取引先の手元にだけ存在することになる。必ず記録が先。
 */

const VALID_TAX_RATES: TaxRate[] = [10, 8, 0]

/** 発行できるのは編集権限のある内部メンバーだけ（金額と取引先を動かす操作のため）。 */
const ISSUE_ALLOWED_ROLES = new Set(['admin', 'editor'])

interface IssueRequestBody {
  spaceId?: string
  provider?: string
  docType?: string
  taskIds?: string[]
  title?: string
  issueDate?: string
  dueDate?: string | null
  taxRate?: number
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as IssueRequestBody

    const spaceId = body.spaceId
    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'spaceId が不正です' }, { status: 400 })
    }

    const provider = body.provider
    if (!provider || !isImplementedAccountingProvider(provider)) {
      return NextResponse.json({ error: '対応していない連携先です' }, { status: 400 })
    }

    const docType = body.docType
    if (docType !== 'quote' && docType !== 'invoice') {
      return NextResponse.json({ error: '書類の種類が不正です' }, { status: 400 })
    }

    const taskIds = Array.isArray(body.taskIds) ? [...new Set(body.taskIds)] : []
    if (taskIds.length === 0 || taskIds.some((id) => !UUID_REGEX.test(id))) {
      return NextResponse.json({ error: '対象のタスクが選ばれていません' }, { status: 400 })
    }

    const taxRate = (body.taxRate ?? 10) as TaxRate
    if (!VALID_TAX_RATES.includes(taxRate)) {
      return NextResponse.json({ error: '税率が不正です' }, { status: 400 })
    }

    // 権限: そのスペースの admin/editor のみ
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('space_id', spaceId)
      .maybeSingle()

    if (!membership || !ISSUE_ALLOWED_ROLES.has(membership.role)) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    }

    const admin = createAdminClient()

    const { data: space } = await (admin as SupabaseClient)
      .from('spaces')
      .select('id, name, org_id')
      .eq('id', spaceId)
      .single()

    if (!space) return NextResponse.json({ error: 'スペースが見つかりません' }, { status: 404 })

    // 発行先（会計サービス側の取引先）が決まっていないと出せない
    const { data: partnerLink } = await (admin as SupabaseClient)
      .from('accounting_partner_links')
      .select('external_partner_id')
      .eq('space_id', spaceId)
      .eq('provider', provider)
      .maybeSingle()

    if (!partnerLink) {
      return NextResponse.json(
        { error: '発行先の取引先が設定されていません。先に取引先を選んでください。' },
        { status: 409 },
      )
    }

    // 対象タスクと金額を集める（他スペースのタスクを混ぜられないよう space_id で縛る）
    const { data: tasks } = await (admin as SupabaseClient)
      .from('tasks')
      .select('id, title')
      .eq('space_id', spaceId)
      .in('id', taskIds)

    if (!tasks || tasks.length !== taskIds.length) {
      return NextResponse.json({ error: '対象のタスクが見つかりません' }, { status: 400 })
    }

    const { data: pricingRows } = await (admin as SupabaseClient)
      .from('task_pricing')
      .select('task_id, sell_total')
      .in('task_id', taskIds)

    const priceMap = new Map<string, number | null>(
      (pricingRows ?? []).map((row: { task_id: string; sell_total: string | number | null }) => [
        row.task_id,
        row.sell_total == null ? null : Number(row.sell_total),
      ]),
    )

    const issuable: IssuableTask[] = (tasks as Array<{ id: string; title: string }>).map((task) => ({
      id: task.id,
      title: task.title,
      sellTotal: priceMap.get(task.id) ?? null,
    }))

    let lines
    try {
      lines = buildLinesFromTasks(issuable, taxRate)
    } catch (err) {
      if (err instanceof MissingAmountError) {
        return NextResponse.json({ error: err.message, taskTitles: err.taskTitles }, { status: 422 })
      }
      return NextResponse.json({ error: (err as Error).message }, { status: 422 })
    }

    // 発行日は必ず日本時間の「今日」。UTCのまま日付にすると深夜帯で前日の日付になる
    const issueDate = body.issueDate ?? formatDateToLocalString(jstNow())
    const subtotal = subtotalOf(lines)
    const idempotencyKey = computeIdempotencyKey({
      spaceId,
      docType: docType as DocumentType,
      partnerId: partnerLink.external_partner_id,
      issueDate,
      taskIds,
      subtotal,
    })

    // --- 1段目: 外部を叩く前に発行記録を先に作る（二度押しはここで止まる） ---
    const { data: record, error: insertError } = await (admin as SupabaseClient)
      .from('billing_documents')
      .insert({
        org_id: space.org_id,
        space_id: spaceId,
        provider,
        doc_type: docType,
        idempotency_key: idempotencyKey,
        status: 'unknown',
        total_amount: subtotal,
        issued_by: user.id,
      })
      .select('id')
      .single()

    if (insertError || !record) {
      // 一意制約違反 = 同じ内容が既に発行済み。エラーではなく「もう出ています」と伝える
      if (insertError?.code === '23505') {
        const { data: existing } = await (admin as SupabaseClient)
          .from('billing_documents')
          .select('id, document_number, web_url, status')
          .eq('org_id', space.org_id)
          .eq('provider', provider)
          .eq('doc_type', docType)
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle()

        return NextResponse.json(
          { error: '同じ内容の書類がすでに発行されています', document: existing },
          { status: 409 },
        )
      }
      console.error('billing_documents insert failed:', insertError)
      return NextResponse.json({ error: '発行記録の作成に失敗しました' }, { status: 500 })
    }

    // 含めたタスクを記録（二重請求の検知に使う）
    await (admin as SupabaseClient)
      .from('billing_document_tasks')
      .insert(taskIds.map((taskId) => ({ document_id: record.id, task_id: taskId })))

    // --- 2段目: 外部へ発行 ---
    const connection = await resolveAccountingConnection(space.org_id, provider as AccountingProviderId)
    if (connection.status !== 'ok') {
      // 外部に何も出していないので、先に作った記録は消してよい（残すと幽霊の発行済みになる）
      await (admin as SupabaseClient).from('billing_documents').delete().eq('id', record.id)
      const { error, httpStatus } = connectionErrorResponse(connection.status)
      return NextResponse.json({ error }, { status: httpStatus })
    }

    try {
      const issued = await connection.adapter.createDocument(
        connection.ctx,
        docType as DocumentType,
        {
          partnerId: partnerLink.external_partner_id,
          title: body.title || space.name,
          issueDate,
          dueDate: body.dueDate ?? null,
          lines,
        },
        idempotencyKey,
      )

      const { data: updated } = await (admin as SupabaseClient)
        .from('billing_documents')
        .update({
          external_id: issued.externalId || null,
          document_number: issued.documentNumber,
          status: issued.status,
          raw_status: issued.rawStatus,
          total_amount: issued.totalAmount ?? subtotal,
          web_url: issued.webUrl,
          issued_at: new Date().toISOString(),
          remote_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id)
        .select('id, document_number, status, total_amount, web_url')
        .single()

      return NextResponse.json({ document: updated }, { status: 201 })
    } catch (err) {
      // 外部で失敗した。記録を消して、同じ内容でやり直せるようにする
      // （残すと一意制約に当たって永久に再発行できなくなる）
      await (admin as SupabaseClient).from('billing_documents').delete().eq('id', record.id)
      console.error('accounting createDocument failed:', err)
      return NextResponse.json(
        { error: `発行に失敗しました: ${(err as Error).message}` },
        { status: 502 },
      )
    }
  } catch (err) {
    console.error('accounting documents POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** 発行履歴。金額が入るため内部メンバーのみ（RLSでも二重に守られる）。 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const spaceId = new URL(request.url).searchParams.get('spaceId')
    if (!spaceId || !UUID_REGEX.test(spaceId)) {
      return NextResponse.json({ error: 'spaceId が不正です' }, { status: 400 })
    }

    // 読取は RLS（内部メンバーのみ）に委ねる＝ここで admin クライアントを使わない
    const { data, error } = await (supabase as SupabaseClient)
      .from('billing_documents')
      .select('id, provider, doc_type, document_number, status, total_amount, web_url, issued_at')
      .eq('space_id', spaceId)
      .order('issued_at', { ascending: false, nullsFirst: false })
      .limit(100)

    if (error) {
      console.error('billing_documents select failed:', error)
      return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
    }

    return NextResponse.json({ documents: data ?? [] })
  } catch (err) {
    console.error('accounting documents GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
