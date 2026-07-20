# multica コネクタ 対外契約仕様 (v1)

**Status**: Draft / 対外契約の正本
**設計判断**: Fable (2026-07-20) 「双方向同期コネクタ層」。本書はその multica 境界の契約。
**関連**: [双方向同期アーキ決定](#) / `AI_SECRETARY_STAGE3_INTEGRATIONS.md`（署名・SSRF 基盤）/ `20260718092110_google_tasks_mirror.sql`（踏襲するアウトボックス原型）

---

## 0. この文書の位置づけ

TaskApp（agentpm秘書）と自社プロダクト **multica** の間の **双方向同期の対外契約**。
TaskApp 側・multica 側の実装は**本書のイベント名・ペイロード・署名・冪等規約に依存する不可逆仕様**。
変更する場合は破壊的変更を避け、`event_type` の版上げ（`.v2` サフィックス）か署名の v2 併記で行う。

**役割の非対称性（重要）**:
- **multica はタスクの実行側**。TaskApp からタスク（Issue 化の元）を受け取り、AI 依頼・処理し、完了を返す。
- **正本（source of truth）はタスクごとに決まる**（下記 §1）。multica は「実行の器」であって、タスクの正本ではない。

---

## 1. 正本モデル（前提の確認）

タスク1件ごとに **`origin`（出自）** を持つ。契約上、multica は origin を**書き換えない**。

| origin | 正本 | 例 | multica の完了報告の扱い |
|--------|------|-----|--------------------------|
| `external` | 外部ツール（例: gtasks） | gtasks で起案 → 秘書が取り込み | multica 完了は TaskApp に「完了イベント」として伝播。TaskApp は外部ツールへ書き戻す |
| `internal` | TaskApp | LINE 会話から秘書が拾った | multica 完了で TaskApp のタスクを done 化 |

multica から見ると **origin に関わらず契約は同一**（タスクを受け取り、完了を返すだけ）。origin による差は TaskApp 側の書き戻し先だけ。multica は origin を意識しなくてよい。

---

## 2. トポロジ（ハブ&スポーク）

```
gtasks ─(import/poll)→ TaskApp[tasks 行] ─(issue.create)→ multica
                          ▲                                   │
                          └──────(task.completed webhook)─────┘
```

- **multica と gtasks は直結しない。** すべて TaskApp の `tasks` 行を経由する。
- TaskApp→multica は**アウトボックス経由の API 呼び出し**（`connector_jobs`。`user_task_mirror_jobs` と同型：fold + version + lease + backoff）。
- multica→TaskApp は **Webhook push**（multica は自社なので watch を出せる前提）＋**日次 reconcile ポーリング**（取りこぼし保険）。

---

## 3. TaskApp → multica（送信：Issue ライフサイクル）

TaskApp が multica の API を叩く。認証・署名は §5。冪等キーは §6。

### 3.1 `issue.upsert`
タスクを multica に Issue として作成／更新する。

```jsonc
// POST {multica_base}/api/agentpm/issues
{
  "event_id": "01J8...ULID",        // 送信ごとに一意。再送は同一 event_id
  "event_type": "issue.upsert",
  "occurred_at": "2026-07-20T10:00:00+09:00",
  "connection_id": "uuid",           // TaskApp 側接続ID（テナント識別）
  "task": {
    "task_ref": "uuid",              // TaskApp の tasks.id（安定・不変の対応キー）
    "title": "string",
    "body": "string|null",           // タスク本文
    "status": "todo|in_progress",    // done は issue.upsert では送らない（完了は §3.2 の TaskApp 内部処理）
    "due_date": "2026-07-25|null",   // ローカル日付（toISOString 禁止・formatDateToLocalString 準拠）
    "assignee_hint": "string|null",  // multica 側割り当ての参考（人物の確定紐付けはしない）
    "origin": "external|internal"    // 参考情報。multica は書き換えない
  }
}
```

**multica のレスポンス**（同期）:
```jsonc
// 200 OK
{ "issue_id": "multica 側の Issue ID", "accepted": true }
```
- multica は `task_ref` を Issue に保持し、**以後 `task_ref` で対応づける**（TaskApp 側は返却された `issue_id` を `connector_task_links.external_id` に保存）。
- 同一 `task_ref` の再 `issue.upsert` は**冪等**（既存 Issue を更新、二重作成しない）。

### 3.2 `issue.cancel`
タスクが対象外化（担当替え・削除・却下）された。multica は Issue をクローズ（AI 依頼を止める）。

```jsonc
{ "event_id": "...", "event_type": "issue.cancel", "connection_id": "uuid",
  "task": { "task_ref": "uuid" } }
```

---

## 4. multica → TaskApp（受信：完了・進捗の戻し）

multica が TaskApp の Webhook を叩く。受け口 `POST /api/connectors/multica/events`。

### 4.1 `task.completed`（必須）
multica 上で Issue が完了した。

```jsonc
{
  "event_id": "01J8...ULID",   // multica 側で一意。再送は同一 event_id（§6 で重複排除）
  "event_type": "task.completed",
  "occurred_at": "2026-07-20T11:00:00+09:00",
  "connection_id": "uuid",
  "task_ref": "uuid",           // TaskApp の tasks.id
  "result": {
    "summary": "string|null",   // 完了サマリ（チャット返信に載せる）
    "artifact_url": "string|null"
  }
}
```

**TaskApp の処理**:
1. `event_id` を `connector_inbound_events` に insert（重複なら 200 で握って終了＝冪等）。
2. 条件付き完了 RPC（`rpc_mirror_complete_task` と同型：`status <> 'done'` のときだけ done 化）。**0 件なら以降の副作用は発火しない**（ループ・二重完了防止）。
3. done への 0→1 遷移が真のときだけ：(a) origin=external なら外部ツールへ完了を書き戻し、(b) チャットへ完了を返信（送信アダプタ層）。

### 4.2 `task.progress`（任意・v1 では最小）
進捗コメントをチャットに中継したい場合。v1 では **保存のみ／チャット中継は任意**。

```jsonc
{ "event_id": "...", "event_type": "task.progress", "connection_id": "uuid",
  "task_ref": "uuid", "note": "string" }
```

---

## 5. 認証・署名（既存 sink 方式を流用）

**両方向とも** HMAC-SHA256 署名。実装は `src/lib/sinks/signature.ts` が正本。

```
X-AgentPM-Signature: t=<unix秒>,v1=<hex(hmac_sha256(secret, t + "." + rawBody))>
```

- **secret**: 接続ごとに **TaskApp が send/receive の2本を生成**（TaskApp→multica と multica→TaskApp で**別 secret**）。作成時レスポンスで**一度だけ平文返却**し、以後は sink と同方式で暗号化して保存する（`encrypt_system_secret`／metadata の `multica.send_secret_encrypted`・`receive_secret_encrypted`）。読み手は `decrypt_system_secret` で復号（平文キーへのフォールバックは持たない＝クリーンカット）。ローテーションは方向別に再生成→暗号化→一度だけ平文返却。**平文はハッシュ保存できない**（HMAC 検証に鍵そのものが要る）ため「一度だけ表示」は UI 上の露出制御であり保存は可逆暗号化。
- **リプレイ窓**: `|now - t| <= 300 秒`。外は拒否。
- **検証**: `rawBody`（パース前の生バイト列）に対して計算。TaskApp 受信側は §7 の 3 拒否ケースを必ず実装。
- **転送先**: HTTPS のみ・ポート443・リダイレクト非追従。SSRF 検証は `src/lib/sinks/ssrf.ts` を通す（TaskApp→multica の宛先 URL 登録時・送信時）。

---

## 6. 冪等・順序・ループ防止

| 論点 | 規約 |
|------|------|
| **event_id** | 送信側が生成する一意 ID（ULID 推奨）。再送は同一 ID。受信側は `unique(connection_id, event_id)` で重複排除 |
| **対応キー** | `task_ref`（TaskApp tasks.id）が両側の安定キー。multica の `issue_id` は TaskApp 側 `external_id` に保存 |
| **完了の冪等** | done は吸収状態。条件付き更新（`status <> 'done'`）で 0→1 遷移時のみ副作用発火。2 回目はどの経路でも no-op |
| **ループ防止** | 「観測状態と異なるときだけ書く」。書き込みが no-op なら DB トリガーも発火せず反響が物理的に停止。エコー用のマーキングは**しない** |
| **順序** | イベントは順不同で届きうる。`task.completed` は単調（完了は逆転しない）。`issue.upsert` は最新スナップショットで上書き（version fold） |
| **at-least-once** | 送達は at-least-once。exactly-once は保証しない。受信側の冪等で吸収する |

---

## 7. TaskApp 受信エンドポイントの拒否ケース（テスト必須）

`POST /api/connectors/multica/events` は以下を**必ず**拒否する（回帰テスト対象）:

1. **署名不正**（`v1` 不一致）→ 401
2. **timestamp が窓外**（`|now - t| > 300s`）→ 401
3. **event_id 再送**（`unique` 違反）→ 200（冪等・副作用なし）。※拒否ではなく「握って成功」
4. 未知 `connection_id` / secret 不一致 → 401
5. `task_ref` が存在しない / 別テナント → 404（org 越境ガード）

---

## 8. リトライ規約

- **TaskApp → multica**: `connector_jobs` のバックオフ（1分→5分→30分→2時間→6時間・最大6試行）。以降 dead。
- **multica → TaskApp**: multica 側で指数バックオフ再送を推奨。TaskApp が 5xx / タイムアウトを返したら再送（同一 event_id）。TaskApp の日次 reconcile が最終保険。
- **縮退**: multica が Webhook を出せない場合、TaskApp 側の reconcile ポーリングのみで完了を検知する（アーキ不変・検知が遅くなるだけ）。

---

## 9. v1 スコープ外（将来）

- multica → TaskApp の**新規タスク起票**（multica を起点にする双方向）。v1 は「TaskApp/gtasks が起点、multica は実行」に限定。
- `task.progress` のチャット中継の既定 ON 化。
- 個人 gtasks ミラー（`user_task_mirror_*`）の connector 框組みへの統合（別判断）。
- **チャット完了返信の本配線**（§4.1 (b)）: コネクタ層は `src/lib/connectors/chatReplySender.ts` の
  **注入ポート（`ChatReplySender`）**だけを持ち、`notifyChat` はそこへ委譲する（未登録なら no-op）。
  実際の「発生元チャット解決 → 資格情報復号 → `deliverToChannel` 送信」は secretary-channels の
  アウトバウンド送信経路（現状**未実装**：`deliverToChannel` はライブラリのみで呼び出し元が無い）に属し、
  両ストリームが1ツリーに揃った時点で `registerChatReplySender(...)` を起動時に一度呼ぶだけで本配線になる。

---

## 10. 未確定（実装前に埋める）

- [ ] **multica 側の Webhook 発火・完了受付 API の実装可否**（本契約は「自社なので用意する」前提）。不可なら multica もポーリング縮退。
- [x] `multica_base` URL・テナント発行フロー（org ↔ connection ↔ multica テナントの対応）: **TaskApp が接続作成時に base_url を受け取り、send/receive 2鍵を生成して暗号化保存し、作成レスポンスで webhook URL・connection_id・2鍵を一度だけ一括表示**（multica 側に貼る設定ブロック）。以後はマスク＋方向別ローテーションのみ。API: `POST /api/integrations/connections/multica`（作成）・`POST /api/integrations/connections/multica/[id]/rotate?direction=send|receive`（ローテ）。
- [x] import 先の space/assignee 決定則（gtasks 側）: `integration_connections.import_config` で最小定義した（`src/lib/google-tasks/import.ts`）。
  `{ target_space_id: string(必須), read_list_ids?: string[], default_assignee_id?: string }`。
  `target_space_id` 未設定の接続は import を skip する。`read_list_ids` 省略時は「ミラー出力先リスト
  (title=`GOOGLE_TASKS_LIST_TITLE`)以外の全リスト」。ミラー出力先は `read_list_ids` に明示指定されても
  必ず除外する（エコー回避のリスト分離）。
