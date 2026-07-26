import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { articleSlugsForType, isShindanTypeKey } from '@/lib/task6/shindanArticles'

/**
 * GET /api/task6/shindan-articles?type=t6
 *
 * タスク滞留診断の結果画面（`/shindan/q` はクライアント側で結果を組み立てるため、
 * サーバーコンポーネントから記事を渡せない）が、そのタイプに効くTASK6記事を引く
 * 公開エンドポイント。未認証で叩ける（proxy は `/api` を素通しし、各routeが自衛する）。
 *
 * 自衛の考え方:
 *   - 読み取り専用・公開記事のみ・件数上限あり。秘匿情報も副作用も無いので認証は課さない。
 *   - 入力は `type` だけで、値は診断のタイプキー（t1〜t8）に限定する。任意のslugを
 *     受け取らないので、これ経由で未公開記事の存在を探ることはできない。
 *   - 記事の公開状態はDBが正本。対応表に載っていても**公開済みでなければ返さない**
 *     （結果画面にリンク切れを出さないための境界がここ）。
 *   - DBが落ちても 500 にせず空配列で返す。記事リンクは診断結果の付随情報であり、
 *     ここの失敗で結果画面ごと壊す方が損失が大きい。
 */

/** CDNキャッシュ。記事の公開状態は分単位で変わらないので、短めに寝かせて負荷を抑える。 */
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600'

export interface ShindanArticle {
  slug: string
  title: string
  description: string | null
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const type = request.nextUrl.searchParams.get('type') ?? ''
  if (!isShindanTypeKey(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }

  const slugs = articleSlugsForType(type)
  if (slugs.length === 0) {
    return NextResponse.json({ posts: [] }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  }

  const admin = createAdminClient()
  const { data, error } = await (admin as SupabaseClient)
    .from('blog_posts')
    .select('slug, title, description')
    .in('slug', slugs)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    // 予約投稿（未来日）を出さないための時刻比較。日付ではなく「瞬間」の比較なので
    // toISOString でよい（CLAUDE.md が禁じているのは日付文字列を作る用途）。
    .lte('published_at', new Date().toISOString())

  if (error) {
    console.error('shindan-articles: query failed:', error.message)
    return NextResponse.json({ posts: [] }, { headers: { 'Cache-Control': CACHE_CONTROL } })
  }

  const published = (data as ShindanArticle[] | null) ?? []
  const bySlug = new Map(published.map((p) => [p.slug, p]))
  // DBの返却順ではなく対応表の順（主処方が先頭）に並べ直す
  const posts = slugs
    .map((slug) => bySlug.get(slug))
    .filter((p): p is ShindanArticle => p !== undefined)
    .map((p) => ({ slug: p.slug, title: p.title, description: p.description ?? null }))

  return NextResponse.json({ posts }, { headers: { 'Cache-Control': CACHE_CONTROL } })
}
