/**
 * 会員登録後の「節目（マイルストーン）」カタログと、運営画面向けのファネル集計（純関数）。
 *
 * - キーと意味は DB（org_milestones.milestone の CHECK 制約 / reconcile_org_milestones()）と
 *   一致させる。追加するときは migration と両方を更新する。
 * - データ取得は page.tsx 側（admin client で admin_org_milestone_stats() を呼ぶ）。
 *   ここは行を画面が読める形に組み替えるだけ。
 */
import { getAcquisitionChannelLabel } from '@/lib/acquisition/firstTouch'

export type MilestoneKey =
  | 'org_created'
  | 'project_created'
  | 'first_task'
  | 'tasks_10'
  | 'team_invited'
  | 'client_invited'
  | 'anyone_invited'
  | 'task_published'
  | 'portal_previewed'
  | 'line_requested'
  | 'line_granted'
  | 'line_linked'
  | 'chat_group_connected'
  | 'ai_configured'
  | 'first_ai_task'
  | 'tool_connected'
  | 'api_key_created'
  | 'retained_7d'
  | 'retained_30d'
  | 'quote_requested'
  | 'paid'
  | 'canceled'

export type MilestoneGroup = 'setup' | 'team' | 'client' | 'secretary' | 'integration' | 'usage' | 'billing'

export const MILESTONE_GROUP_LABEL: Readonly<Record<MilestoneGroup, string>> = {
  setup: '初期設定',
  team: 'チーム',
  client: '相手先',
  secretary: 'チャット秘書',
  integration: '連携',
  usage: '定着',
  billing: '課金',
}

export interface MilestoneDef {
  key: MilestoneKey
  label: string
  group: MilestoneGroup
  /** 運営向けの一言（どう判定しているか） */
  description: string
}

/** 表示順＝この配列の順 */
export const MILESTONE_CATALOG: readonly MilestoneDef[] = [
  { key: 'org_created', label: '組織を作成', group: 'setup', description: '会員登録のあと、組織名を入れて作成した' },
  { key: 'project_created', label: '最初のプロジェクトを作成', group: 'setup', description: '初期設定が終わり、アプリ画面に入った' },
  { key: 'first_task', label: '最初のタスクを作成', group: 'setup', description: 'サンプル以外のタスクを1件作った' },
  { key: 'tasks_10', label: 'タスクが10件に到達', group: 'usage', description: 'サンプル以外のタスクが10件になった' },
  { key: 'team_invited', label: 'チームメンバーを招待', group: 'team', description: 'メンバー宛の招待を送った（または2人目が参加した）' },
  { key: 'client_invited', label: '相手先を招待', group: 'client', description: '相手先宛の招待を送った（または相手先が参加した）' },
  { key: 'anyone_invited', label: '誰かを招待', group: 'team', description: 'チームか相手先のどちらかを招待した（早い方）' },
  { key: 'task_published', label: 'タスクを相手先に公開', group: 'client', description: 'タスクを相手先に見える設定にした' },
  { key: 'portal_previewed', label: '相手先の画面をプレビュー', group: 'client', description: '相手先からどう見えるかを確認した' },
  { key: 'line_requested', label: '共通LINEを申込', group: 'secretary', description: '共通LINEの利用を申し込んだ' },
  { key: 'line_granted', label: '共通LINEを開通', group: 'secretary', description: '運営が開通した' },
  { key: 'line_linked', label: 'LINE秘書と連携', group: 'secretary', description: '本人が LINE 秘書と連携した' },
  { key: 'chat_group_connected', label: 'チャットのグループを接続', group: 'secretary', description: 'LINE / Slack / Chatwork / Google Chat のグループをつないだ' },
  { key: 'ai_configured', label: 'AI連携を設定', group: 'secretary', description: '会話からタスクを拾う AI を設定した' },
  { key: 'first_ai_task', label: 'AIが最初のタスクを拾った', group: 'secretary', description: '会話から自動でタスク候補が出た' },
  { key: 'tool_connected', label: 'ツール連携', group: 'integration', description: 'Google Tasks / Notion などをつないだ' },
  { key: 'api_key_created', label: 'APIキーを発行', group: 'integration', description: 'CLI / API を使い始めた' },
  { key: 'retained_7d', label: '7日後も利用', group: 'usage', description: '作成から7日以上たった後もタスクを触っている' },
  { key: 'retained_30d', label: '30日後も利用', group: 'usage', description: '作成から30日以上たった後もタスクを触っている' },
  { key: 'quote_requested', label: '見積もりを依頼', group: 'billing', description: '有料化の相談があった' },
  { key: 'paid', label: '有料化', group: 'billing', description: '有料プランになった（見積もり承認を含む）' },
  { key: 'canceled', label: '解約', group: 'billing', description: '課金を解約した' },
]

const CATALOG_BY_KEY: ReadonlyMap<string, MilestoneDef> = new Map(MILESTONE_CATALOG.map((m) => [m.key, m]))

export function getMilestoneLabel(key: string): string {
  return CATALOG_BY_KEY.get(key)?.label ?? key
}

export function getMilestoneDef(key: string): MilestoneDef | undefined {
  return CATALOG_BY_KEY.get(key)
}

/**
 * メインのファネル（登録 → 定着 → 有料化の背骨）。
 * 「LINE を使わない組織」も落ちないよう、チャネル依存の節目は入れない。
 */
export const FUNNEL_STEPS: readonly MilestoneKey[] = [
  'org_created',
  'project_created',
  'first_task',
  'anyone_invited',
  'retained_7d',
  'paid',
]

/** 流入経路別の表に出す段 */
export const CHANNEL_TABLE_STEPS: readonly MilestoneKey[] = [
  'project_created',
  'first_task',
  'anyone_invited',
  'chat_group_connected',
  'retained_7d',
  'paid',
]

/** admin_org_milestone_stats() の 1 行 */
export interface MilestoneStatRow {
  /** null=全体 / それ以外=流入経路 */
  channel: string | null
  /** '_cohort' は分母（組織数）を運ぶ疑似行 */
  milestone: string
  org_count: number
  reached_count: number
  median_days: number | null
}

export interface FunnelStep {
  key: MilestoneKey
  label: string
  reached: number
  /** コホート全体に対する到達率（%） */
  rateOfCohort: number
  /** 直前の段に対する到達率（%）。先頭は 100 */
  rateOfPrev: number
  /** 組織作成からの中央値（日）。未到達なら null */
  medianDays: number | null
}

export interface MilestoneSummary {
  key: MilestoneKey
  label: string
  group: MilestoneGroup
  groupLabel: string
  description: string
  reached: number
  rate: number
  medianDays: number | null
}

export interface ChannelFunnel {
  channel: string
  label: string
  orgCount: number
  steps: Array<{ key: MilestoneKey; reached: number; rate: number }>
}

export interface FunnelReport {
  cohortOrgCount: number
  funnel: FunnelStep[]
  all: MilestoneSummary[]
  byChannel: ChannelFunnel[]
}

function pct(n: number, d: number): number {
  if (d <= 0) return 0
  return Math.round((n / d) * 1000) / 10
}

export function buildFunnelReport(rows: MilestoneStatRow[]): FunnelReport {
  const total = new Map<string, MilestoneStatRow>()
  const perChannel = new Map<string, Map<string, MilestoneStatRow>>()
  for (const r of rows) {
    if (r.channel == null) {
      total.set(r.milestone, r)
      continue
    }
    let m = perChannel.get(r.channel)
    if (!m) {
      m = new Map()
      perChannel.set(r.channel, m)
    }
    m.set(r.milestone, r)
  }

  const cohortOrgCount = Number(total.get('_cohort')?.org_count ?? 0)

  const reachedOf = (key: string) => Number(total.get(key)?.reached_count ?? 0)
  const medianOf = (key: string): number | null => {
    const v = total.get(key)?.median_days
    return v == null ? null : Number(v)
  }

  const funnel: FunnelStep[] = []
  let prev = cohortOrgCount
  for (const key of FUNNEL_STEPS) {
    const reached = reachedOf(key)
    funnel.push({
      key,
      label: getMilestoneLabel(key),
      reached,
      rateOfCohort: pct(reached, cohortOrgCount),
      rateOfPrev: funnel.length === 0 ? (cohortOrgCount > 0 ? 100 : 0) : pct(reached, prev),
      medianDays: medianOf(key),
    })
    prev = reached
  }

  const all: MilestoneSummary[] = MILESTONE_CATALOG.map((def) => ({
    key: def.key,
    label: def.label,
    group: def.group,
    groupLabel: MILESTONE_GROUP_LABEL[def.group],
    description: def.description,
    reached: reachedOf(def.key),
    rate: pct(reachedOf(def.key), cohortOrgCount),
    medianDays: medianOf(def.key),
  }))

  const byChannel: ChannelFunnel[] = Array.from(perChannel.entries())
    .map(([channel, m]) => {
      const orgCount = Number(m.get('_cohort')?.org_count ?? 0)
      return {
        channel,
        label: getAcquisitionChannelLabel(channel),
        orgCount,
        steps: CHANNEL_TABLE_STEPS.map((key) => {
          const reached = Number(m.get(key)?.reached_count ?? 0)
          return { key, reached, rate: pct(reached, orgCount) }
        }),
      }
    })
    .filter((c) => c.orgCount > 0)
    .sort((a, b) => b.orgCount - a.orgCount || a.channel.localeCompare(b.channel))

  return { cohortOrgCount, funnel, all, byChannel }
}

/** org_milestones の行（組織詳細ページ用） */
export interface OrgMilestoneRow {
  milestone: string
  reached_at: string
  source: string
}

export interface MilestoneTimelineItem {
  key: MilestoneKey
  label: string
  group: MilestoneGroup
  groupLabel: string
  reachedAt: string | null
  /** 組織作成から何日後か（小数1桁）。未到達なら null */
  daysFromCreation: number | null
  /** 'app'=アプリが直接記録 / 'reconcile'=元データから導出 */
  source: string | null
}

/**
 * 組織1件の節目を「到達済み（到達順）→ 未到達（カタログ順）」で並べる。
 */
export function buildMilestoneTimeline(rows: OrgMilestoneRow[], orgCreatedAt: string): MilestoneTimelineItem[] {
  const createdMs = new Date(orgCreatedAt).getTime()
  const byKey = new Map(rows.map((r) => [r.milestone, r]))

  const items: MilestoneTimelineItem[] = MILESTONE_CATALOG.map((def) => {
    const row = byKey.get(def.key)
    const reachedAt = row?.reached_at ?? null
    const days =
      reachedAt && Number.isFinite(createdMs)
        ? Math.max(0, Math.round(((new Date(reachedAt).getTime() - createdMs) / 86400000) * 10) / 10)
        : null
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      groupLabel: MILESTONE_GROUP_LABEL[def.group],
      reachedAt,
      daysFromCreation: days,
      source: row?.source ?? null,
    }
  })

  const reached = items
    .filter((i) => i.reachedAt)
    .sort((a, b) => new Date(a.reachedAt!).getTime() - new Date(b.reachedAt!).getTime())
  const pending = items.filter((i) => !i.reachedAt)
  return [...reached, ...pending]
}
