import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import * as WebBrowser from 'expo-web-browser'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { WEB_BASE_URL } from '~/api/webApi'
import { formatDue } from '~/components/TaskRow'
import { WikiBody } from '~/components/WikiBody'
import { EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { useParsedWikiBody, useWikiPage } from '~/hooks/wikiQueries'
import { useReadyContext } from '~/hooks/useSession'
import { useColors } from '~/theme/colors'

/** Wiki のページ。スマホは読むだけ（編集は Web）。前回の本文が手元にあれば、通信を待たずにそれを先に出す */
export default function WikiPageScreen() {
  const c = useColors()
  const { pageId } = useLocalSearchParams<{ pageId: string }>()
  const ctx = useReadyContext()
  const query = useWikiPage(pageId)
  const page = query.data
  const blocks = useParsedWikiBody(page?.body)

  // 全画面の Loading は、手元に何も無いときだけ
  if (query.isPending) return <Loading />
  if (query.isError && !page) return <ErrorRetry message="ページを読み込めませんでした" onRetry={() => query.refetch()} />
  if (!page || !ctx) {
    return <EmptyState message="このページを開けませんでした。削除されたか、見る権限がない可能性があります。" />
  }

  const updated = formatDue(formatDateToLocalString(new Date(page.updated_at)))
  const webUrl = `${WEB_BASE_URL}/${ctx.orgId}/project/${page.space_id}/wiki?page=${page.id}`

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}>
      <Stack.Screen options={{ title: page.title }} />
      <Text selectable style={[styles.title, { color: c.text }]}>
        {page.title}
      </Text>
      <View style={styles.meta}>
        {updated ? <Text style={[styles.metaText, { color: c.textMuted }]}>更新: {updated}</Text> : null}
        <Pressable
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync(webUrl)}
          style={styles.webLink}>
          <Text style={[styles.metaText, { color: c.primary }]}>Web で編集する</Text>
        </Pressable>
      </View>
      {page.is_folder ? (
        <Text style={[styles.empty, { color: c.textMuted }]}>フォルダです</Text>
      ) : blocks.length === 0 ? (
        <Text style={[styles.empty, { color: c.textMuted }]}>本文はまだありません</Text>
      ) : (
        <WikiBody blocks={blocks} />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 30 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 16 },
  metaText: { fontSize: 13 },
  // 指で押せる高さ（44pt）を確保する
  webLink: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  empty: { fontSize: 14, paddingVertical: 24 },
})
