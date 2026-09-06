/**
 * 招待メール文面の読み込み（server 専用）。
 * 運営が管理画面で保存した文面（email_templates）があればそれを、なければコード既定を返す。
 * DB が落ちていても招待メール自体は止めない（必ず既定へフォールバック）。
 */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  INVITE_TEMPLATE_DEFAULTS,
  INVITE_TEMPLATE_FIELD_KEYS,
  INVITE_TEMPLATE_KEYS,
  isInviteTemplateKey,
  type InviteTemplateFields,
  type InviteTemplateKey,
} from './invite'

export interface InviteTemplateRow {
  key: InviteTemplateKey
  fields: InviteTemplateFields
  /** 運営が保存した文面か（false = コード既定） */
  isCustom: boolean
  updatedAt: string | null
}

export const EMAIL_TEMPLATE_COLUMNS = 'key, subject, heading, body, cta_label, note, updated_at'

function mergeWithDefaults(key: InviteTemplateKey, row: Record<string, unknown> | undefined): InviteTemplateFields {
  const defaults = INVITE_TEMPLATE_DEFAULTS[key]
  if (!row) return { ...defaults }
  const fields = { ...defaults }
  for (const f of INVITE_TEMPLATE_FIELD_KEYS) {
    const v = row[f]
    if (typeof v === 'string') fields[f] = v
  }
  return fields
}

/** 両テンプレートを管理画面向けの形で返す */
export async function loadInviteTemplateRows(): Promise<Record<InviteTemplateKey, InviteTemplateRow>> {
  let rows: Record<string, unknown>[] = []
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('email_templates').select(EMAIL_TEMPLATE_COLUMNS)
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
    if (isInviteTemplateKey(r.key)) byKey.set(r.key, r)
  }

  const out = {} as Record<InviteTemplateKey, InviteTemplateRow>
  for (const key of INVITE_TEMPLATE_KEYS) {
    const row = byKey.get(key)
    out[key] = {
      key,
      fields: mergeWithDefaults(key, row),
      isCustom: Boolean(row),
      updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : null,
    }
  }
  return out
}

/** 送信用: 指定キーの文面を返す（保存が無ければ既定） */
export async function loadInviteTemplate(key: InviteTemplateKey): Promise<InviteTemplateFields> {
  const rows = await loadInviteTemplateRows()
  return rows[key].fields
}
