import { accountingFetch } from '@/lib/accounting/http'
import type { HostPolicy } from '@/lib/task-sync/types'
import type {
  AccountingAdapter,
  AccountingContext,
  AccountingPartner,
  DocumentInput,
  DocumentStatus,
  DocumentType,
  IssuedDocument,
} from '@/lib/accounting/types'

/**
 * Misoca アダプタ（見積書・請求書の作成のみ）。
 *
 * 実機で確認した事実（2026-07-26、認証なしリクエストの応答コードで経路の実在を確認）:
 *   - `https://app.misoca.jp/api/v3/invoices`       → 401（実在・請求書の一覧）
 *   - `https://app.misoca.jp/api/v3/estimates`      → 401（実在・見積書）
 *   - `https://app.misoca.jp/api/v3/contact_groups` → 401（実在・取引先）
 *   - 認可 `https://app.misoca.jp/oauth2/authorize` → 302（実在）
 *   - トークン `https://app.misoca.jp/oauth2/token`（POST専用のためGETでは404）
 *   - OAuthアプリの登録は `https://app.misoca.jp/oauth2/applications`
 *
 * ⚠ Misoca の請求書は**作成だけ単数形パス**（公式ドキュメント doc.misoca.jp/v3 の記載:
 *   一覧は `GET /invoices`、取得は `GET /invoice/{id}`、作成は `POST /invoice`）。見積書は
 *   `POST /estimates`（複数形）で、書類種別ごとに規則が違う。ここを揃えて書くと片方が404になる。
 *
 * 取引先は「contact（担当者）」ではなく「contact_group（取引先）」が発行の宛先単位。
 *
 * ⚠ 未検証: リクエストボディのフィールド名。変換は buildDocumentPayload() に閉じ込めてある。
 */

const API_BASE = 'https://app.misoca.jp/api/v3'

const MISOCA_HOST_POLICY = { kind: 'fixed', host: 'app.misoca.jp' } as const satisfies HostPolicy

/** ページング（RFC5988 Link ヘッダ。per_page の上限は100）。 */
const PAGE_SIZE = 100
const MAX_PARTNER_PAGES = 20

/** 作成時のパス。請求書だけ単数形（上のコメント参照）。 */
const CREATE_PATH: Record<DocumentType, string> = {
  quote: '/estimates',
  invoice: '/invoice',
}

/** 単体取得のパス。こちらは両方とも単数形。 */
const SHOW_PATH: Record<DocumentType, string> = {
  quote: '/estimate',
  invoice: '/invoice',
}

interface MisocaContactGroup {
  id: number | string
  name?: string
  code?: string | null
}

interface MisocaDocument {
  id?: number | string
  subject?: string | null
  invoice_number?: string | null
  estimate_number?: string | null
  total_amount?: number | string | null
  status?: string | null
  payment_status?: string | null
}

/**
 * Misoca のステータスを TaskApp の語彙に畳む。
 *
 * Misoca は書類の進行状態(status)と入金状態(payment_status)を別に持つ。請求書の「入金済み」は
 * payment_status 側にしか出ないため、先に見る。
 */
export function mapMisocaStatus(
  type: DocumentType,
  raw: { status?: string | null; paymentStatus?: string | null },
): DocumentStatus {
  const payment = raw.paymentStatus?.toLowerCase()
  if (type === 'invoice' && (payment === 'paid' || payment === 'settled' || payment === 'completed')) {
    return 'paid'
  }

  const value = raw.status?.toLowerCase() ?? ''
  if (!value) return 'unknown'
  if (value === 'draft' || value === 'unsaved') return 'draft'
  if (value === 'deleted' || value === 'canceled' || value === 'cancelled') return 'canceled'
  if (value === 'issued' || value === 'sent' || value === 'submitted' || value === 'printed') return 'issued'
  if (type === 'quote' && (value === 'accepted' || value === 'ordered' || value === 'agreed')) return 'accepted'
  return 'unknown'
}

/** 中間表現 → Misoca のリクエストボディ。仕様のズレはこの関数で吸収する。 */
export function buildDocumentPayload(type: DocumentType, input: DocumentInput): Record<string, unknown> {
  const items = input.lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    tax_type: taxRateToTaxType(line.taxRate),
    memo: line.description ?? undefined,
  }))

  const payload: Record<string, unknown> = {
    contact_group_id: input.partnerId,
    subject: input.title,
    issue_date: input.issueDate,
    items,
    body_memo: input.memo ?? undefined,
  }

  if (input.dueDate) {
    // 請求書は支払期日、見積書は有効期限。同じ「期限」でも意味が違うのでキーを分ける。
    if (type === 'invoice') payload.payment_due_on = input.dueDate
    else payload.expired_date = input.dueDate
  }

  return payload
}

/**
 * 税率(%) → Misoca の税区分。
 * 未知の税率は標準税率へ倒す（呼び出し側は 10 / 8 / 0 しか作らない）。
 */
function taxRateToTaxType(taxRate: number): string {
  switch (taxRate) {
    case 10:
      return 'standard'
    case 8:
      return 'reduced'
    case 0:
      return 'exempt'
    default:
      return 'standard'
  }
}

function normalizeDocument(type: DocumentType, raw: MisocaDocument): IssuedDocument {
  const total = raw.total_amount == null ? null : Number(raw.total_amount)
  return {
    externalId: raw.id != null ? String(raw.id) : '',
    documentNumber: (type === 'quote' ? raw.estimate_number : raw.invoice_number) ?? null,
    status: mapMisocaStatus(type, { status: raw.status, paymentStatus: raw.payment_status }),
    rawStatus: raw.status ?? null,
    totalAmount: Number.isFinite(total as number) ? (total as number) : null,
    webUrl: raw.id ? `https://app.misoca.jp${SHOW_PATH[type]}s/${raw.id}` : null,
  }
}

function unwrapDocument(body: unknown): MisocaDocument {
  if (!body || typeof body !== 'object') return {}
  const obj = body as Record<string, unknown>
  for (const key of ['invoice', 'estimate', 'data']) {
    const inner = obj[key]
    if (inner && typeof inner === 'object') return inner as MisocaDocument
  }
  return obj as MisocaDocument
}

function misocaFetch(
  ctx: AccountingContext,
  path: string,
  init: { method: string; body?: unknown; idempotencyKey?: string },
): Promise<unknown> {
  return accountingFetch(MISOCA_HOST_POLICY, 'Misoca', ctx.credentials.token, `${API_BASE}${path}`, init)
}

export const misocaAdapter: AccountingAdapter = {
  id: 'misoca',
  label: 'Misoca',
  hostPolicy: MISOCA_HOST_POLICY,
  supports: ['quote', 'invoice'],

  async listPartners(ctx, opts): Promise<AccountingPartner[]> {
    const partners: AccountingPartner[] = []

    for (let page = 1; page <= MAX_PARTNER_PAGES; page++) {
      const params = new URLSearchParams({ page: String(page), per_page: String(PAGE_SIZE) })
      if (opts?.query) params.set('search', opts.query)

      const body = await misocaFetch(ctx, `/contact_groups?${params.toString()}`, { method: 'GET' })
      // 一覧は配列そのままで返る形と、包まれる形の両方があり得るため両対応にする。
      const chunk: MisocaContactGroup[] = Array.isArray(body)
        ? (body as MisocaContactGroup[])
        : ((body as { contact_groups?: MisocaContactGroup[] })?.contact_groups ?? [])

      for (const group of chunk) {
        partners.push({ id: String(group.id), name: group.name ?? '(名称未設定)', hint: group.code ?? null })
      }
      if (chunk.length < PAGE_SIZE) break
    }

    return partners
  },

  async createDocument(ctx, type, input, idempotencyKey): Promise<IssuedDocument> {
    const body = await misocaFetch(ctx, CREATE_PATH[type], {
      method: 'POST',
      body: buildDocumentPayload(type, input),
      idempotencyKey,
    })
    return normalizeDocument(type, unwrapDocument(body))
  },

  async getDocument(ctx, type, externalId): Promise<IssuedDocument> {
    const body = await misocaFetch(ctx, `${SHOW_PATH[type]}/${encodeURIComponent(externalId)}`, {
      method: 'GET',
    })
    return normalizeDocument(type, unwrapDocument(body))
  },
}
