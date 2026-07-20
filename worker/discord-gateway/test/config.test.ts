import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

const base = {
  DISCORD_BOT_TOKEN: 'bot-tok',
  INGEST_URL: 'https://app.example.com/api/channels/discord/ingest',
  INGEST_HMAC_SECRET: 'sekret',
} as NodeJS.ProcessEnv

describe('loadConfig', () => {
  it('必須3つが揃えば既定値付きで返す', () => {
    expect(loadConfig(base)).toEqual({
      botToken: 'bot-tok',
      ingestUrl: 'https://app.example.com/api/channels/discord/ingest',
      ingestSecret: 'sekret',
      batchMaxSize: 20,
      flushIntervalMs: 2000,
    })
  })

  it.each(['DISCORD_BOT_TOKEN', 'INGEST_URL', 'INGEST_HMAC_SECRET'])(
    '%s 欠落は fail-closed で throw',
    (key) => {
      const env = { ...base }
      delete env[key as keyof typeof env]
      expect(() => loadConfig(env)).toThrow(new RegExp(key))
    },
  )

  it('空文字も欠落扱い', () => {
    expect(() => loadConfig({ ...base, INGEST_HMAC_SECRET: '' })).toThrow(/INGEST_HMAC_SECRET/)
  })

  it('BATCH_MAX_SIZE / FLUSH_INTERVAL_MS を上書きできる', () => {
    const c = loadConfig({ ...base, BATCH_MAX_SIZE: '50', FLUSH_INTERVAL_MS: '500' })
    expect(c.batchMaxSize).toBe(50)
    expect(c.flushIntervalMs).toBe(500)
  })

  it('不正な数値(0/負/非数)は既定にフォールバック', () => {
    expect(loadConfig({ ...base, BATCH_MAX_SIZE: '0' }).batchMaxSize).toBe(20)
    expect(loadConfig({ ...base, BATCH_MAX_SIZE: '-3' }).batchMaxSize).toBe(20)
    expect(loadConfig({ ...base, FLUSH_INTERVAL_MS: 'abc' }).flushIntervalMs).toBe(2000)
  })
})
