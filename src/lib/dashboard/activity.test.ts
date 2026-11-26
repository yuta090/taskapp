import { describe, it, expect } from 'vitest'
import { activityFailureKind, describeActivity, type ActivityRow } from './activity'
import { UNKNOWN_PROFILE_LABEL } from '@/lib/labels'

const ctx = {
  orgId: 'org-1',
  spaceId: 'space-1',
  nameById: new Map([
    ['user-sato', '佐藤'],
    ['user-suzuki', '鈴木'],
  ]),
}

function row(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    occurred_at: '2026-11-26T01:00:00Z',
    actor_user_id: 'user-sato',
    channel: 'app',
    kind: 'task_created',
    target_id: 'target-1',
    task_id: 'task-1',
    title: '見積を作る',
    detail: null,
    ...overrides,
  }
}

describe('describeActivity — 動作の文言', () => {
  const cases: Array<[Partial<ActivityRow>, string]> = [
    [{ kind: 'task_created' }, 'タスクを作成'],
    [{ kind: 'task_completed', detail: { from: 'in_progress', to: 'done' } }, 'タスクを完了'],
    [{ kind: 'task_status', detail: { from: 'todo', to: 'in_progress' } }, '状態を着手予定→進行中に変更'],
    [{ kind: 'task_status', detail: { from: 'in_progress', to: 'in_review' } }, '状態を進行中→社内承認中に変更'],
    [{ kind: 'task_status', detail: { from: 'backlog', to: 'considering' } }, '状態を未着手→検討中に変更'],
    [{ kind: 'task_status', detail: { from: 'done', to: 'todo' } }, '状態を完了→着手予定に変更'],
    [{ kind: 'task_ball', detail: { to: 'internal' } }, 'ボールを社内へ'],
    [{ kind: 'task_ball', detail: { to: 'client' } }, 'ボールをクライアントへ'],
    [{ kind: 'task_assignee', detail: { to: 'user-suzuki' } }, '担当者を鈴木に変更'],
    [{ kind: 'task_assignee', detail: { to: null } }, '担当者を担当なしに変更'],
    [{ kind: 'task_assignee', detail: { to: 'user-gone' } }, `担当者を${UNKNOWN_PROFILE_LABEL}に変更`],
    [{ kind: 'task_deleted', task_id: null }, 'タスクを削除'],
    [{ kind: 'comment_added', detail: { excerpt: 'お願いします' } }, 'コメント'],
    [{ kind: 'file_uploaded', task_id: null }, 'ファイルをアップロード'],
    [{ kind: 'file_deleted', task_id: null }, 'ファイルを削除'],
    [{ kind: 'wiki_created', task_id: null }, 'Wiki ページを作成'],
    [{ kind: 'wiki_edited', task_id: null }, 'Wiki ページを編集'],
    [{ kind: 'wiki_deleted', task_id: null }, 'Wiki ページを削除'],
    [{ kind: 'review_approved' }, '承認'],
    [{ kind: 'review_changes_requested' }, '差し戻し'],
  ]

  it.each(cases)('%j → 「%s」', (overrides, expected) => {
    expect(describeActivity(row(overrides), ctx).action).toBe(expected)
  })

  it('知らない種類・知らない状態値でも落ちない', () => {
    expect(describeActivity(row({ kind: 'something_new' }), ctx).action).toBe('操作')
    expect(describeActivity(row({ kind: 'task_status', detail: { from: 'x', to: 'y' } }), ctx).action).toBe(
      '状態をx→yに変更'
    )
    expect(describeActivity(row({ kind: 'task_status', detail: null }), ctx).action).toBe('状態を変更')
  })
})

describe('describeActivity — 誰が', () => {
  it('名簿から名前を引く', () => {
    expect(describeActivity(row({ actor_user_id: 'user-suzuki' }), ctx).who).toBe('鈴木')
  })

  it('名簿にいない人は（メンバー外）', () => {
    expect(describeActivity(row({ actor_user_id: 'user-gone' }), ctx).who).toBe(UNKNOWN_PROFILE_LABEL)
  })

  it('actor が null ならシステム', () => {
    expect(describeActivity(row({ actor_user_id: null }), ctx).who).toBe('システム')
  })

  it('CLI・AI（mcp）経由には小さなラベルを添える。画面・ポータルには添えない', () => {
    expect(describeActivity(row({ channel: 'cli' }), ctx).channelLabel).toBe('CLI')
    expect(describeActivity(row({ channel: 'mcp' }), ctx).channelLabel).toBe('AI')
    expect(describeActivity(row({ channel: 'app' }), ctx).channelLabel).toBeNull()
    expect(describeActivity(row({ channel: 'portal' }), ctx).channelLabel).toBeNull()
  })
})

describe('describeActivity — 対象とリンク', () => {
  it('タスク系・コメント・承認は、タスクを開くリンク', () => {
    for (const kind of [
      'task_created',
      'task_completed',
      'task_status',
      'task_ball',
      'task_assignee',
      'comment_added',
      'review_approved',
      'review_changes_requested',
    ]) {
      const view = describeActivity(row({ kind, detail: { to: 'internal', from: 'todo' } }), ctx)
      expect(view.href, kind).toBe('/org-1/project/space-1?task=task-1')
      expect(view.target).toBe('見積を作る')
    }
  })

  it('Wiki の作成・編集は、そのページを開くリンク', () => {
    for (const kind of ['wiki_created', 'wiki_edited']) {
      const view = describeActivity(row({ kind, target_id: 'page-9', task_id: null, title: '議事メモ' }), ctx)
      expect(view.href).toBe('/org-1/project/space-1/wiki?page=page-9')
      expect(view.target).toBe('議事メモ')
    }
  })

  it('ファイルのアップロードは、ファイル一覧ページへのリンク', () => {
    const view = describeActivity(row({ kind: 'file_uploaded', task_id: null, title: '見積.pdf' }), ctx)
    expect(view.href).toBe('/org-1/project/space-1/files')
    expect(view.target).toBe('見積.pdf')
  })

  it('削除系はリンクなし（題名だけ出す）', () => {
    for (const kind of ['task_deleted', 'file_deleted', 'wiki_deleted']) {
      const view = describeActivity(row({ kind, task_id: null }), ctx)
      expect(view.href, kind).toBeNull()
      expect(view.target).toBe('見積を作る')
    }
  })

  it('タスクの id が無い行（消えたタスクのコメントなど）はリンクなし', () => {
    expect(describeActivity(row({ kind: 'comment_added', task_id: null }), ctx).href).toBeNull()
  })

  it('title が null なら（題名なし）', () => {
    expect(describeActivity(row({ title: null }), ctx).target).toBe('（題名なし）')
  })
})

describe('describeActivity — コメントの抜粋', () => {
  it('抜粋を1行にして添える', () => {
    const view = describeActivity(row({ kind: 'comment_added', detail: { excerpt: '確認\n  お願いします\n' } }), ctx)
    expect(view.excerpt).toBe('確認 お願いします')
  })

  it('コメント以外、抜粋が空のときは null', () => {
    expect(describeActivity(row({ kind: 'task_created' }), ctx).excerpt).toBeNull()
    expect(describeActivity(row({ kind: 'comment_added', detail: { excerpt: '  ' } }), ctx).excerpt).toBeNull()
    expect(describeActivity(row({ kind: 'comment_added', detail: null }), ctx).excerpt).toBeNull()
  })
})

describe('describeActivity — 行の識別', () => {
  it('同じ変更で状態とボールが両方変わった行は id が同じなので、key は kind まで含める', () => {
    const a = describeActivity(row({ id: 7, kind: 'task_status', detail: { from: 'todo', to: 'done' } }), ctx)
    const b = describeActivity(row({ id: 7, kind: 'task_ball', detail: { to: 'client' } }), ctx)
    expect(a.key).not.toBe(b.key)
  })

  it('時刻はそのまま持つ', () => {
    expect(describeActivity(row({}), ctx).occurredAt).toBe('2026-11-26T01:00:00Z')
  })
})

describe('activityFailureKind — 読み込み失敗の種類', () => {
  it('Not authorized は権限が無い（社内メンバー以外）', () => {
    expect(activityFailureKind({ message: 'Not authorized', code: 'P0001' })).toBe('forbidden')
    expect(activityFailureKind(new Error('Not authorized'))).toBe('forbidden')
  })

  it('それ以外のエラーは読み込み失敗、エラーが無ければ null', () => {
    expect(activityFailureKind(new Error('network'))).toBe('failed')
    expect(activityFailureKind({ code: '500' })).toBe('failed')
    expect(activityFailureKind(null)).toBeNull()
    expect(activityFailureKind(undefined)).toBeNull()
  })
})
