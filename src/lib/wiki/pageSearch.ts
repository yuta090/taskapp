/**
 * Wiki ページを名前（とタグ）で絞り込む。タスク詳細の「仕様書連携」欄で使う。
 * 資料が増えても探せるよう、タグの有無に関係なく全ページを対象にする。
 */

type SearchablePage = { title: string; tags?: string[] | null }

export interface WikiPageSearchResult<T> {
  /** 表示する候補（最大 limit 件） */
  matches: T[]
  /** 条件に合ったページの総数（「ほか N 件」の表示用） */
  total: number
  /** 入力と同じ名前のページ。あれば「新しく作る」を出さない */
  exactMatch: T | null
}

/** 全角英数・大文字小文字・空白の違いを吸収する */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * 一覧を下ごしらえして、検索する関数を返す。
 * 名前とタグの変換は一覧が変わったときの1回だけにして、1文字打つたびの検索では使い回す
 * （ページが多いスペースで、日本語入力の1打鍵ごとに全件を変換し直さないため）。
 *
 * 検索は、空白で区切った言葉を全部含むページを返す（順番は問わない）。
 * 並びは 同じ名前 → 名前が入力で始まる → それ以外 の順で、同じ順位の中は渡された順（最近更新順）を保つ。
 * 空の入力では絞り込まずに先頭から返す。
 */
export function createWikiPageSearch<T extends SearchablePage>(pages: readonly T[]) {
  const entries = pages.map((page) => {
    const title = normalizeForSearch(page.title)
    return { page, title, haystack: [title, ...(page.tags ?? []).map(normalizeForSearch)].join(' ') }
  })

  return (query: string, limit = 8): WikiPageSearchResult<T> => {
    const q = normalizeForSearch(query)
    if (!q) return { matches: pages.slice(0, limit), total: pages.length, exactMatch: null }

    const words = q.split(' ')
    const ranked: { page: T; rank: number; index: number }[] = []
    let exactMatch: T | null = null

    for (let index = 0; index < entries.length; index++) {
      const { page, title, haystack } = entries[index]
      if (!words.every((word) => haystack.includes(word))) continue

      const rank = title === q ? 0 : title.startsWith(q) ? 1 : 2
      if (rank === 0 && !exactMatch) exactMatch = page
      ranked.push({ page, rank, index })
    }

    ranked.sort((a, b) => a.rank - b.rank || a.index - b.index)
    return { matches: ranked.slice(0, limit).map((r) => r.page), total: ranked.length, exactMatch }
  }
}

/** 1回だけ探すとき用。繰り返し探すなら createWikiPageSearch で下ごしらえを使い回す */
export function searchWikiPages<T extends SearchablePage>(
  pages: readonly T[],
  query: string,
  limit = 8
): WikiPageSearchResult<T> {
  return createWikiPageSearch(pages)(query, limit)
}
