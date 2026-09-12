import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LinkifiedText } from '@/components/shared/LinkifiedText'

/**
 * タスクの説明文などに書いた URL を押せるようにする。
 * 相手先（ポータル）には社内の画面を開けないので、そこでは押せないままにする。
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="true" {...rest}>
      {children}
    </a>
  ),
}))

const ORG = '11111111-1111-1111-1111-111111111111'
const SPACE = '22222222-2222-2222-2222-222222222222'
const ID = '33333333-3333-3333-3333-333333333333'
const TASK_LINK = `/${ORG}/project/${SPACE}?task=${ID}`
const FILE_LINK = `/api/files/${ID}/download`

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LinkifiedText', () => {
  it('文字はそのまま出す', () => {
    render(<LinkifiedText text={'1行目\n2行目'} />)
    expect(screen.getByText(/1行目/)).toBeInTheDocument()
  })

  it('アプリの中のリンクは、同じタブで開く（next/link）', () => {
    render(<LinkifiedText text={`参考: ${TASK_LINK}`} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', TASK_LINK)
    expect(link).toHaveAttribute('data-next-link', 'true')
    expect(link).not.toHaveAttribute('target', '_blank')
  })

  it('外部のサイトは新しいタブで開き、元のページを渡さない', () => {
    render(<LinkifiedText text="https://example.com/a" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('ファイルのダウンロードは新しいタブ（画面が変わらない）', () => {
    render(<LinkifiedText text={FILE_LINK} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', FILE_LINK)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('相手先の画面では、社内の画面へのリンクを押せるようにしない', () => {
    render(<LinkifiedText text={`参考: ${TASK_LINK}`} inApp={false} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(new RegExp(TASK_LINK.slice(1, 20)))).toBeInTheDocument()
  })

  it('相手先の画面でも、外部のサイトは押せる', () => {
    render(<LinkifiedText text="https://example.com/a" inApp={false} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com/a')
  })

  it('リンクを押しても、囲みの操作（説明の編集）を開かない', () => {
    const onContainerClick = vi.fn()
    render(
      <div onClick={onContainerClick}>
        <LinkifiedText text={`参考: ${TASK_LINK}`} />
      </div>
    )
    fireEvent.click(screen.getByRole('link'))
    expect(onContainerClick).not.toHaveBeenCalled()
  })

  it('中身が空なら何も出さない', () => {
    const { container } = render(<LinkifiedText text="" />)
    expect(container.textContent).toBe('')
  })
})
