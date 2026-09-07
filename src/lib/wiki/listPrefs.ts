'use client'

/**
 * Wiki 一覧の表示設定（表示項目・並べ替え）。ブラウザ単位（localStorage）で保存する。
 * 検索語・タグ・作成者の絞り込みはここでは保存しない（画面を離れたら消える）。
 *
 * 保存・復元の作法は useGanttSidebarWidth と同じ:
 * 遅延初期化で localStorage を読み、変更のたびに書き込む。
 */
import { useCallback, useState } from 'react'
import {
  DEFAULT_WIKI_SORT,
  type WikiListSort,
  type WikiSortDir,
  type WikiSortKey,
  type WikiViewMode,
} from './listView'

export type WikiListColumn = 'tags' | 'author' | 'updater' | 'created_at' | 'updated_at'

export interface WikiListPrefs {
  columns: WikiListColumn[]
  sort: WikiListSort
  /** 表示切替（一覧/フォルダ/マイルストーン別）。 */
  view: WikiViewMode
  /** フォルダ表示で折りたたんだページ id。 */
  collapsedIds: string[]
}

export const WIKI_LIST_PREFS_KEY = 'wiki-list-prefs:v1'

export const DEFAULT_WIKI_LIST_PREFS: WikiListPrefs = {
  columns: ['tags', 'author', 'updated_at'],
  sort: DEFAULT_WIKI_SORT,
  view: 'list',
  collapsedIds: [],
}

const VALID_COLUMNS: readonly WikiListColumn[] = ['tags', 'author', 'updater', 'created_at', 'updated_at']
const VALID_SORT_KEYS: readonly WikiSortKey[] = ['updated_at', 'created_at', 'title', 'author']
const VALID_SORT_DIRS: readonly WikiSortDir[] = ['asc', 'desc']
const VALID_VIEWS: readonly WikiViewMode[] = ['list', 'folder', 'milestone']

function isWikiListColumn(value: unknown): value is WikiListColumn {
  return typeof value === 'string' && (VALID_COLUMNS as readonly string[]).includes(value)
}

function isWikiSortKey(value: unknown): value is WikiSortKey {
  return typeof value === 'string' && (VALID_SORT_KEYS as readonly string[]).includes(value)
}

function isWikiSortDir(value: unknown): value is WikiSortDir {
  return typeof value === 'string' && (VALID_SORT_DIRS as readonly string[]).includes(value)
}

function isWikiViewMode(value: unknown): value is WikiViewMode {
  return typeof value === 'string' && (VALID_VIEWS as readonly string[]).includes(value)
}

/** 壊れた JSON・未知の列/並べ替えキーは既定値に戻す。 */
export function parseWikiListPrefs(raw: string | null): WikiListPrefs {
  if (raw == null || raw.trim() === '') return DEFAULT_WIKI_LIST_PREFS

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WIKI_LIST_PREFS

    const record = parsed as Record<string, unknown>

    // 配列なら空でも尊重する（利用者が意図的に全部 OFF にした状態を保存できるように）。
    // 配列でない（壊れている）ときだけ既定に戻す。
    const columns = Array.isArray(record.columns)
      ? record.columns.filter(isWikiListColumn)
      : DEFAULT_WIKI_LIST_PREFS.columns

    const rawSort =
      typeof record.sort === 'object' && record.sort !== null
        ? (record.sort as Record<string, unknown>)
        : {}
    const key = isWikiSortKey(rawSort.key) ? rawSort.key : DEFAULT_WIKI_SORT.key
    const dir = isWikiSortDir(rawSort.dir) ? rawSort.dir : DEFAULT_WIKI_SORT.dir

    // 古い保存値（view/collapsedIds が無い）は既定に戻す。未知の view も既定の list に戻す。
    const view = isWikiViewMode(record.view) ? record.view : DEFAULT_WIKI_LIST_PREFS.view

    const collapsedIds = Array.isArray(record.collapsedIds)
      ? record.collapsedIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_WIKI_LIST_PREFS.collapsedIds

    return {
      columns,
      sort: { key, dir },
      view,
      collapsedIds,
    }
  } catch {
    return DEFAULT_WIKI_LIST_PREFS
  }
}

function readStored(): WikiListPrefs {
  if (typeof window === 'undefined') return DEFAULT_WIKI_LIST_PREFS
  try {
    return parseWikiListPrefs(localStorage.getItem(WIKI_LIST_PREFS_KEY))
  } catch {
    return DEFAULT_WIKI_LIST_PREFS
  }
}

function writeStored(prefs: WikiListPrefs) {
  try {
    localStorage.setItem(WIKI_LIST_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // プライベートモード等でストレージが使えなくても、このセッション内では state で機能する
  }
}

export function useWikiListPrefs(): [WikiListPrefs, (prefs: WikiListPrefs) => void] {
  const [prefs, setPrefsState] = useState<WikiListPrefs>(readStored)

  const setPrefs = useCallback((next: WikiListPrefs) => {
    setPrefsState(next)
    writeStored(next)
  }, [])

  return [prefs, setPrefs]
}
