import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { Text, useColorScheme } from 'react-native'
import { Centered, Screen } from '~/components/ui'
import { persister, queryClient } from '~/hooks/queryClient'
import { usePushNotifications } from '~/hooks/usePushNotifications'
import { SessionProvider, useSession } from '~/hooks/useSession'
import { useVersionGate } from '~/hooks/useVersionGate'
import { useColors } from '~/theme/colors'

SplashScreen.preventAutoHideAsync()

// 端末に取り置いたデータは、アプリの版が変わったら使わない（形が変わっているかもしれないため）
const CACHE_BUSTER = '1'

export default function RootLayout() {
  const scheme = useColorScheme()
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          buster: CACHE_BUSTER,
          maxAge: 1000 * 60 * 60 * 24,
        }}>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </PersistQueryClientProvider>
    </ThemeProvider>
  )
}

function RootNavigator() {
  const { step } = useSession()
  const { updateRequired } = useVersionGate()
  usePushNotifications(step)

  useEffect(() => {
    if (step !== 'checking') SplashScreen.hideAsync()
  }, [step])

  if (updateRequired) return <UpdateRequired />

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Protected guard={step === 'signedOut'}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={step === 'mfa'}>
        <Stack.Screen name="mfa" options={{ title: '2段階認証' }} />
      </Stack.Protected>
      <Stack.Protected guard={step === 'ready'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="project/[spaceId]" options={{ title: 'プロジェクト' }} />
        <Stack.Screen name="task/[taskId]" options={{ title: 'タスク' }} />
        <Stack.Screen name="wiki/[pageId]" options={{ title: 'Wiki' }} />
        <Stack.Screen name="notification/[notificationId]" options={{ title: '通知' }} />
      </Stack.Protected>
    </Stack>
  )
}

function UpdateRequired() {
  const c = useColors()
  return (
    <Screen>
      <Centered>
        <Text style={{ color: c.text, fontSize: 17, fontWeight: '600', marginBottom: 8 }}>アプリを更新してください</Text>
        <Text style={{ color: c.textSecondary, fontSize: 14, textAlign: 'center' }}>
          この版はもう使えません。App Store / Google Play から最新の版に更新してください。
        </Text>
      </Centered>
    </Screen>
  )
}
