import { getIntegration, type IntegrationId } from '@/lib/integrations/registry'

/**
 * ツール連携の「連携のしかた」手順 — 単一の真実源。
 *
 * 接続画面には「APIキー」欄があるだけで、**どこでそのキーを取るのか**がどこにも書いて
 * いなかった。手順を画面ごとに書くと必ずズレるので、文言はここ1箇所に集約し、
 * `ToolSetupGuide`（「連携のしかた」ボタン）が各画面でこれを描画する。
 *
 * ⚠ ここは説明文のみ。接続の可否・課金ゲート・アダプタの能力を決めない
 *   （それぞれ entitlements.ts / adapters.ts / registry.ts が真実源）。
 *
 * 書き方の約束（CLAUDE.md の出力ルールに合わせる）:
 *   - 相手ツール側の操作 → TaskApp 側の操作 の順に並べる（人は相手ツールを先に触るため）
 *   - 1ステップ＝1動作。専門用語を避け、画面に実際に出ているボタン名で書く
 *   - 実装で確認できない手順は書かない（想像で書くと、その通りにやって繋がらない）
 */

/**
 * 個人アカウントの接続（設定 → ツール連携）のキー。
 * 組織のツール連携（registry.ts の IntegrationId）とは別軸なので ID を分ける。
 * とくに Google ToDo は「組織の双方向同期(google_tasks)」と「個人のミラー」で別物のため、
 * `google_tasks_personal` として明示的に分けている（同じ ID にすると説明が混ざる）。
 */
export const PERSONAL_SETUP_GUIDE_KEYS = [
  'google_calendar',
  'google_tasks_personal',
  'zoom',
  'teams',
] as const

export type PersonalSetupGuideKey = (typeof PERSONAL_SETUP_GUIDE_KEYS)[number]
export type SetupGuideKey = IntegrationId | PersonalSetupGuideKey

export interface IntegrationSetupGuide {
  /** つなぐと何が起きるか（1〜2文） */
  summary: string
  /** 手順。相手ツール側 → TaskApp 側 の順 */
  steps: string[]
  /** 気をつけること（任意） */
  notes?: string[]
  /**
   * 公式ドキュメントのURL。省略時は registry の setupUrl を使う
   * （個人連携キーは registry に無いため、必要ならここに書く）。
   */
  docUrl?: string
}

/** 取り込み先スペースの指定は全コネクタ共通の最後の一歩。文言のブレを防ぐため定数化する。 */
const PICK_TARGET_SPACE = '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）'

export const INTEGRATION_SETUP_GUIDES: Partial<Record<SetupGuideKey, IntegrationSetupGuide>> = {
  // ---- タスク同期（双方向） ---------------------------------------------
  google_tasks: {
    summary:
      '会社の Google ToDo リストと双方向でつなぎます。Google 側でチェックを付けると TaskApp 側も完了になります。',
    steps: [
      '接続画面の「Google Tasks に接続」を押します',
      'Google アカウントでログインします',
      'ToDo リストの読み書きを許可します（終わると自動でこの画面に戻ります）',
      PICK_TARGET_SPACE,
      '必要なら、既定の担当者と、取り込むリストを指定します',
    ],
    notes: [
      '取り込み先のプロジェクトを選ぶまで同期は始まりません（意図しない場所へ大量のタスクが流れ込まないようにしています）。',
    ],
  },
  multica: {
    summary:
      'multica と相互につなぎます。multica で起きた案件が TaskApp に届き、完了はどちらから行っても両方に反映されます。',
    steps: [
      'TaskApp に multica の URL（例: https://multica.example.com）を入れて「自社multica接続を作成」を押します',
      '画面に出る「送信先URL」「送信鍵」「受信鍵」をその場で控えます（閉じると二度と表示されません）',
      'multica 側の連携設定に、控えた送信先URLと鍵を貼ります',
      PICK_TARGET_SPACE,
    ],
    notes: [
      '鍵が漏れたときは「送信鍵を再生成」「受信鍵を再生成」で作り直せます。古い鍵はその場で使えなくなるので、multica 側も新しい鍵に差し替えてください。',
    ],
  },
  backlog: {
    summary: 'Backlog の課題を取り込んでタスクにします。完了は Backlog 側にも書き戻します。',
    steps: [
      'Backlog を開き、右上のアイコンから「個人設定」→「API」を開きます',
      'メモ欄に用途（例: TaskApp連携）を書いて「登録」を押し、表示された APIキーをコピーします',
      'TaskApp の「スペースURL」に Backlog のURL（例: https://your-space.backlog.jp）を入れます',
      'コピーした APIキーを貼って「接続する」を押します',
      PICK_TARGET_SPACE,
    ],
    notes: ['APIキーは発行した人の権限で動きます。見えない課題は取り込めません。'],
  },
  jooto: {
    summary: 'Jooto のタスクを取り込んでタスクにします。完了は Jooto 側にも書き戻します。',
    steps: [
      'Jooto にログインし、アカウント設定の「API」から APIキーを発行します',
      '発行された APIキーをコピーします',
      'TaskApp の「APIキー」欄に貼って「接続する」を押します',
      PICK_TARGET_SPACE,
    ],
    notes: [
      'Jooto からの取り込みは1日1回です（Jooto 標準プランの呼び出し回数の上限に合わせています）。',
      'そのため Jooto 側の期限は、AI秘書の期限リマインドの根拠には使いません（終わっている仕事を催促しないためです）。',
    ],
  },
  jira: {
    summary: 'Jira の課題を取り込んでタスクにします。完了は Jira 側にも書き戻します。',
    steps: [
      'Atlassian のアカウント設定（id.atlassian.com）で「セキュリティ」→「APIトークンの作成と管理」を開きます',
      '「APIトークンを作成」を押し、表示されたトークンをコピーします（閉じると再表示できません）',
      'TaskApp の「サイトURL」に Jira のURL（例: https://your-site.atlassian.net）を入れます',
      'Atlassian にログインしているメールアドレスを入れ、コピーしたトークンを「APIキー」欄に貼ります',
      '「接続する」を押します。' + PICK_TARGET_SPACE,
    ],
    notes: ['メールアドレスは本人確認に使います（Jira はトークンだけでは認証できません）。'],
  },
  redmine: {
    summary:
      'Redmine のチケットを取り込んでタスクにします。完了は Redmine 側にも書き戻します。自社サーバーで動かしている Redmine にもつなげます。',
    steps: [
      'Redmine にログインし、右上の「個人設定」を開きます',
      '右側の「APIアクセスキー」で「表示」を押し、鍵をコピーします',
      'TaskApp の「サーバーURL」に Redmine のURL（例: https://redmine.example.com）を入れます',
      'コピーした鍵を「APIキー」欄に貼って「接続する」を押します',
      PICK_TARGET_SPACE,
    ],
    notes: [
      'APIアクセスキーが表示されないときは、管理者に「REST API を有効にしてほしい」と依頼してください。',
      '社内からしか開けない Redmine にはつなげません（インターネット経由で届くURLが必要です）。',
    ],
  },
  asana: {
    summary: 'Asana のタスクを取り込んでタスクにします。完了は Asana 側にも書き戻します。',
    steps: [
      'Asana の開発者向け画面（app.asana.com/0/my-apps）を開きます',
      '「Personal access token」→「Create new token」でトークンを作り、コピーします（閉じると再表示できません）',
      'TaskApp の「APIキー」欄に貼って「接続する」を押します',
      PICK_TARGET_SPACE,
    ],
  },
  trello: {
    summary: 'Trello のカードを取り込んでタスクにします。完了は Trello 側にも書き戻します。',
    steps: [
      'Trello にログインします',
      '接続画面の「Trello でトークンを発行する」を押します（Trello の許可画面が開きます）',
      '「Allow」を押すと、画面に長い英数字（トークン）が出ます。これをコピーします',
      'TaskApp の「APIキー」欄に貼って「接続する」を押します',
      PICK_TARGET_SPACE,
    ],
    notes: [
      '貼るのは「トークン」です。Trello の「APIキー」は TaskApp 側が持っているため、入力は要りません。',
      'トークンに期限は付けていません。使うのをやめるときは Trello 側でいつでも取り消せます。',
    ],
  },
  linear: {
    summary: 'Linear の issue を取り込んでタスクにします。完了は Linear 側にも書き戻します。',
    steps: [
      'Linear の Settings →「Security & access」→「Personal API keys」を開きます',
      '「New API key」でキーを作り、表示された値をコピーします（閉じると再表示できません）',
      'TaskApp の「APIキー」欄に貼って「接続する」を押します',
      PICK_TARGET_SPACE,
    ],
  },
  chatwork: {
    summary:
      'Chatwork の「タスク」機能とつなぎます。チャットのつなぎ込み（「つなぐ」タブ）とは別で、こちらはタスクの同期です。',
    steps: [
      'Chatwork の右上のアイコンから「サービス連携」→「API Token」を開きます',
      'パスワードを入れて表示されたトークンをコピーします',
      'TaskApp の「APIキー」欄に貼って「接続する」を押します',
      PICK_TARGET_SPACE,
    ],
    notes: [
      'Chatwork のタスクは一度に100件までしか取得できないため、タスクの多いチャットでは取りこぼしが起きえます。',
      'そのため Chatwork 側の期限は、AI秘書の期限リマインドの根拠には使いません（終わっている仕事を催促しないためです）。',
      'TaskApp から Chatwork へ新しいタスクを作ることはできません（取り込みと、完了の書き戻しに対応しています）。',
    ],
  },
  kintone: {
    summary:
      'kintone のアプリのレコードを取り込んでタスクにします。完了は kintone 側にも書き戻します。',
    steps: [
      'kintone の対象アプリで「アプリの設定」→「APIトークン」を開きます',
      'トークンを生成し、「レコード閲覧」と「レコード編集」にチェックを入れて保存します',
      '画面右上の「アプリを更新」を押して、トークンを有効にします',
      'TaskApp にサブドメイン（例: your-space.cybozu.com）と、アプリ番号＋APIトークンの組を入れて接続します',
      'アプリごとに「どの項目がタスク名・期限・担当・完了か」を対応づけます（候補が提案されるので確認するだけです）',
    ],
    notes: [
      'APIトークンはアプリごとに発行します。接続したあとでも、アプリを1つずつ追加・削除できます。',
      '「アプリを更新」を押し忘れると、作ったトークンは有効になりません（一番多いつまずきです）。',
      '対応づけに使った選択肢の名前を kintone 側で変えると、対応が外れて同期が止まります。',
    ],
  },
  generic_inbound: {
    summary:
      '公開APIが無いツールでも、Zapier・Make・n8n などから決まった形で送ってもらえば、タスクとして取り込めます。',
    steps: [
      'TaskApp で受信口を作り、送り先URLと署名用の鍵を発行します',
      '鍵はその場で控えます（一度しか表示されません）',
      'Zapier などの自動化ツールで、発行したURL宛にタスクの内容を送る設定をします',
      PICK_TARGET_SPACE,
    ],
    notes: [
      'こちらから取りに行かない「受け取るだけ」の連携です。相手ツール側で完了にしても TaskApp には戻りません。',
    ],
  },
  // ---- データ書き出し・通知（送りっぱなし） -----------------------------
  webhook: {
    summary: 'タスクが発生したときに、指定した宛先へ通知を送ります（署名付き）。',
    steps: [
      '受け取り側のURLを用意します（Zapier・Make・自社のサーバーなど）',
      'TaskApp で送り先のURLと、通知したいできごと（作成・完了など）を登録します',
      '表示された署名用の鍵を控えて、受け取り側で「正しい送り主か」を確かめる設定に使います',
    ],
    notes: ['送りっぱなしの一方通行です。相手側での変更は TaskApp に戻ってきません。'],
  },
  notion: {
    summary:
      'タスクを Notion のデータベースへ書き出せます。逆に、Notion のデータベースを取り込んで同期することもできます。',
    steps: [
      'TaskApp の「Notion に接続」から、Notion にログインして許可します',
      '許可の画面で、使いたいデータベース（ページ）にチェックを入れて共有します',
      '書き出すときは、送り先のデータベースIDと、通知したいできごとを登録します',
      '取り込むときは、一覧から取り込み元のデータベースを選び、期日・完了の対応づけを1回確認します',
    ],
    notes: [
      '書き出しと取り込みは同じ1つの接続を使います。別々に接続を作る必要はありません。',
      'Notion 側で共有し忘れたデータベースは、権限が無いため一覧に出ません。',
    ],
  },
  google_sheets: {
    summary: 'タスクが発生するたびに、指定したスプレッドシートへ1行ずつ追記します。',
    steps: [
      'TaskApp の「Google Sheets に接続」から、Google アカウントでログインして許可します',
      '追記したいスプレッドシートを開き、URL の中ほどにある長い英数字（スプレッドシートID）をコピーします',
      'TaskApp にスプレッドシートIDとシート名（例: タスク）を入れて登録します',
    ],
    notes: ['送りっぱなしの一方通行です。シート側で書き換えても TaskApp には戻りません。'],
  },
  csv_export: {
    summary: '会計ソフト（freee・マネーフォワードなど）へ取り込むためのCSVを書き出せます。',
    steps: [
      '対象のプロジェクトを開きます',
      '「設定」→「データ管理」→「データエクスポート」を開きます',
      'CSVを書き出し、会計ソフト側の取り込み画面で読み込みます',
    ],
    notes: ['書き出しはプロジェクトごとです（このツール連携の画面からは書き出せません）。'],
  },
  // ---- 個人アカウントの接続（設定 → ツール連携） ------------------------
  google_calendar: {
    summary: '日程調整の候補日について、参加者の予定が空いているかを自動で確認できるようになります。',
    steps: [
      '「Googleアカウントを接続」を押します',
      'Googleアカウントでログインします',
      '「カレンダーの空き情報の参照」を許可します',
      '自動的にこの画面に戻ります',
    ],
    notes: ['取得するのは「空いている / 埋まっている」だけです。予定の中身は読み取りません。'],
  },
  google_tasks_personal: {
    summary:
      'あなたが担当するタスクが、あなたの Google ToDo リストの「TaskApp」リストに自動で追加されます。Gmail やスマホの Google ToDo アプリからも見えるようになります。',
    steps: [
      '「Google ToDo リストを接続」を押します',
      'Googleアカウントでログインします',
      'ToDo リストの読み書きを許可します',
      '自動的にこの画面に戻ります',
    ],
    notes: [
      '同期されるのは自分が担当のタスクだけです。他の人のタスクは同期されません。',
      'Google 側でチェックを付けると TaskApp 側も完了になります。',
    ],
  },
  zoom: {
    summary: '日程調整で会議が決まったときに、Zoom の会議リンクを自動で作れるようになります。',
    steps: [
      '「Zoomアカウントを接続」を押します',
      'Zoom にログインして、会議の作成を許可します',
      '自動的にこの画面に戻ります',
      'プロジェクト設定で既定のビデオ会議を Zoom にすると、以後は自動でリンクが入ります',
    ],
  },
  teams: {
    summary:
      '日程調整で会議が決まったときに、Microsoft Teams の会議リンクを自動で作れるようになります。',
    steps: [
      '「Teamsアカウントを接続」を押します',
      'Microsoft アカウントでログインして、会議の作成を許可します',
      '自動的にこの画面に戻ります',
      'プロジェクト設定で既定のビデオ会議を Teams にすると、以後は自動でリンクが入ります',
    ],
  },
}

/**
 * 手順を引く。無ければ null（呼び出し側は「連携のしかた」ボタンごと出さない）。
 * 近日対応（planned）のツールは手順を持たない＝ボタンも出ない、が意図した状態。
 */
export function getSetupGuide(key: string): IntegrationSetupGuide | null {
  return INTEGRATION_SETUP_GUIDES[key as SetupGuideKey] ?? null
}

/**
 * 公式ドキュメントのURL。手順側の docUrl を優先し、無ければ registry の setupUrl を使う
 * （URLを2箇所に書かないための一本化）。
 */
export function getSetupGuideDocUrl(key: string): string | null {
  const guide = getSetupGuide(key)
  if (!guide) return null
  return guide.docUrl ?? getIntegration(key)?.setupUrl ?? null
}
