/**
 * タスク詳細の「仕様書連携」（Web のタスク詳細と同じ名前）。タスクに紐づく Wiki ページ（wiki_page_id）を開く1行と、
 * Wiki ページを持たない資料の場所（spec_path。http/https なら開く）。どちらも無いときは「未設定」と出す
 * （欄ごと消すと、紐づいていないのか見えていないのか分からない）。
 */
import type { Task } from '@/types/database'
import * as WebBrowser from 'expo-web-browser'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePrefetchWikiPage, useWikiTitle } from '~/hooks/wikiQueries'
import { safeLinkHref } from '~/lib/wikiBody'
import { useColors } from '~/theme/colors'

export function TaskWikiLink({ task }: { task: Pick<Task, 'id' | 'wiki_page_id' | 'spec_path' | 'org_id' | 'space_id'> }) {
  const c = useColors()
  // 題名だけの軽い問い合わせ。手元にあれば出し、無ければ「Wiki ページを開く」。本文は押す瞬間（onPressIn）に先読みする
  const title = useWikiTitle(task.wiki_page_id, task.org_id)
  const prefetch = usePrefetchWikiPage()
  const pageId = task.wiki_page_id
  const specPath = task.spec_path?.trim() || null
  const specHref = safeLinkHref(specPath)

  return (
    <View>
      <Text style={[styles.heading, { color: c.textSecondary }]}>仕様書連携</Text>
      {pageId ? (
        <Pressable
          accessibilityRole="button"
          onPressIn={() => prefetch(pageId, task.org_id)}
          onPress={() => router.push({ pathname: '/wiki/[pageId]', params: { pageId, orgId: task.org_id } })}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.chip : c.surface, borderColor: c.border }]}>
          <Text style={[styles.label, { color: c.text }]} numberOfLines={1}>
            {title.data ?? 'Wiki ページを開く'}
          </Text>
          <Text style={[styles.chevron, { color: c.textMuted }]}>›</Text>
        </Pressable>
      ) : specPath && specHref?.startsWith('http') ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync(specHref)}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.chip : c.surface, borderColor: c.border }]}>
          <Text style={[styles.label, { color: c.primary }]} numberOfLines={1}>
            {specPath}
          </Text>
          <Text style={[styles.chevron, { color: c.textMuted }]}>›</Text>
        </Pressable>
      ) : specPath ? (
        <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text selectable style={[styles.label, { color: c.textSecondary }]}>
            {specPath}
          </Text>
        </View>
      ) : (
        <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.label, { color: c.textMuted }]}>未設定（Web で設定できます）</Text>
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
