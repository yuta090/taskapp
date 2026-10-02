/**
 * 端末に取り置く（AsyncStorage に書く）問い合わせの条件。画面にも通信にも依らない。
 *
 * 取り置きは 1 つの文字列として丸ごと書き出す。Wiki の本文は 1 ページで数十 KB になりうるので、
 * 開いたページが増えるほど起動のたびに読み書きする量が膨らむ。本文つきのページ（'wikiPage'）は
 * メモリにだけ置き、端末には書かない。題名だけの軽い問い合わせ（'wikiTitle'）は書いてよい。
 * 議事録の本文つき（'meetingMinutes'）も同じ理由でメモリだけ。本文を持たない会議の一覧（'meetings'）は書いてよい。
 * 押したらすぐ出す方針のため、押す前の先読み（usePrefetchWikiPage・usePrefetchMeetingMinutes）はメモリ上で効く。
 */
import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query'

/** 端末に書かない問い合わせの先頭のキー */
const MEMORY_ONLY_KEYS = new Set(['wikiPage', 'meetingMinutes'])

export function shouldPersistQuery(query: Query): boolean {
  if (MEMORY_ONLY_KEYS.has(String(query.queryKey[0]))) return false
  return defaultShouldDehydrateQuery(query)
}
