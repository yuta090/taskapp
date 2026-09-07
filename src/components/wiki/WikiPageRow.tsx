'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import { Tag } from '@phosphor-icons/react'
import { TruncatedText } from '@/components/shared'
import type { WikiPage } from '@/types/database'
import type { WikiListColumn } from '@/lib/wiki/listPrefs'
import { formatWikiAbsoluteTime, formatWikiRelativeTime, formatWikiShortDate } from '@/lib/wiki/listView'

export interface WikiRowMember {
  name: string
  avatarUrl: string | null
}

interface WikiPageRowProps {
  page: WikiPage
  isSelected: boolean
  onClick: () => void
  /** メタ行に出す項目。'updated_at' は右端固定位置に出る。 */
  columns: WikiListColumn[]
  getMember: (userId: string) => WikiRowMember | null
}

/** 20px 丸アバター。TaskRow の担当者アバターと同じ見た目（画像があれば画像、無ければ頭文字）。 */
function MemberAvatar({ member, fallbackId }: { member: WikiRowMember | null; fallbackId: string }) {
  const name = member?.name ?? `${fallbackId.slice(0, 8)}...`

  if (member?.avatarUrl) {
    return (
      <Image
        src={member.avatarUrl}
        alt=""
        width={20}
        height={20}
        className="w-5 h-5 rounded-full object-cover flex-shrink-0"
        unoptimized
      />
    )
  }

  return (
    <div
      className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-medium"
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/** メタ行の各項目の間に「·」区切りを挟む。 */
function withSeparators(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((node, index) =>
    index === 0 ? [node] : [<span key={`sep-${index}`} className="text-gray-300">·</span>, node]
  )
}

export function WikiPageRow({ page, isSelected, onClick, columns, getMember }: WikiPageRowProps) {
  const metaItems: ReactNode[] = []

  if (columns.includes('tags') && page.tags.length > 0) {
    metaItems.push(
      <span key="tags" className="flex items-center gap-1">
        <Tag className="text-gray-400 text-xs" />
        {page.tags.slice(0, 3).map(tag => (
          <span key={tag} className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded">
            {tag}
          </span>
        ))}
        {page.tags.length > 3 && (
          <span className="text-[10px] text-gray-400">+{page.tags.length - 3}</span>
        )}
      </span>
    )
  }

  if (columns.includes('author')) {
    const author = getMember(page.created_by)
    metaItems.push(
      <span key="author" className="flex items-center gap-1.5">
        <MemberAvatar member={author} fallbackId={page.created_by} />
        <span>{author?.name ?? `${page.created_by.slice(0, 8)}...`}</span>
      </span>
    )
  }

  if (columns.includes('updater') && page.updated_by !== page.created_by) {
    const updater = getMember(page.updated_by)
    metaItems.push(
      <span key="updater">更新: {updater?.name ?? `${page.updated_by.slice(0, 8)}...`}</span>
    )
  }

  if (columns.includes('created_at')) {
    metaItems.push(
      <span key="created_at" title={formatWikiAbsoluteTime(page.created_at)}>
        作成 {formatWikiShortDate(page.created_at)}
      </span>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all border-b border-gray-100 last:border-b-0 ${
        isSelected
          ? 'bg-indigo-50/60 border-l-2 border-l-indigo-500'
          : 'hover:bg-gray-50/80 border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex-1 min-w-0">
        <TruncatedText as="h3" className={`text-sm font-medium ${isSelected ? 'text-indigo-900' : 'text-gray-900'}`}>
          {page.title}
        </TruncatedText>
        {metaItems.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
            {withSeparators(metaItems)}
          </div>
        )}
      </div>
      {columns.includes('updated_at') && (
        <div
          className="text-xs text-gray-400 flex-shrink-0"
          title={formatWikiAbsoluteTime(page.updated_at)}
        >
          {formatWikiRelativeTime(page.updated_at)}
        </div>
      )}
    </div>
  )
}
