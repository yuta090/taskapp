'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

export interface CtaOption {
  id: string
  name: string
  key: string
}

export interface EditablePost {
  id: string | null
  slug: string
  title: string
  description: string
  body_md: string
  status: 'draft' | 'published' | 'archived'
  cover_image_url: string
  tags: string[]
  author_name: string
  inline_cta_id: string | null
  footer_cta_id: string | null
  noindex: boolean
}

export default function BlogEditorClient({
  initialPost,
  ctaOptions,
}: {
  initialPost: EditablePost
  ctaOptions: CtaOption[]
}) {
  const router = useRouter()
  const [post, setPost] = useState<EditablePost>(initialPost)
  const [previewHtml, setPreviewHtml] = useState({ before: '', after: '', hasPlaceholder: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isNew = initialPost.id === null

  const set = <K extends keyof EditablePost>(key: K, value: EditablePost[K]) =>
    setPost((p) => ({ ...p, [key]: value }))

  // ライブプレビュー（デバウンス）
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/blog/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body_md: post.body_md }),
        })
        if (res.ok) {
          const d = await res.json()
          setPreviewHtml({ before: d.beforeHtml, after: d.afterHtml, hasPlaceholder: d.hasPlaceholder })
        }
      } catch {
        /* プレビュー失敗は無視（保存には影響しない） */
      }
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [post.body_md])

  async function save(nextStatus: EditablePost['status']) {
    setSaving(true)
    setError(null)
    const payload = { ...post, status: nextStatus }
    const method = isNew ? 'POST' : 'PATCH'
    try {
      const res = await fetch('/api/admin/blog', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? '保存に失敗しました')
        return
      }
      if (isNew && data.post?.id) {
        router.replace(`/admin/blog/${data.post.id}`)
      } else {
        setPost((p) => ({ ...p, status: nextStatus }))
      }
      router.refresh()
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!post.id || !confirm('この記事を削除しますか？')) return
    const res = await fetch(`/api/admin/blog?id=${post.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/admin/blog')
    else setError('削除に失敗しました')
  }

  const titleLen = post.title.length
  const descLen = post.description.length

  return (
    <div className="p-6 max-w-6xl">
      <AdminPageHeader
        title={isNew ? '新規記事' : '記事を編集'}
        description="Markdownで執筆。本文中に {{cta}} を置くとその位置に本文中CTAが入ります。"
        actions={
          <div className="flex items-center gap-2">
            {!isNew && (
              <button
                onClick={remove}
                className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
              >
                削除
              </button>
            )}
            <button
              onClick={() => save('draft')}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              下書き保存
            </button>
            <button
              onClick={() => save('published')}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {post.status === 'published' ? '更新（公開中）' : '公開する'}
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {/* SEO / メタ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <label className="block">
          <span className="text-xs text-gray-500">タイトル（全角32文字目安 / {titleLen}）</span>
          <input
            value={post.title}
            onChange={(e) => set('title', e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="資料回収が進まない税理士事務所へ…"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">slug（英小文字・数字・ハイフン）</span>
          <input
            value={post.slug}
            onChange={(e) => set('slug', e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
            placeholder="tax-document-collection"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-xs text-gray-500">
            メタディスクリプション（80〜120文字推奨 / {descLen}）
          </span>
          <textarea
            value={post.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">カバー画像URL（/ か https://）</span>
          <input
            value={post.cover_image_url}
            onChange={(e) => set('cover_image_url', e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">タグ（カンマ区切り）</span>
          <input
            value={post.tags.join(', ')}
            onChange={(e) =>
              set(
                'tags',
                e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              )
            }
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">本文中CTA（{'{{cta}}'} の位置に挿入）</span>
          <select
            value={post.inline_cta_id ?? ''}
            onChange={(e) => set('inline_cta_id', e.target.value || null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">（なし）</option>
            {ctaOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">末尾CTA</span>
          <select
            value={post.footer_cta_id ?? ''}
            onChange={(e) => set('footer_cta_id', e.target.value || null)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">（なし）</option>
            {ctaOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={post.noindex}
            onChange={(e) => set('noindex', e.target.checked)}
          />
          noindex（検索エンジンにインデックスさせない）
        </label>
      </div>

      {/* 本文: 2ペイン */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">Markdown</div>
          <textarea
            value={post.body_md}
            onChange={(e) => set('body_md', e.target.value)}
            rows={28}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono leading-relaxed"
            placeholder={'## 見出し\n\n本文…\n\n{{cta}}\n\n続きの本文…'}
          />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">プレビュー</div>
          <div className="rounded-lg border border-gray-200 px-4 py-3 h-[46rem] overflow-y-auto prose prose-sm prose-gray max-w-none">
            <div dangerouslySetInnerHTML={{ __html: previewHtml.before }} />
            {previewHtml.hasPlaceholder && (
              <div className="my-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 not-prose">
                ここに本文中CTA（{ctaOptions.find((c) => c.id === post.inline_cta_id)?.name ?? '未選択'}）が入ります
              </div>
            )}
            {previewHtml.hasPlaceholder && (
              <div dangerouslySetInnerHTML={{ __html: previewHtml.after }} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
