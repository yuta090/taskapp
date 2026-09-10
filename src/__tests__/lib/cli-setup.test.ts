import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CLI_PACKAGE_NAME,
  CLI_INSTALL_COMMAND,
  SKILL_URL,
  CLAUDE_CODE_SKILL_COMMAND,
  AI_READ_SKILL_PROMPT,
} from '@/lib/cli-setup'

/**
 * 画面・説明書に出す「入れ方」の正本。npm に公開する名前とずれると、画面どおりに打っても
 * 古い版や別物が入る（実際 package.json の名前は未公開の 'agentpm' で、
 * 画面の @uzukko/agentpm は 3 月の 0.2.0 のままだった）。
 */
const cliDir = path.resolve(process.cwd(), 'packages/cli')
const cliPkg = JSON.parse(readFileSync(path.join(cliDir, 'package.json'), 'utf-8'))

describe('cli-setup', () => {
  it('インストールするパッケージ名は、CLI の package.json の名前と一致する', () => {
    expect(cliPkg.name).toBe(CLI_PACKAGE_NAME)
    expect(CLI_INSTALL_COMMAND).toBe(`npm install -g ${CLI_PACKAGE_NAME}`)
  })

  it('npm に載せるのは実行に要るもの（bin と dist）だけ', () => {
    expect(cliPkg.files).toEqual(['bin', 'dist'])
  })

  it('agentpm --version が出す版は package.json の版と一致する', () => {
    const indexSrc = readFileSync(path.join(cliDir, 'src/index.ts'), 'utf-8')
    expect(indexSrc).toContain(`const CLI_VERSION = '${cliPkg.version}'`)
  })

  it('Claude Code 用のコマンドは、スキルのフォルダを作ってから SKILL.md を置く', () => {
    expect(CLAUDE_CODE_SKILL_COMMAND).toBe(
      `mkdir -p ~/.claude/skills/agentpm && curl -fsSL ${SKILL_URL} -o ~/.claude/skills/agentpm/SKILL.md`,
    )
  })

  it('AI に渡す文には説明書の URL が入っている', () => {
    expect(AI_READ_SKILL_PROMPT).toContain(SKILL_URL)
  })

  // ヘルプは画面と別に手書きしているので、コマンドがずれたらここで気づく
  it('ヘルプ（コマンドラインのページ）は画面と同じコマンド・同じ一文を載せている', () => {
    const manual = readFileSync(path.resolve(process.cwd(), 'docs/manual/internal/cli.md'), 'utf-8')
    expect(manual).toContain(CLI_INSTALL_COMMAND)
    expect(manual).toContain(CLAUDE_CODE_SKILL_COMMAND)
    expect(manual).toContain(AI_READ_SKILL_PROMPT)
    expect(manual).not.toContain('一般向けの配布はしていません')
  })
})
