import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ActivitySection } from './ActivitySection'
import type { ActivityView } from '@/lib/dashboard/activity'

function view(overrides: Partial<ActivityView>): ActivityView {
  return {
    key: '1:task_created',
    who: '佐藤',
    channelLabel: null,
    action: 'タスクを作成',
    excerpt: null,
    target: '見積を作る',
    href: '/org-1/project/space-1?task=t1',
    occurredAt: '2026-11-26T01:00:00Z',
    ...overrides,
  }
}

const noop = () => {}

function renderSection(props: Partial<React.ComponentProps<typeof ActivitySection>> = {}) {
  return render(
    <ActivitySection
      items={[]}
      loading={false}
      failure={null}
      hasMore={false}
      loadingMore={false}
      onLoadMore={noop}
      {...props}
    />
  )
}

describe('ActivitySection', () => {
  it('「最近のアクティビティ」の区画になる', () => {
    renderSection()
    expect(screen.getByRole('region', { name: '最近のアクティビティ' })).toBeInTheDocument()
  })

  it('1行に、誰が・何をした・対象（リンク）・時刻を出す', () => {
    renderSection({ items: [view({})] })
    const section = screen.getByRole('region', { name: '最近のアクティビティ' })
    const item = within(section).getByRole('listitem')
    expect(item).toHaveTextContent('佐藤')
    expect(item).toHaveTextContent('タスクを作成')
    expect(within(item).getByRole('link', { name: '見積を作る' })).toHaveAttribute(
      'href',
      '/org-1/project/space-1?task=t1'
    )
    expect(item.querySelector('time')).toHaveAttribute('datetime', '2026-11-26T01:00:00Z')
  })

  it('リンク先が無い行（削除したもの）は、対象を文字だけで出す', () => {
    renderSection({ items: [view({ action: 'タスクを削除', href: null })] })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('見積を作る')).toBeInTheDocument()
  })

  it('CLI・AI 経由の行には小さなラベルが付く', () => {
    renderSection({
      items: [view({ key: 'a', channelLabel: 'CLI' }), view({ key: 'b', channelLabel: 'AI' }), view({ key: 'c' })],
    })
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('CLI')
    expect(items[1]).toHaveTextContent('AI')
    expect(items[2]).not.toHaveTextContent('CLI')
  })

  it('コメントの抜粋を添える', () => {
    renderSection({ items: [view({ action: 'コメント', excerpt: 'お願いします' })] })
    expect(screen.getByText('お願いします')).toBeInTheDocument()
  })

  it('読み込み中は、読み込み中と出す', () => {
    renderSection({ loading: true })
    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
  })

  it('0 件なら、そう書く', () => {
    renderSection()
    expect(screen.getByText('まだアクティビティはありません')).toBeInTheDocument()
  })

  it('読み込みに失敗したら、そう書く', () => {
    renderSection({ failure: 'failed' })
    expect(screen.getByText('アクティビティを読み込めませんでした')).toBeInTheDocument()
  })

  it('権限が無いときは、社内メンバーだけが見られると書く', () => {
    renderSection({ failure: 'forbidden' })
    expect(screen.getByText('最近のアクティビティは、このプロジェクトの社内メンバーだけが見られます')).toBeInTheDocument()
  })

  it('続きがあれば「もっと見る」を出し、押すと続きを読む', () => {
    const onLoadMore = vi.fn()
    renderSection({ items: [view({})], hasMore: true, onLoadMore })
    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('続きを読んでいるあいだは、ボタンを押せない', () => {
    renderSection({ items: [view({})], hasMore: true, loadingMore: true })
    expect(screen.getByRole('button', { name: '読み込み中…' })).toBeDisabled()
  })

  it('続きが無ければ「もっと見る」は出ない', () => {
    renderSection({ items: [view({})], hasMore: false })
    expect(screen.queryByRole('button', { name: 'もっと見る' })).not.toBeInTheDocument()
  })

  it('一覧が出たあとで続きの読み込みに失敗しても、一覧は残して知らせる', () => {
    renderSection({ items: [view({})], failure: 'failed', hasMore: true })
    expect(screen.getByRole('listitem')).toBeInTheDocument()
    expect(screen.getByText('続きを読み込めませんでした')).toBeInTheDocument()
  })
})
