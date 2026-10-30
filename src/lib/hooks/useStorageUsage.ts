'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * ディスク使用量（`/api/storage/usage`）。表示専用。
 *   - useOrgStorageUsage: 組織全体の内訳（組織のオーナーだけが取れる）
 *   - useSpaceStorageUsage: プロジェクト1つ分（社内メンバーが取れる）
 */

export interface OrgStorageUsage {
  total_bytes: number
  chat_attachments_bytes: number
  spaces: Array<{ space_id: string; name: string; bytes: number; file_count: number }>
}

export interface SpaceStorageUsage {
  space_id: string
  bytes: number
  file_count: number
}

async function fetchUsage<T>(query: string): Promise<T> {
  const res = await fetch(`/api/storage/usage?${query}`, { credentials: 'same-origin' })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(json.error ?? `ディスク使用量を取得できませんでした (${res.status})`)
  }
  return json
}

// 使用量はファイルを上げ下ろししたときしか変わらないので、秒単位の鮮度は要らない
const STALE_TIME = 2 * 60_000

export function useOrgStorageUsage(orgId: string | undefined, enabled = true) {
  return useQuery<OrgStorageUsage>({
    queryKey: ['storageUsage', 'org', orgId ?? null],
    queryFn: () => fetchUsage<OrgStorageUsage>(`org_id=${encodeURIComponent(orgId!)}`),
    enabled: enabled && !!orgId,
    staleTime: STALE_TIME,
  })
}

export function useSpaceStorageUsage(orgId: string, spaceId: string) {
  return useQuery<SpaceStorageUsage>({
    queryKey: ['storageUsage', 'space', spaceId],
    queryFn: () =>
      fetchUsage<SpaceStorageUsage>(
        `org_id=${encodeURIComponent(orgId)}&space_id=${encodeURIComponent(spaceId)}`,
      ),
    staleTime: STALE_TIME,
  })
}
