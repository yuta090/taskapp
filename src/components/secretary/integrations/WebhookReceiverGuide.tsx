'use client'

import { useState } from 'react'
import { CaretRight, CaretDown } from '@phosphor-icons/react'

/**
 * webhook受信側向けの実装ガイド（折りたたみ）。
 * docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3(署名)/§5(受信側ドキュメント要件)。
 */
export function WebhookReceiverGuide() {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {open ? <CaretDown className="w-3 h-3" /> : <CaretRight className="w-3 h-3" />}
        受信側の実装方法
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs text-gray-600 leading-relaxed">
          <div>
            <p className="font-medium text-gray-700">署名検証</p>
            <p>
              リクエストヘッダ <code className="font-mono bg-gray-50 px-1 rounded">X-AgentPM-Signature</code>{' '}
              は <code className="font-mono bg-gray-50 px-1 rounded">t=&lt;unix秒&gt;,v1=&lt;hex(hmac_sha256(secret, t + &quot;.&quot; + body))&gt;</code>{' '}
              の形式です（Stripe/Slack同型）。<code className="font-mono bg-gray-50 px-1 rounded">t</code>{' '}
              が現在時刻から5分以上ずれているリクエストは古い署名の再利用としてリプレイ扱いで拒否してください。
            </p>
          </div>
          <div>
            <p className="font-medium text-gray-700">配達は at-least-once・順序保証なし</p>
            <p>
              同じイベントが複数回届くこと、イベント間の到着順が前後することがあります。
              <code className="font-mono bg-gray-50 px-1 rounded">event_key</code>{' '}
              で重複を除去（dedupe）し、
              <code className="font-mono bg-gray-50 px-1 rounded">occurred_at</code>{' '}
              が最新のものだけを反映する（last-write-wins）実装にしてください。
            </p>
          </div>
          <div>
            <p className="font-medium text-gray-700">ペイロード</p>
            <p>
              各配達はイベント発生時点のタスク全体のスナップショットです。差分ではなく毎回全体で
              upsert する実装を推奨します。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
