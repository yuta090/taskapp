import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * docs/ の Slack アプリ manifest（ツール連携「AgentPM」と AI秘書「AgentPM秘書」）。
 *
 * 同じワークスペースに両方入るので、Slack のアプリ情報（説明欄）だけで
 * 「どちらが何をするか・もう一方との違い」が分かるようにしておく。
 * JSON 版と YAML 版は同じ内容を保つ（作成ダイアログのタブ違い）。
 */
type Manifest = { display_information: { name: string; long_description: string } }

/** YAML 版の long_description（ブロックスカラー `|`）だけを取り出す。YAML パーサへの依存を増やさない */
function ymlLongDescription(src: string): string {
  const m = src.match(/^ {2}long_description: \|\n((?: {4}.*\n|\n)+)/m)
  if (!m) throw new Error('long_description block not found')
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^ {4}/, ''))
    .join('\n')
}

const agentpmJson = JSON.parse(readFileSync('docs/slack-app-manifest.json', 'utf8')) as Manifest
const agentpmYmlDescription = ymlLongDescription(readFileSync('docs/slack-app-manifest.yml', 'utf8'))
const secretaryJson = JSON.parse(readFileSync('docs/slack-secretary-app-manifest.json', 'utf8')) as Manifest

describe('docs/slack-app-manifest（ツール連携 AgentPM）', () => {
  it('JSON と YAML の説明文が一致する', () => {
    expect(agentpmYmlDescription.trim()).toBe(
      agentpmJson.display_information.long_description.trim(),
    )
  })

  it('通知の4種類（追加・ボール・ステータス・コメント）と、秘書との違いを書く', () => {
    const d = agentpmJson.display_information.long_description
    expect(d).toMatch(/ステータス/)
    expect(d).toContain('「AgentPM秘書」との違い')
    expect(d).toMatch(/会話は読みません/)
    expect(d.length).toBeLessThanOrEqual(5000)
  })
})

describe('docs/slack-secretary-app-manifest（AI秘書）', () => {
  it('ツール連携 AgentPM との違いを書く', () => {
    const d = secretaryJson.display_information.long_description
    expect(d).toContain('「AgentPM」との違い')
    expect(d).toMatch(/会話を読/)
    expect(d).toMatch(/合言葉で紐づけたチャンネルだけ/)
  })
})
