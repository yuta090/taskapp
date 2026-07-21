import { describe, it, expect } from 'vitest'
import {
  estimateCostUsd,
  estimateCostJpy,
  MODEL_PRICES,
  DEFAULT_USD_JPY,
} from '@/lib/ai/cost'

describe('estimateCostUsd', () => {
  it('既知モデルは input/output 単価×トークンで原価を出す', () => {
    // gpt-4o-mini: input $0.15 / output $0.60 per 1M tok（代表値）
    const price = MODEL_PRICES['gpt-4o-mini']
    expect(price).toBeDefined()
    const usd = estimateCostUsd('gpt-4o-mini', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    })
    expect(usd).toBeCloseTo(price!.inputPerMTokUsd + price!.outputPerMTokUsd, 6)
  })

  it('少量トークンでも比例して算出する', () => {
    const usd = estimateCostUsd('gpt-4o-mini', {
      promptTokens: 500,
      completionTokens: 200,
    })
    const p = MODEL_PRICES['gpt-4o-mini']!
    const expected =
      (500 / 1_000_000) * p.inputPerMTokUsd + (200 / 1_000_000) * p.outputPerMTokUsd
    expect(usd).toBeCloseTo(expected, 10)
  })

  it('未知モデルは null（勝手に0円にして原価を過小評価しない）', () => {
    expect(estimateCostUsd('totally-unknown-model', { promptTokens: 100, completionTokens: 100 })).toBeNull()
  })
})

describe('estimateCostJpy', () => {
  it('USD原価に為替を掛けて円換算する', () => {
    const usd = estimateCostUsd('gpt-4o-mini', { promptTokens: 1000, completionTokens: 500 })!
    const jpy = estimateCostJpy('gpt-4o-mini', { promptTokens: 1000, completionTokens: 500 }, 150)
    expect(jpy).toBeCloseTo(usd * 150, 10)
  })

  it('為替未指定なら DEFAULT_USD_JPY を使う', () => {
    const usd = estimateCostUsd('gpt-4o-mini', { promptTokens: 1000, completionTokens: 500 })!
    const jpy = estimateCostJpy('gpt-4o-mini', { promptTokens: 1000, completionTokens: 500 })
    expect(jpy).toBeCloseTo(usd * DEFAULT_USD_JPY, 10)
  })

  it('未知モデルは null', () => {
    expect(estimateCostJpy('nope', { promptTokens: 10, completionTokens: 10 })).toBeNull()
  })
})
