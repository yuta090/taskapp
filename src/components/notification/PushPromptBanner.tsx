'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, X } from '@phosphor-icons/react'
import { usePushNotifications } from '@/lib/hooks/usePushNotifications'
import { readPushEnvironment } from '@/lib/push/environment'
import { useClientSnapshot } from '@/lib/hooks/useClientSnapshot'

/** 「あとで」を押したら二度と出さない。端末ごとの都合なので localStorage でよい */
const DISMISS_KEY = 'taskapp:pushPromptDismissed'

/** この端末・この人に、案内を出すべきか。ブラウザにしか無い情報だけで決まる */
function shouldPrompt(): boolean {
  try {
    if (localStorage.getItem(DISMISS_KEY) === '1') return false
  } catch {
    // プライベートモード等で読めないときは出さない側に倒す（毎回出るほうが困る）
    return false
  }
  if (readPushEnvironment() !== 'supported') return false
  // 'granted'（もう許可済み）'denied'（断られた）のときは聞き直さない
  if (typeof Notification === 'undefined') return false
  return Notification.permission === 'default'
}

/**
 * ブラウザ通知を1回だけ案内する帯。
 *
 * 通知の仕組みは前からあるのに、設定画面の奥にあって誰も気づかず、購読者は0人だった。
 * かといって毎回聞くのはうるさいので、**まだ一度も可否を答えていない人にだけ1回**出す。
 *
 * 判定に必要な情報は localStorage とブラウザAPIにしか無いので、描画してから決める
 * （サーバー側では出さない）。出さないと決まった場合は usePushNotifications を
 * 呼ばない構造にしてある — あのフックは mount 時に service worker を登録するので、
 * 帯を出さない人にまで登録処理を走らせたくない。
 */
export function PushPromptBanner() {
  const prompt = useClientSnapshot(shouldPrompt, false)
  const [dismissed, setDismissed] = useState(false)

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // 保存できなくても、この表示中は消えるので実害は小さい
    }
    setDismissed(true)
  }, [])

  if (!prompt || dismissed) return null
  return <PushPromptCard onDismiss={dismiss} />
}

function PushPromptCard({ onDismiss }: { onDismiss: () => void }) {
  // ここに来る時点で許可は 'default' と分かっている＝購読は存在しえないので、
  // mount時の service worker 登録はしない。押されてから初めて動かす
  const push = usePushNotifications({ checkOnMount: false })

  // 許可されたらそのまま消える（お礼の表示は出さない。1回で終わらせる）
  useEffect(() => {
    if (push.isSubscribed) onDismiss()
  }, [push.isSubscribed, onDismiss])

  return (
    <div
      data-testid="push-prompt-banner"
      className="flex-shrink-0 flex flex-wrap items-center gap-3 border-b border-indigo-100 bg-indigo-50 px-4 py-3"
      role="status"
    >
      <Bell className="w-5 h-5 text-indigo-ink flex-shrink-0" />
      <p className="text-sm text-indigo-ink flex-1 min-w-[240px]">
        承認依頼や、あなたに回ってきた番だけ、このブラウザにお知らせできます。
        <span className="text-indigo-ink/70">（夜9時〜朝8時と土日は鳴りません）</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void push.enable()}
          disabled={push.loading}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          通知を受け取る
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          あとで
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="閉じる"
          className="p-1 text-gray-400 hover:text-gray-600"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {push.error && (
        <p className="w-full text-xs text-red-600">
          {push.error}　
          <Link href="/settings/notifications" className="underline">
            通知設定
          </Link>
          から設定し直せます。
        </p>
      )}
    </div>
  )
}
