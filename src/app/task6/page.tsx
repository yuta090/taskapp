import type { Metadata } from 'next'
import Link from 'next/link'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { listPublishedPosts } from '@/lib/blog/posts'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  // 検索需要のある「タスク管理」(月12,100)を先頭に置く。TASK6は無名なのでブランド先頭にしない
  title: 'タスク管理を学ぶメディア TASK6（タスクシックス）',
  description:
    'タスク管理・プロジェクト管理・仕事の進め方を、実際にあった話から学べるメディア。ツールを入れたのに回らない、を直します。',
  alternates: { canonical: 'https://agentpm.app/task6' },
}

interface PostCard {
  slug: string
  title: string
  description: string | null
  published_at: string | null
  cover_image_url: string | null
  cover_caption: string | null
  tags: string[]
}

/** サムネ画像+コピーライト的キャプションの下帯(HTML重ね・画像に文字は焼き込まない) */
function Thumb({ post, rounded, eager }: { post: PostCard; rounded?: boolean; eager?: boolean }) {
  return (
    <div className={`relative overflow-hidden ${rounded ? 'rounded-2xl' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbUrl(post)}
        alt=""
        width={1200}
        height={630}
        loading={eager ? undefined : 'lazy'}
        className="aspect-video w-full object-cover"
      />
      {post.cover_caption && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent px-5 pb-3.5 pt-12">
          <p className="text-lg font-bold tracking-wide text-white drop-shadow-md">
            {post.cover_caption}
          </p>
        </div>
      )}
    </div>
  )
}

function thumbUrl(p: PostCard): string {
  // 一覧のサムネはイラスト(文字なし)。隣にHTMLのタイトルが並ぶため、文字入りバナーだと
  // タイトルが二重になる。合成バナー(イラスト+タイトル)はSNSシェア用のog:image専用。
  // カバー未設定の記事のみ、自動生成のOG画像で代用する
  return p.cover_image_url ?? `/task6/${p.slug}/opengraph-image`
}

function PostDate({ value }: { value: string | null }) {
  if (!value) return null
  return (
    <time dateTime={value} className="text-xs text-slate-400">
      {new Date(value).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })}
    </time>
  )
}

function Tags({ tags, max = 2 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, max).map((t) => (
        <span
          key={t}
          className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700"
        >
          {t}
        </span>
      ))}
    </div>
  )
}

/** 先頭記事: 特集扱いの大きなカード */
function FeaturedCard({ post }: { post: PostCard }) {
  return (
    <Link
      href={`/task6/${post.slug}`}
      className="group grid gap-6 rounded-3xl border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md md:grid-cols-2 md:p-5"
    >
      <Thumb post={post} rounded eager />
      <div className="flex flex-col justify-center gap-3 px-1 pb-3 md:py-4 md:pr-4">
        <Tags tags={post.tags} max={3} />
        <h2 className="text-2xl font-bold leading-snug tracking-tight text-slate-900 group-hover:text-amber-600 md:text-3xl">
          {post.title}
        </h2>
        {post.description && (
          <p className="line-clamp-3 leading-relaxed text-slate-600">{post.description}</p>
        )}
        <PostDate value={post.published_at} />
      </div>
    </Link>
  )
}

function Card({ post }: { post: PostCard }) {
  return (
    <Link
      href={`/task6/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <Thumb post={post} />
      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <Tags tags={post.tags} />
        <h3 className="line-clamp-2 text-lg font-bold leading-snug text-slate-900 group-hover:text-amber-600">
          {post.title}
        </h3>
        {post.description && (
          <p className="line-clamp-2 text-sm leading-relaxed text-slate-500">{post.description}</p>
        )}
        <div className="mt-auto pt-1">
          <PostDate value={post.published_at} />
        </div>
      </div>
    </Link>
  )
}

export default async function Task6IndexPage() {
  const posts = await listPublishedPosts()
  const [featured, ...rest] = posts

  return (
    <main className="font-sans antialiased text-slate-900 bg-surface">
      <LPHeader />

      {/* マストヘッド(メディアの顔) */}
      <section className="border-b border-slate-100 bg-gradient-to-b from-amber-50/60 to-white">
        <div className="mx-auto max-w-6xl px-5 pb-14 pt-28 md:pt-32">
          <p className="text-sm font-bold tracking-wide text-amber-600">
            タスク管理と仕事の進め方を学ぶメディア
          </p>
          {/* h1 はロゴ画像。検索エンジンは alt を見出しの文字として読むので、
              ブランド名だけでなく何のメディアかまで書く（見た目は変えない） */}
          <h1 className="mt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/task6/logo.png"
              alt="TASK6（タスクシックス）｜タスク管理を学ぶメディア"
              width={957}
              height={222}
              fetchPriority="high"
              className="h-11 w-auto md:h-14"
            />
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
            「ツールを入れたのに、仕事がまわらない」を直す。
            タスク管理・プロジェクト管理・仕事の進め方を、実際にあった話から学ぶメディアです。
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 pb-24">
        {/* 記事 */}
        {posts.length === 0 ? (
          <section className="mt-14 rounded-3xl border border-dashed border-amber-200 bg-amber-50/40 px-8 py-14 text-center">
            <p className="text-sm font-bold tracking-wide text-amber-600">COMING SOON</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">創刊準備中です</h2>
            <p className="mx-auto mt-3 max-w-xl leading-relaxed text-slate-600">
              いま第1期の記事を制作しています。公開までのあいだ、無料の診断とテンプレートを
              先にお使いいただけます。
            </p>
          </section>
        ) : (
          <section className="mt-14">
            <FeaturedCard post={featured} />
            {rest.length > 0 && (
              <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((p) => (
                  <Card key={p.slug} post={p} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* 定番コーナー(記事ゼロでもメディアとして機能する導線) */}
        <section className="mt-16">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">読む前に、試せるもの</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            <Link
              href="/shindan"
              className="group flex flex-col rounded-2xl bg-slate-900 p-6 transition-transform hover:-translate-y-0.5"
            >
              <p className="text-xs font-bold tracking-wide text-amber-400">無料・約3分</p>
              <h3 className="mt-2 text-lg font-bold text-white">タスク滞留診断</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                仕事が止まりやすいタイプと、どこから手を打てばいいかが図で分かります。
              </p>
              <span className="mt-4 text-sm font-semibold text-amber-400 group-hover:text-amber-300">
                診断してみる →
              </span>
            </Link>
            <Link
              href="/task6/dl/task-list-excel"
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <p className="text-xs font-bold tracking-wide text-amber-600">無料テンプレート</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900">タスク管理表（Excel）</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                「いま誰の番か」が分かるボール列つき。そのまま使える管理表を配布中。
              </p>
              <span className="mt-4 text-sm font-semibold text-amber-600 group-hover:text-amber-700">
                受け取る →
              </span>
            </Link>
            <Link
              href="/task6/author"
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <p className="text-xs font-bold tracking-wide text-slate-400">ABOUT</p>
              <h3 className="mt-2 text-lg font-bold text-slate-900">編集方針と著者</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                実際にあった話だけを書く。ツールなしの解決法まで書く。TASK6の約束です。
              </p>
              <span className="mt-4 text-sm font-semibold text-amber-600 group-hover:text-amber-700">
                詳しく →
              </span>
            </Link>
          </div>
        </section>
      </div>

      <LPFooter />
    </main>
  )
}
