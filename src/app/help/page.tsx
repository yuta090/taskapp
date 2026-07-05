import Link from 'next/link'
import {
  ArrowLeft,
  PlusCircle,
  UserPlus,
  Eye,
  Tray,
  Target,
  SquaresFour,
  ChartBar,
  Question,
} from '@phosphor-icons/react/dist/ssr'

export const metadata = {
  title: '使い方マニュアル | AgentPM',
  description: 'AgentPM の使い方・用語集・よくあるトラブルの解決方法',
}

const STEPS = [
  {
    icon: PlusCircle,
    title: '1. タスクを作成する',
    description: 'プロジェクトのタスク一覧から「新規タスク」でタスクを追加します。担当者や期限、ボールの向き先を設定できます。',
  },
  {
    icon: UserPlus,
    title: '2. メンバー・クライアントを招待する',
    description: 'プロジェクト設定のメンバーセクションから、社内メンバーやクライアント担当者をメールで招待します。',
  },
  {
    icon: Eye,
    title: '3. クライアントに公開する',
    description: 'ボールを「外部」にすると、そのタスクはクライアントポータルにも表示され、確認・回答を依頼できます。',
  },
]

const GLOSSARY = [
  {
    term: 'ボール（ball）',
    description:
      '「次にアクションすべき側」を示す概念です。社内（internal）またはクライアント側（外部 / client）のいずれかが設定され、タスクの停滞を防ぎます。',
  },
  {
    term: 'クライアントに公開（Amber-500バッジ）',
    description:
      '黄色（Amber-500）のバッジや表示は、そのタスクがクライアントポータルにも見えていることを示す目印です。ボールを「外部」にすると自動的に公開されます。',
  },
  {
    term: '承認・修正依頼',
    description:
      'クライアントに公開したタスクやレビューに対して、クライアントが行える2つの回答です。内容に問題がなければ「承認」、直してほしい点があれば「修正依頼」としてコメント付きで差し戻せます。',
  },
  {
    term: 'マイルストーン',
    description:
      'プロジェクトの節目となる区切りです。タスクを紐づけることで、ガントチャートやバーンダウンチャートに進捗として表示されます。',
  },
  {
    term: 'スペック（spec タスク）',
    description:
      '仕様に関する意思決定を追跡する特別なタスクです。「検討中 → 決定 → 実装済み」の状態で管理し、誰がいつ何を決定したかの記録を残します。',
  },
]

const SCREENS = [
  {
    icon: Tray,
    name: '受信トレイ',
    description: 'クライアントの承認・修正依頼やボールの受け渡しなど、あなた宛ての通知が時系列で届きます。',
  },
  {
    icon: Target,
    name: 'マイタスク',
    description: '全プロジェクトを横断して、自分が担当者に設定されているタスクだけを一覧できます。',
  },
  {
    icon: SquaresFour,
    name: 'ガントチャート',
    description: '開始日・期限日を設定したタスクとマイルストーンを時系列のバーで表示します。バーをドラッグして日程を調整できます。',
  },
  {
    icon: ChartBar,
    name: 'バーンダウンチャート',
    description: '期限付きタスクの消化ペースをグラフで確認できます。理想線と実績線のずれから遅延の兆候をつかめます。',
  },
]

const TROUBLESHOOTING = [
  {
    question: '招待メールが届かない',
    answer:
      '迷惑メールフォルダを確認し、メールアドレスの入力ミスがないか見直してください。解決しない場合は、プロジェクト設定から再度招待を送信できます。',
  },
  {
    question: 'ボールが変更できない',
    answer:
      'ステータスが「完了」のタスクはボールを変更できません。一度「進行中」に戻してから変更してください。クライアント側からの変更は開発チームへの依頼が必要です。',
  },
  {
    question: '通知が届かない',
    answer:
      '設定画面でメール通知・Slack通知が有効になっているか確認してください。アプリ内の受信トレイには常に通知が記録されています。',
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/inbox"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="戻る"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">使い方マニュアル</h1>
              <p className="text-sm text-gray-500">AgentPM の基本的な使い方と用語をまとめています</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-10">
        {/* はじめに */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">はじめに</h2>
          <div className="space-y-3">
            {STEPS.map((step) => (
              <div
                key={step.title}
                className="flex items-start gap-3 bg-white rounded-lg border border-gray-200 p-4"
              >
                <step.icon className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-gray-900">{step.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 用語集 */}
        <section id="glossary" className="space-y-4 scroll-mt-6">
          <h2 className="text-lg font-semibold text-gray-900">用語集</h2>
          <dl className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {GLOSSARY.map((item) => (
              <div key={item.term} className="p-4">
                <dt className="text-sm font-medium text-gray-900">{item.term}</dt>
                <dd className="text-sm text-gray-600 mt-1">{item.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 主要画面の説明 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">主要画面</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {SCREENS.map((screen) => (
              <div key={screen.name} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <screen.icon className="w-4 h-4 text-gray-500" />
                  <h3 className="text-sm font-medium text-gray-900">{screen.name}</h3>
                </div>
                <p className="text-sm text-gray-600">{screen.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* トラブルシューティング */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Question className="w-5 h-5 text-gray-500" />
            よくあるトラブル
          </h2>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {TROUBLESHOOTING.map((item) => (
              <div key={item.question} className="p-4">
                <h3 className="text-sm font-medium text-gray-900">Q. {item.question}</h3>
                <p className="text-sm text-gray-600 mt-1">A. {item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="text-xs text-gray-400 text-center">
          さらに詳しい内容は
          <Link href="/docs/manual/internal" className="text-indigo-600 hover:underline mx-1">
            使い方マニュアル（詳細版）
          </Link>
          をご覧ください。
        </p>
      </main>
    </div>
  )
}
