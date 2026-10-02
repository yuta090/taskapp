import { formatWikiRelativeTime } from '@/lib/wiki/listView'
import { FlashList } from '@shopify/flash-list'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Keyboard, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { Chip, EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { usePrefetchWikiPage, useWikiPages } from '~/hooks/wikiQueries'
import { useReadyContext } from '~/hooks/useSession'
import { buildWikiRowTree, flattenWikiRows, type WikiRow } from '~/lib/wikiList'
import { useColors } from '~/theme/colors'

/** 行の左のインデント幅（深さ1段ぶん） */
const INDENT = 16
/** 一覧に出すタグの最大数 */
const MAX_TAGS = 2

/** プロジェクトの Wiki 一覧。スマホは読むだけ（作成・移動・編集・ピン留めは Web）。手元に前回の一覧があれば先に出す */
export default function WikiListScreen() {
  const c = useColors()
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>()
  const ctx = useReadyContext()
  const orgId = ctx?.orgId ?? ''
  const wiki = useWikiPages(spaceId)
  const prefetchPage = usePrefetchWikiPage()
  const [query, setQuery] = useState('')
  // 折りたたんだフォルダの id。初期は全部開く
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  // 入力は先に画面へ映し、重い絞り込みは少し遅らせる（打つたびに引っかからない）
  const deferredQuery = useDeferredValue(query)
  // 並べ替えが重いツリーは、一覧か検索語が変わったときだけ作り直す。開閉は平らにするだけ
  const tree = useMemo(() => (wiki.data ? buildWikiRowTree(wiki.data, deferredQuery) : []), [wiki.data, deferredQuery])
  const rows = useMemo(() => flattenWikiRows(tree, deferredQuery, collapsed), [tree, deferredQuery, collapsed])

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const openPage = useCallback(
    (pageId: string) => {
      Keyboard.dismiss()
      router.push({ pathname: '/wiki/[pageId]', params: { pageId, orgId } })
    },
    [orgId]
  )

  // 全画面の Loading は、手元に何も無いときだけ
  if (wiki.isPending) return <Loading />
  if (wiki.isError && !wiki.data) {
    return <ErrorRetry message="Wiki を読み込めませんでした" onRetry={() => wiki.refetch()} />
  }
  if (!wiki.data || wiki.data.length === 0) return <EmptyState message="Wiki はまだありません（Web で作れます）" />

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      <View style={[styles.searchBar, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="題名・タグで探す"
          placeholderTextColor={c.textMuted}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.searchInput,
            { color: c.text, backgroundColor: c.background, borderColor: c.border },
            // ✕ の下に文字がもぐらないようにする
            query !== '' && styles.searchInputWithClear,
          ]}
        />
        {query !== '' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="検索をクリア" onPress={() => setQuery('')} style={styles.clear}>
            <Text style={[styles.clearText, { color: c.textSecondary }]}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      {rows.length === 0 ? (
        <EmptyState message="該当するページはありません" />
      ) : (
        <FlashList<WikiRow>
          // プロジェクトを切り替えたとき、前のスクロール位置を持ち越さない
          key={spaceId}
          data={rows}
          keyExtractor={(r) => r.page.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={wiki.isRefetching} onRefresh={() => wiki.refetch()} />}
          renderItem={({ item }) => (
            <WikiRowView
              row={item}
              onToggle={toggle}
              onOpen={openPage}
              onPrefetch={(pageId) => prefetchPage(pageId, orgId)}
            />
          )}
        />
      )}
    </View>
  )
}

function WikiRowView({
  row,
  onToggle,
  onOpen,
  onPrefetch,
}: {
  row: WikiRow
  onToggle: (id: string) => void
  onOpen: (pageId: string) => void
  onPrefetch: (pageId: string) => void
}) {
  const c = useColors()
  const { page, depth, hasChildren, collapsed, pinned } = row
  // 子を持つフォルダ（本文なし）は行全体で開閉。子の無い空のフォルダと通常のページは開く（フォルダは「フォルダです」と出る）
  const bodyToggles = page.is_folder && hasChildren
  const tags = page.tags.slice(0, MAX_TAGS)

  return (
    <View style={[styles.row, { backgroundColor: c.surface, borderBottomColor: c.border, paddingLeft: 8 + depth * INDENT }]}>
      {hasChildren ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={collapsed ? '開く' : '閉じる'}
          accessibilityState={{ expanded: !collapsed }}
          hitSlop={8}
          onPress={() => onToggle(page.id)}
          style={styles.toggle}>
          <Text style={[styles.toggleMark, { color: c.textSecondary }]}>{collapsed ? '▸' : '▾'}</Text>
        </Pressable>
      ) : (
        <View style={styles.toggle} />
      )}
      <Pressable
        accessibilityRole="button"
        onPressIn={bodyToggles ? undefined : () => onPrefetch(page.id)}
        onPress={() => (bodyToggles ? onToggle(page.id) : onOpen(page.id))}
        style={({ pressed }) => [styles.body, { backgroundColor: pressed ? c.chip : 'transparent' }]}>
        <View style={styles.main}>
          <View style={styles.titleLine}>
            {pinned ? <Chip label="ピン" tone="primary" /> : null}
            <Text numberOfLines={2} style={[styles.title, { color: c.text }]}>
              {page.title}
            </Text>
          </View>
          {tags.length > 0 ? (
            <View style={styles.tags}>
              {tags.map((t) => (
                <Chip key={t} label={t} />
              ))}
            </View>
          ) : null}
        </View>
        <Text style={[styles.time, { color: c.textMuted }]}>{formatWikiRelativeTime(page.updated_at)}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 16 },
  searchInputWithClear: { paddingRight: 44 },
  clear: { position: 'absolute', right: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 16 },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggle: { width: 28, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  toggleMark: { fontSize: 16 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingLeft: 4, paddingRight: 8, paddingVertical: 8 },
  main: { flex: 1, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1, fontSize: 16, fontWeight: '500', lineHeight: 22 },
  tags: { flexDirection: 'row', gap: 6 },
  time: { fontSize: 12 },
})
