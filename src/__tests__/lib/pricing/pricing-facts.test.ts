import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import facts from '@/lib/pricing/facts.json'

/**
 * 稟議パックの資料（public/docs/）が、料金の正本（facts.json）と食い違っていないか。
 *
 * 資料は PDF と Excel なので、中身を直接比べるのは重い。代わりに、作り直したときに
 * `build:approval-pack` が書き出す manifest.json と正本を突き合わせる。
 *
 * **落ちたときの直し方**: `npm run build:approval-pack` を実行して、生成物を一緒にコミットする。
 * 正本だけ直して資料が古いまま本番に出るのを、ここで止める。
 */
const manifestPath = path.join(process.cwd(), 'public/docs/manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  asOf: string
  numbers: Record<string, number>
  files: string[]
}

describe('稟議パックの資料と料金の正本', () => {
  it('資料を作った時点と、正本の as-of がそろっている', () => {
    expect(manifest.asOf).toBe(facts.asOf)
  })

  it.each([
    ['proMonthlyYen', facts.agentpm.pro.monthlyYen],
    ['proMaxMembers', facts.agentpm.pro.maxMembers],
    ['proMaxProjects', facts.agentpm.pro.maxProjects],
    ['freeMaxMembers', facts.agentpm.free.maxMembers],
    ['freeMaxProjects', facts.agentpm.free.maxProjects],
    ['aCurrentCheapest', facts.competitorA.current.cheapest.monthlyYen],
    ['aCurrentStandard', facts.competitorA.current.standard.monthlyYen],
    ['aNextCheapest', facts.competitorA.from2027.cheapest.monthlyYen],
    ['aNextStandard', facts.competitorA.from2027.standard.monthlyYen],
    ['tcoHourlyYen', facts.tco.hourlyYen],
    ['tcoProjects', facts.tco.projects],
    ['tcoReductionRate', facts.tco.reductionRate],
  ])('%s が正本と一致する（ずれていたら npm run build:approval-pack）', (key, expected) => {
    expect(manifest.numbers[key]).toBe(expected)
  })

  it('4つの資料がそろっている', () => {
    expect(manifest.files).toEqual([
      'agentpm-comparison.pdf',
      'agentpm-security.pdf',
      'agentpm-roi.xlsx',
      'agentpm-migration-plan.xlsx',
    ])
  })
})

describe('公開ページに出す数字も、正本と同じであること', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

  it('料金ページの Pro の月額が正本と同じ', () => {
    const src = read('src/app/pricing/page.tsx')
    expect(src).toContain(`¥${facts.agentpm.pro.monthlyYen.toLocaleString('ja-JP')}`)
  })

  it('比較ページに、A社の現行と新プランの月額が両方出ている', () => {
    const src = read('src/app/compare/page.tsx')
    for (const v of [
      facts.competitorA.current.cheapest.monthlyYen,
      facts.competitorA.current.standard.monthlyYen,
      facts.competitorA.from2027.cheapest.monthlyYen,
      facts.competitorA.from2027.standard.monthlyYen,
    ]) {
      expect(src).toContain(`¥${v.toLocaleString('ja-JP')}`)
    }
  })
})
