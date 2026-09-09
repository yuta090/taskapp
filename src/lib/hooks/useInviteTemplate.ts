'use client'

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { TemplateFields } from '@/lib/email/templates/core'

/** どの段の文面か（org=事務所が保存 / platform=運営が保存 / code=最初からの文面） */
export type InviteTemplateSource = 'org' | 'platform' | 'code'

export interface InviteTemplate {
  fields: TemplateFields
  source: InviteTemplateSource
  /** 事務所の文面として保存できる立場か（事務所の管理者だけ） */
  canSaveTemplate: boolean
}

/**
 * 招待フォームに出す「いま使われている文面」。
 * 開いたときだけ取りに行き、役割(client/member)ごとに別の文面を持つ。
 */
export function useInviteTemplate(
  spaceId: string | null,
  role: 'client' | 'member',
  enabled: boolean,
) {
  const query = useQuery<InviteTemplate>({
    queryKey: ['inviteTemplate', spaceId, role],
    enabled: enabled && !!spaceId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<InviteTemplate> => {
      const res = await fetch(`/api/invites/template?space_id=${spaceId}&role=${role}`)
      if (!res.ok) throw new Error('文面を読み込めませんでした')
      const json = (await res.json()) as { fields: TemplateFields; source: InviteTemplateSource; can_save_template: boolean }
      return { fields: json.fields, source: json.source, canSaveTemplate: json.can_save_template }
    },
  })

  const { refetch } = query
  // 保存した直後に読み直すため（保存で変わるのは、いま開いている役割の文面だけ）
  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  return {
    template: query.data ?? null,
    loading: enabled && !!spaceId && query.isPending && !query.data,
    error: query.error ? '文面を読み込めませんでした' : null,
    refresh,
  }
}
