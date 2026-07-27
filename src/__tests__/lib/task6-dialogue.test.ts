import { beforeEach, describe, expect, it, vi } from 'vitest'

// 記事本文(サニタイズ済みHTML)の「**話者**「セリフ」」段落を、
// 丸アイコン付きの吹き出しHTMLへ変換するテンプレート側ロジックのテスト。
// 変換はサニタイズ後に行うため、挿入されるHTMLはすべて自前のテンプレート文字列で、
// セリフ部分は既にサニタイズ済みの断片をそのまま移し替える。

const SUPABASE_URL = 'https://example.supabase.co'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
})

async function subject() {
  return await import('@/lib/task6/dialogue')
}

describe('renderTask6BodyHtml: 会話の吹き出し変換', () => {
  it('ガントの会話段落を、アイコン付き吹き出しに変換する', async () => {
    const { renderTask6BodyHtml } = await subject()
    const html = '<p><strong>ガント</strong>「まず全体を見よう」</p>'
    const out = renderTask6BodyHtml(html)

    expect(out).toContain(`${SUPABASE_URL}/storage/v1/object/public/task6-covers/characters/gantt.jpg`)
    expect(out).toContain('ガント先生')
    expect(out).toContain('まず全体を見よう')
    // 元の <p><strong> 形式の段落は残らない
    expect(out).not.toContain('<p><strong>ガント</strong>')
  })

  it('アイビー・ゆあも変換され、それぞれのアイコンを使う', async () => {
    const { renderTask6BodyHtml } = await subject()
    const html =
      '<p><strong>アイビー</strong>「今日の6行から」</p>\n<p><strong>ゆあ</strong>「メモしました！」</p>'
    const out = renderTask6BodyHtml(html)

    expect(out).toContain('characters/ivy.jpg')
    expect(out).toContain('characters/yua.jpg')
    expect(out).toContain('アイビー先生')
    // ゆあは「先生」を付けない表示名
    expect(out).toMatch(/>ゆあ</)
  })

  it('セリフ内のインライン装飾(リンク等)を保持する', async () => {
    const { renderTask6BodyHtml } = await subject()
    const html =
      '<p><strong>ガント</strong>「<a href="/task6">一覧</a>を見てごらん」</p>'
    const out = renderTask6BodyHtml(html)

    expect(out).toContain('<a href="/task6">一覧</a>')
  })

  it('登録されていない話者は変換しない', async () => {
    const { renderTask6BodyHtml } = await subject()
    const html = '<p><strong>タロウ</strong>「こんにちは」</p>'
    expect(renderTask6BodyHtml(html)).toBe(html)
  })

  it('会話を含まないHTMLはそのまま返す', async () => {
    const { renderTask6BodyHtml } = await subject()
    const html = '<h2 id="a">見出し</h2>\n<p>ふつうの段落。<strong>強調</strong>もそのまま。</p>'
    expect(renderTask6BodyHtml(html)).toBe(html)
  })

  it('鉤括弧の外に補足がある段落は変換しない(誤爆防止)', async () => {
    const { renderTask6BodyHtml } = await subject()
    const html = '<p><strong>ガント</strong>「一部だけ」と言った。</p>'
    expect(renderTask6BodyHtml(html)).toBe(html)
  })

  it('閉じ括弧のない段落が、後続の段落と誤結合しない', async () => {
    const { renderTask6BodyHtml } = await subject()
    const html =
      '<p><strong>ガント</strong>「閉じ忘れの段落</p>\n<p>次の「段落」です</p>'
    expect(renderTask6BodyHtml(html)).toBe(html)
  })
})

describe('renderTask6BodyHtml: キャラクター紹介カード', () => {
  it('{{characters}} 段落を3人の紹介カードへ置き換える', async () => {
    const { renderTask6BodyHtml } = await subject()
    const html = '<p>前文</p>\n<p>{{characters}}</p>\n<p>後文</p>'
    const out = renderTask6BodyHtml(html)

    expect(out).toContain('characters/gantt.jpg')
    expect(out).toContain('characters/ivy.jpg')
    expect(out).toContain('characters/yua.jpg')
    expect(out).toContain('ガント先生')
    expect(out).toContain('アイビー先生')
    expect(out).not.toContain('{{characters}}')
    expect(out).toContain('<p>前文</p>')
    expect(out).toContain('<p>後文</p>')
  })
})

describe('characterImageUrl', () => {
  it('公開バケットのURLを組み立てる', async () => {
    const { characterImageUrl } = await subject()
    expect(characterImageUrl('yua')).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/task6-covers/characters/yua.jpg`,
    )
  })
})
