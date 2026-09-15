import { describe, it, expect } from 'vitest'
import {
  MAX_MENTION_COUNT,
  getMentionCandidates,
  detectMentionQuery,
  resolveMentionUserIds,
  splitCommentBody,
} from '@/lib/comments/mentions'
import type { SpaceMember } from '@/lib/hooks/useSpaceMembers'

function member(overrides: Partial<SpaceMember> = {}): SpaceMember {
  return {
    id: 'u1',
    displayName: 'テスト太郎',
    avatarUrl: null,
    role: 'editor',
    ...overrides,
  }
}

const admin = member({ id: 'admin-1', displayName: '管理者アリス', role: 'admin' })
const editor = member({ id: 'editor-1', displayName: '編集イチロー', role: 'editor' })
const viewer = member({ id: 'viewer-1', displayName: '閲覧ウメコ', role: 'viewer' })
const client = member({ id: 'client-1', displayName: 'クライアント江里子', role: 'client' })
const vendor = member({ id: 'vendor-1', displayName: 'ベンダー加藤', role: 'vendor' })

const allMembers = [admin, editor, viewer, client, vendor]

describe('getMentionCandidates', () => {
  it('internal は社内の役割（admin/editor/viewer）だけを候補にする', () => {
    const result = getMentionCandidates(allMembers, {
      visibility: 'internal',
      currentUserId: null,
    })
    expect(result.map((m) => m.id).sort()).toEqual(['admin-1', 'editor-1', 'viewer-1'])
  })

  it('client は社内 + クライアントを候補にする', () => {
    const result = getMentionCandidates(allMembers, {
      visibility: 'client',
      currentUserId: null,
    })
    expect(result.map((m) => m.id).sort()).toEqual([
      'admin-1',
      'client-1',
      'editor-1',
      'viewer-1',
    ])
  })

  it('vendor は社内 + ベンダーを候補にする', () => {
    const result = getMentionCandidates(allMembers, {
      visibility: 'vendor',
      currentUserId: null,
    })
    expect(result.map((m) => m.id).sort()).toEqual([
      'admin-1',
      'editor-1',
      'vendor-1',
      'viewer-1',
    ])
  })

  it('自分自身は候補から除く', () => {
    const result = getMentionCandidates(allMembers, {
      visibility: 'internal',
      currentUserId: 'admin-1',
    })
    expect(result.map((m) => m.id)).not.toContain('admin-1')
  })

  it('query があれば前方一致を優先し、部分一致を後ろに続ける', () => {
    const members = [
      member({ id: '1', displayName: '山田太郎', role: 'editor' }),
      member({ id: '2', displayName: '中山太郎', role: 'editor' }),
      member({ id: '3', displayName: '山本花子', role: 'editor' }),
    ]
    const result = getMentionCandidates(members, {
      visibility: 'internal',
      currentUserId: null,
      query: '山',
    })
    // 前方一致(山田・山本)が先、部分一致(中山)が後ろ
    expect(result.map((m) => m.id)).toEqual(['1', '3', '2'])
  })

  // 候補が開いている間の Enter は先頭の候補を選ぶ。名簿で「山田太郎」が「山田」より前にいると、
  // 「@山田」と打って Enter を押した人に山田太郎さんが差し込まれていた
  it('表示名が query と完全に一致する人を、前方一致の人より先に出す', () => {
    const members = [
      member({ id: 'yamada-taro', displayName: '山田太郎', role: 'editor' }),
      member({ id: 'yamada', displayName: '山田', role: 'editor' }),
      member({ id: 'nakayama', displayName: '中山田', role: 'editor' }),
    ]
    const result = getMentionCandidates(members, {
      visibility: 'internal',
      currentUserId: null,
      query: '山田',
    })
    expect(result.map((m) => m.id)).toEqual(['yamada', 'yamada-taro', 'nakayama'])
  })

  it('query に一致しない場合は空配列', () => {
    const result = getMentionCandidates(allMembers, {
      visibility: 'internal',
      currentUserId: null,
      query: 'ぜんぜん一致しない',
    })
    expect(result).toEqual([])
  })
})

describe('detectMentionQuery', () => {
  it('行頭の @ を検出する', () => {
    expect(detectMentionQuery('@ta', 3)).toEqual({ start: 0, query: 'ta' })
  })

  it('空白のあとの @ を検出する', () => {
    const text = 'こんにちは @ta'
    expect(detectMentionQuery(text, text.length)).toEqual({ start: 6, query: 'ta' })
  })

  it('@ の直後（クエリが空）でも検出する', () => {
    expect(detectMentionQuery('@', 1)).toEqual({ start: 0, query: '' })
  })

  it('@ のあとに空白が入ったら検出しない（確定したメンションとして扱う）', () => {
    expect(detectMentionQuery('@太郎 です', 6)).toBeNull()
  })

  it('@ が無ければ null', () => {
    expect(detectMentionQuery('こんにちは', 5)).toBeNull()
  })

  it('メールアドレスのように直前が空白でも行頭でもない @ は検出しない', () => {
    expect(detectMentionQuery('foo@ta', 6)).toBeNull()
  })

  // 課題2: 日本語の文章で @ の候補が出ない
  it('直前が句点「。」でも検出する', () => {
    const text = '確認お願いします。@山田'
    expect(detectMentionQuery(text, text.length)).toEqual({ start: 9, query: '山田' })
  })

  it('直前が読点「、」でも検出する', () => {
    const text = '山田さん、@'
    expect(detectMentionQuery(text, text.length)).toEqual({ start: 5, query: '' })
  })

  it('直前が全角の開き括弧「（」でも検出する', () => {
    const text = '（@山田'
    expect(detectMentionQuery(text, text.length)).toEqual({ start: 1, query: '山田' })
  })

  it('全角の＠でも検出する', () => {
    const text = '＠山田'
    expect(detectMentionQuery(text, text.length)).toEqual({ start: 0, query: '山田' })
  })

  it('メールアドレス（英字の直後）は全角＠でも検出しない', () => {
    expect(detectMentionQuery('a＠b', 3)).toBeNull()
  })
})

describe('resolveMentionUserIds', () => {
  it('本文に @表示名 が残っている人だけを返す', () => {
    const body = 'お願いします @編集イチロー'
    const result = resolveMentionUserIds(
      body,
      [{ id: editor.id, displayName: editor.displayName }],
      allMembers
    )
    expect(result).toEqual(['editor-1'])
  })

  it('選んだあとに @表示名 を消したら含めない', () => {
    const body = 'お願いします'
    const result = resolveMentionUserIds(
      body,
      [{ id: editor.id, displayName: editor.displayName }],
      allMembers
    )
    expect(result).toEqual([])
  })

  it('見える範囲の外に落ちた人は除く', () => {
    const body = 'お願いします @クライアント江里子'
    // 公開範囲を internal に変えたあとの候補（client は含まれない）
    const internalOnly = allMembers.filter((m) => m.role !== 'client')
    const result = resolveMentionUserIds(
      body,
      [{ id: client.id, displayName: client.displayName }],
      internalOnly
    )
    expect(result).toEqual([])
  })

  it('重複は除く', () => {
    const body = '@編集イチロー さん、@編集イチロー さん'
    const result = resolveMentionUserIds(
      body,
      [
        { id: editor.id, displayName: editor.displayName },
        { id: editor.id, displayName: editor.displayName },
      ],
      allMembers
    )
    expect(result).toEqual(['editor-1'])
  })

  // 課題1(a): 「@山田」を選んで消し、「@山田太郎」を選び直すと、本文に残る
  // 「@山田」の部分一致で山田さんにも届いてしまっていた
  it('短い名前を選んで消し、長い名前を選び直したら、本文に残っている長い名前の人だけを返す', () => {
    const yamada = member({ id: 'yamada', displayName: '山田' })
    const yamadaTaro = member({ id: 'yamada-taro', displayName: '山田太郎' })
    const body = 'お願いします @山田太郎'
    const result = resolveMentionUserIds(
      body,
      [
        { id: yamada.id, displayName: yamada.displayName },
        { id: yamadaTaro.id, displayName: yamadaTaro.displayName },
      ],
      [yamada, yamadaTaro]
    )
    expect(result).toEqual(['yamada-taro'])
  })

  // 課題1(b): 表示名が同じ「佐藤」が2人いて、片方を間違えて選んで消し、
  // もう片方を選び直すと、選んだ一覧が本文から消しても減らないため両方届いていた
  it('同じ表示名の人を選び直したら、後から選んだ人（本文に残っている方）だけを返す', () => {
    const satoA = member({ id: 'sato-a', displayName: '佐藤' })
    const satoB = member({ id: 'sato-b', displayName: '佐藤' })
    const body = '@佐藤 お願いします'
    const result = resolveMentionUserIds(
      body,
      [
        { id: satoA.id, displayName: satoA.displayName },
        { id: satoB.id, displayName: satoB.displayName },
      ],
      [satoA, satoB]
    )
    expect(result).toEqual(['sato-b'])
  })

  // 「@山田」を選んだあと、差し込まれた空白を消して「太郎」を手で打ち、候補を選ばずに送ると、
  // 本文の「@山田太郎」を選んだ人の名前（山田）だけで照合していたため、山田さんに届いていた
  it('選んだ人の名前のあとに手で文字を足して別のメンバーの名前になったら、選んだ人に届けない', () => {
    const yamada = member({ id: 'yamada', displayName: '山田' })
    const yamadaTaro = member({ id: 'yamada-taro', displayName: '山田太郎' })
    const result = resolveMentionUserIds(
      '@山田太郎 お願いします',
      [{ id: yamada.id, displayName: yamada.displayName }],
      [yamada, yamadaTaro]
    )
    expect(result).toEqual([])
  })

  it('最大 MAX_MENTION_COUNT 件まで', () => {
    const many = Array.from({ length: MAX_MENTION_COUNT + 5 }, (_, i) => ({
      id: `u${i}`,
      displayName: `太郎${i}`,
    }))
    const candidates: SpaceMember[] = many.map((m) => member({ id: m.id, displayName: m.displayName }))
    const body = many.map((m) => `@${m.displayName}`).join(' ')
    const result = resolveMentionUserIds(body, many, candidates)
    expect(result).toHaveLength(MAX_MENTION_COUNT)
  })
})

describe('splitCommentBody', () => {
  it('mention が無ければそのまま1つのテキストを返す', () => {
    expect(splitCommentBody('こんにちは', [], allMembers)).toEqual([
      { type: 'text', value: 'こんにちは' },
    ])
  })

  it('本文が空なら空配列', () => {
    expect(splitCommentBody('', [], allMembers)).toEqual([])
  })

  it('@表示名 を mention セグメントに分ける', () => {
    const body = 'お願いします @編集イチロー よろしく'
    const result = splitCommentBody(body, [editor.id], allMembers)
    expect(result).toEqual([
      { type: 'text', value: 'お願いします ' },
      { type: 'mention', value: '@編集イチロー', userId: editor.id },
      { type: 'text', value: ' よろしく' },
    ])
  })

  it('短い名前が長い名前の一部を誤って拾わない', () => {
    const short = member({ id: 's1', displayName: '田中' })
    const long = member({ id: 'l1', displayName: '田中太郎' })
    const body = '@田中太郎 さん'
    const result = splitCommentBody(body, [short.id, long.id], [short, long])
    expect(result).toEqual([
      { type: 'mention', value: '@田中太郎', userId: long.id },
      { type: 'text', value: ' さん' },
    ])
  })
})
