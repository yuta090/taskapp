import { describe, it, expect } from 'vitest'
import {
  MILESTONE_CATALOG,
  FUNNEL_STEPS,
  CHANNEL_TABLE_STEPS,
  getMilestoneLabel,
  buildFunnelReport,
  buildMilestoneTimeline,
  type MilestoneStatRow,
} from '@/lib/analytics/milestones'

/**
 * 節目カタログとファネル集計（純関数）。
 * DB の admin_org_milestone_stats() が返す行（channel null=全体 / '_cohort'=分母）を
 * 画面が読む形に組み替える。
 */

function row(partial: Partial<MilestoneStatRow> & { milestone: string }): MilestoneStatRow {
  return { channel: null, org_count: 0, reached_count: 0, median_days: null, ...partial }
}

describe('MILESTONE_CATALOG', () => {
  it('キーが重複せず、DB の CHECK 制約と同じ 22 個ある', () => {
    const keys = MILESTONE_CATALOG.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(22)
  })

  it('ファネルの段はすべてカタログに存在する', () => {
    const keys = new Set(MILESTONE_CATALOG.map((m) => m.key))
    for (const k of FUNNEL_STEPS) expect(keys.has(k)).toBe(true)
    for (const k of CHANNEL_TABLE_STEPS) expect(keys.has(k)).toBe(true)
  })

  it('未知のキーはそのまま返す（表示が壊れない）', () => {
    expect(getMilestoneLabel('first_task')).toBe('最初のタスクを作成')
    expect(getMilestoneLabel('something_new')).toBe('something_new')
  })
})

describe('buildFunnelReport', () => {
  const rows: MilestoneStatRow[] = [
    row({ milestone: '_cohort', org_count: 10, reached_count: 10 }),
    row({ milestone: 'org_created', org_count: 10, reached_count: 10, median_days: 0 }),
    row({ milestone: 'project_created', org_count: 10, reached_count: 8, median_days: 0.1 }),
    row({ milestone: 'first_task', org_count: 10, reached_count: 4, median_days: 1.5 }),
    row({ milestone: 'paid', org_count: 10, reached_count: 1, median_days: 20 }),
    row({ channel: 'task6_article', milestone: '_cohort', org_count: 6, reached_count: 6 }),
    row({ channel: 'task6_article', milestone: 'org_created', org_count: 6, reached_count: 6 }),
    row({ channel: 'task6_article', milestone: 'first_task', org_count: 6, reached_count: 3 }),
    row({ channel: 'unknown', milestone: '_cohort', org_count: 4, reached_count: 4 }),
    row({ channel: 'unknown', milestone: 'org_created', org_count: 4, reached_count: 4 }),
    row({ channel: 'unknown', milestone: 'first_task', org_count: 4, reached_count: 1 }),
  ]

  it('分母はコホートの組織数', () => {
    const report = buildFunnelReport(rows)
    expect(report.cohortOrgCount).toBe(10)
  })

  it('メインファネルは FUNNEL_STEPS の順で、累積到達（_funnel 行）から全体比と直前段比を出す', () => {
    const withFunnel: MilestoneStatRow[] = [
      ...rows,
      row({ milestone: '_funnel:org_created', org_count: 10, reached_count: 10 }),
      row({ milestone: '_funnel:project_created', org_count: 10, reached_count: 8 }),
      // first_task 単独では 4 件だが、project_created も踏んでいるのは 3 件
      row({ milestone: '_funnel:first_task', org_count: 10, reached_count: 3 }),
      row({ milestone: '_funnel:anyone_invited', org_count: 10, reached_count: 1 }),
      row({ milestone: '_funnel:retained_7d', org_count: 10, reached_count: 1 }),
      // paid 単独は 1 件だが、前の段を全て踏んだ組織は 0
      row({ milestone: '_funnel:paid', org_count: 10, reached_count: 0 }),
    ]
    const report = buildFunnelReport(withFunnel)
    expect(report.funnel.map((s) => s.key)).toEqual([...FUNNEL_STEPS])
    const first = report.funnel[0]
    expect(first.key).toBe('org_created')
    expect(first.reached).toBe(10)
    expect(first.rateOfCohort).toBe(100)
    expect(first.rateOfPrev).toBe(100)

    const firstTask = report.funnel.find((s) => s.key === 'first_task')!
    expect(firstTask.reachedIsCumulative).toBe(true)
    expect(firstTask.reached).toBe(3)
    expect(firstTask.reachedAny).toBe(4)
    expect(firstTask.rateOfCohort).toBe(30)
    // 直前段 project_created(8) に対して 3 → 37.5%
    expect(firstTask.rateOfPrev).toBe(37.5)
    expect(firstTask.medianDays).toBe(1.5)

    const paid = report.funnel.find((s) => s.key === 'paid')!
    expect(paid.reached).toBe(0)
    expect(paid.reachedAny).toBe(1)
  })

  it('_funnel 行が無ければ独立の到達数で代用し、その旨を返す', () => {
    const report = buildFunnelReport(rows)
    const firstTask = report.funnel.find((s) => s.key === 'first_task')!
    expect(firstTask.reachedIsCumulative).toBe(false)
    expect(firstTask.reached).toBe(4)
    expect(firstTask.rateOfCohort).toBe(40)
  })

  it('行が無い節目は 0 件として出る（未到達でも段が消えない）', () => {
    const report = buildFunnelReport(rows)
    const invited = report.funnel.find((s) => s.key === 'anyone_invited')!
    expect(invited.reached).toBe(0)
    expect(invited.rateOfCohort).toBe(0)
    expect(invited.medianDays).toBeNull()
  })

  it('すべての節目はカタログ順に、グループ名つきで並ぶ', () => {
    const report = buildFunnelReport(rows)
    expect(report.all).toHaveLength(MILESTONE_CATALOG.length)
    expect(report.all[0].key).toBe('org_created')
    const paid = report.all.find((m) => m.key === 'paid')!
    expect(paid.groupLabel).toBe('課金')
    expect(paid.reached).toBe(1)
    expect(paid.rate).toBe(10)
  })

  it('流入経路別は組織数の多い順・各段の到達率つき', () => {
    const report = buildFunnelReport(rows)
    expect(report.byChannel.map((c) => c.channel)).toEqual(['task6_article', 'unknown'])
    const task6 = report.byChannel[0]
    expect(task6.label).toBe('記事（TASK6）')
    expect(task6.orgCount).toBe(6)
    const step = task6.steps.find((s) => s.key === 'first_task')!
    expect(step.reached).toBe(3)
    expect(step.rate).toBe(50)
  })

  it('分母 0 のときは率を 0 にして割り算で壊れない', () => {
    const report = buildFunnelReport([])
    expect(report.cohortOrgCount).toBe(0)
    expect(report.funnel[0].rateOfCohort).toBe(0)
    expect(report.byChannel).toEqual([])
  })
})

describe('buildMilestoneTimeline', () => {
  it('到達済みは到達順、未到達はカタログ順で後ろに並ぶ', () => {
    const timeline = buildMilestoneTimeline(
      [
        { milestone: 'first_task', reached_at: '2026-08-02T00:00:00Z', source: 'reconcile' },
        { milestone: 'org_created', reached_at: '2026-08-01T00:00:00Z', source: 'reconcile' },
        { milestone: 'portal_previewed', reached_at: '2026-08-03T00:00:00Z', source: 'app' },
      ],
      '2026-08-01T00:00:00Z',
    )
    const reached = timeline.filter((t) => t.reachedAt)
    expect(reached.map((t) => t.key)).toEqual(['org_created', 'first_task', 'portal_previewed'])
    expect(reached[1].daysFromCreation).toBe(1)
    expect(timeline.length).toBe(MILESTONE_CATALOG.length)
    expect(timeline[timeline.length - 1].reachedAt).toBeNull()
  })
})
