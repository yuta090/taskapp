import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CliSetupGuide } from '@/components/settings/CliSetupGuide'
import {
  CLI_INSTALL_COMMAND,
  CLI_LOGIN_COMMAND,
  CLAUDE_CODE_SKILL_COMMAND,
  AI_READ_SKILL_PROMPT,
} from '@/lib/cli-setup'

/**
 * APIキー画面に出す「AI から AgentPM を使う準備」。
 * プロジェクト設定の API 設定にはインストール手順も AI への覚えさせ方も無く、
 * アカウント側の手順は Claude Code が読まない場所（~/.claude/skills/agentpm.md）に置かせていた。
 */
beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('CliSetupGuide', () => {
  it('インストール → ログイン → AI に覚えさせる、の順に手順を出す', () => {
    render(<CliSetupGuide />)
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toHaveLength(3)
    expect(headings[0]).toMatch(/インストール/)
    expect(headings[1]).toMatch(/ログイン/)
    expect(headings[2]).toMatch(/覚えさせる/)
  })

  it('インストールのコマンドを出し、コピーできる', async () => {
    render(<CliSetupGuide />)
    expect(screen.getByText(CLI_INSTALL_COMMAND)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'インストールのコマンドをコピー' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CLI_INSTALL_COMMAND))
  })

  it('ログインのコマンドを出し、コピーできる', async () => {
    render(<CliSetupGuide />)
    expect(screen.getByText(CLI_LOGIN_COMMAND)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ログインのコマンドをコピー' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CLI_LOGIN_COMMAND))
  })

  it('鍵は AI のチャットに貼らず、自分でターミナルに入れるよう案内する', () => {
    render(<CliSetupGuide />)
    expect(screen.getByText(/チャットに貼らない/)).toBeInTheDocument()
  })

  it('Claude Code 用の説明書は、Claude Code が読むフォルダ（skills/agentpm/SKILL.md）に置かせる', async () => {
    render(<CliSetupGuide />)
    expect(screen.getByText(CLAUDE_CODE_SKILL_COMMAND)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('~/.claude/skills/agentpm.md')
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code 用のコマンドをコピー' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CLAUDE_CODE_SKILL_COMMAND))
  })

  it('Claude Code 以外の AI 向けに、説明書を読ませる一文をコピーできる', async () => {
    render(<CliSetupGuide />)
    fireEvent.click(screen.getByRole('button', { name: 'AI に渡す文をコピー' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(AI_READ_SKILL_PROMPT))
  })

  it('プロジェクト設定から開いたときは、既定のプロジェクトとしてこのプロジェクトのIDを出す', async () => {
    render(<CliSetupGuide spaceId="space-123" />)
    expect(screen.getByText('space-123')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトIDをコピー' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('space-123'))
  })

  it('アカウント設定から開いたときはプロジェクトIDを出さない', () => {
    render(<CliSetupGuide />)
    expect(screen.queryByRole('button', { name: 'プロジェクトIDをコピー' })).toBeNull()
  })
})
