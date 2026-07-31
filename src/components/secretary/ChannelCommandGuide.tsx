'use client'

import { useEffect, useId, useState } from 'react'
import { CaretDown, CaretRight, ChatText, Check, Copy, Warning } from '@phosphor-icons/react'
import {
  getChannelCommandGuide,
  getChannelPastePlacement,
  renderBotProfileShortText,
  renderBotProfileText,
} from '@/lib/channels/commandGuides'
import { getChannel } from '@/lib/channels/registry'
import {
  BOT_PROFILE_COPIED_MESSAGE,
  BOT_PROFILE_COPY_FAILED_MESSAGE,
  PROFILE_TEXT_LONG_HINT,
  PROFILE_TEXT_LONG_LABEL,
  PROFILE_TEXT_SHORT_HINT,
  PROFILE_TEXT_SHORT_LABEL,
  resolveChannelBotOwnership,
  type BotOwnership,
} from '@/components/secretary/botProfilePlacement'

interface ChannelCommandGuideProps {
  /** registry の ChannelId（'discord' / 'slack' / 'line' …） */
  channel: string
  /**
   * 秘書のアカウントの持ち主。貼り先（プロフィール欄／グループの説明欄）が変わる。
   * 省略時はレジストリから決める。LINE だけは同じ 'line' でも事務所ごとに変わるので、
   * 呼び出し側（連携ハブ）が利用状態から解決して渡す。
   */
  botOwnership?: BotOwnership
  /** 最初から開いた状態にする */
  defaultOpen?: boolean
  className?: string
}

/** コピー済みの表示を戻すまでの時間（ミリ秒）。押した手応えを出すだけの短い表示。 */
const COPIED_RESET_MS = 2000

/** どちらの文章をコピーしたか。 */
type ProfileTextVariant = 'long' | 'short'

interface CopyResult {
  variant: ProfileTextVariant
  status: 'copied' | 'failed'
}

/**
 * 「使い方（コマンド一覧）」ボタン — 押すと、そのチャットで打てる合図の一覧が開く。
 *
 * 秘書をグループに入れたあと「タスクをどう片づけるのか分からない」という詰まりが実際に起きていた。
 * 接続手順（＝つなぎ方）は別のパネルが持つので、ここは**つないだあとの使い方**だけを出す。
 *
 * 中身は commandGuides.ts（単一の真実源）から引く。画面ごとに文言を書かない
 * （ツール連携の ToolSetupGuide が setupGuides.ts に対して取っているのと同じ形）。
 * 使い方が無いチャネル（1:1専用の WhatsApp / Messenger）では**何も描画しない**。
 *
 * 貼り先は「秘書のアカウントを誰が持っているか」で変える（判定は botProfilePlacement.ts、
 * 文言は commandGuides.getChannelPastePlacement が正本）。当社が持つ秘書
 * （Discord / Google Chat / 共通LINE）のプロフィール欄は事務所の方が編集できないので、
 * そこを貼り先として案内すると詰む。
 * 代わりの貼り先は**そのチャットに実在するメニュー名**で呼ぶ（Discord は「トピック」、
 * LINE は「ノート」…）。全部を「グループの説明欄」と呼ぶと、その名前が見つからず貼れない。
 *
 * 実装メモ:
 *  - モーダルは使わない（UI_RULES）。その場で開く開閉パネルにする。
 *  - 閉じているときは中身をDOMに残さない（長文を常時読み上げさせないため。Hint と同じ方式）。
 *  - 色は中央トークンのみ（白の直書き・hex直書き・`dark:` バリアントは使わない）。
 *    この画面はログイン後のアプリ画面＝ダーク対象（isDarkAllowedPath が true）なので、
 *    面は必ず bg-surface / bg-gray-50 系のトークンで書く。
 *    amber は「相手先に見える要素」の予約色なのでここでは使わない。
 */
export function ChannelCommandGuide({
  channel,
  botOwnership,
  defaultOpen = false,
  className,
}: ChannelCommandGuideProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null)
  const panelId = useId()
  const guide = getChannelCommandGuide(channel)
  const profileText = renderBotProfileText(channel)
  const profileShortText = renderBotProfileShortText(channel)
  const placement = getChannelPastePlacement(
    channel,
    botOwnership ?? resolveChannelBotOwnership(getChannel(channel)),
  )

  // コピーできた手応えは数秒で戻す。保存ボタンではないので確定操作は無い（楽観更新の作法）。
  // 失敗の案内は消さない — 手でコピーし直してもらう必要があるため、次に押すまで残す。
  useEffect(() => {
    if (copyResult?.status !== 'copied') return
    const timer = setTimeout(() => setCopyResult(null), COPIED_RESET_MS)
    return () => clearTimeout(timer)
  }, [copyResult])

  if (!guide) return null

  /**
   * クリップボードは権限・環境（安全な接続でない場合など）で失敗する。
   * 握らないと押しても何も起きず「壊れている」ように見えるので、必ず結果を画面に出す。
   */
  const copyText = async (variant: ProfileTextVariant, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyResult({ variant, status: 'copied' })
    } catch {
      setCopyResult({ variant, status: 'failed' })
    }
  }

  return (
    <div className={className} data-testid="channel-command-guide">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
      >
        <ChatText className="h-3.5 w-3.5" weight="bold" />
        <span>使い方（コマンド一覧）</span>
        {open ? (
          <CaretDown className="h-3 w-3" weight="bold" />
        ) : (
          <CaretRight className="h-3 w-3" weight="bold" />
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className="mt-2 max-w-2xl rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-700 space-y-4"
        >
          <p className="text-gray-600">{guide.summary}</p>

          {/* 打てる合図。打つ文字列がある行だけ等幅で見せ、ボタン操作は説明だけ出す。 */}
          <ul className="space-y-2">
            {guide.commands.map((command) => (
              <li key={command.input ?? command.effect} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {command.input && (
                    <code className="rounded border border-gray-200 bg-surface px-1.5 py-0.5 font-mono text-gray-900">
                      {command.input}
                    </code>
                  )}
                  <span className="text-gray-700">{command.effect}</span>
                </div>
                {command.note && <p className="text-gray-500">{command.note}</p>}
              </li>
            ))}
          </ul>

          <ul className="list-disc space-y-1 pl-5 text-gray-500">
            {guide.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>

          {profileText && placement && (
            <div className="border-t border-gray-200 pt-3 space-y-3">
              <p className="font-medium text-gray-700">{placement.heading}</p>
              <p className="text-gray-500">{placement.note}</p>

              <ProfileTextBlock
                data-testid="channel-command-guide-profile-text"
                label={PROFILE_TEXT_LONG_LABEL}
                hint={PROFILE_TEXT_LONG_HINT}
                text={profileText}
                result={copyResult?.variant === 'long' ? copyResult : null}
                onCopy={() => void copyText('long', profileText)}
              />

              {profileShortText && (
                <ProfileTextBlock
                  data-testid="channel-command-guide-profile-short-text"
                  label={PROFILE_TEXT_SHORT_LABEL}
                  hint={PROFILE_TEXT_SHORT_HINT}
                  text={profileShortText}
                  result={copyResult?.variant === 'short' ? copyResult : null}
                  onCopy={() => void copyText('short', profileShortText)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 貼る文章の1ブロック（見出し＋本文＋コピー）。
 * 長い版と短い版でまったく同じ形なので、書き写さずここに1つだけ持つ。
 */
function ProfileTextBlock({
  'data-testid': testId,
  label,
  hint,
  text,
  result,
  onCopy,
}: {
  /**
   * ⚠ 目印は**呼び出し側にそのままの文字列で書く**（`data-testid="..."`）。
   * 変数で渡すと、E2Eの前提を見張る番人（src/__tests__/design/e2eContract.test.ts）が
   * ソースから目印を見つけられず、「実装に無い」と誤検知して落ちる。
   */
  'data-testid': string
  label: string
  hint: string
  text: string
  result: CopyResult | null
  onCopy: () => void
}) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-gray-700">
        {label}
        <span className="ml-1 font-normal text-gray-500">（{hint}）</span>
      </p>
      <pre
        data-testid={testId}
        className="overflow-x-auto whitespace-pre-wrap rounded border border-gray-200 bg-surface p-3 font-mono text-[11px] leading-relaxed text-gray-800"
      >
        {text}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:bg-gray-50 hover:text-indigo-800 transition-colors"
        >
          {result?.status === 'copied' ? (
            <Check className="h-3.5 w-3.5" weight="bold" />
          ) : (
            <Copy className="h-3.5 w-3.5" weight="bold" />
          )}
          <span>{label}をコピー</span>
        </button>
        {result?.status === 'copied' && (
          <span role="status" className="text-gray-500">
            {BOT_PROFILE_COPIED_MESSAGE}
          </span>
        )}
        {result?.status === 'failed' && (
          <span role="status" className="inline-flex items-center gap-1 text-red-600">
            <Warning className="h-3.5 w-3.5 shrink-0" weight="bold" />
            {BOT_PROFILE_COPY_FAILED_MESSAGE}
          </span>
        )}
      </div>
    </div>
  )
}
