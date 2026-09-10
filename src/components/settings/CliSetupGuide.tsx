'use client'

import { useState } from 'react'
import { Check, Copy, Terminal, Warning } from '@phosphor-icons/react'
import {
  AGENTPM_ORIGIN,
  AI_READ_SKILL_PROMPT,
  CLAUDE_CODE_SKILL_COMMAND,
  CLI_INSTALL_COMMAND,
  CLI_LOGIN_COMMAND,
  CLI_NODE_MIN_VERSION,
  CLI_VERIFY_COMMAND,
} from '@/lib/cli-setup'

interface CliSetupGuideProps {
  /** プロジェクト設定から開いたとき: login の「Default Space ID」に入れるこのプロジェクトのID */
  spaceId?: string
}

function CopyButton({ text, label, onDark }: { text: string; label: string; onDark: boolean }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // コピーできない環境（権限なし等）では何もしない。文字は選択して手でコピーできる
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      className={`shrink-0 p-1.5 rounded transition-colors ${
        onDark ? 'text-gray-400 hover:text-gray-100 hover:bg-gray-700' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200'
      }`}
    >
      {copied ? (
        <Check className={`w-3.5 h-3.5 ${onDark ? 'text-green-400' : 'text-green-600'}`} />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  )
}

/** 黒地のコマンド欄（ターミナルに貼るもの） */
function CommandBlock({ command, copyLabel }: { command: string; copyLabel: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-gray-900 py-1.5 pl-3 pr-1.5">
      <code className="flex-1 min-w-0 py-1 font-mono text-xs text-gray-100 whitespace-pre-wrap break-all">{command}</code>
      <CopyButton text={command} label={copyLabel} onDark />
    </div>
  )
}

/** 明るい地の文章欄（AI のチャットに貼るもの） */
function TextBlock({ text, copyLabel }: { text: string; copyLabel: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-3 pr-1.5">
      <p className="flex-1 min-w-0 py-1 text-xs text-gray-700 break-all">{text}</p>
      <CopyButton text={text} label={copyLabel} onDark={false} />
    </div>
  )
}

/**
 * AI（Claude Code など）から AgentPM を使う準備: CLI のインストール → ログイン → AI に覚えさせる。
 * APIキーを発行する画面（アカウントの「APIキー」とプロジェクト設定の「API設定」）の両方に出す。
 * 文言の正本は src/lib/cli-setup.ts（AI 用の説明書と同じ値を使う）。
 */
export function CliSetupGuide({ spaceId }: CliSetupGuideProps) {
  return (
    <section aria-labelledby="cli-setup-title" className="rounded-lg border border-gray-200 bg-surface">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 id="cli-setup-title" className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <Terminal className="text-gray-500" />
          AI（Claude Code など）から使う準備
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">
          CLI（コマンドで AgentPM を操作する道具）を入れて、AI に使い方を覚えさせます。最初の1回だけの作業です。
        </p>
      </div>

      <ol className="space-y-6 p-4">
        <li>
          <h4 className="mb-1 text-sm font-medium text-gray-700">1. CLI をインストールする</h4>
          <p className="mb-2 text-xs text-gray-500">
            ターミナル（Mac は「ターミナル」アプリ）で次を実行します。Node.js {CLI_NODE_MIN_VERSION}{' '}
            以上が必要です（入っていなければ nodejs.org から入れてください）。
          </p>
          <CommandBlock command={CLI_INSTALL_COMMAND} copyLabel="インストールのコマンドをコピー" />
          <p className="mt-1.5 text-xs text-gray-400">入れたことがある場合も、同じコマンドで最新版になります。</p>
        </li>

        <li>
          <h4 className="mb-1 text-sm font-medium text-gray-700">2. APIキーでログインする</h4>
          <p className="mb-2 text-xs text-gray-500">ターミナルで次を実行し、聞かれた順に入力します。</p>
          <CommandBlock command={CLI_LOGIN_COMMAND} copyLabel="ログインのコマンドをコピー" />
          <dl className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 text-xs">
            <div className="flex gap-3 px-3 py-2">
              <dt className="w-28 shrink-0 text-gray-500">API URL</dt>
              <dd className="min-w-0 text-gray-700">何も入れずに Enter（{AGENTPM_ORIGIN} につながります）</dd>
            </div>
            <div className="flex gap-3 px-3 py-2">
              <dt className="w-28 shrink-0 text-gray-500">API Key</dt>
              <dd className="min-w-0 text-gray-700">この画面で発行した APIキーを貼り付けて Enter</dd>
            </div>
            <div className="flex gap-3 px-3 py-2">
              <dt className="w-28 shrink-0 text-gray-500">Default Space ID</dt>
              <dd className="min-w-0 text-gray-700">
                {spaceId ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>このプロジェクトのID</span>
                    <code className="rounded bg-gray-100 px-1 font-mono text-gray-900 break-all">{spaceId}</code>
                    <CopyButton text={spaceId} label="プロジェクトIDをコピー" onDark={false} />
                  </span>
                ) : (
                  'よく使うプロジェクトのID（何も入れずに Enter でも可）'
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-gray-500">
            つながったかどうかは <code className="rounded bg-gray-100 px-1 font-mono">{CLI_VERIFY_COMMAND}</code>{' '}
            で確かめられます（プロジェクトの名前が出れば成功です。プロジェクト設定で作ったキーなら、そのプロジェクトだけが出ます）。
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-700">
            <Warning className="mt-0.5 shrink-0 text-amber-600" weight="fill" />
            <span>
              APIキーは合鍵です。AI のチャットに貼らないでください（会話の記録に残ります）。ログインは自分でターミナルに入力します。
            </span>
          </p>
        </li>

        <li>
          <h4 className="mb-1 text-sm font-medium text-gray-700">3. AI に使い方を覚えさせる</h4>
          <p className="mb-3 text-xs text-gray-500">
            AI が CLI の使い方を読めるように、説明書（スキル）を渡します。説明書は AgentPM の最新のコマンド一覧から作られています。
          </p>
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-medium text-gray-700">Claude Code の場合</p>
              <CommandBlock command={CLAUDE_CODE_SKILL_COMMAND} copyLabel="Claude Code 用のコマンドをコピー" />
              <p className="mt-1.5 text-xs text-gray-500">
                ターミナルで実行したあと、Claude Code を開き直してください。「AgentPM にタスクを作って」のように頼むと、説明書を読んで CLI を使います。
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-gray-700">ほかの AI（Codex・Cursor など）の場合</p>
              <p className="mb-1.5 text-xs text-gray-500">次の文を AI のチャットにそのまま貼ってください（鍵は入っていません）。</p>
              <TextBlock text={AI_READ_SKILL_PROMPT} copyLabel="AI に渡す文をコピー" />
            </div>
          </div>
        </li>
      </ol>
    </section>
  )
}
