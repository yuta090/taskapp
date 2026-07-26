import { describe, it, expect } from 'vitest'
import {
  QUESTIONS_BIZ,
  QUESTIONS_SELF,
  score,
  pickFreeQuestion,
  FREE_Q_LOAD,
  VERB_KEYS,
  PROCESS_KEYS,
} from '@/lib/shindan/model'

/**
 * タスク滞留診断の採点エンジン(multica-prj/shindan-appから移植)の回帰テスト。
 * 仕様の正本: multica-prj/SHINDAN_SPEC.md
 */

describe('設問セット', () => {
  it('法人17問・個人13問', () => {
    expect(QUESTIONS_BIZ.length).toBe(17)
    expect(QUESTIONS_SELF.length).toBe(13)
  })

  it('全設問の加点先キーはt1〜t9のいずれか', () => {
    for (const q of [...QUESTIONS_BIZ, ...QUESTIONS_SELF]) {
      for (const key of Object.keys(q.w)) {
        expect(key).toMatch(/^t[1-9]$/)
      }
    }
  })
})

describe('score', () => {
  it('全問「ほとんどない」(0)なら滞留なし(none)', () => {
    const s = score('biz', QUESTIONS_BIZ.map(() => 0))
    expect(s.verdict).toBe('none')
    expect(s.top).toEqual([])
    expect(s.load).toBe(0)
    // 問題ゼロなので完遂力は全て満点
    for (const k of VERB_KEYS) expect(s.verb[k]).toBe(100)
  })

  it('全問「よくある」(2)なら全タイプ100%・量も100%', () => {
    const s = score('self', QUESTIONS_SELF.map(() => 2))
    expect(s.load).toBe(100)
    for (const k of PROCESS_KEYS) expect(s.type[k]).toBe(100)
    expect(s.top.length).toBe(2)
    expect(['B', 'C']).toContain(s.verdict)
  })

  it('量(t9)の設問だけ「よくある」なら判定C(量が中心)', () => {
    const answers = QUESTIONS_BIZ.map((q) => (q.verb === null ? 2 : 0))
    const s = score('biz', answers)
    expect(s.load).toBeGreaterThanOrEqual(50)
    expect(s.verdict).toBe('C')
  })

  it('プロセスの滞留だけなら判定A(仕組みで対応できる)', () => {
    const answers = QUESTIONS_BIZ.map((q) => (q.verb === null ? 0 : 1))
    const s = score('biz', answers)
    expect(s.load).toBeLessThan(50)
    expect(s.verdict).toBe('A')
  })

  it('スコアは0〜100に正規化される', () => {
    const s = score('biz', QUESTIONS_BIZ.map((_, i) => (i % 3) as 0 | 1 | 2))
    for (const v of Object.values(s.type)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('同じ回答は常に同じ結果(決定的)', () => {
    const answers = QUESTIONS_SELF.map((_, i) => ((i * 7) % 3) as 0 | 1 | 2)
    const a = score('self', answers)
    const b = score('self', answers)
    expect(a).toEqual(b)
  })
})

describe('pickFreeQuestion', () => {
  it('判定C(量が中心)なら業務量の質問を選ぶ', () => {
    const answers = QUESTIONS_BIZ.map((q) => (q.verb === null ? 2 : 0))
    const s = score('biz', answers)
    expect(pickFreeQuestion('biz', s)).toBe(FREE_Q_LOAD)
  })

  it('上位タイプがあればそのタイプの質問を選ぶ(空文字にならない)', () => {
    const s = score('self', QUESTIONS_SELF.map(() => 1))
    const q = pickFreeQuestion('self', s)
    expect(q.length).toBeGreaterThan(0)
  })
})
