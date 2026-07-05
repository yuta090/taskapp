import Link from 'next/link'
import {
  ArrowLeft,
  EnvelopeSimple,
  CursorClick,
  CheckCircle,
  House,
  Lightning,
  ListChecks,
  Question,
} from '@phosphor-icons/react/dist/ssr'

export const metadata = {
  title: 'ご利用ガイド | AgentPM',
  description: 'クライアントポータルの使い方・用語・よくあるトラブルの解決方法',
}

const STEPS = [
  {
    icon: EnvelopeSimple,
    title: '1. 招待メールを開く',
    description: '開発チームから届いたメールに記載のリンクをクリックすると、ポータルの参加画面が開きます。',
  },
  {
    icon: CursorClick,
    title: '2. ポータルに参加する',
    description: '初めての場合はパスワードを設定して参加します。既にアカウントをお持ちの場合はそのまま参加できます。',
  },
  {
    icon: CheckCircle,
    title: '3. 「要対応」から確認する',
    description: '黄色いバッジが付いたタスクは、あなたの確認・回答が必要なものです。上から順に対応してください。',
  },
]

const GLOSSARY = [
  {
    term: '黄色（Amber）のバッジ',
    description: 'あなたの確認や対応が必要なことを示す目印です。見かけたら、そのタスクの内容を確認してください。',
  },
  {
    term: '承認・修正依頼',
    description:
      'タスクの内容に問題がなければ「承認」、直してほしい点があればコメントを添えて「修正依頼」を送れます。',
  },
  {
    term: '要対応',
    description: 'あなたの確認や回答を開発チームが待っている状態です。ダッシュボードの「要対応」セクションにまとまっています。',
  },
]

const SCREENS = [
  {
    icon: House,
    name: 'ダッシュボード',
    description: 'プロジェクト全体の進み具合を一目で確認できます。',
  },
  {
    icon: Lightning,
    name: '要対応',
    description: 'あなたの確認・回答が必要なタスクの一覧です。',
  },
  {
    icon: ListChecks,
    name: 'タスク一覧',
    description: 'プロジェクトのすべてのタスクを確認できます。',
  },
]

const TROUBLESHOOTING = [
  {
    question: 'ポータルにアクセスできません',
    answer: '招待メールのリンクからアクセスしてください。迷惑メールフォルダや、リンクの有効期限（30日間）もご確認ください。',
  },
  {
    question: 'タスクが表示されません',
    answer: 'タスク一覧画面のフィルターをリセットしてみてください。あなたに関連するタスクのみが表示されます。',
  },
  {
    question: '間違えて承認してしまいました',
    answer: '該当タスクのコメント欄に「承認を取り消したい」旨を記載してください。開発チームが確認して対応します。',
  },
]

export default function ClientHelpPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/portal"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="戻る"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">ご利用ガイド</h1>
              <p className="text-sm text-gray-500">クライアントポータルの使い方をまとめています</p>
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
            お困りの場合
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
          解決しない場合は開発チームにタスクのコメントでお問い合わせください。
        </p>
      </main>
    </div>
  )
}
