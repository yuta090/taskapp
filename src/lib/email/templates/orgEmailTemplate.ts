/**
 * 事務所(org)ごとの招待メール文面の読み込み（server 専用）。
 *
 * 文面の決まり方は3段:
 *   1. 事務所が保存したもの（org_email_templates）
 *   2. 運営が管理画面で保存したもの（email_templates）
 *   3. コード既定（registry.ts の台帳）
 *
 * 事務所の行はキャッシュしない。招待メールは1通ずつしか送らないので読み込みは1回増えるだけで、
 * そのかわり「保存した直後の1通目から新しい文面」になる（運営側の30秒の記憶は据え置き）。
 * DB が落ちていても 2→3 に落ちて送信は止めない。
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { TEMPLATE_FIELD_KEYS, type TemplateFields } from './core'
import { getEmailTemplateDef } from './registry'
import { loadEmailTemplateRows } from './loadEmailTemplate'

/** どこの文面が使われたか（画面の表示用） */
export type TemplateSource = 'org' | 'platform' | 'code'

/**
 * 事務所が上書きできるキー。自分が送る招待メールだけに限る
 * （承認依頼・請求・認証メールは運営の文面のまま）。DB 側の CHECK と対で守る。
 */
export const ORG_OVERRIDABLE_TEMPLATE_KEYS = ['invite_client', 'invite_member'] as const
export type OrgOverridableTemplateKey = (typeof ORG_OVERRIDABLE_TEMPLATE_KEYS)[number]

export function isOrgOverridableTemplateKey(key: string): key is OrgOverridableTemplateKey {
  return (ORG_OVERRIDABLE_TEMPLATE_KEYS as readonly string[]).includes(key)
}

export const ORG_EMAIL_TEMPLATE_COLUMNS = 'subject, heading, body, cta_label, note, updated_at'

function mergeOver(base: TemplateFields, row: Record<string, unknown>): TemplateFields {
  const fields = { ...base }
  for (const f of TEMPLATE_FIELD_KEYS) {
    const v = row[f]
    if (typeof v === 'string') fields[f] = v
  }
  return fields
}

async function fetchOrgRow(orgId: string, key: string): Promise<Record<string, unknown> | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('org_email_templates')
      .select(ORG_EMAIL_TEMPLATE_COLUMNS)
      .eq('org_id', orgId)
      .eq('key', key)
      .maybeSingle()
    if (error) {
      console.warn('[email-templates] 事務所の文面を読めなかったため既定の文面を使います:', error.message)
      return null
    }
    return (data as Record<string, unknown> | null) ?? null
  } catch (err) {
    console.warn('[email-templates] 事務所の文面を読めなかったため既定の文面を使います:', err)
    return null
  }
}

/** 運営の保存 → コード既定 の順で決まる「事務所より下の段」の文面 */
async function loadBaseTemplate(key: string): Promise<{ fields: TemplateFields; source: TemplateSource }> {
  const rows = await loadEmailTemplateRows()
  const row = rows[key]
  return { fields: row.fields, source: row.isCustom ? 'platform' : 'code' }
}

/**
 * 事務所が保存した文面（欠けている項目は下の段の文面で補う）。保存が無ければ null。
 */
export async function loadOrgEmailTemplate(orgId: string, key: string): Promise<TemplateFields | null> {
  if (!isOrgOverridableTemplateKey(key)) return null
  const row = await fetchOrgRow(orgId, key)
  if (!row) return null
  const base = await loadBaseTemplate(key)
  return mergeOver(base.fields, row)
}

/**
 * 実際に送るときに使う文面と、それがどの段のものかを返す。
 * orgId が分からないときや、事務所が触れないキーのときは下の段だけで決める。
 */
export async function resolveEmailTemplate(
  orgId: string | null | undefined,
  key: string,
): Promise<{ fields: TemplateFields; source: TemplateSource }> {
  if (!getEmailTemplateDef(key)) throw new Error(`[email-templates] unknown template key: ${key}`)

  if (!orgId || !isOrgOverridableTemplateKey(key)) return loadBaseTemplate(key)

  // 事務所の行と運営の行は互いに独立なので並列に読む（送信の待ち時間を1往復ぶん減らす）
  const [row, base] = await Promise.all([fetchOrgRow(orgId, key), loadBaseTemplate(key)])
  if (!row) return base
  return { fields: mergeOver(base.fields, row), source: 'org' }
}
