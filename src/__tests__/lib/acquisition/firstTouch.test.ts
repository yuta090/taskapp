import { describe, it, expect } from 'vitest'
import {
  FIRST_TOUCH_COOKIE,
  extractFirstTouch,
  encodeFirstTouchCookie,
  decodeFirstTouchCookie,
  deriveAcquisitionChannel,
  buildAcquisitionRecord,
  ACQUISITION_CHANNEL_LABEL,
  getAcquisitionChannelLabel,
  MANUAL_ACQUISITION_CHANNELS,
  type FirstTouch,
} from '@/lib/acquisition/firstTouch'

/**
 * 流入経路の first-touch 記録。
 * - proxy が「最初に来たときの URL パラメータと参照元」を cookie に残す（あれば上書きしない）
 * - 組織作成時に cookie を読んで流入経路（channel）を判定し、DB に記録する
 */

const NOW = '2026-09-07T10:00:00.000Z'

function extract(url: string, referer: string | null = null) {
  return extractFirstTouch(new URL(url), referer, NOW)
}

describe('extractFirstTouch', () => {
  it('utm パラメータがあれば取り出す（着地ページと時刻つき）', () => {
    const ft = extract('https://agentpm.app/lp1?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_content=a&utm_term=task')
    expect(ft).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'spring',
      utm_content: 'a',
      utm_term: 'task',
      landing_path: '/lp1',
      at: NOW,
    })
  })

  it('記事の ref/art（既存の task6 方式）も拾う', () => {
    const ft = extract('https://agentpm.app/signup?ref=task6&art=line-group-tasks')
    expect(ft?.ref).toBe('task6')
    expect(ft?.art).toBe('line-group-tasks')
  })

  it('広告のクリック ID（gclid 等）は種類だけ残す（値は保存しない）', () => {
    const ft = extract('https://agentpm.app/?gclid=abc123')
    expect(ft?.click_id).toBe('gclid')
    expect(JSON.stringify(ft)).not.toContain('abc123')
  })

  it('外部サイトからの参照元はホスト名だけ残す', () => {
    const ft = extract('https://agentpm.app/task6/line-group-tasks', 'https://www.google.com/search?q=x')
    expect(ft?.referrer).toBe('www.google.com')
    expect(ft?.landing_path).toBe('/task6/line-group-tasks')
  })

  it('自サイト内の遷移・パラメータ無しは「手がかり無し」として null', () => {
    expect(extract('https://agentpm.app/pricing')).toBeNull()
    expect(extract('https://agentpm.app/pricing', 'https://agentpm.app/')).toBeNull()
    expect(extract('https://agentpm.app/pricing', 'not a url')).toBeNull()
  })

  it('長すぎる値は切り詰め、不正な文字は落とす', () => {
    const long = 'a'.repeat(500)
    const ft = extract(`https://agentpm.app/?utm_source=${long}&ref=<script>`)
    expect(ft?.utm_source?.length).toBe(100)
    expect(ft?.ref).toBeUndefined()
  })
})

describe('cookie encode/decode', () => {
  it('往復して同じ値になる（cookie に使えない文字はエンコード）', () => {
    const ft: FirstTouch = { utm_source: 'note', utm_medium: 'social', landing_path: '/lp2', referrer: 'note.com', at: NOW }
    const raw = encodeFirstTouchCookie(ft)
    expect(raw).not.toMatch(/[;,\s"]/)
    expect(decodeFirstTouchCookie(raw)).toEqual(ft)
  })

  it('壊れた cookie は null（登録を止めない）', () => {
    expect(decodeFirstTouchCookie(null)).toBeNull()
    expect(decodeFirstTouchCookie('%7Bbroken')).toBeNull()
    expect(decodeFirstTouchCookie(encodeURIComponent('"just a string"'))).toBeNull()
    expect(decodeFirstTouchCookie(encodeURIComponent('{"at":"x"}'))).toBeNull()
  })

  it('cookie 名は agentpm_ft', () => {
    expect(FIRST_TOUCH_COOKIE).toBe('agentpm_ft')
  })
})

describe('deriveAcquisitionChannel', () => {
  const base = { landing_path: '/', at: NOW }

  it('記事・診断の ref が最優先', () => {
    expect(deriveAcquisitionChannel({ ...base, ref: 'task6', utm_medium: 'cpc' })).toBe('task6_article')
    expect(deriveAcquisitionChannel({ ...base, ref: 'shindan' })).toBe('shindan')
  })

  it('広告: クリック ID か utm_medium が cpc/ppc/paid 系', () => {
    expect(deriveAcquisitionChannel({ ...base, click_id: 'gclid' })).toBe('paid_ad')
    expect(deriveAcquisitionChannel({ ...base, utm_medium: 'CPC' })).toBe('paid_ad')
    expect(deriveAcquisitionChannel({ ...base, utm_medium: 'paid_social' })).toBe('paid_ad')
  })

  it('メール・SNS・紹介は utm_medium / utm_source で判定', () => {
    expect(deriveAcquisitionChannel({ ...base, utm_medium: 'email' })).toBe('email')
    expect(deriveAcquisitionChannel({ ...base, utm_medium: 'social' })).toBe('sns')
    expect(deriveAcquisitionChannel({ ...base, utm_source: 'twitter' })).toBe('sns')
    expect(deriveAcquisitionChannel({ ...base, utm_medium: 'referral' })).toBe('referral')
  })

  it('参照元のホストで 検索 / AI検索 / SNS / 紹介 を判定', () => {
    expect(deriveAcquisitionChannel({ ...base, referrer: 'www.google.com' })).toBe('organic_search')
    expect(deriveAcquisitionChannel({ ...base, referrer: 'search.yahoo.co.jp' })).toBe('organic_search')
    expect(deriveAcquisitionChannel({ ...base, referrer: 'chatgpt.com' })).toBe('ai_search')
    expect(deriveAcquisitionChannel({ ...base, referrer: 'www.perplexity.ai' })).toBe('ai_search')
    expect(deriveAcquisitionChannel({ ...base, referrer: 't.co' })).toBe('sns')
    expect(deriveAcquisitionChannel({ ...base, referrer: 'example.co.jp' })).toBe('referral')
  })

  it('手がかりが無ければ direct', () => {
    expect(deriveAcquisitionChannel(null)).toBe('direct')
    expect(deriveAcquisitionChannel({ ...base })).toBe('direct')
  })
})

describe('buildAcquisitionRecord', () => {
  it('RPC に渡す形（channel + 元の値）を作る', () => {
    const ft: FirstTouch = { ref: 'task6', art: 'line-group-tasks', landing_path: '/task6/line-group-tasks', referrer: 'www.google.com', at: NOW }
    expect(buildAcquisitionRecord(ft)).toEqual({
      channel: 'task6_article',
      ref: 'task6',
      article_slug: 'line-group-tasks',
      landing_path: '/task6/line-group-tasks',
      referrer: 'www.google.com',
      first_touch_at: NOW,
    })
  })

  it('cookie が無いときは channel だけ', () => {
    expect(buildAcquisitionRecord(null)).toEqual({ channel: 'direct' })
  })
})

describe('channel labels', () => {
  it('全チャネルに日本語ラベルがあり、手動登録用の候補は運営向けの言葉', () => {
    for (const key of Object.keys(ACQUISITION_CHANNEL_LABEL)) {
      expect(getAcquisitionChannelLabel(key)).not.toBe(key)
    }
    expect(getAcquisitionChannelLabel('nope')).toBe('nope')
    expect(MANUAL_ACQUISITION_CHANNELS).toContain('sales')
    expect(MANUAL_ACQUISITION_CHANNELS).toContain('event')
    expect(MANUAL_ACQUISITION_CHANNELS).not.toContain('unknown')
  })
})
