# REVIEW_SPEC（テンプレ）

> 正本：spec/ 配下の md。Wiki は索引のみ。
> 
> **アンカー規約**
> - 仕様セクションは必ず固定IDを持つ（specPathの # に使う）
> - 各セクションの先頭に **HTMLアンカー** を置く：`<a id="xxx"></a>`
> - IDは英小文字+ハイフン（例：`meeting-minutes`）

---

<a id="overview"></a>
## 概要
- このドキュメントが扱う範囲
- 用語（ball / considering / approvals / changes-requested など）

<a id="roles-permissions"></a>
## ロールと権限
- クライアント
- 開発会社（社内）
- 「社内代行」の扱い（actor と onBehalfOf の分離）

<a id="considering"></a>
## 検討中（considering）
- 定義（未決事項＝タスクから抽出。議事録本文の自動抽出はしない）
- 表示（クライアント/社内）
- 解決（決定）
  - クライアント：指名なし（1人承認OK）
  - 社内代行：確認相手＋根拠（chat/email/call/meeting）必須
- 状態遷移（considering → decided → implemented / reopened）

<a id="approvals"></a>
## 承認（approvals）
- 承認対象
- 指名なし承認のルール
- 再承認（差し戻し後：差し戻した本人のみ再承認必須）

<a id="changes-requested"></a>
## 差し戻し（changes requested）
- 差し戻し条件
- 差し戻し理由（必須）
- 差し戻し後フロー

<a id="meeting-minutes"></a>
## 会議（議事録）
- Meetingはミーティングごとに作成・履歴管理
- 会議開始/終了の意味
- 未決事項の自動抽出（considering ball=client + review未承認 + 仮決定）

<a id="meeting-minutes-md"></a>
## 議事録MD（A方式：タスク化）
- 記法
  - `- [ ] SPEC(/spec/FILE.md#anchor): ...` → type=specでタスク化
  - `- [ ] TODO: ...` → 通常タスク
  - 生成済みマーカー：`<!--task:t123-->`（重複生成防止）
- チェックONで `decided`（ただし社内代行は確認相手/根拠必須）

<a id="notifications"></a>
## 通知（メール＋アプリ内）
- 送信タイミング（ball=client化、期限2日前、期限超過、会議終了）
- 冪等（同一イベントで重複送信しない）
- 会議終了通知テンプレ（決定/未決/リンク）

<a id="spec-flow"></a>
## 仕様タスクの運用（specフロー）
- type=spec の必須項目
  - specPath（`/spec/*.md#anchor`）必須
  - decisionState（considering/decided/implemented）
- `decided → implemented` の手順（正本に反映してから implemented）

