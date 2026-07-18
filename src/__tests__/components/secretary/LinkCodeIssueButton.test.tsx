import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { LinkCodeIssueButton } from '@/components/secretary/LinkCodeIssueButton'

/**
 * SpaceConnectionList から切り出した突合コード発行ボタンの単体テスト（提示レイヤーの純粋抽出）。
 * 挙動（発行→コード表示→コピー、失敗時トースト）は抽出前と同一であること。
 */

const fetchMock = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const SPACE = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('LinkCodeIssueButton', () => {
  it('発行前は「確認コードを発行」ボタンを表示する', () => {
    render(<LinkCodeIssueButton orgId={ORG} spaceId={SPACE} />)
    expect(screen.getByText('確認コードを発行')).toBeInTheDocument()
  })

  it('発行に成功するとコードと期限を表示する', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 'ABC123', expiresAt: '2026-08-01T00:00:00+09:00' }),
    })

    render(<LinkCodeIssueButton orgId={ORG} spaceId={SPACE} />)
    fireEvent.click(screen.getByText('確認コードを発行'))

    await waitFor(() => expect(screen.getByText('ABC123')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/channels/link-codes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orgId: ORG, spaceId: SPACE }),
      }),
    )
  })

  it('コピー操作でクリップボードにコードを書き込む', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 'ABC123', expiresAt: '2026-08-01T00:00:00+09:00' }),
    })

    render(<LinkCodeIssueButton orgId={ORG} spaceId={SPACE} />)
    fireEvent.click(screen.getByText('確認コードを発行'))
    await waitFor(() => expect(screen.getByText('ABC123')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('コピー'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC123'))
  })

  it('発行に失敗するとエラートーストを表示する', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: '発行できません' }),
    })

    render(<LinkCodeIssueButton orgId={ORG} spaceId={SPACE} />)
    fireEvent.click(screen.getByText('確認コードを発行'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('発行できません'))
  })
})
