'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowSquareOut, Check, Copy } from '@phosphor-icons/react'
import { useOrgChannelAccount } from '@/lib/hooks/useOrgChannelAccount'
import {
  buildSecretarySlackManifest,
  secretaryManifestCreateUrl,
  secretaryWebhookUrlForOrg,
  SECRETARY_SLACK_BOT_DISPLAY_NAME,
} from '@/lib/channels/slack/secretaryManifest'

/** 登録フォームが成功したときに window へ投げるイベント名。案内画面が進み具合を取り直す。 */
export const CHANNEL_ACCOUNT_REGISTERED_EVENT = 'agentpm:channel-account-registered'

type Where = 'slack' | 'agentpm'

interface Step {
  title: string
  where: Where[]
  body: React.ReactNode
}

function WhereBadge({ where }: { where: Where }) {
  return where === 'slack' ? (
    <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
      Slack
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      AgentPM
    </span>
  )
}

/**
 * Slack に AI秘書を入れる手順の案内（自社Slackアプリ方式）。
 *
 * 画面を開いた人が最初に見るのは「全体で何手順あり、どこで何をするか」。Slack と AgentPM を
 * 往復するため、各手順に「どこで」の印を付け、いまどの手順かを示す。
 * 「Slack でアプリを作る」は、AgentPM が組み立てた設定ファイルを Slack の作成画面に渡すので、
 * 利用者は名前や権限を入力せず「Create」を押すだけでよい。受信URLは組織単位で確定済みなので、
 * 以前あった「登録後に Slack へ戻って受信URLを貼る」手順は無い。
 */
export function SlackSecretarySetupGuide({ orgId }: { orgId: string }) {
  const { data: account, isPending, refetch } = useOrgChannelAccount(orgId, 'slack')
  const registered = !!account && account.status === 'active'
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onRegistered = (e: Event) => {
      const detail = (e as CustomEvent<{ orgId?: string; channel?: string }>).detail
      if (!detail || (detail.orgId === orgId && detail.channel === 'slack')) refetch()
    }
    window.addEventListener(CHANNEL_ACCOUNT_REGISTERED_EVENT, onRegistered)
    return () => window.removeEventListener(CHANNEL_ACCOUNT_REGISTERED_EVENT, onRegistered)
  }, [orgId, refetch])

  const manifest = useMemo(() => {
    // サーバー描画とブラウザで同じ値になるよう環境変数を優先（無ければブラウザの origin）
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://agentpm.app')
    return buildSecretarySlackManifest({ eventsUrl: secretaryWebhookUrlForOrg(origin, orgId) })
  }, [orgId])
  const createUrl = useMemo(() => secretaryManifestCreateUrl(manifest), [manifest])

  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* クリップボード不可の環境では何もしない */
    }
  }

  const steps: Step[] = [
    {
      title: '秘書アプリを作る',
      where: ['slack'],
      body: (
        <>
          <p>
            下のボタンを押すと、名前や権限を入力済みの状態で Slack の作成画面が開きます。会社のワークスペースを選んで
            「Create」を押すだけです。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a
              href={createUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600"
            >
              Slack でアプリを作る
              <ArrowSquareOut className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={copyManifest}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              設定ファイルをコピー
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            ボタンで開かない場合は、コピーした設定ファイルを Slack の「Create New App → From an app manifest」に貼ってください。
          </p>
        </>
      ),
    },
    {
      title: 'ワークスペースに入れて、2つの鍵をコピー',
      where: ['slack'],
      body: (
        <>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              左メニュー「Install App」→「Install to Workspace」→「許可する」。出てきた「Bot User OAuth Token」（xoxb- で始まる）をコピー。
            </li>
            <li>左メニュー「Basic Information」→ App Credentials の「Signing Secret」（Show を押す）をコピー。</li>
          </ul>
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Slack に AgentPM のアプリが複数ある場合、必ず「AgentPM秘書」の画面でコピーしてください。別のアプリの鍵だと登録は通っても秘書が反応しません。
          </p>
        </>
      ),
    },
    {
      title: '2つの鍵を AgentPM に登録',
      where: ['agentpm'],
      body: registered ? (
        <p>
          {account?.displayName}（登録済み）。鍵を入れ直す場合は、下の登録フォームからもう一度登録してください。
        </p>
      ) : (
        <p>この下の「資格情報を登録する」に、コピーした2つを貼って登録します。受信の設定は AgentPM 側で済んでいるので、Slack に戻る必要はありません。</p>
      ),
    },
    {
      title: '秘書をチャンネルに招待',
      where: ['slack'],
      body: (
        <p>
          秘書を入れたいチャンネルで <code className="rounded bg-gray-100 px-1 text-xs">/invite @{SECRETARY_SLACK_BOT_DISPLAY_NAME}</code> を実行します（名前を変えた場合はその名前）。プライベートチャンネルでも招待すれば使えます。
        </p>
      ),
    },
    {
      title: '合言葉を発行して、そのチャンネルに投稿',
      where: ['agentpm', 'slack'],
      body: (
        <p>
          この下の「合言葉の発行」で相手先（プロジェクト）を選んで発行し、出てきた合言葉を招待したチャンネルにそのまま投稿します。投稿すると「確認待ち」に出ます（30分で失効・1チャンネルに1つ）。
        </p>
      ),
    },
    {
      title: '確認待ちで承認する',
      where: ['agentpm'],
      body: (
        <p>
          投稿したチャンネルが、この画面の一番下の「確認待ち」に出ます（左メニューの「確認待ち」はタスク候補用で、こちらではありません）。承認すると、そのチャンネルの会話を秘書が読み始めます。
        </p>
      ),
    },
  ]

  // いまどの手順か: 鍵の登録（手順3）までが AgentPM 側で判定できる。以降は利用者の操作なので手順4を示す。
  // 初回（キャッシュ無し）の取得中は印を出さない — 登録済みの人に一瞬「手順1」を見せない。
  const currentIndex = isPending ? -1 : registered ? 3 : 0

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-surface p-4">
      <h2 className="text-sm font-semibold text-gray-900">Slack に秘書を入れる手順（全{steps.length}つ）</h2>
      <p className="mt-1 text-xs text-gray-500">
        Slack と AgentPM を行き来します。各手順の「どこで」の印を見ながら、上から順に進めてください。
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => {
          const done = currentIndex >= 0 && i < currentIndex
          const current = i === currentIndex
          return (
            <li
              key={s.title}
              className={`rounded-md border px-3 py-2 ${
                current ? 'border-amber-300 bg-amber-50/40' : done ? 'border-gray-100 bg-gray-50' : 'border-gray-100'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    done ? 'bg-emerald-500 text-white' : current ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={`text-sm font-semibold ${done ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                  {s.title}
                </span>
                {s.where.map((w) => (
                  <WhereBadge key={w} where={w} />
                ))}
                {done && <span className="text-[11px] font-semibold text-emerald-600">済み</span>}
                {current && <span className="text-[11px] font-semibold text-amber-700">いまここ</span>}
              </div>
              <div className="mt-1.5 pl-8 text-sm text-gray-700">{s.body}</div>
            </li>
          )
        })}
      </ol>

      <p className="mt-4 text-xs text-gray-500">
        Bot の名前は Slack の制約で作成時は英字（{SECRETARY_SLACK_BOT_DISPLAY_NAME}）になります。日本語にしたい場合は、Slack のアプリ設定の「App Home」で表示名を変え、Reinstall to Workspace を押すと反映されます。
      </p>
    </section>
  )
}
