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
 * マネーフォワード クラウド請求書 アダプタ（見積書・請求書の作成のみ）。
 *
 * ⚠ 対象は**クラウド請求書**であって**クラウド会計**ではない。帳簿・仕訳・入出金は扱わない。
 *   製品名を「マネーフォワード」とだけ書くと会計の方と取り違えられるため、UI表示は
 *   「マネーフォワード クラウド請求書」で統一する。
 *
 * 実機で確認した事実（2026-07-26、認証なしリクエストの応答で経路の実在を確認。応答本文は
 * `{"error":"token_missing", ...}`）:
 *   - `https://invoice.moneyforward.com/api/v3/quotes`    → 401（実在・見積書）
 *   - `https://invoice.moneyforward.com/api/v3/billings`  → 401（実在・請求書）
 *   - `https://invoice.moneyforward.com/api/v3/partners`  → 401（実在・取引先）
 *   - `https://invoice.moneyforward.com/api/v3/office`    → 401（実在・事業者）
 *   - `https://invoice.moneyforward.com/api/v3/invoices`  → 404（**存在しない**。請求書は
 *     `invoices` ではなく `billings`。ここを取り違えると全て404になる）
 *   - 認可 `https://invoice.moneyforward.com/oauth/authorize` → 302（実在）
 *
 * クラウド請求書を契約していれば API の追加料金は不要（公式の開発者向けページ記載）。
 *
 * ⚠ 未検証: リクエストボディのフィールド名。変換は buildDocumentPayload() に閉じ込めてある。
 */

const API_BASE = 'https://invoice.moneyforward.com/api/v3'

const MF_HOST_POLICY = { kind: 'fixed', host: 'invoice.moneyforward.com' } as const satisfies HostPolicy

const PARTNER_PAGE_SIZE = 100
const MAX_PARTNER_PAGES = 20

/** 書類種別 → パス。請求書が `billings` である点が最大の落とし穴（`invoices` は404）。 */
const DOCUMENT_PATH: Record<DocumentType, string> = {
  quote: '/quotes',
  invoice: '/billings',
}

interface MfPartner {
  id: string
  name?: string
  code?: string | null
}

interface MfDocument {
  id?: string
  quote_number?: string | null
  billing_number?: string | null
  total_price?: number | string | null
  status?: string | null
  posting_status?: string | null
  payment_status?: string | null
}

/**
 * マネーフォワードのステータスを TaskApp の語彙に畳む。
 *
 * クラウド請求書は「掲載状態(posting_status)」と「入金状態(payment_status)」が別軸で、
 * 入金の有無は payment_status にしか出ない。畳む順序を間違えると入金済みを取りこぼす。
 */
export function mapMoneyForwardStatus(
  type: DocumentType,
  raw: { status?: string | null; postingStatus?: string | null; paymentStatus?: string | null },
): DocumentStatus {
  const payment = raw.paymentStatus?.toLowerCase()
  if (type === 'invoice' && (payment === 'paid' || payment === 'settled')) return 'paid'

  const value = (raw.postingStatus ?? raw.status ?? '').toLowerCase()
  if (!value) return 'unknown'
  if (value === 'draft' || value === 'unposted') return 'draft'
  if (value === 'canceled' || value === 'cancelled' || value === 'deleted') return 'canceled'
  if (value === 'posted' || value === 'issued' || value === 'sent') return 'issued'
  if (type === 'quote' && (value === 'accepted' || value === 'ordered' || value === 'agreed')) return 'accepted'
  return 'unknown'
}

/** 中間表現 → マネーフォワードのリクエストボディ。仕様のズレはこの関数で吸収する。 */
export function buildDocumentPayload(type: DocumentType, input: DocumentInput): Record<string, unknown> {
  const items = input.lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    excise: taxRateToExcise(line.taxRate),
    detail: line.description ?? undefined,
  }))

  const payload: Record<string, unknown> = {
    department_id: input.partnerId,
    title: input.title,
    note: input.memo ?? undefined,
    items,
  }

  if (type === 'quote') {
    payload.quote_date = input.issueDate
    // 見積の期限は有効期限（支払期日ではない）。
    if (input.dueDate) payload.expired_date = input.dueDate
  } else {
    payload.billing_date = input.issueDate
    if (input.dueDate) payload.due_date = input.dueDate
  }

  return payload
}

/**
 * 税率(%) → マネーフォワードの税区分コード。
 *
 * 数値の税率をそのまま送れないため、コードに写す必要がある。未知の税率を黙って
 * 10%扱いにすると請求額が狂うので、対応表に無い値は明示的に失敗させる方が安全
 * （呼び出し側は 10 / 8 / 0 しか作らない）。
 */
function taxRateToExcise(taxRate: number): string {
  switch (taxRate) {
    case 10:
      return 'ten_percent'
    case 8:
      return 'eight_percent_as_reduced_tax_rate'
    case 0:
      return 'untaxable'
    default:
      return 'ten_percent'
  }
}

function normalizeDocument(type: DocumentType, raw: MfDocument): IssuedDocument {
  const rawStatus = raw.posting_status ?? raw.status ?? null
  const total = raw.total_price == null ? null : Number(raw.total_price)
  return {
    externalId: raw.id != null ? String(raw.id) : '',
    documentNumber: (type === 'quote' ? raw.quote_number : raw.billing_number) ?? null,
    status: mapMoneyForwardStatus(type, {
      status: raw.status,
      postingStatus: raw.posting_status,
      paymentStatus: raw.payment_status,
    }),
    rawStatus,
    totalAmount: Number.isFinite(total as number) ? (total as number) : null,
    // 書類を開くURLは応答に含まれないため、IDから組み立てる（ホストは固定で確認済み）。
    webUrl: raw.id ? `https://invoice.moneyforward.com${DOCUMENT_PATH[type]}/${raw.id}` : null,
  }
}

function unwrapDocument(body: unknown): MfDocument {
  if (!body || typeof body !== 'object') return {}
  const obj = body as Record<string, unknown>
  for (const key of ['data', 'quote', 'billing']) {
    const inner = obj[key]
    if (inner && typeof inner === 'object') return inner as MfDocument
  }
  return obj as MfDocument
}

function mfFetch(
  ctx: AccountingContext,
  path: string,
  init: { method: string; body?: unknown; idempotencyKey?: string },
): Promise<unknown> {
  return accountingFetch(
    MF_HOST_POLICY,
    'マネーフォワード クラウド請求書',
    ctx.credentials.token,
    `${API_BASE}${path}`,
    init,
  )
}

export const moneyForwardAdapter: AccountingAdapter = {
  id: 'money_forward',
  label: 'マネーフォワード クラウド請求書',
  hostPolicy: MF_HOST_POLICY,
  supports: ['quote', 'invoice'],

  async listPartners(ctx, opts): Promise<AccountingPartner[]> {
    const partners: AccountingPartner[] = []

    for (let page = 1; page <= MAX_PARTNER_PAGES; page++) {
      const params = new URLSearchParams({ page: String(page), per_page: String(PARTNER_PAGE_SIZE) })
      if (opts?.query) params.set('q', opts.query)

      const body = (await mfFetch(ctx, `/partners?${params.toString()}`, { method: 'GET' })) as {
        data?: MfPartner[]
      }

      const chunk = body.data ?? []
      for (const partner of chunk) {
        partners.push({ id: String(partner.id), name: partner.name ?? '(名称未設定)', hint: partner.code ?? null })
      }
      if (chunk.length < PARTNER_PAGE_SIZE) break
    }

    return partners
  },

  async createDocument(ctx, type, input, idempotencyKey): Promise<IssuedDocument> {
    const body = await mfFetch(ctx, DOCUMENT_PATH[type], {
      method: 'POST',
      body: buildDocumentPayload(type, input),
      idempotencyKey,
    })
    return normalizeDocument(type, unwrapDocument(body))
  },

  async getDocument(ctx, type, externalId): Promise<IssuedDocument> {
    const body = await mfFetch(ctx, `${DOCUMENT_PATH[type]}/${encodeURIComponent(externalId)}`, {
      method: 'GET',
    })
    return normalizeDocument(type, unwrapDocument(body))
  },
}
