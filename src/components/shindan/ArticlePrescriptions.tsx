'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * 診断結果に差し込む「あなたのタイプに効く記事」（＝処方箋の在庫への導線）。
 *
 * 診断は「症状が分かる」ところまでしかやらない。その場で読める処方箋（TASK6の記事）へ
 * 繋ぐことで、メール登録前の読者にも持ち帰るものを渡す。
 *
 * 記事在庫は育てている途中なので、**0件のときは見出しごと何も描かない**。
 * 「準備中」「Coming soon」の類は、診断を受けた直後の人の熱を冷ますだけなので置かない。
 * 取得失敗時も同じ（記事リンクは付随情報であり、これで結果画面を壊さない）。
 *
 * 記事の紐付けは `src/lib/task6/shindanArticles.ts`（正本は docs/blog/SHINDAN_ARTICLE_MAP.md）。
 * 公開済みかの判定はAPI側が行うため、ここにリンク切れは出ない。
 */

interface ShindanArticle {
  slug: string
  title: string
  description: string | null
}

interface ArticlePrescriptionsProps {
  /** 診断のタイプキー（t1〜t8） */
  type: string
  /** 画面に出すタイプ名（「無音型」等）。自分ごとに見えるよう見出しに使う */
  typeName: string
}

export function ArticlePrescriptions({ type, typeName }: ArticlePrescriptionsProps) {
  const [posts, setPosts] = useState<ShindanArticle[]>([])

  useEffect(() => {
    let alive = true
    fetch(`/api/task6/shindan-articles?type=${encodeURIComponent(type)}`)
      .then((res) => (res.ok ? res.json() : { posts: [] }))
      .then((data: { posts?: ShindanArticle[] }) => {
        if (alive) setPosts(data.posts ?? [])
      })
      .catch(() => {
        // 記事リンクは付随情報。取得失敗は黙って何も出さない（結果画面は成立させる）
        if (alive) setPosts([])
      })
    return () => {
      alive = false
    }
  }, [type])

  if (posts.length === 0) return null

  return (
    <div className="tsum" style={{ marginTop: 12 }}>
      <div className="tbody">
        <b style={{ color: 'var(--main)' }}>{typeName}の人が、今週から試せること</b>
        <ul style={{ margin: '10px 0 0', paddingLeft: '1.2em' }}>
          {posts.map((p) => (
            <li key={p.slug} style={{ marginBottom: 6 }}>
              <Link href={`/task6/${p.slug}`}>{p.title}</Link>
              {p.description ? (
                <span style={{ display: 'block', fontSize: 13, opacity: 0.75 }}>{p.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
