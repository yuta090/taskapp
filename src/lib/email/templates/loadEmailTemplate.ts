/**
 * メール文面の読み込み（server 専用）。
 * 運営が管理画面で保存した文面（email_templates）があればそれを、なければ台帳（registry）の既定を返す。
 * DB が落ちていてもメール自体は止めない（必ず既定へフォールバック）。
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { TEMPLATE_FIELD_KEYS, type TemplateFields } from './core'
import { EMAIL_TEMPLATE_DEFS, EMAIL_TEMPLATE_KEYS, getEmailTemplateDef, isEmailTemplateKey } from './registry'

export interface EmailTemplateRow {
  key: string
  fields: TemplateFields
  /** 運営が保存した文面か（false = コード既定） */
  isCustom: boolean
  updatedAt: string | null
}

export const EMAIL_TEMPLATE_COLUMNS = 'key, subject, heading, body, cta_label, note, updated_at'

/**
 * 送信のたびに全文面を読みに行かないための短い記憶（同一プロセス内・30秒）。
 * 日次リマインドは宛先ぶん同時に送るので、同じ問い合わせが N 本並ぶのを1本に束ねる（single-flight）。
 * 運営が保存した文面の反映が最大30秒遅れるだけで、送信は止まらない。管理画面は fresh:true で常に読み直す。
 */
const CACHE_TTL_MS = 30_000
let cached: { at: number; rows: Record<string, EmailTemplateRow> } | null = null
let inflight: Promise<Record<string, EmailTemplateRow>> | null = null

/** テスト用: 記憶を捨てる */
export function resetEmailTemplateCache() {
  cached = null
  inflight = null
}

function mergeWithDefaults(defaults: TemplateFields, row: Record<string, unknown> | undefined): TemplateFields {
  if (!row) return { ...defaults }
  const fields = { ...defaults }
  for (const f of TEMPLATE_FIELD_KEYS) {
    const v = row[f]
    if (typeof v === 'string') fields[f] = v
  }
  return fields
}

/** 台帳の全テンプレートを管理画面向けの形で返す。fresh:true で記憶を使わず読み直す */
export async function loadEmailTemplateRows(opts: { fresh?: boolean } = {}): Promise<Record<string, EmailTemplateRow>> {
  if (!opts.fresh) {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows
    if (inflight) return inflight
  }
  const run = fetchEmailTemplateRows().then((rows) => {
    cached = { at: Date.now(), rows }
    return rows
  })
  if (!opts.fresh) {
    inflight = run
    run.finally(() => {
      if (inflight === run) inflight = null
    })
  }
  return run
}

async function fetchEmailTemplateRows(): Promise<Record<string, EmailTemplateRow>> {
  let rows: Record<string, unknown>[] = []
  try {
    const admin = createAdminClient()
    // 台帳のキーだけ取る（台帳から外したキーの行が残っていても読まない）
    const { data, error } = await admin.from('email_templates').select(EMAIL_TEMPLATE_COLUMNS).in('key', [...EMAIL_TEMPLATE_KEYS])
    if (error) {
      console.warn('[email-templates] 読み込みに失敗したため既定文面を使います:', error.message)
    } else {
      rows = (data ?? []) as Record<string, unknown>[]
    }
  } catch (err) {
    console.warn('[email-templates] 読み込みに失敗したため既定文面を使います:', err)
  }

  const byKey = new Map<string, Record<string, unknown>>()
  for (const r of rows) {
    if (isEmailTemplateKey(r.key)) byKey.set(r.key, r)
  }

  const out: Record<string, EmailTemplateRow> = {}
  for (const def of EMAIL_TEMPLATE_DEFS) {
    const row = byKey.get(def.key)
    out[def.key] = {
      key: def.key,
      fields: mergeWithDefaults(def.defaults, row),
      isCustom: Boolean(row),
      updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : null,
    }
  }
  return out
}

/** 送信用: 指定キーの文面を返す（保存が無ければ既定。台帳外キーはプログラムミスなので例外） */
export async function loadEmailTemplate(key: string): Promise<TemplateFields> {
  const def = getEmailTemplateDef(key)
  if (!def) throw new Error(`[email-templates] unknown template key: ${key}`)
  const rows = await loadEmailTemplateRows()
  return rows[key].fields
}
