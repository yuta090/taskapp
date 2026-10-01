import { FlashList } from '@shopify/flash-list'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { EmptyState, ErrorRetry, Loading } from '~/components/ui'
import { usePrefetchSpaceTasks, useSpaces } from '~/hooks/queries'
import { useSession } from '~/hooks/useSession'
import { listProjects } from '~/lib/spaceList'
import { useColors } from '~/theme/colors'

export default function ProjectsScreen() {
  const c = useColors()
  const { activeOrg, orgsLoading, orgsError, refetchOrgs } = useSession()
  const spaces = useSpaces()
  const prefetch = usePrefetchSpaceTasks()

  const projects = useMemo(() => (spaces.data ? listProjects(spaces.data) : []), [spaces.data])

  const body = (() => {
    if (orgsError) return <ErrorRetry message="組織を読み込めませんでした" onRetry={refetchOrgs} />
    if (!activeOrg && !orgsLoading) return <EmptyState message="所属している組織がありません" />
    // 前回の取り置き・マイタスクの取り置きがあればそれを先に出す（isPending は手元に何も無いときだけ）
    if (spaces.isPending) return <Loading />
    if (spaces.isError && !spaces.data) {
      return <ErrorRetry message="プロジェクトを読み込めませんでした" onRetry={() => spaces.refetch()} />
    }
    if (projects.length === 0) return <EmptyState message="プロジェクトはありません" />
    return (
      <FlashList
        data={projects}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={spaces.isRefetching} onRefresh={() => spaces.refetch()} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPressIn={() => prefetch(item.id)}
            onPress={() => router.push({ pathname: '/project/[spaceId]', params: { spaceId: item.id } })}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.chip : c.surface, borderColor: c.border }]}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={2}>
              {item.name}
            </Text>
          </Pressable>
        )}
      />
    )
  })()

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: c.background }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: c.text }]}>プロジェクト</Text>
        {activeOrg ? <Text style={[styles.org, { color: c.textMuted }]}>{activeOrg.orgName}</Text> : null}
      </View>
      <View style={styles.list}>{body}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  org: { fontSize: 13 },
  list: { flex: 1 },
  row: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '500' },
})
