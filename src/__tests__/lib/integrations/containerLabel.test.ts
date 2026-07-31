import { describe, it, expect } from 'vitest'
import {
  INTEGRATIONS,
  containerLabelOf,
  listIntegrations,
} from '@/lib/integrations/registry'
import { isImplementedTaskSyncProvider } from '@/lib/task-sync/implemented'

/**
 * 取り込み対象の「入れ物」の呼び名。
 *
 * これまで画面には「読み込み対象リスト(任意・カンマ区切り)」とだけ出ていた。実体は
 * Trello ならボード、Backlog や Jira ならプロジェクトで、ツールごとに呼び名が違うのに
 * Google ToDo の言葉（リスト）のまま固定されていて、利用者に意味が通じなかった。
 * 呼び名はレジストリ（ツール定義の単一の真実源）に持たせ、UIはそれを表示する。
 */
describe('containerLabelOf', () => {
  it.each([
    ['trello', 'ボード'],
    ['backlog', 'プロジェクト'],
    ['jira', 'プロジェクト'],
    ['redmine', 'プロジェクト'],
    ['linear', 'チーム'],
    ['kintone', 'アプリ'],
    ['notion', 'データベース'],
    ['google_tasks', 'リスト'],
  ])('%s の入れ物は「%s」と呼ぶ', (id, label) => {
    expect(containerLabelOf(id)).toBe(label)
  })

  /**
   * multica だけは呼び名を持たない。取り込み先の指定が専用UI(MulticaTargetSpaceSelect)で完結し、
   * 外部の「入れ物」を一覧する口が無いため。呼び名を付けると選択欄が出てしまい、
   * 取りに行けない一覧を延々と読みに行く。
   */
  it('multica には呼び名を付けない（入れ物を一覧する口が無いため）', () => {
    expect(containerLabelOf('multica')).toBe('')
  })

  it('アダプタ実装済みのツールは、すべて呼び名を持つ', () => {
    for (const def of listIntegrations()) {
      if (!isImplementedTaskSyncProvider(def.id)) continue
      expect(INTEGRATIONS[def.id].containerLabel, `${def.id}`).toBeTruthy()
    }
  })

  it('未知のIDでも空文字を返して落ちない（画面が壊れるより既定語で出す）', () => {
    expect(containerLabelOf('unknown')).toBe('')
  })
})
