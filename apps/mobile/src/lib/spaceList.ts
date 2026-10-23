/**
 * プロジェクトタブの一覧に並べるプロジェクト。アーカイブ済みは出さず、sort_order の昇順（同じなら名前）。
 */
import type { Space } from '@/types/database'

export function listProjects(spaces: readonly Space[]): Space[] {
  return spaces
    .filter((s) => !s.archived_at)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja'))
}
