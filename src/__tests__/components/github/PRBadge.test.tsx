import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PRBadge } from '@/components/github/PRBadge'

/**
 * PR-B: pr_url は authenticated から読めない列になったため、PRBadge は
 * prUrl を受け取らず、repoFullName（接続した本人だけに渡る）から画面側で組み立てる。
 * author_login も authenticated からは誰も読めなくなったため props から削除済み。
 */

describe('PRBadge', () => {
  it('repoFullName があれば、リポジトリ名とリンクを組み立てて表示する', () => {
    render(
      <PRBadge
        state="open"
        prNumber={42}
        title="ログイン機能の実装"
        updatedAt="2026-09-01T00:00:00.000Z"
        repoFullName="yuta090/taskapp"
      />
    )

    expect(screen.getByText('yuta090/taskapp')).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://github.com/yuta090/taskapp/pull/42')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('repoFullName が無ければ、リンク・リポジトリ名を出さず番号とタイトルだけにする', () => {
    render(
      <PRBadge
        state="open"
        prNumber={42}
        title="ログイン機能の実装"
        updatedAt="2026-09-01T00:00:00.000Z"
      />
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(screen.getByText('ログイン機能の実装')).toBeInTheDocument()
    expect(screen.queryByText(/github\.com/)).not.toBeInTheDocument()
  })

  it('compact でも repoFullName が無ければリンクにしない', () => {
    render(<PRBadge state="open" prNumber={7} title="t" updatedAt="2026-09-01T00:00:00.000Z" compact />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('#7')).toBeInTheDocument()
  })
})
