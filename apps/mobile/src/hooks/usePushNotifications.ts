/**
 * プッシュ通知: ログインが済んだら通知の許可をもらって端末を登録し、通知をタップしたら
 * そのタスク（無ければ受信トレイ）を開く。
 *
 * 鳴らす条件（種類・夜間と土日・1日の上限・本人の設定）は Web と同じで、サーバー側で決まる。
 */
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { registerPushToken } from '~/api/pushTokens'
import type { AuthStep } from '~/lib/authStep'
import { resolveEasProjectId, taskIdFromPushData } from '~/lib/pushData'

// アプリを開いている間に届いた通知も、バナーで見せる
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

async function registerThisDevice(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return
  const projectId = resolveEasProjectId(Constants)
  if (!projectId) {
    // `eas init` 前（Expo Go での開発中など）はトークンを取れないので、登録しない
    console.warn('[push] EAS projectId が無いので、プッシュ通知の登録を飛ばします')
    return
  }

  if (Platform.OS === 'android') {
    // サーバーは channelId: 'default' で送る
    await Notifications.setNotificationChannelAsync('default', {
      name: '通知',
      importance: Notifications.AndroidImportance.HIGH,
    })
  }

  let { status } = await Notifications.getPermissionsAsync()
  if (status === 'undetermined') {
    status = (await Notifications.requestPermissionsAsync()).status
  }
  if (status !== 'granted') return

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
  await registerPushToken(token, Platform.OS, Constants.expoConfig?.version ?? null)
}

export function usePushNotifications(step: AuthStep): void {
  const ready = step === 'ready'

  // 2段階目まで通ってから登録する（それまでは DB が拒否する）
  useEffect(() => {
    if (!ready) return
    registerThisDevice().catch((e: unknown) => console.warn('[push] Failed to register this device:', e))
  }, [ready])

  // 通知をタップして開いたら、そのタスクへ。アプリが閉じていた状態からの起動も拾う
  const lastResponse = Notifications.useLastNotificationResponse()
  const handledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || !lastResponse) return
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const id = lastResponse.notification.request.identifier
    if (handledRef.current === id) return
    handledRef.current = id
    const taskId = taskIdFromPushData(lastResponse.notification.request.content.data)
    if (taskId) router.push({ pathname: '/task/[taskId]', params: { taskId } })
    else router.push('/inbox')
    Notifications.clearLastNotificationResponse()
  }, [ready, lastResponse])
}
