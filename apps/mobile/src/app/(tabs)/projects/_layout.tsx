import { Stack } from 'expo-router'

/**
 * プロジェクトタブの中の画面の積み重ね（一覧 → プロジェクトのタスク → 会議・議事録・Wiki の一覧）。
 * タブの外ではなく中に積むので、ほかのタブへ移って戻っても、開いていたプロジェクトの画面がそのまま残る。
 */
export default function ProjectsLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[spaceId]/index" options={{ title: 'プロジェクト' }} />
      <Stack.Screen name="[spaceId]/meetings" options={{ title: '会議・議事録' }} />
      <Stack.Screen name="[spaceId]/meetings/[meetingId]" options={{ title: '議事録' }} />
      <Stack.Screen name="[spaceId]/wiki" options={{ title: 'Wiki' }} />
    </Stack>
  )
}
