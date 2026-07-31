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
 * ## 書き方の約束（厳守）
 *
 * - **手順は必ず公式ドキュメントで裏を取る**。記憶で書かない。ツール側は画面をよく変えるため、
 *   「昔こうだった」で書くと、その通りにやって辿り着けず信用を失う。裏が取れなかったことは
 *   書かない（曖昧に濁すのではなく、書かない）。
 * - 裏付けに実際に開いたURLを `sources` に、確認した日を `verifiedOn` に残す。次に直す人が
 *   「いつ時点の画面か」を判断できるようにするため。**古い `verifiedOn` は再確認の合図**。
 * - 1ステップ＝1動作。ボタン名・メニュー名は画面の**正確な表記**をそのまま使う（英語UIは英語のまま）。
 * - 並び順は「相手ツール側の操作 → TaskApp 側の操作」。人は相手ツールを先に触るため。
 * - TaskApp 側の道順は次の表記に統一する。**「接続画面」のような曖昧語は使わない**
 *   （利用者はそれがどの画面か分からない、という実際の指摘から）:
 *     組織: 「左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から〇〇を選ぶ
 *            （見つからないときは一覧の下の「すべて表示」を押す）」
 *     個人: 「設定 →「個人のツール連携」を開く」
 * - **運用者が最初に一度だけやる作業と、利用者が毎回やる作業を混ぜない**（Trello で実際に混ぜ、
 *   利用者全員が Power-Up を作りに行きかねない手順になっていた）。手順は利用者の操作に徹する。
 * - notes は「気をつけること」だけ。手順を書かない。
 * - 全ツール共通の定型（owner/admin だけが操作できる等）は `adminOnly` で表し、文言は
 *   ToolSetupGuide 側で1回だけ出す。ツールごとに書き写さない。
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
  /** 手順。相手ツール側 → TaskApp 側 の順。1ステップ＝1動作 */
  steps: string[]
  /** 気をつけること（任意）。手順は書かない */
  notes?: string[]
  /**
   * 接続の作成・変更が owner/admin 限定か。共通の一文を ToolSetupGuide が出す
   * （ツールごとに同じ注意を書き写さないため）。
   */
  adminOnly?: boolean
  /**
   * 手順の裏付けに**実際に開いた**公式ドキュメント。次に直す人が同じ場所を見直せるように残す。
   * 開いていないURLを書かない（書いたら裏を取ったことにならない）。
   */
  sources: string[]
  /** 公式資料で裏を取った日（YYYY-MM-DD）。古くなったら再確認する目印。 */
  verifiedOn: string
  /**
   * 公式ドキュメントのURL。省略時は registry の setupUrl を使う
   * （個人連携キーは registry に無いため、必要ならここに書く）。
   */
  docUrl?: string
}

/**
 * TaskApp 自身の機能（相手ツール側の画面が存在しないもの）の verifiedOn。
 * 外部ドキュメントではなく自社コードで裏を取っているため、sources には実装のパスを入れる。
 */
const SELF = '2026-07-30'

export const INTEGRATION_SETUP_GUIDES: Partial<Record<SetupGuideKey, IntegrationSetupGuide>> = {
  multica: {
    summary:
      'multica と相互につなぎます。multica で起きた案件が TaskApp に届き、完了はどちらから行っても両方に反映されます。',
    steps: [
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から multica を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「multicaのURL」の欄に、自社の multica のURLを入れます（例: https://multica.example.com）',
      '「自社multica接続を作成」を押します',
      '画面に出る「送信先URL」「送信鍵」「受信鍵」を、その場で控えます（閉じると二度と表示されません）',
      'multica 側の連携設定に、控えた送信先URLと鍵を貼ります',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      '鍵が漏れたときは「送信鍵を再生成」「受信鍵を再生成」で作り直せます。古い鍵はその場で使えなくなるので、multica 側も新しい鍵に差し替えてください。',
      'multica から届くタスクには期限が入りません。そのため multica 側を期限リマインドの根拠には使いません。',
    ],
    adminOnly: true,
    sources: ['src/components/secretary/integrations/ConnectorSyncPane.tsx'],
    verifiedOn: SELF,
  },
  generic_inbound: {
    summary:
      '公開APIが無いツールでも、Zapier・Make・n8n などから決まった形で送ってもらえば、タスクとして取り込めます。',
    steps: [
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から「その他のツール（Webhook）」を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '受信口を作り、送り先URLと署名用の鍵を発行します',
      '鍵はその場で控えます（一度しか表示されません）',
      'Zapier などの自動化ツールで、発行したURL宛にタスクの内容を送る設定をします',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      'こちらから取りに行かない「受け取るだけ」の連携です。相手ツール側で完了にしても TaskApp には戻りません。',
      '次にいつ届くかは送る側次第で、こちらでは保証できません。そのため受け取った期限は催促の根拠には使いません。',
    ],
    adminOnly: true,
    sources: ['src/components/secretary/integrations/GenericInboundPanel.tsx'],
    verifiedOn: SELF,
  },
  webhook: {
    summary: 'タスクが発生したときに、指定した宛先へ通知を送ります（署名付き）。',
    steps: [
      '受け取り側のURLを用意します（Zapier・Make・自社のサーバーなど）',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Webhook を選びます',
      '「新規作成」を押します',
      '「表示名」に、あとで自分が分かる名前を入れます',
      '「URL」に、用意した受け取り先を入れます',
      '「購読イベント」で、通知したいできごとにチェックを入れます',
      '「作成」を押します',
      '表示された署名用の鍵を控えて、受け取り側で「正しい送り主か」を確かめる設定に使います',
    ],
    notes: ['送りっぱなしの一方通行です。相手側での変更は TaskApp に戻ってきません。'],
    adminOnly: true,
    sources: ['src/components/secretary/integrations/CreateSinkForm.tsx'],
    verifiedOn: SELF,
  },
  csv_export: {
    summary: '会計ソフト（freee・マネーフォワードなど）へ取り込むためのCSVを書き出せます。',
    steps: [
      '対象のプロジェクトを開きます',
      '「設定」→「データ管理」→「データエクスポート」を開きます',
      'CSVを書き出し、会計ソフト側の取り込み画面で読み込みます',
    ],
    notes: [
      '書き出しはプロジェクトごとです（複数プロジェクトを横断するツール連携の画面からは書き出せません）。',
    ],
    sources: ['src/components/secretary/integrations/ToolConnectOverview.tsx'],
    verifiedOn: SELF,
  },
  google_tasks: {
    summary: '会社の Google ToDo リスト（Google Tasks）と双方向でつなぎます。どちらで作っても両方に現れ、どちらでチェックを付けても両方が完了になります。',
    steps: [
      'Google Tasks 側で事前にやることはありません',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Google Tasks を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '画面上の「双方向同期」の中にある「Google Tasks」の欄で、「Google Tasksに接続」を押します',
      'Google のログイン画面で、使いたい Google アカウントを選びます',
      '「Create, edit, organize, and delete all your tasks.」（ToDo の作成・編集・整理・削除）という許可を求められるので、そのまま許可します',
      '許可が終わると自動で TaskApp の画面に戻ります',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      '取り込み先を選ぶ欄の名前は、画面上では「取り込み先スペース」です。ここを選んだ瞬間に取り込みが「有効」に切り替わります。別に有効化のスイッチはありません。',
      '接続そのものは組織のメンバーなら実行できますが、「取り込み先スペース」「既定の担当者(任意)」などの設定を触れるのは、組織のオーナーか管理者だけです。それ以外の人には、選べない灰色の状態で表示されます。',
      '求められる許可は ToDo に関する1種類だけです。Google の決まりで、許可が1種類しかないときはチェックボックスは出ず、まとめて「許可する／しない」のどちらかになります。途中でどれかだけ外す、ということはできません。',
      'この許可には ToDo の削除も含まれます。Google の用意している許可の単位がそうなっているためで、読み取りだけに絞ることはできません。',
      '取り込み先を選ぶまで同期は始まりません。意図しない場所へ大量のタスクが流れ込まないようにするためです。',
      '「読み込み対象リスト(任意・カンマ区切り)」という欄がありますが、入れるのはリストの名前ではなく Google 側の内部IDです。空のままにしておくと、書き出し先リスト以外のすべてのリストが対象になります。普通は空のままで構いません。',
    ],
    // adminOnly を立てない: 接続そのものはメンバーでも実行できる（制限がかかるのは接続後の
    // 取り込み設定だけ）。共通の一文を出すと「繋げない」と誤解させるため、notes 側で説明する。
    sources: [
      'https://developers.google.com/workspace/tasks/auth',
      'https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions',
    ],
    verifiedOn: '2026-07-30',
  },
  backlog: {
    summary: 'Backlog の課題を TaskApp に取り込んで、ふだん見ているタスク一覧の中で一緒に扱えるようにします。TaskApp 側で完了にすると Backlog 側にも書き戻ります。',
    steps: [
      'Backlog にログインします（自分のスペースのURL、例: https://（スペースID）.backlog.jp を開きます）',
      '画面いちばん上の帯（グローバルバー）にある自分のアイコンを押します',
      '出てきたメニューの「個人設定」を選びます',
      '個人設定の中の「API」を開きます（「APIの設定」の画面が開きます）',
      '「メモ」の欄に、何に使うかを書きます（例: TaskApp連携）',
      '「登録」を押します',
      '一覧に増えたAPIキーの文字列をコピーします',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Backlog を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「スペースURL」の欄に、自分の Backlog のURLを入れます（例: https://（スペースID）.backlog.jp）',
      '「APIキー」の欄に、さきほどコピーした文字列を貼り付けます',
      '「接続する」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      'スペースURLの末尾は「.backlog.jp」と「.backlog.com」の2種類があります。公式のよくあるご質問でもこの2つが案内されています。自分がふだん開いているURLをそのまま写してください。ここを間違えるとつながりません。',
      '古いスペースで使われている「.backlogtool.com」のURLでもつながります。',
      'APIキーを使えなくしたいときは、「APIの設定」の一覧の右にある「×」を押して削除します。公式ヘルプの表記は「削除ボタン」ではなく一覧右側の「×」です。',
      '登録したAPIキーは「APIの設定」の一覧に表示されます。ただし公式ヘルプは「登録済のAPIキーが一覧で表示されます」と書いているだけなので、文字列そのものがいつでも再表示できるとは断言できません。手元にも控えておくと安心です。',
      'Backlog には呼び出し回数の上限があります。公式のお知らせによると、読み込みは有料プランで600回/分、フリープランで60回/分までで、超えると「429 Too Many Requests」が返ります。',
      'この上限は「APIキーごと」ではなく「ユーザーごと」です（公式のお知らせに「この制限はAPIキー単位ではなく、ユーザー単位であることにご注意ください」と明記）。同じ人のキーを他のツールでも使い回していると、合計で上限に当たります。',
    ],
    adminOnly: true,
    sources: [
      'https://support-ja.backlog.com/api/v2/help_center/ja/articles/360035641754.json',
      'https://support-ja.backlog.com/api/v2/help_center/ja/articles/360036146273.json',
      'https://backlog.com/ja/enterprise-help/userguide/userguide1850/',
      'https://backlog.com/ja/enterprise-help/userguide/userguide162/',
      'https://backlog.com/ja/enterprise-help/userguide/userguide1185/',
    ],
    verifiedOn: '2026-07-30',
  },
  jooto: {
    summary: 'Jooto のタスクを TaskApp に取り込んで、ほかのツールの仕事と並べて見られるようにします。TaskApp 側で完了にすると Jooto 側にも書き戻ります。',
    steps: [
      'Jooto にログインします（https://app.jooto.com）',
      '画面左上の黒い背景の部分を押します',
      '「APIキー」の設定を選びます（発行済みAPIキー一覧のページが開きます）',
      '画面右上の「APIキーを追加」を押します',
      '説明欄に、何に使うかを書きます（例: TaskApp連携）',
      '「Jooto API利用規約に同意」にチェックを入れます',
      '「追加」を押します',
      '発行済みAPIキー一覧で、いま追加した行を押します（APIキーが表示されます）',
      '表示されたAPIキーの文字列をコピーします',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Jooto を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「APIキー」の欄に、さきほどコピーした文字列を貼り付けます',
      '「接続する」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      'APIキーの発行には Jooto の組織管理者の権限が要ります。公式のリファレンスに「組織の管理者はAPIキーを管理でき、発行されている全てのAPIキーの編集・削除が可能です」と書かれています。管理者でない方は、管理者に発行してもらってください。',
      'Jooto の API はもともとビジネスプラン向けの機能です。公式のお知らせに「ビジネスプラン限定の『Jooto API』機能につきまして、スタンダードプランにおいても制限付きで試用いただけるようになりました」と書かれています。',
      '呼び出し回数の上限はプランで大きく違います。公式のリファレンスによると、1ヶ月あたりビジネスプランは無制限、スタータープランは最大100回までです（毎月1日0時にリセット）。',
      '作れるAPIキーの数にも上限があります。ビジネスプランは10個、スタータープランは1個までです。すでに1個使っている場合、スタータープランでは新しく追加できません。',
      '上限を超えると Jooto は「429 Too Many Requests」というエラーを返します。ほかの連携ツールでも同じ組織のAPIを使っていると、合計で上限に当たることがあります。',
      '上限に達しても「100回だけ追加」といった買い足しはできません。公式ヘルプは、上限を増やすには上位プランへの切り替えが必要で、問い合わせフォームから相談するよう案内しています。',
    ],
    adminOnly: true,
    sources: [
      'https://www.jooto.com/api/reference/authentication/',
      'https://www.jooto.com/api/reference/restriction/',
      'https://www.jooto.com/api/reference/',
      'https://tayori.com/q/jooto-help-center/detail/1011394/',
      'https://www.jooto.com/news/20251209_starterplan/',
    ],
    verifiedOn: '2026-07-30',
  },
  jira: {
    summary: 'Jira のプロジェクトを TaskApp につないで、課題を取り込めるようにします。選んだプロジェクトの課題が TaskApp に流れてきて、TaskApp 側で完了にすると Jira 側にも完了が書き戻ります。',
    steps: [
      'ブラウザで https://id.atlassian.com/manage-profile/security/api-tokens を開きます',
      'Atlassian アカウントでログインします',
      '※ すぐ近くに「Create API token with scopes」というボタンもありますが、そちらは押さないでください（理由は下の「気をつけること」に書きました）',
      '「Create API token」を押します',
      '名前を入れます。あとで見て何用か分かる名前にします（例: TaskApp）',
      '有効期限（expiration date）を選びます（1〜365日の範囲）',
      '「Create」を押します',
      '「Copy to clipboard」を押して、表示された文字列をコピーします（この画面を離れると二度と表示されません）',
      'Jira を開きます',
      'ブラウザのアドレス欄に出ている自分のサイトの住所を控えます（https://〇〇.atlassian.net の形）',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Jira を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「サイトURL」の欄に、控えた https://〇〇.atlassian.net を入れます',
      '「メールアドレス(Basic認証)」の欄に、いまトークンを作った本人の Atlassian アカウントのメールアドレスを入れます',
      '「APIキー」の欄に、コピーしたトークンの文字列を貼り付けます',
      '「接続する」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      '「Create API token with scopes」（権限を絞ったトークン）を選ばない理由: 絞ったトークンは、公式の説明どおり接続先の住所が https://api.atlassian.com/ex/jira/{cloudId} という別物に変わります。TaskApp の「サイトURL」は https://〇〇.atlassian.net を前提にしているため、絞ったトークンでは繋がりません。公式は「絞ったほうが安全なのでおすすめ」と書いていますが、ここでは従来型を選んでください。',
      'メールアドレスが要る理由: Jira は合鍵（トークン）だけでは「誰の合鍵か」を判断しません。公式の例示も「メールアドレス:トークン」の形（curl -u fred@example.com:freds_api_token）で、2点セットで本人確認します。だから両方を入れる欄があります。',
      '入れるメールアドレスは、必ず「そのトークンを作った本人」のものです。Google ログインで Jira を使っている場合も、Atlassian アカウントのメールアドレスを入れます。',
      'トークンは作った直後の1回しか表示されません。公式も「この手順のあとは復元できない」と明記しています。コピーし忘れたら作り直してください。',
      '有効期限は最長365日です。期限が切れると同期が黙って止まります。期限の日をカレンダーに入れておくと安心です。',
      'TaskApp から見えるのは、トークンを作った人が Jira で見られる範囲と同じです。退職・異動する予定の人のアカウントでは作らないでください。',
    ],
    adminOnly: true,
    sources: [
      'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/',
      'https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/',
    ],
    verifiedOn: '2026-07-30',
  },
  redmine: {
    summary: 'Redmine の課題（チケット）を TaskApp に取り込む連携です。つなぐと、選んだプロジェクトの課題が TaskApp 側に流れ込み、誰が次に動くかを一覧で見られるようになります。',
    steps: [
      'Redmine に、連携に使いたいユーザーでログインします',
      '「個人設定」（英語表示では「My account」）を開きます（確実なのは URL を直接開く方法です: https://<自社のRedmineのアドレス>/my/account）',
      'ページ右側の「APIアクセスキー」（英語表示では「API access key」）の欄を探します',
      '「表示」（英語表示では「Show」）を押します',
      '表示された文字列（APIアクセスキー）をコピーします',
      '※ 「APIアクセスキー」の欄が見当たらないときは、ここで止まって管理者に連絡します（次の3つは管理者の作業です）',
      '【管理者の作業】「管理」→「設定」→「API」タブを開きます（英語表示では「Administration」→「Settings」→「API」）',
      '【管理者の作業】「RESTによるWebサービスを有効にする」（英語表示では「Enable REST web service」）にチェックを入れます',
      '【管理者の作業】画面の保存ボタンを押します（そのあと手順2からやり直すと欄が出ます）',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Redmine を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「サーバーURL」の欄に、Redmine のトップページのアドレスを入れます（例: https://redmine.example.com。/my/account などの後ろの部分は付けません）',
      '「APIキー」の欄に、コピーしたAPIアクセスキーを貼り付けます',
      '「接続する」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      '外部のツールから読み書きするための入口（REST API）が管理者によって切られていると、キーが隠れているのではなく「APIアクセスキー」の欄そのものが画面に出ません。「見つからない＝自分の探し方が悪い」ではないので、無ければ管理者に有効化を頼んでください。',
      '「個人設定」への行き方はバージョンで違います。5系・6系は画面右上にリンクが並んでいます。7系からは右上のアイコン（アバター）を押すと出るメニューの中に入りました。どちらでも URL を直接打つのが一番早いです。',
      '有効化の場所もバージョンで名前が違います。5系・6系は「管理」→「設定」→「API」タブです。開発中の7系ではこの設定が「連携」（Integrations）タブに移っています。',
      '接続先は https:// で始まるアドレスだけ受け付けます。http:// のまま運用している Redmine、:8080 のようにポート番号が付くアドレス、URLの中にユーザー名やパスワードを含む書き方は、いずれも弾かれます。',
      '社内ネットワークやVPNの中だけで動いている Redmine は、TaskApp から呼びに行けないのでつながりません。外（インターネット）から開けるアドレスが必要です。手元のパソコンのブラウザで開けても、社外から開けなければNGです。',
      '「サーバーURL」は Redmine のトップのアドレスにしてください。課題一覧やプロジェクト画面を開いたときの長いURLを貼ると、うまくつながらないことがあります。',
    ],
    adminOnly: true,
    sources: [
      'https://www.redmine.org/projects/redmine/wiki/Rest_api',
      'https://www.redmine.org/projects/redmine/wiki/RedmineSettings',
      'https://raw.githubusercontent.com/redmine/redmine/6.1-stable/app/views/my/_sidebar.html.erb',
      'https://raw.githubusercontent.com/redmine/redmine/6.1-stable/config/locales/ja.yml',
      'https://raw.githubusercontent.com/redmine/redmine/6.1-stable/app/helpers/settings_helper.rb',
    ],
    verifiedOn: '2026-07-30',
  },
  asana: {
    summary: 'Asana のタスクを TaskApp に取り込む連携です。つなぐと、選んだプロジェクトのタスクが TaskApp 側に流れ込み、他ツールの仕事とまとめて「次に動くのは誰か」を見られるようになります。',
    steps: [
      'Asana にログインします',
      'https://app.asana.com/0/my-apps を開きます（開発者向けの管理ページ＝developer console です。メニューからたどる場合は、画面右上の自分のプロフィール写真 →「Settings」→「Apps」→「View developer console」）',
      '「+ Create new token」（新しいトークンを作る）を押します',
      '「Token name」（トークンの名前）に、後から分かる名前を入れます（例: TaskApp）',
      '「Create token」を押します',
      '表示されたトークンを、その場でコピーします（この画面を閉じると二度と表示されません）',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Asana を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「APIキー」の欄に、コピーしたトークンを貼り付けます',
      '「接続する」を押します',
      '複数のワークスペースに所属している場合だけ、選ぶ欄が出ます。取り込みたいものを選んでもう一度「接続する」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      'トークンは作成直後の一度しか表示されません（公式に「一度だけ表示される。無くしたら作り直すかリセットすればよい」と明記があります）。コピーし損ねたら、探し回らずに作り直してください。',
      '作成・編集・削除は同じ developer console のページでできます。担当者が変わったら古いトークンを消してください。',
      'トークンは作った本人の権限で動き、Asana 上の操作もその人の名前で記録されます。担当者個人ではなく、連携専用のユーザー（またはゲスト）アカウントを作ってそこで発行する方法も公式に案内されています。',
      '個人トークンで見えるのは、その人が見えている範囲だけです。会社全体のデータをまとめて扱いたい場合、公式は Service Accounts（Enterprise プランでのみ使え、作成できるのは管理者だけ）を案内しています。',
      'トークンは一度作れば使い続けられる長期のものです（公式は long-lived と説明）。ただし作った人のアカウントが停止・退職で消えると連携も止まります。',
      'トークンはパスワードと同じ扱いです。チャットやメールに貼って共有しないでください。',
    ],
    adminOnly: true,
    sources: [
      'https://developers.asana.com/docs/personal-access-token',
      'https://developers.asana.com/docs/quick-start',
      'https://developers.asana.com/docs/manage-and-share-your-app',
      'https://developers.asana.com/docs/authentication',
    ],
    verifiedOn: '2026-07-30',
  },
  trello: {
    summary: 'Trello のボードを TaskApp につないで、カードを取り込めるようにします。TaskApp 側で完了にすると Trello 側にも書き戻ります。',
    steps: [
      'ブラウザで Trello（https://trello.com）を開きます',
      'つなぎたいアカウントでログインします（複数アカウントを持っている人は、ここでログインしているアカウントが許可の対象になります）',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Trello を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      'フォーム上部の外部リンク「Trello でトークンを発行する」を押します（Trello の許可画面が開きます）',
      '開いた画面に「どのアプリに」「何を許可するか」が書かれているので、内容を読みます',
      '緑色の「Allow」（許可する）を押します',
      'そのまま同じ画面に表示された長い英数字（トークン）を、途中で切らずに全部コピーします',
      'TaskApp の画面に戻ります',
      '「APIキー」の欄に、コピーした文字列を貼り付けます',
      '「接続する」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      '「Allow」を押しても TaskApp の画面には自動では戻りません。トークンがその場に表示されるので、自分でコピーして貼ってください。',
      'TaskApp が求める許可の範囲は read（読み取り）と write（書き込み）の2つで、期限は「なし」です。許可画面にも同じ内容が出るので、押す前に見比べて確かめてください。',
      '貼る文字列は正しくは「トークン」ですが、TaskApp の欄の名前は「APIキー」です。名前が違っていても、ここに貼るので合っています（他のツールと欄を共通にしているためです）。',
      'このトークンは、あなたが Trello で見られる／書き込めるボードに、あなたの代わりに触れる合鍵です。人に見せない・チャットに貼らないでください。',
      'つなぐのをやめたいときは、Trello のアバターを押して「Settings」→「Applications」の欄から、該当アプリの「Revoke」を押します（直接開くなら https://trello.com/u/my/account）。一覧には、アプリの名前・許可した日・許可した範囲・期限が出ます。',
    ],
    adminOnly: true,
    sources: [
      'https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/',
      'https://developer.atlassian.com/cloud/trello/guides/power-ups/managing-apps/',
      'https://support.atlassian.com/trello/docs/revoking-a-trello-token/',
    ],
    verifiedOn: '2026-07-30',
  },
  linear: {
    summary: 'Linear の Issue（課題）を TaskApp に取り込む連携です。つなぐと、選んだチームの Issue が TaskApp 側に流れ込み、次に動くのが誰かを他ツールの仕事とまとめて見られるようになります。',
    steps: [
      'Linear にログインします',
      'https://linear.app/settings/account/security を開きます（画面のメニューからたどる場合は「Settings」→「Account」→「Security & Access」）',
      'このページのAPIキーの項目で、新しいキーを作る操作をします',
      'キーに、後から見て分かる名前を付けます（例: TaskApp）',
      'キーの権限で Read と Write の両方を選びます（自分が見られるデータすべてを渡す「full access」でも構いません）',
      '必要なら、対象を特定のチーム（team）だけに限定します',
      '作成後に表示されたキーを、その場でコピーします',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Linear を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「APIキー」の欄に、コピーしたキーを貼り付けます',
      '「接続する」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      '最後に選ぶ「取り込み先」は、Linear ではチーム（team）単位になります。Linear の Project（プロジェクト）単位では選べません。Linear では Issue は必ずどこかのチームに属しますが、プロジェクトには属さないものもあり、チームでないと取りこぼすためです。',
      '権限を絞るときは Read と Write の両方を入れてください（絞るときの選択肢は Read / Write / Admin / Create issues / Create comments です）。TaskApp は完了を Linear 側に書き戻すため、Read だけだと取り込みはできても完了が反映されません。',
      'ワークスペースの管理者が「Settings」→「Administration」→「API」の「Member API keys」でメンバーのキー作成を止めていることがあります。その場合はメンバーは作れない（管理者自身はいつでも作れる）ので、作れなければ管理者に確認してください。',
      '発行済みのキーは同じメニューから一覧で確認でき、不要になったら取り消せます。担当者が変わったら古いキーを消してください。',
      'キーは作った人の権限で動きます。特定のチームだけに絞ると、そのチーム以外の Issue は TaskApp 側に出てきません。まずは必要な範囲を広めにして、後から絞るほうが混乱が少ないです。',
      'キーは個人アカウントにひもづきます。作った人が退職してアカウントが消えると、連携も止まります。長く使うなら連携専用のアカウントで作るほうが安全です。',
    ],
    adminOnly: true,
    sources: [
      'https://linear.app/docs/api-and-webhooks',
      'https://linear.app/docs/security-and-access',
      'https://linear.app/developers/graphql',
    ],
    verifiedOn: '2026-07-30',
  },
  chatwork: {
    summary: 'Chatwork のチャットに溜まっている「タスク」を TaskApp に取り込みます。TaskApp で完了にすると Chatwork 側も完了になります。',
    steps: [
      'Chatwork に、連携に使いたいアカウントでログインします',
      '※ パーソナルプラン以外の契約では、先に Chatwork の組織管理者への申請が必要です',
      '申請が必要な場合は、ログインしたまま申請ページ（https://www.chatwork.com/service/packages/chatwork/subpackages/api/request.php）を開きます',
      'Chatwork の画面右上の「利用者名」を押します',
      '出てきたメニューから「サービス連携」を選びます',
      '「サービス連携」の画面の左側のメニューから「APIトークン」を選びます',
      '表示されたAPIトークンの文字列をコピーします',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から「Chatwork タスク」を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「APIキー」の欄に、コピーしたAPIトークンを貼り付けます',
      '「接続する」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      'TaskApp の一覧には「Chatwork タスク」という名前で並んでいます。チャットのやり取りを受け取る「つなぐ」タブの Chatwork 接続とは別物です。同じ Chatwork でも入口が2つあるので間違えないでください。',
      'パーソナルプラン以外は、Chatwork API を使うのに Chatwork の組織管理者への申請が必要です。自分の権限だけでは完結しないので、申請の窓口になる人に先に声をかけておくと早いです。',
      '貼るのは「その人個人の合鍵」です。そのアカウントが参加しているチャットしか候補に出ません。「取り込みたい相手先のチャットが選べない」の原因はほとんどこれで、故障ではありません。参加していないチャットは、先にそのアカウントを招待してもらってください。',
      '閲覧しかできない権限（readonly）のチャットは、はじめから候補に出しません。完了を書き戻せず必ず失敗する接続になるためです。',
      'APIトークンは期限がなく、Chatwork のほぼ全機能に触れる強い合鍵です。人に見せたり、チャットに貼ったりしないでください。',
      'Chatwork のタスク一覧は、公式仕様で一度に最大100件までしか取れず、続きを取りに行く仕組み（ページング）がありません。タスクがたくさん溜まっているチャットでは、取りこぼしが起きえます。',
    ],
    adminOnly: true,
    sources: [
      'https://developer.chatwork.com/docs/getting-started',
      'https://developer.chatwork.com/docs/endpoints',
      'https://developer.chatwork.com/reference/get-rooms-room_id-tasks',
      'https://developer.chatwork.com/reference/put-rooms-room_id-tasks-task_id-status',
      'https://www.chatwork.com/service/packages/chatwork/subpackages/api/request.php',
    ],
    verifiedOn: '2026-07-30',
  },
  kintone: {
    summary: 'kintone のアプリのレコードを TaskApp に取り込んでタスクにします。TaskApp で完了にすると kintone 側にも書き戻ります。',
    steps: [
      'kintone で、取り込みたいアプリの「レコードの一覧」画面を開きます',
      '画面右上の歯車の形をした「アプリを設定」アイコンを押します',
      '「アプリの設定」画面で「設定」タブを開きます',
      '「カスタマイズ／サービス連携」の中にある「APIトークン」を押します',
      '「APIトークン」画面で「生成する」を押します',
      '出てきたトークンの「アクセス権」で「レコード閲覧」にチェックが入っていることを確認します（初期状態で入っています）',
      '同じ「アクセス権」で、レコードの編集を許可するチェックも入れます（完了を kintone に書き戻すために必要です）',
      '※ 用途や担当者を書き残したいときは、「メモ」の横の「編集する」アイコンを押します',
      'メモの内容を書きます（200文字まで）',
      'チェックマークの「保存」アイコンを押して、メモを確定します',
      '画面右下の「保存」を押します',
      '画面右上の「アプリを更新」を押します',
      '「アプリを更新」ダイアログで、もう一度「アプリを更新」を押します（ここまで押さないとトークンは有効になりません）',
      '表示されたAPIトークンの文字列をコピーします',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から kintone を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「サブドメイン」の欄に、自社の kintone のサブドメインを入れます（例: your-company、または https://your-company.cybozu.com をそのまま貼っても構いません）',
      '「アプリのURL または アプリID」の欄に、対象アプリのURLかアプリ番号を入れます',
      'そのすぐ下の「APIトークン」の欄に、コピーしたトークンを貼り付けます',
      '※ 別のアプリもつなぐときは「+ アプリを追加（最大9件）」を押して行を増やし、そのアプリ用に作ったトークンを同じように入れます（アプリごとに別のトークンが必要です）',
      '「接続する」を押します',
      '接続できたら、アプリごとに「設定する」を押します',
      '「タイトルとして取り込むフィールド」「期日として取り込むフィールド」「完了として扱うフィールド」を選びます（候補が自動で提案されるので、合っているか確認するだけです）',
      '完了の判定にドロップダウンなどを使う場合は、「完了とみなす選択肢(複数可)」で、どの値を完了とみなすかにチェックを入れます',
      '「この設定で取り込む」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      '一番多いつまずきは「アプリを更新」の押し忘れです。保存しただけではトークンは効かず、TaskApp 側で「つながらない」となります。',
      'APIトークンはアプリ単位です。3つのアプリをつなぐなら、トークンも3本作ります。',
      'ライトコースの契約では APIトークンそのものが使えません（公式の記載）。',
      '1つのアプリで作れる APIトークンは20個までです。',
      '1回のやり取りで使えるトークンは9個までという kintone 側の制限があるため、TaskApp の「+ アプリを追加」も最大9件までです。10件目以降は接続を分けてください。',
      'APIトークンのアクセス権は、アプリ・レコード・項目ごとのアクセス権より優先されます。つまり、人には見せていないレコードもトークン経由では読めます。取り込み対象のアプリを選ぶときに気をつけてください。',
    ],
    adminOnly: true,
    sources: [
      'https://jp.kintone.help/k/ja/user/app_settings/api_token.html',
      'https://cybozu.dev/ja/kintone/docs/rest-api/overview/authentication/',
      'https://cybozu.dev/ja/kintone/tips/development/customize/development-know-how/api-tokens/',
    ],
    verifiedOn: '2026-07-30',
  },
  notion: {
    summary: 'Notion のデータベースへタスクを書き出したり、逆に Notion のデータベースを取り込んでタスクを同期したりできます。書き出しと取り込みは、同じ1つの接続を共有します。',
    steps: [
      'Notion で、書き出し先／取り込み元にしたいデータベースを開きます',
      'そのデータベースに対して、自分が「Full access」を持っているか確かめます',
      '書き出しに使う場合は、そのデータベースのURLから「データベースID」をコピーします（ワークスペース名の次のスラッシュ「/」から、クエスチョンマーク「?」までの間にある32文字の英数字）',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Notion を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「新規作成」を押します',
      '「表示名」の欄の下に出てくる「Notion に接続」を押します（まだ接続していないときだけ出ます）',
      'Notion の許可画面が開くので、内容を読みます',
      '「Select pages」（共有するページを選ぶ）を押します',
      'ページを選ぶ画面の検索欄で、さきほどのデータベースを名前で探します',
      '見つかったデータベースにチェックを入れます',
      '「Allow access」（アクセスを許可）を押します',
      'TaskApp の画面に戻ってくるまで待ちます（途中でやめると、選んだページへの権限は付きません）',
      '「表示名」の欄に、あとで自分が分かる名前を入れます',
      '「データベースID」の欄に、手順3でコピーしたIDを貼り付けます',
      '「購読イベント」で、書き出したいできごとにチェックを入れます（作成／完了／削除・却下／再オープン）',
      '「作成」を押します',
      '同じ画面の下にある「Notionからの取り込み」の一覧から、取り込み元のデータベースを選びます',
      '期日・完了などの対応づけを確認します',
      '「この設定で取り込む」を押します',
      '接続できたら、取り込み先のプロジェクトを選びます（選んだ時点で同期が始まります）',
    ],
    notes: [
      'Notion の権限には「Full access」「Can edit」「Can comment」「Can view」などがあり、他の人と共有できるのは「Full access」だけです。そのため許可画面のページ選択には、自分が「Full access」を持っているページ／データベースしか出てきません。見当たらないときは、まず Notion 側で自分の権限を上げてください。',
      '共有し忘れたデータベースは、権限が無いため TaskApp の一覧に出てきません。API から見ても「存在しない」のと同じ扱い（404）になります。',
      '「Allow access」を押しただけで途中でブラウザを閉じると、選んだページへの権限は付きません。Notion の公式資料にもそう書かれています。',
      '使えるのは、最初に許可した人が共有したデータベースだけです。あとから別のデータベースを足したいときは、Notion 側でそのデータベースを開いて共有先に追加してください。',
      'あとからデータベースを足したいときは、Notion 側でそのデータベースを開き、右上の「•••」→「Add connections」から接続を選ぶ方法もあります（Notion 公式ヘルプに記載）。',
      '書き出しと取り込みは、同じ1つの接続を使います。別々に接続を作る必要はありません。',
    ],
    adminOnly: true,
    sources: [
      'https://developers.notion.com/guides/get-started/authorization',
      'https://developers.notion.com/docs/authorization',
      'https://developers.notion.com/reference/retrieve-a-database',
      'https://www.notion.com/help/add-and-manage-connections-with-the-api',
      'https://www.notion.com/help/sharing-and-permissions',
    ],
    verifiedOn: '2026-07-30',
  },
  google_sheets: {
    summary: 'タスクが発生するたびに、指定したスプレッドシートへ1行ずつ自動で追記されます。書き出し専用の一方通行です。',
    steps: [
      'Google スプレッドシートで、追記先にしたいシートを開きます（新しく作ってもかまいません）',
      'ブラウザのアドレス欄のURLを見ます。URL は「https://docs.google.com/spreadsheets/d/スプレッドシートID/edit?gid=シートID」という形になっています',
      '「/d/」の直後から、次の「/edit」の手前までにある長い英数字の並びが「スプレッドシートID」です。ここをコピーします（例: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms）',
      '追記先にしたいシートの見出しタブの名前（例: タスク）も控えておきます',
      'TaskApp を開き、左メニューの「秘書」→ 上部タブ「ツール連携」→ 左の一覧から Google Sheets を選びます（見つからないときは一覧の下の「すべて表示」を押します）',
      '「新規作成」を押します',
      '「スプレッドシートID」の欄の下に出てくる「Google Sheets に接続」を押します（まだ接続していないときだけ出ます）',
      'Google のログイン画面で、使いたい Google アカウントを選びます',
      '「See, edit, create, and delete all your Google Sheets spreadsheets」（スプレッドシートの閲覧・編集・作成・削除）という許可を求められるので、そのまま許可します',
      '許可が終わると自動で TaskApp の画面に戻ります',
      '「表示名」の欄に、あとで自分が分かる名前を入れます',
      '「スプレッドシートID」の欄に、コピーしたIDを貼り付けます',
      '「シート名」の欄に、控えておいた見出しタブの名前を入れます',
      '「購読イベント」で、書き出したいできごとにチェックを入れます（作成／完了／削除・却下／再オープン）',
      '「作成」を押します',
    ],
    notes: [
      'スプレッドシートIDは URL の「/d/」と「/edit」に挟まれた部分です。末尾の「gid=…」の数字は別物（シートそのものの識別番号）なので、間違えて貼らないよう気をつけてください。',
      'スプレッドシートIDはシートの名前を変えても変わりません。名前を付け替えても設定し直す必要はありません。',
      'シート名（見出しタブの名前）を後から変えると、追記先が見つからなくなります。名前を変えたら TaskApp 側も直してください。',
      'シート名にスペースやアポストロフィが入っていると、Google 側の書き方の決まりで引用符が要る扱いになり面倒です。シンプルな名前（例: タスク）を勧めます。',
      '送りっぱなしの一方通行です。シート側で行を書き換えても TaskApp には戻りません。',
      'Google が用意している許可の単位の都合で、「このシートだけ」ではなく、あなたのスプレッドシート全体に対する閲覧・編集・作成・削除の許可を求められます。追記先を絞りたい場合は、専用の Google アカウントを使う手もあります。',
    ],
    adminOnly: true,
    sources: [
      'https://developers.google.com/sheets/api/guides/concepts',
      'https://developers.google.com/identity/protocols/oauth2/scopes',
      'https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions',
    ],
    verifiedOn: '2026-07-30',
  },
/* ---- 個人アカウントの接続 ---- */
  google_calendar: {
    summary: '日程調整のときに、参加者の予定が空いているかを自動で確かめられるようになります。読み取るのは「空いている／埋まっている」だけです。',
    steps: [
      'Google カレンダー側で事前にやることはありません',
      'TaskApp で、設定 →「個人のツール連携」を開きます',
      '「Google Calendar」の欄にある「Googleアカウントを接続」を押します',
      'Google のログイン画面で、自分の Google アカウントを選びます',
      '「View your availability in your calendars」（カレンダーの空き状況を見る）という許可を求められるので、そのまま許可します',
      '許可が終わると自動でこの画面に戻ります',
    ],
    notes: [
      '「Google Calendar」の欄そのものが表示されないことがあります。この機能は表に出す／出さないを切り替えられる作りのためで、欄が見当たらないときは、まだ開放されていないと思ってください。',
      '読み取るのは「その時間が空いているか、埋まっているか」だけです。予定の件名・場所・参加者といった中身は読み取れません。Google が用意しているこの許可の範囲がそもそも空き状況に限られているためです。',
      '求められる許可はこの1種類だけなので、Google の決まりでチェックを外して一部だけ許可することはできません。まとめて許可するか、しないかのどちらかです。',
      '予定が非公開設定であっても、その時間帯が「埋まっている」ことは相手に伝わります。逆に言うと、伝わるのはそこまでです。',
      '接続すると、日程が確定したときの Google Meet のリンク自動作成にも使われます（同じ画面の「ビデオ会議アカウント」の欄に出てきます）。',
    ],
    sources: [
      'https://developers.google.com/identity/protocols/oauth2/scopes',
      'https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query',
      'https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions',
    ],
    verifiedOn: '2026-07-30',
  },
  google_tasks_personal: {
    summary: 'あなたが担当のタスクが、あなた個人の Google ToDo リストへ自動で写されます。Gmail の横やスマホの Google ToDo アプリからも見えるようになります。',
    steps: [
      'Google ToDo（Google Tasks）側で事前にやることはありません',
      'TaskApp で、設定 →「個人のツール連携」を開きます',
      '「Google ToDo リスト」の欄にある「Google ToDo リストを接続」を押します',
      'Google のログイン画面で、自分の Google アカウントを選びます',
      '「Create, edit, organize, and delete all your tasks.」（ToDo の作成・編集・整理・削除）という許可を求められるので、そのまま許可します',
      '許可が終わると自動でこの画面に戻ります',
    ],
    notes: [
      '「Google ToDo リスト」の欄そのものが表示されないことがあります。この機能は管理者側の設定で表に出す／出さないを切り替えられる作りで、Google の審査が終わるまでは出さない運用になっているためです。欄が見当たらないときは、まだ開放されていないと思ってください。',
      '写されるのは、自分が担当になっているタスクだけです。他の人のタスクは写りません。',
      'Google 側でチェックを付けると、TaskApp 側も完了になります。',
      '求められる許可は ToDo に関する1種類だけなので、Google の決まりでチェックを外して一部だけ許可することはできません。',
      'この許可には ToDo の削除も含まれます。読み取りだけに絞ることはできません。',
      'これは自分ひとりのための接続です。会社全体で Google ToDo を正本にしたい場合は、左メニューの「秘書」→ 上部タブ「ツール連携」側の Google Tasks を使ってください。',
    ],
    sources: [
      'https://developers.google.com/workspace/tasks/auth',
      'https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions',
    ],
    verifiedOn: '2026-07-30',
  },
  zoom: {
    summary: '自分の Zoom アカウントを TaskApp につなぐと、日程調整で会議が確定したときに Zoom の会議リンクが自動で作られます。TaskApp が Zoom に対してすることは会議を作る（変える・消す）ことだけで、録画や過去の会議の中身は読み取りません。',
    steps: [
      'ブラウザで Zoom（https://zoom.us）を開きます',
      '会議の主催者にしたいアカウントでサインインします（ここで許可したアカウントが、作られる会議の主催者になります）',
      'TaskApp で、設定 →「個人のツール連携」を開きます',
      '「ビデオ会議アカウント」の中の Zoom の欄で、青いボタン「Zoomアカウントを接続」を押します',
      'Zoom の画面に切り替わるので、サインインを求められたら手順2のアカウントでサインインします',
      '許可を求める画面に並んでいる項目を読みます',
      '「Allow」（＝許可する）を押します',
      '自動で TaskApp の「個人のツール連携」画面に戻ります（Zoom の欄のラベルが「未接続」から「接続済み」に変わっていれば、つながっています）',
      'プロジェクトの設定を開きます',
      '左の「外部連携」の中の「ビデオ会議」を選びます',
      '「デフォルトプロバイダー」で「Zoom」を選びます（選んだ時点で保存されます）',
    ],
    notes: [
      'そもそも Zoom の欄が出てこないときは、TaskApp 側でまだ Zoom 連携が有効にされていません。管理者に有効化を頼んでください。',
      '会社で使っている Zoom（複数人のアカウント）は、初期状態でアプリの追加に管理者の承認が必要です。Zoom 公式に「Marketplace をまだ使っていない複数人アカウントは pre-approval（アプリを入れる前に管理者の承認が要る設定）が有効」と明記されています。',
      '承認が要るかどうかの見分け方は、Zoom App Marketplace でアプリを開いたときのボタンです。公式いわく「Add」ではなく「Request」と出ていたら、管理者の承認待ちという合図です。管理者に承認を頼んでから、もう一度この手順をやり直してください。',
      '許可画面に並ぶ項目は、TaskApp 側で登録している Zoom アプリの設定で決まります。「会議の作成だけのはず」と決めつけず、実際に画面に出ている項目を読んでから押してください。',
      'つなぐのは「個人」の接続です。会社で一度つなげば全員ぶん有効、にはなりません。会議を主催する人が、それぞれ自分で接続します。',
      'TaskApp 側で接続をやめるときは、同じ「個人のツール連携」画面の Zoom の欄にあるゴミ箱アイコン（説明: 連携を解除）を押し、「Zoom連携を解除しますか？」に OK と答えます。',
    ],
    sources: [
      'https://developers.zoom.us/docs/integrations/oauth/',
      'https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062865',
      'https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060122',
      'https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0062300',
      'https://developers.zoom.us/docs/integrations/create/',
    ],
    verifiedOn: '2026-07-30',
  },
  teams: {
    summary: '自分の会社・学校の Microsoft 365 アカウントを TaskApp につなぐと、日程調整で会議が確定したときに Teams の会議リンクが自動で作られます。TaskApp が求めるのはオンライン会議の作成・読み取りの許可です。',
    steps: [
      '会社（または学校）から配られた Microsoft 365 のアカウントを手元に用意します',
      '※ 個人用の Microsoft アカウント（outlook.com など）では使えません',
      'TaskApp で、設定 →「個人のツール連携」を開きます',
      '「ビデオ会議アカウント」の中の Microsoft Teams の欄で、青いボタン「Teamsアカウントを接続」を押します',
      'Microsoft のサインイン画面が出るので、手順1のアカウントでサインインします',
      '「Permissions requested」（＝要求されている許可）という画面が出るので、並んでいる項目を読みます',
      '「Accept」（＝承諾する。隣は「Cancel」）を押します',
      '自動で TaskApp の「個人のツール連携」画面に戻ります（Microsoft Teams の欄のラベルが「未接続」から「接続済み」に変わっていれば、つながっています）',
      'プロジェクトの設定を開きます',
      '左の「外部連携」の中の「ビデオ会議」を選びます',
      '「デフォルトプロバイダー」で「Microsoft Teams」を選びます（選んだ時点で保存されます）',
    ],
    notes: [
      'そもそも Microsoft Teams の欄が出てこないときは、TaskApp 側でまだ Teams 連携が有効にされていません。管理者に有効化を頼んでください。',
      '個人用の Microsoft アカウントでは接続できません。Microsoft の公式資料で、Teams のオンライン会議を作る操作は「会社または学校のアカウント」だけが対象で、個人アカウントは Not supported と表になっています。',
      'サインインできるのは、TaskApp 側に登録された Microsoft のテナント（会社）に属するアカウントだけです。別の会社のアカウントだと、サインイン画面までは進めても接続できません。うまくいかないときは管理者に、自社のテナントが登録されているか確認してください。',
      '「Need admin approval」（＝管理者の承認が必要）という画面が出たら、自分では許可できません。会社の管理者にお願いしてください。',
      '会社が申請の受付（管理者承認のワークフロー）を有効にしている場合は、代わりに「Approval required」という画面が出ます。理由を書く欄（Enter justification for requesting this app）に用件を書いて「Request approval」を押すと、管理者に申請が届きます。',
      '一度「Accept」を押すと、次からはこの画面は出ません（求める許可が増えたときだけ、また出ます）。',
    ],
    sources: [
      'https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0',
      'https://learn.microsoft.com/en-us/entra/identity-platform/application-consent-experience',
      'https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview',
      'https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent',
      'https://learn.microsoft.com/en-us/security/zero-trust/develop/permissions-require-admin-consent',
    ],
    verifiedOn: '2026-07-30',
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
