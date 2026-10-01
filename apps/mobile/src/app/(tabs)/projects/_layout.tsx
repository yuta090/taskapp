import { Stack } from 'expo-router'

/**
 * プロジェクトタブの中の画面の積み重ね（一覧 → プロジェクトのタスク）。
 * タブの外ではなく中に積むので、ほかのタブへ移って戻っても、開いていたプロジェクトの画面がそのまま残る。
 */
export default function ProjectsLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[spaceId]" options={{ title: 'プロジェクト' }} />
    </Stack>
  )
}
