import { describe, it, expect } from 'vitest'
import { getManifest } from '@/lib/cli-manifest'
import { buildAgentpmSkill } from '@/lib/cli-skill'
import { CLI_INSTALL_COMMAND, SKILL_URL } from '@/lib/cli-setup'

/**
 * AI（Claude Code 等）に読ませる agentpm の説明書（スキル）。
 * 以前は 3 月に手書きした静的ファイルで、CSV 取り込み・ファイル送信・Wiki 転記が載っていなかった。
 * コマンド一覧（manifest）から組み立てることで、コマンドを足しても説明書が古くならないようにする。
 */
const skill = buildAgentpmSkill(getManifest())

describe('buildAgentpmSkill', () => {
  it('Claude Code が読めるスキルの形（先頭に name と description）になっている', () => {
    expect(skill.startsWith('---\nname: agentpm\ndescription: ')).toBe(true)
    expect(skill.split('\n').slice(1).indexOf('---')).toBeGreaterThan(0)
  })

  it('manifest の全コマンドが載っている', () => {
    for (const cmd of getManifest().commands) {
      if (!cmd.subcommands?.length) {
        expect(skill, cmd.name).toContain(`agentpm ${cmd.name}`)
        continue
      }
      for (const sub of cmd.subcommands) {
        if (sub.hidden || sub.deprecated) continue
        expect(skill, `${cmd.name} ${sub.name}`).toContain(`agentpm ${cmd.name} ${sub.name}`)
      }
    }
  })

  it('隠し・廃止予定のコマンドは載せない', () => {
    const md = buildAgentpmSkill({
      ...getManifest(),
      commands: [
        {
          name: 'demo',
          description: 'Demo',
          subcommands: [
            { name: 'shown', description: 'x', tool: 't', options: [] },
            { name: 'secret', description: 'x', tool: 't', hidden: true, options: [] },
            { name: 'old', description: 'x', tool: 't', deprecated: true, options: [] },
          ],
        },
      ],
    })
    expect(md).toContain('agentpm demo shown')
    expect(md).not.toContain('agentpm demo secret')
    expect(md).not.toContain('agentpm demo old')
  })

  it('必須のオプションは括弧なし、任意のオプションは [ ] で囲む', () => {
    expect(skill).toMatch(/`agentpm task create [^`]*--title <title>/)
    expect(skill).not.toMatch(/`agentpm task create [^`]*\[--title <title>\]/)
    expect(skill).toMatch(/`agentpm task create [^`]*\[--description <desc>\]/)
  })

  it('短い別名ではなく長い名前のオプションで書く', () => {
    expect(skill).not.toContain('-s, --space-id')
    expect(skill).toContain('[--space-id <uuid>]')
  })

  it('テキストを流し込むコマンドには CLI が足す --file <path> も載せる', () => {
    expect(skill).toMatch(/`agentpm task import [^`]*\[--file <path>\]/)
    expect(skill).toMatch(/`agentpm wiki create [^`]*\[--file <path>\]/)
  })

  it('選べる値を載せる（存在しない値を推測で送らないように）', () => {
    expect(skill).toContain('backlog|todo|in_progress|in_review|done|considering')
  })

  it('入れ方と、鍵をチャットに貼らせない約束が書いてある', () => {
    expect(skill).toContain(CLI_INSTALL_COMMAND)
    expect(skill).toContain('agentpm login')
    expect(skill).toMatch(/チャットに貼/)
  })

  it('取り込み・削除は下見を見せてから実行する約束が書いてある', () => {
    expect(skill).toContain('--no-dry-run')
  })

  it('権限で断られたときの読み方が書いてある（古いキーは発行し直し・サーバー障害は深追いしない）', () => {
    expect(skill).toContain('権限エラー: User is not a member of this space')
    expect(skill).toMatch(/古い形式/)
    expect(skill).toContain('Internal server error')
  })

  it('プロジェクト設定で作ったキーでも space list で確かめられることを書いている', () => {
    expect(skill).toMatch(/プロジェクト設定で作ったキーなら、そのプロジェクトだけが出る/)
  })

  it('最新版の置き場所を書いている', () => {
    expect(skill).toContain(SKILL_URL)
  })
})
