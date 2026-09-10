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
  IdentificationBadge,
  Robot,
  Folder,
  BookOpen,
  Bell,
  ShieldCheck,
  ArrowRight,
} from '@phosphor-icons/react/dist/ssr'
import { SPACE_ROLE_GUIDE, INVITE_ROLE_GUIDE } from '@/lib/roles/spaceRoles'

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
    description: 'プロジェクト設定のメンバーセクションから、社内メンバーやクライアント担当者をメールで招待します。招待できるのは管理者と編集者です。',
  },
  {
    icon: Eye,
    title: '3. クライアントに公開する',
    description: 'ボールを「外部」にすると、そのタスクはクライアントポータルにも表示され、確認・回答を依頼できます。',
  },
]

/** 画面写真つきの案内。写真はデモ組織のもの（public/img/help/）。 */
const SCREENSHOTS = [
  {
    src: '/img/help/task-inspector.png',
    title: 'タスク画面（左：メニュー／中央：一覧／右：詳細）',
    caption:
      'タスクの行をクリックすると、右側に詳細が開きます。詳細は開いたまま一覧を操作できます。保存ボタンはありません（入力するとその場で保存されます）。',
  },
  {
    src: '/img/help/inbox.png',
    title: '受信トレイ（あなた宛ての知らせ）',
    caption:
      'クライアントの承認・修正依頼、ボールの受け渡しなどが時系列で並びます。「要対応」が付いているものが、あなたの返事を待っている件です。',
  },
  {
    src: '/img/help/secretary-connect.png',
    title: 'AI秘書とチャットをつなぐ画面',
    caption:
      '左メニュー「秘書」→「チャット連携」。①自分のチャットをつなぐ ②相手先とのグループをつなぐ、の2段階でつなぎます。',
  },
  {
    src: '/img/help/settings-notifications.png',
    title: '通知設定',
    caption:
      '急ぎ（あなたの返事待ち）はすぐメール、それ以外は1日1回のまとめ。夜9時〜朝8時と土日は止まり、翌営業日の朝にまわります。',
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
  {
    term: '合言葉（連携コード）',
    description:
      'チャットと AgentPM をつなぐときに使う、その場かぎりの文字列です。相手先のグループに投稿してもらうと、そのグループがプロジェクトと結びつきます。本人確認用のコードは有効期限15分・1回かぎりで、グループには貼らずに1対1のトークへ送ります。',
  },
  {
    term: '相手先',
    description:
      '一緒に仕事を進める外部の関係者（クライアント）と、そのグループを指します。AgentPM ではプロジェクト単位で結びつけて管理します。',
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
  {
    icon: Robot,
    name: '秘書（チャット連携）',
    description: 'LINE や Slack などのチャットをつなぐと、会話の中の「やること」を拾ってタスクにします。',
  },
  {
    icon: Folder,
    name: 'ファイル',
    description: '資料の受け渡し場所です。公開にすると相手先からも見え、CSV はそのまま表で開けます。',
  },
  {
    icon: BookOpen,
    name: 'Wiki',
    description: '決まったこと・仕様のまとめを残す場所です。タスクと結びつけて経緯を追えます。',
  },
]

/** アプリ内では要約だけ見せ、詳しい手順は /docs/manual に置く（内容の重複を避ける）。 */
const MANUAL_LINKS = [
  { href: '/docs/manual/internal/secretary', icon: Robot, label: 'AI秘書・チャット連携', note: 'LINE等のつなぎ方・打てる合図' },
  { href: '/docs/manual/internal/notifications', icon: Bell, label: '通知ガイド', note: '届き方・設定・届かない時' },
  { href: '/docs/manual/internal/files', icon: Folder, label: 'ファイル', note: 'アップロード・公開・CSVを表で見る' },
  { href: '/docs/manual/internal/integrations', icon: SquaresFour, label: 'ツール連携', note: '他のタスク管理ツールとつなぐ' },
  { href: '/docs/manual/internal/security', icon: ShieldCheck, label: 'ログインとセキュリティ', note: '二要素認証・APIキー' },
  { href: '/docs/manual/internal/settings', icon: IdentificationBadge, label: 'プロジェクト設定', note: 'メンバー・承認・表示' },
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
      '「設定 → 通知設定」でメール通知が有効か、種類ごとのスイッチが切られていないかを確認してください。急ぎ以外は1日1回のまとめで届きます。夜9時〜朝8時と土日は、すぐ送るぶんが翌営業日の朝にまわります。アプリ内の受信トレイには常に記録が残ります。',
  },
  {
    question: 'チャットで「完了 3」と送っても反応がない',
    answer:
      'Chatwork の「返信」ボタンを使うと、お名前が文の先頭に入って合図として読み取れません。「完了 3」だけを送ってください。番号は直前に届いたお知らせの番号です。',
  },
  {
    question: '承認や期限の知らせが自分のチャットに届かない',
    answer:
      '相手先のグループをつないだだけでは、本人には届きません。「秘書 → チャット連携」の「自分のチャットをつなぐ」を済ませてください。',
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-surface border-b border-gray-200">
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
                className="flex items-start gap-3 bg-surface rounded-lg border border-gray-200 p-4"
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

        {/* 画面の見かた（写真つき） */}
        <section id="screens" className="space-y-4 scroll-mt-6">
          <h2 className="text-lg font-semibold text-gray-900">画面の見かた</h2>
          <p className="text-sm text-gray-600">実際の画面です（サンプルのデータを表示しています）。</p>
          <div className="space-y-6">
            {SCREENSHOTS.map((shot) => (
              <figure key={shot.src} className="bg-surface rounded-lg border border-gray-200 overflow-hidden">
                <img
                  src={shot.src}
                  alt={shot.title}
                  loading="lazy"
                  className="w-full border-b border-gray-100"
                />
                <figcaption className="p-4">
                  <h3 className="text-sm font-medium text-gray-900">{shot.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">{shot.caption}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* 用語集 */}
        <section id="glossary" className="space-y-4 scroll-mt-6">
          <h2 className="text-lg font-semibold text-gray-900">用語集</h2>
          <dl className="bg-surface rounded-lg border border-gray-200 divide-y divide-gray-100">
            {GLOSSARY.map((item) => (
              <div key={item.term} className="p-4">
                <dt className="text-sm font-medium text-gray-900">{item.term}</dt>
                <dd className="text-sm text-gray-600 mt-1">{item.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* メンバーの役割 */}
        <section id="roles" className="space-y-4 scroll-mt-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <IdentificationBadge className="w-5 h-5 text-gray-500" />
            メンバーの役割
          </h2>
          <p className="text-sm text-gray-600">
            プロジェクトごとに、メンバーには次のどれかの役割が付きます。役割の変更は管理者が
            プロジェクト設定のメンバー画面から行います。
          </p>
          <dl className="bg-surface rounded-lg border border-gray-200 divide-y divide-gray-100">
            {SPACE_ROLE_GUIDE.map((role) => (
              <div key={role.value} className="p-4">
                <dt className="text-sm font-medium text-gray-900">{role.label}</dt>
                <dd className="text-sm text-gray-600 mt-1">{role.desc}</dd>
              </div>
            ))}
          </dl>

          <h3 className="text-sm font-semibold text-gray-900">招待するときに選ぶ役割</h3>
          <dl className="bg-surface rounded-lg border border-gray-200 divide-y divide-gray-100">
            {INVITE_ROLE_GUIDE.map((role) => (
              <div key={role.value} className="p-4">
                <dt className="text-sm font-medium text-gray-900">{role.label}</dt>
                <dd className="text-sm text-gray-600 mt-1">{role.desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 主要画面の説明 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">主要画面</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {SCREENS.map((screen) => (
              <div key={screen.name} className="bg-surface rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <screen.icon className="w-4 h-4 text-gray-500" />
                  <h3 className="text-sm font-medium text-gray-900">{screen.name}</h3>
                </div>
                <p className="text-sm text-gray-600">{screen.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 詳しい手順へ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">詳しい手順を見る</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {MANUAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-start gap-3 bg-surface rounded-lg border border-gray-200 p-4 hover:border-indigo-200 hover:shadow-sm transition-all"
              >
                <link.icon className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-1">
                    {link.label}
                    <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">{link.note}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* トラブルシューティング */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Question className="w-5 h-5 text-gray-500" />
            よくあるトラブル
          </h2>
          <div className="bg-surface rounded-lg border border-gray-200 divide-y divide-gray-100">
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
