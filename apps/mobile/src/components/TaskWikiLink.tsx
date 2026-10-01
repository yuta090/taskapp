/**
 * タスク詳細の「資料」。タスクに紐づく Wiki ページ（wiki_page_id）を開く1行と、
 * Wiki ページを持たない資料の場所（spec_path。開けない）の表示。どちらも無ければ何も描かない。
 */
import type { Task } from '@/types/database'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useWikiPage, usePrefetchWikiPage } from '~/hooks/wikiQueries'
import { useColors } from '~/theme/colors'

export function TaskWikiLink({ task }: { task: Pick<Task, 'id' | 'wiki_page_id' | 'spec_path' | 'org_id' | 'space_id'> }) {
  const c = useColors()
  // 題名は手元にあれば出す。読めていなければ「資料を開く」（読み込みは裏で進み、開くころには本文も来ている）
  const page = useWikiPage(task.wiki_page_id)
  const prefetch = usePrefetchWikiPage()
  const pageId = task.wiki_page_id
  if (!pageId && !task.spec_path) return null

  return (
    <View>
      <Text style={[styles.heading, { color: c.textSecondary }]}>資料</Text>
      {pageId ? (
        <Pressable
          accessibilityRole="button"
          onPressIn={() => prefetch(pageId)}
          onPress={() => router.push({ pathname: '/wiki/[pageId]', params: { pageId } })}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.chip : c.surface, borderColor: c.border }]}>
          <Text style={[styles.label, { color: c.text }]} numberOfLines={1}>
            {page.data?.title ?? '資料を開く'}
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
