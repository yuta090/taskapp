'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { urlBase64ToUint8Array } from '@/lib/push/vapid'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface UsePushNotificationsResult {
  isSupported: boolean
  permission: NotificationPermission | 'unsupported'
  isSubscribed: boolean
  loading: boolean
  error: string | null
  enable: () => Promise<void>
  disable: () => Promise<void>
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * ブラウザのWeb Push購読を管理する。保存ボタンは無く、enable/disable呼び出しで
 * 即座に購読/解除する(プロジェクト規約: 保存ボタン無しの楽観的更新必須)。
 */
export function usePushNotifications(): UsePushNotificationsResult {
  const isSupported = isPushSupported()
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    isSupported ? Notification.permission : 'unsupported'
  )
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  useEffect(() => {
    if (!isSupported) {
      setLoading(false)
      return
    }

    let cancelled = false

    const check = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/push-sw.js')
        const subscription = await registration.pushManager.getSubscription()
        if (!cancelled) setIsSubscribed(subscription != null)
      } catch (err) {
        console.warn('Failed to check push subscription state:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [isSupported])

  const enable = useCallback(async () => {
    if (!isSupported) return
    setError(null)

    try {
      const registration = await navigator.serviceWorker.register('/push-sw.js')
      const result = await Notification.requestPermission()
      setPermission(result)

      if (result !== 'granted') {
        setError('ブラウザの設定で通知がブロックされています。アドレスバーのサイト設定から許可してください')
        return
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        setError('プッシュ通知が設定されていません')
        return
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      })

      const json = subscription.toJSON() as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
      }

      // Registered server-side (service_role) rather than upserted directly:
      // push_subscriptions.endpoint is globally UNIQUE and RLS only allows a
      // user to update their own rows, so a direct browser upsert can never
      // take over an endpoint a different user previously subscribed from
      // the same shared browser. /api/push/subscribe transfers ownership.
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint ?? subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          userAgent: navigator.userAgent,
        }),
      })

      if (!res.ok) throw new Error('Failed to register push subscription')
      setIsSubscribed(true)
    } catch (err) {
      console.warn('Failed to enable push notifications:', err)
      setError('プッシュ通知の設定に失敗しました')
    }
  }, [isSupported])

  const disable = useCallback(async () => {
    if (!isSupported) return
    setError(null)

    try {
      const registration = await navigator.serviceWorker.register('/push-sw.js')
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        setIsSubscribed(false)
        return
      }

      const endpoint = subscription.endpoint
      await subscription.unsubscribe()

      const supabase = supabaseRef.current as SupabaseClient
      const { error: deleteError } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint)

      if (deleteError) throw deleteError
      setIsSubscribed(false)
    } catch (err) {
      console.warn('Failed to disable push notifications:', err)
      setError('プッシュ通知の解除に失敗しました')
    }
  }, [isSupported])

  return { isSupported, permission, isSubscribed, loading, error, enable, disable }
}
