/**
 * タスク詳細の「資料」。タスクに紐づく Wiki ページ（wiki_page_id）を開く1行と、
 * Wiki ページを持たない資料の場所（spec_path。開けない）の表示。どちらも無ければ何も描かない。
 */
import type { Task } from '@/types/database'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePrefetchWikiPage, useWikiTitle } from '~/hooks/wikiQueries'
import { useColors } from '~/theme/colors'

export function TaskWikiLink({ task }: { task: Pick<Task, 'id' | 'wiki_page_id' | 'spec_path' | 'org_id' | 'space_id'> }) {
  const c = useColors()
  // 題名だけの軽い問い合わせ。手元にあれば出し、無ければ「資料を開く」。本文は押す瞬間（onPressIn）に先読みする
  const title = useWikiTitle(task.wiki_page_id, task.org_id)
  const prefetch = usePrefetchWikiPage()
  const pageId = task.wiki_page_id
  if (!pageId && !task.spec_path) return null

  return (
    <View>
      <Text style={[styles.heading, { color: c.textSecondary }]}>資料</Text>
      {pageId ? (
        <Pressable
          accessibilityRole="button"
          onPressIn={() => prefetch(pageId, task.org_id)}
          onPress={() => router.push({ pathname: '/wiki/[pageId]', params: { pageId, orgId: task.org_id } })}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.chip : c.surface, borderColor: c.border }]}>
          <Text style={[styles.label, { color: c.text }]} numberOfLines={1}>
            {title.data ?? '資料を開く'}
          </Text>
          <Text style={[styles.chevron, { color: c.textMuted }]}>›</Text>
        </Pressable>
      ) : (
        <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text selectable style={[styles.label, { color: c.textSecondary }]}>
            {task.spec_path}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  heading: { fontSize: 13, fontWeight: '600', paddingBottom: 6 },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1, fontSize: 15 },
  chevron: { fontSize: 22, marginLeft: 8 },
})
