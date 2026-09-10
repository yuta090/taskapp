import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 初めての人は API URL を知らない。login で空欄のまま Enter しても、
 * 環境変数に鍵だけ入れても、本番（https://agentpm.app）につながるようにする。
 * 設定ファイルの場所は HOME から決まるので、テストごとに空の HOME を用意して読み込み直す。
 */
let home: string
const savedEnv = { ...process.env }

// テストの実行方式によっては process.env.HOME を書き換えても os.homedir() に届かない
// （別スレッドで動くと OS 側の環境変数が変わらない）ため、homedir だけ差し替える
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => home }
})

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agentpm-home-'))
  delete process.env.TASKAPP_API_URL
  delete process.env.TASKAPP_API_KEY
  delete process.env.TASKAPP_SPACE_ID
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...savedEnv }
  rmSync(home, { recursive: true, force: true })
})

const load = () => import('./config.js')

describe('loadCliConfig', () => {
  it('API URL を設定していなければ本番（https://agentpm.app）を使う', async () => {
    const { loadCliConfig, getApiConfig, DEFAULT_API_URL } = await load()
    expect(DEFAULT_API_URL).toBe('https://agentpm.app')
    loadCliConfig({ apiKey: 'tsk_test_key_123' })
    expect(getApiConfig()).toEqual({ apiUrl: 'https://agentpm.app', apiKey: 'tsk_test_key_123' })
  })

  it('環境変数の API URL があればそちらを優先する', async () => {
    process.env.TASKAPP_API_URL = 'http://localhost:4000'
    const { loadCliConfig, getApiConfig } = await load()
    loadCliConfig({ apiKey: 'tsk_test_key_123' })
    expect(getApiConfig().apiUrl).toBe('http://localhost:4000')
  })

  it('設定ファイルの API URL と鍵も使える', async () => {
    writeFileSync(
      join(home, '.taskapprc.json'),
      JSON.stringify({ apiUrl: 'https://staging.example', apiKey: 'tsk_file_key_123' }),
    )
    const { loadCliConfig, getApiConfig } = await load()
    loadCliConfig({})
    expect(getApiConfig()).toEqual({ apiUrl: 'https://staging.example', apiKey: 'tsk_file_key_123' })
  })

  it('鍵が無ければ「agentpm login を」と案内して止める', async () => {
    const { loadCliConfig, ConfigError } = await load()
    expect(() => loadCliConfig({})).toThrow(ConfigError)
    expect(() => loadCliConfig({})).toThrow('agentpm login')
  })
})
