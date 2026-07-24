import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LPHeader } from '@/components/lp/Header'
import { LPFooter } from '@/components/lp/Footer'
import { CtaBlock } from '@/components/blog/CtaBlock'
import { getPublishedPost } from '@/lib/blog/posts'
import { isKnownAuthorName } from '@/lib/task6/authors'
import { renderMarkdownToHtml, splitOnCtaPlaceholder } from '@/lib/markdown'

export const dynamic = 'force-dynamic'

const SITE = 'https://agentpm.app'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) return { title: '記事が見つかりません | TASK6' }

  const url = `${SITE}/task6/${post.slug}`
  return {
    title: `${post.title} | TASK6`,
    description: post.description ?? undefined,
    alternates: { canonical: url },
    robots: post.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      title: post.title,
      description: post.description ?? undefined,
      url,
      type: 'article',
      locale: 'ja_JP',
      ...(post.cover_image_url ? { images: [{ url: post.cover_image_url }] } : {}),
    },
  }
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params
  const post = await getPublishedPost(slug)
  if (!post) notFound()

  const { before, after, hasPlaceholder } = splitOnCtaPlaceholder(post.body_md)
  const beforeHtml = await renderMarkdownToHtml(before)
  const afterHtml = hasPlaceholder ? await renderMarkdownToHtml(after) : ''

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description ?? undefined,
    datePublished: post.published_at ?? undefined,
    author: post.author_name
      ? {
          '@type': 'Person',
          name: post.author_name,
          // 著者プロフィールに紐づけて「誰が書いたか」を機械可読にする(E-E-A-T)
          // @idはプロフィール側のPersonと同一(検索エンジンが同一人物と結合できる)
          ...(isKnownAuthorName(post.author_name)
            ? { '@id': `${SITE}/task6/author#person`, url: `${SITE}/task6/author` }
            : {}),
        }
      : undefined,
    mainEntityOfPage: `${SITE}/task6/${post.slug}`,
    ...(post.cover_image_url ? { image: post.cover_image_url } : {}),
  }

  return (
    <main className="font-sans antialiased text-slate-900 bg-white">
      <LPHeader />
      <script
        type="application/ld+json"
        // DB由来のtitle等が混ざるため、</script>混入によるscript脱出を防ぐ
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <article className="mx-auto max-w-3xl px-5 pb-20 pt-24">
        <header className="mb-8">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900">
            {post.title}
          </h1>
          <div className="mt-3 flex items-center gap-3 text-sm text-slate-500">
            {post.published_at && (
              <time dateTime={post.published_at}>
                {new Date(post.published_at).toLocaleDateString('ja-JP')}
              </time>
            )}
            {post.author_name &&
              (isKnownAuthorName(post.author_name) ? (
                <Link
                  href="/task6/author"
                  className="underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
                >
                  {post.author_name}
                </Link>
              ) : (
                <span>{post.author_name}</span>
              ))}
          </div>
        </header>

        {post.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.cover_image_url}
            alt=""
            className="mb-8 w-full rounded-2xl object-cover"
          />
        )}

        <div className="prose prose-slate max-w-none prose-headings:scroll-mt-24">
          <div dangerouslySetInnerHTML={{ __html: beforeHtml }} />
          {hasPlaceholder && post.inline_cta && <CtaBlock cta={post.inline_cta} />}
          {hasPlaceholder && <div dangerouslySetInnerHTML={{ __html: afterHtml }} />}
        </div>

        {post.footer_cta && (
          <div className="mt-12">
            <CtaBlock cta={post.footer_cta} />
          </div>
        )}
      </article>
      <LPFooter />
    </main>
  )
}
