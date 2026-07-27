import { createAdminClient } from '@/lib/supabase/admin'
import type { BillingQuoteRow, BillingQuoteStatus } from './quotes'
import type { ApprovedQuoteWithOrg } from './quotesCsv'

/**
 * billing_quotes のデータアクセス。
 *
 * 書込は全てここ（service_role）経由＝テーブルには authenticated 向けの
 * INSERT/UPDATE/DELETE ポリシーを作っていない。呼び出し側(route)が認可を済ませてから呼ぶ。
 * 承認だけは同時実行に強い RPC（rpc_approve_billing_quote）に委ねる。
 */

const SELECT_COLUMNS =
  'id,org_id,status,requested_by,requested_note,requested_at,amount_monthly_jpy,add_members,add_line_groups,add_external_chat_groups,offer_note,offered_at,expires_at,approved_at,stripe_sync_status'

/** 見積もりの状態のうち「まだ決着していない」もの。org あたり1件だけ存在しうる。 */
const OPEN_STATUSES: BillingQuoteStatus[] = ['requested', 'offered']

function admin() {
  return createAdminClient()
}

/** org の見積もり一覧（新しい順）。 */
export async function listOrgQuotes(orgId: string): Promise<BillingQuoteRow[]> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .select(SELECT_COLUMNS)
    .eq('org_id', orgId)
    .order('requested_at', { ascending: false })
    .limit(50)

  if (error || !data) return []
  return data as unknown as BillingQuoteRow[]
}

/** 進行中（依頼中/提示中）の見積もり。無ければ null。 */
export async function getOpenQuote(orgId: string): Promise<BillingQuoteRow | null> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .select(SELECT_COLUMNS)
    .eq('org_id', orgId)
    .in('status', OPEN_STATUSES)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as BillingQuoteRow
}

export class QuoteConflictError extends Error {
  constructor(message = '進行中のお見積もりが既にあります') {
    super(message)
    this.name = 'QuoteConflictError'
  }
}

/**
 * 顧客からの枠追加の依頼を作る。
 * 希望の内訳は `requested_note`（自由文）に入れる。**金額と加算数を決めるのは提示側**で、
 * 依頼の時点では枠は1つも増えない（顧客が数量を自己申告して増やせる経路を作らない）。
 * 進行中の見積もりが既にあれば部分ユニーク索引が弾く → QuoteConflictError。
 */
export async function createQuoteRequest(params: {
  orgId: string
  userId: string
  note: string
}): Promise<BillingQuoteRow> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .insert({
      org_id: params.orgId,
      status: 'requested',
      requested_by: params.userId,
      requested_note: params.note,
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    // 23505 = unique_violation（billing_quotes_one_open_per_org）
    if ((error as { code?: string }).code === '23505') throw new QuoteConflictError()
    throw new Error(error.message)
  }
  return data as unknown as BillingQuoteRow
}

/**
 * 当社が金額を提示する（requested → offered）。
 * 提示後の行は不変で、金額を変えるときは cancel して新しい行を作る（supersede）。
 */
export async function offerQuote(params: {
  quoteId: string
  adminUserId: string
  amountMonthlyJpy: number
  addMembers: number
  addLineGroups: number
  addExternalChatGroups: number
  note?: string | null
  expiresAt: string
}): Promise<boolean> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .update({
      status: 'offered',
      amount_monthly_jpy: params.amountMonthlyJpy,
      add_members: params.addMembers,
      add_line_groups: params.addLineGroups,
      add_external_chat_groups: params.addExternalChatGroups,
      offer_note: params.note ?? null,
      offered_by: params.adminUserId,
      offered_at: new Date().toISOString(),
      expires_at: params.expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.quoteId)
    .eq('status', 'requested')
    .select('id')

  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

export type ApproveQuoteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_offered' | 'expired' | 'amount_mismatch' }

/**
 * 顧客(owner)による承認。同時実行・二重押し・金額すり替えは RPC が同一Tx内で弾く。
 * `amountEcho` は画面に表示されていた金額。行と違えば amount_mismatch。
 */
export async function approveQuote(
  quoteId: string,
  userId: string,
  amountEcho: number,
): Promise<ApproveQuoteResult> {
  const { data, error } = await admin().rpc('rpc_approve_billing_quote', {
    p_quote_id: quoteId,
    p_user_id: userId,
    p_amount_echo: amountEcho,
  })

  if (error) throw new Error(error.message)
  const result = data as { ok?: boolean; reason?: string } | null
  if (result?.ok) return { ok: true }
  return { ok: false, reason: (result?.reason ?? 'not_offered') as ApproveQuoteResult extends { ok: false; reason: infer R } ? R : never }
}

/** 顧客が見送る（offered → rejected）。 */
export async function rejectQuote(quoteId: string): Promise<boolean> {
  return transition(quoteId, ['offered'], { status: 'rejected', rejected_at: new Date().toISOString() })
}

/** 当社が取り下げる（requested/offered → canceled）。金額の作り直しはこれ＋新規作成。 */
export async function cancelQuote(quoteId: string): Promise<boolean> {
  return transition(quoteId, OPEN_STATUSES, {
    status: 'canceled',
    canceled_at: new Date().toISOString(),
  })
}

/** 承認済みの枠を終了する（approved → terminated）。加算はここで消える。既存は切らない。 */
export async function terminateQuote(quoteId: string): Promise<boolean> {
  return transition(quoteId, ['approved'], {
    status: 'terminated',
    terminated_at: new Date().toISOString(),
  })
}

/** 当社が請求へ手動反映したことを記録する（PR1 の運用。PR2 で自動化）。 */
export async function markStripeSyncApplied(quoteId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .update({ stripe_sync_status: 'applied', updated_at: new Date().toISOString() })
    .eq('id', quoteId)
    .eq('status', 'approved')
    .select('id')

  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

/** 承認済みだが請求へ未反映の見積もり（当社の作業待ち一覧）。 */
export async function listPendingSyncQuotes(): Promise<BillingQuoteRow[]> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .select(SELECT_COLUMNS)
    .eq('status', 'approved')
    .eq('stripe_sync_status', 'pending')
    .order('approved_at', { ascending: true })
    .limit(100)

  if (error || !data) return []
  return data as unknown as BillingQuoteRow[]
}

/** 1回のクエリで取る件数。Supabase の1リクエスト上限に収まる大きさにする。 */
export const APPROVED_QUOTES_PAGE_SIZE = 500
/** 取り切る上限。ここに達したら「全部は出せていない」と知らせる（黙って捨てない）。 */
export const APPROVED_QUOTES_MAX = 5000

export interface ApprovedQuotesResult {
  rows: ApprovedQuoteWithOrg[]
  /** true = 件数が多すぎて全部は返せていない。画面・CSVで警告すること。 */
  truncated: boolean
}

/**
 * 承認済み（＝毎月請求すべき）追加枠の一覧。組織名を添えて返す。
 * 請求書払いが中心のため「金額が分かれば足りる」運用の主データ（CSVで経理へ渡す）。
 * terminated は含めない（終了＝もう請求しない）。
 *
 * ⚠ ここは請求額の正本。1ページだけ取って打ち切ると、あふれた分が
 * 画面にも合計金額にもCSVにも出ないまま**請求漏れ**になる。だから全ページ取り切り、
 * それでも取り切れない異常時だけ truncated=true で明示する。
 */
export async function listApprovedQuotesWithOrg(): Promise<ApprovedQuotesResult> {
  const client = admin()

  const rows: BillingQuoteRow[] = []
  let truncated = false

  for (let offset = 0; offset < APPROVED_QUOTES_MAX; offset += APPROVED_QUOTES_PAGE_SIZE) {
    const to = Math.min(offset + APPROVED_QUOTES_PAGE_SIZE, APPROVED_QUOTES_MAX) - 1
    const { data, error } = await client
      .from('billing_quotes')
      .select(SELECT_COLUMNS)
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .range(offset, to)

    if (error) {
      console.error('[billing_quotes] 承認済み一覧の取得に失敗', error)
      // 途中まで取れた分だけ返すと「少ない合計金額」を正しい額として見せてしまう。
      // 中途半端な数字より 0件（＝明らかに異常）のほうが気づける。
      return { rows: [], truncated: false }
    }
    const page = (data ?? []) as unknown as BillingQuoteRow[]
    rows.push(...page)
    if (page.length < to - offset + 1) break
  }

  if (rows.length >= APPROVED_QUOTES_MAX) {
    // 実運用でここに来たら設計の想定外。請求漏れに直結するので必ずログに残す。
    console.error(
      `[billing_quotes] 承認済みが上限 ${APPROVED_QUOTES_MAX} 件に達した。ページングの見直しが必要`,
    )
    truncated = true
  }

  if (rows.length === 0) return { rows: [], truncated }

  const orgIds = Array.from(new Set(rows.map((r) => r.org_id)))
  const { data: orgs } = await client.from('organizations').select('id,name').in('id', orgIds)
  const nameById = new Map<string, string>(
    ((orgs as Array<{ id: string; name: string }> | null) ?? []).map((o) => [o.id, o.name]),
  )

  return {
    truncated,
    rows: rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      orgName: nameById.get(r.org_id) ?? '(不明な組織)',
      amountMonthlyJpy: r.amount_monthly_jpy,
      addMembers: r.add_members,
      addLineGroups: r.add_line_groups,
      addExternalChatGroups: r.add_external_chat_groups,
      approvedAt: r.approved_at ?? null,
      stripeSyncStatus: r.stripe_sync_status ?? 'n/a',
    })),
  }
}

/** 当社の作業対象（依頼中/提示中）の一覧。 */
export async function listOpenQuotes(): Promise<BillingQuoteRow[]> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .select(SELECT_COLUMNS)
    .in('status', OPEN_STATUSES)
    .order('requested_at', { ascending: true })
    .limit(100)

  if (error || !data) return []
  return data as unknown as BillingQuoteRow[]
}

/** 期待する現在状態を条件に含めた遷移（負けは false＝二重操作を静かに無視できる）。 */
async function transition(
  quoteId: string,
  from: BillingQuoteStatus[],
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', quoteId)
    .in('status', from)
    .select('id')

  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

/** route が org 越権を弾くための所属確認。 */
export async function getQuoteOrgId(quoteId: string): Promise<string | null> {
  const { data, error } = await admin()
    .from('billing_quotes')
    .select('org_id')
    .eq('id', quoteId)
    .maybeSingle()

  if (error || !data) return null
  return (data as { org_id: string }).org_id
}
