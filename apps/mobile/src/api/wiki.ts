/**
 * Wiki ページの読み取り（本文つき・1件）。Web の useWikiPageDetail
 * （src/lib/hooks/useWikiPageDetail.ts）と同じ問い合わせ。見える範囲は RLS が決める。
 * スマホは読むだけ。編集は Web。
 */
import { supabase } from './supabase'

export interface WikiPage {
  id: string
  space_id: string
  title: string
  /** BlockNote のブロック配列の JSON 文字列（空のページ・フォルダは空文字） */
  body: string | null
  updated_at: string
  /** フォルダのページ。本文は持たない（Web 側は列を読まないが、スマホは「フォルダです」と出すために読む） */
  is_folder: boolean
}

export async function fetchWikiPage(orgId: string, pageId: string): Promise<WikiPage | null> {
  const { data, error } = await supabase
    .from('wiki_pages')
    .select('id, space_id, title, body, updated_at, is_folder')
    .eq('id', pageId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw error
  return (data as WikiPage | null) ?? null
}

/** 題名だけ（資料リンクの行用）。本文を読まない軽い問い合わせ */
export async function fetchWikiTitle(orgId: string, pageId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('wiki_pages')
    .select('id, title')
    .eq('id', pageId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw error
  return (data as { title: string } | null)?.title ?? null
}
