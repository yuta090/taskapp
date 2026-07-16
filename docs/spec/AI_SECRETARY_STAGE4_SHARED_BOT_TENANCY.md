# AI秘書 Stage 4: 共有bot マルチテナント境界（設計正本）

> 策定 2026-07-15。fable-architect の二段裁定（基盤＋追補）＋Codex設計＋ユーザーのプロダクト判断を統合した確定設計。
> **これは後戻り困難な境界の正本。実装（migration/app）はこの不変条件を1つも省略してはならない。**

## 0. 目的とプロダクト判断（確定）

現状は「1顧客(org) = 1専用LINE bot（白ラベル表示名）」。これに**当社所有の共有bot 1つを多数の顧客orgで相乗り**させるモデルを足し、両者を共存させる。

| 用途 | bot | 白ラベル | オンボード | 既定の紐付け |
|------|-----|---------|-----------|-------------|
| 無料/試用/内部スタッフ申し送り | 共有bot（表示名固定「agentpm秘書」） | なし | 招待＋コードで数分 | Web承認 |
| 有料/顧問先向け白ラベル | 顧客ごとの専用bot | あり（「山田会計事務所の秘書」） | 手作業30-45分 | 従来どおり |
| 本部/多拠点大手の一括登録 | 共有bot | なし | バッチ発行→各店舗が招待 | **code_only（当社が信頼確認したorgに限り開放）** |

**原価の前提**: 共有botはLINE無料枠（月200通/アカウント）を全相乗りorgで共有するため超過が当社に集中する。専用botは無料枠が顧客ごとに付く。よって共有botには org単位の使用量メータリング／クォータ／縮退が要る。

## 1. テナント解決の新フロー（確定）

```
webhook(raw body)
  → destination 抽出 → channel_accounts 逆引き（line_bot_user_id unique）
  → account 固有 secret で署名検証（検証前に本文/コードを一切処理しない）
  → account.owner_type で分岐
      owner_type='org'（専用bot・従来経路。コードパス不変）
        org_id = account.org_id
        group: (account_id, external_group_id) で active世代を取得／無ければ org_id=account.org_id で新世代
      owner_type='platform'（共有bot）
        1:1 / room: org解決不能 → 保存ゼロ＋定型案内replyのみ（identityリンクは非対応）
        group:
          active世代あり: org_id = group.org_id / space_id = group.space_id（account.orgIdは使わない）
          active世代なし（limbo）:
            join: 汎用挨拶のみ・会話は保存しない
            通常発言/添付/postback: 保存しない・取得しない・抽出しない
            紐付けコード投入:
              binding_mode='web_approval' → claim登録＋チャレンジ返信 → org内部ユーザーがWebコンソールで承認RPC
              binding_mode='code_only'   → 承認RPCファミリで即INSERT（同一org内space限定）＋org通知
```

**帰属導出の絶対規約**: グループ文脈の org は**常に `channel_groups` 行から**導く。`account.orgId` をグループの帰属・identity検索・postback検証に使わない（共有botでは account に org が無い＝NULL）。未改修パスは org_id NOT NULL 違反で **fail-closed に落ちる**（黙って他社に誤帰属する事故を構造的に防ぐ）。

**送信の絶対規約**: グループ送信は必ず `group.account_id → account`。`findLineAccountForOrg`（org→account逆引き）をグループ送信に使うことを禁止。

## 2. スキーマ差分（確定）

### channel_accounts
```
owner_type text NOT NULL CHECK (owner_type in ('org','platform')) DEFAULT 'org'
org_id     → nullable 化（NOT NULL を落とす）
CHECK ((owner_type='org') = (org_id is not null))   -- org⇔org_id有, platform⇔org_id無
```
- 既存専用botは全て `owner_type='org'`。共有bot資格情報は `owner_type='platform', org_id=NULL`。
- **別テーブル案・ダミーorg案は却下**。理由: webhook dispatch の `unique(channel, line_bot_user_id)` を2表にまたがらせない／ダミーorgは既存コードが誤帰属のまま fail-open する。org_id=NULL の fail-closed が本質的価値。
- org検索（`findLineAccountForOrg` 等）は `owner_type='org'` 条件を明示的に加える。

### channel_groups
```
org_id     → NOT NULL 維持（絶対に nullable にしない）
tenant_source text NOT NULL CHECK in ('account_owner','approved_link_code','code_only_link') DEFAULT 'account_owner'
bound_by_link_code_id uuid nullable FK → channel_link_codes
supersedes_group_id   uuid nullable self-ref（共有→専用移行の監査）
```
- `tenant_source='account_owner'` ⇒ account は owner_type='org' かつ group.org_id=account.org_id、join時 space_id=NULL 許容。
- `tenant_source in ('approved_link_code','code_only_link')` ⇒ account は owner_type='platform'、作成時点で org_id/space_id/bound_by_link_code_id が全て NOT NULL。
- active世代 unique `(account_id, external_group_id) where status='active'` は維持。

### channel_link_codes
```
purpose text CHECK in ('identity','group_link','shared_group_claim')  -- 既存行は legacy値で現挙動維持
binding_mode text CHECK in ('web_approval','code_only')               -- 発行時に焼き込み・不変。償還時は code の mode のみ参照
target_account_id uuid nullable FK → channel_accounts                 -- 対象 platform account 固定
code_hash text                                                        -- shared_group_claim は生保存せず HMAC+pepper・128bit
batch_id uuid nullable                                                -- 一括発行のグルーピング
consumed_at timestamptz
code → nullable 化（hash方式併存のため）
```
- **コード形状（Fable裁定・確定）**: web_approval / code_only **共通の単一形状**。31文字集合 `ABCDEFGHJKMNPQRSTUVWXYZ23456789` × **26文字 ≈ 128.8bit**。表示は `GC-` プレフィクス＋ハイフン区切り（例 `GC-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX`）、**正準形（HMAC対象）＝プレフィクス・区切りを除いた26文字本体**。発行は CSPRNG（`node:crypto`）。`code_hash = HMAC-SHA256(pepper, 26文字正準形)`、生codeは NULL（§7-5）。pepper未設定は発行・照合とも fail-closed。形状/フィルタ/hash方式は binding_mode で分岐しない（分岐は link_code 行の binding_mode のみ）。既存 identity/group_link の8文字 `LINK_CODE_REGEX` とは**長さで排他**（ルーティング衝突なし）。受理は `normalizeClaimCode`（空白U+3000含む・ハイフン・GCプレフィクス除去→全角半角→大文字→26文字一致）。PR2実装済。
- **応答オラクルは非封鎖**（128bitで当てる前提が消える）。invalid 応答は not-found/expired/consumed/他org/他account すべて**同一バイト列の固定文言**＋グループ単位レート制限（PR3・例 1時間N回超で無応答化）。失効/消費済み再投入は claims に `rejected` 記録（盗難検知面）。
- shared_group_claim（web_approval）: **TTL 10-30分**・1グループのみ成功・コード投入では消費せずWeb承認トランザクションで消費。
- code_only: **TTLだけ別＝既定7日/最大30日**（店舗が数日かけてbot追加する現実に合わせる）・**単回成功**（consumed_at）・マルチユース禁止。

### channel_group_claims（新設・共有botの全紐付け試行の統一台帳）
```
id, link_code_id, account_id, external_group_id, org_id, space_id,
challenge_hash/label, status(pending|approved|rejected|expired|auto_approved),
approved_by, approved_at, rejected_at, created_at, last_event_at, events_seen,
group_display_name_snapshot   -- LINE APIから取得（content-free・承認者の確認材料）
unique(link_code_id, account_id, external_group_id) where status='pending'  -- webhook再送の冪等化
```
- service-role専用・**会話本文を持たない content-free 台帳**。
- **web_approval系**: pending → approved / rejected / expired（人の承認ステートマシン）。
- **code_only系**（Fable最終裁定§4で(d)を精緻化・旧「claim非経由」案を上書き）: 償還RPCが group INSERT と**同一Txで `auto_approved` 行**を記録（approved_by=null、根拠=bound link_code）。**失効/消費済みコードの再投入は `rejected` 行として記録**する — code_only は人の承認が無いぶん、試行の観測が唯一の盗難検知面。これで claims = 「共有bot の全紐付け試行の1表」に統一され、レート監視・abuse検知も1表で済む。
- pending は web_approval のみ（`auto_approved` は pending を経由しない＝偽の承認ワークフローを作らない）。

### org_channel_policy（新設・権限とクォータ）
```
org_id uuid PK
allow_code_only boolean NOT NULL DEFAULT false   -- 書込は service role のみ（当社の運用判断）
granted_by, granted_at
monthly_push_quota int nullable
on_exceed text CHECK in ('none','degrade','block') DEFAULT 'none'
state text CHECK in ('ok','soft','hard') DEFAULT 'ok'   -- cronが集計で更新
```
- **書込経路は service role のみ**（authenticated への書込ポリシーを作らない）。既定は全org false / none / ok。

## 3. 不変条件（実装が1つも省略してはならない）

### DB制約・トリガー（service roleはRLSを迂回するため、ここが実境界）
- **A-1（必須）channel_groups BEFORE INSERT 整合トリガー**: account.owner_type を引いて検証。
  - platform ⇒ tenant_source in ('approved_link_code','code_only_link') かつ space_id/bound_by_link_code_id NOT NULL
  - org ⇒ tenant_source='account_owner' かつ new.org_id = account.org_id
- **A-2（必須）guardトリガーの不変列拡張**: 現行(20260711073329)は space_id しか守っていない。`org_id / account_id / external_group_id / tenant_source / bound_by_link_code_id / supersedes_group_id` を immutable に追加。
- channel_accounts の owner_type/org_id 整合 CHECK。**加えて BEFORE UPDATE guard で `owner_type` と `org_id` を完全 immutable 化（必須）**。行内 CHECK は `platform,NULL → org,A社` を止められず、A-1(group INSERT時)・A-2(group行)も account 行を見張らないため、共有account を特定org所有へ書き換えると既存他社groupのイベントを誤帰属できる。共有→専用は§5どおり新account・新世代のみ。
- **channel_group_claims BEFORE INSERT/UPDATE integrity guard（必須）**: 結合列 `link_code_id / org_id / space_id / account_id / external_group_id` を作成後 immutable。status 遷移は `pending → approved/rejected/expired` のみ（`auto_approved` は INSERT時終端・code_only経路用）。INSERT時に claim.org/space が bound link_code の org/space と一致することを検証。claim行は RLS で org内部メンバーに group表示名/groupIdを見せるため、承認後に別orgへ移せると越境露出になる。
- channel_groups(org_id, space_id) は spaces(id, org_id) 複合FK維持。space_id は NULL→値 一方向維持（共有groupは最初から値入りで作る）。
- channel_groups(org_id, space_id) は spaces(id, org_id) 複合FK維持。space_id は NULL→値 一方向維持（共有groupは最初から値入りで作る）。
- 全紐付け（web_approval/code_only）は **service-role専用の承認RPCファミリ**のみが channel_groups を作れる（webhook内アドホックINSERT禁止）。RPCは code_hash照合→purpose/binding_mode検証→未消費未失効 FOR UPDATE→INSERT（org/space/bound_by/tenant_source確定済）→consumed_at消費 を単一トランザクション。
- 子テーブル（channel_messages/channel_digest_tasks/channel_identities）は (id, org_id) 複合FK維持。可能なら channel_messages に (group_id, account_id, org_id) 複合FK。

### アプリ層
- 署名検証前は destination 以外を信用・処理しない。
- 専用botの org は account.org_id、共有botの org は承認済み active group からのみ。event本文/送信者identity/コードから直接 org を採らない。
- 共有botの active group が無ければ通常発言・添付・postback・タスク操作を保存/実行しない。
- 全 group イベントで `event account_id == group.account_id` を確認。
- group返信・digest配達・添付取得・sink配達は `group.account_id`・`group.org_id` 起点。
- `findActiveLineIdentities` は group解決後の group.org_id で検索。
- limboでは org名/space名/顧客固有設定/既存リンクの有無を応答に含めない。コード不正時の応答を統一（存在/期限/orgを推測させない）。

### 承認RPCの規律
- ロック順序固定: link_codes 行 FOR UPDATE → claim 行 FOR UPDATE（全経路）。
- claim ロック後に `claim.link_code_id = ロックした link_code.id` を**再検証**（ロック前の無施錠読みとの TOCTOU を閉じる。claim結合列 immutable との二重防御）。
- 同一グループへの2claim同時承認は `channel_groups_active_unique` が最終審判。敗者の 23505 は graceful reject（リトライしない）。デッドロック無し。**23505 は `GET STACKED DIAGNOSTICS constraint_name` で `channel_groups_active_unique` の時のみ graceful false、他の unique violation は再送出**（握り潰さない）。
- RPC内で再検証: purpose/binding_mode・**未消費(consumed_at)・未失効(expires_at)・未revoke(`revoked_at is null`)**・claim.account_id が対象 platform account・claim.org/space が code.org/space 一致・**承認者の membership を code.org_id に対して**（API routeが auth.uid をサーバ側解決して渡す。クライアント申告の user_id/org_id は信用しない）。revoked コードの承認拒否は失効テストに必須。
- reject RPC も approve と同型に link_code→claim 順でロックし code.org に対して membership 検証。

### 検証ハーネスの規律（必須）
- 検証SQLは**実 migration ファイルをそのまま baseline に適用**して行う（スキーマの手コピー禁止）。手コピーは列順/権限/search_path/欠落制約/再適用失敗を見逃し、実際に本番DDLと乖離した（例: テストだけ FORCE RLS）。
- 並行系(g)は**2接続で実際に同時実行**しロック待ち/デッドロック/23505 を再現する（逐次実行は不可）。

### code_only の追加不変条件
- 紐付け先は常に code.org_id/space_id のみ（web_approvalと同一）。**テナント間(A社↔B社)境界は code_only を足しても1ミリも緩まない**。盗難コードの最悪被害は「発行org自身のデータが発行org統制外グループに流出」で、**opt-inしたorg自身に閉じる**。
- 1コード=1グループ=単回成功。マルチユースのcode_only禁止。
- code_only 成立時に org コンソール通知＋メール必須（検知的統制）。是正は unlink→新世代。
- external_group_id allowlist は不採用（LINE groupId はbot参加前に知り得ず招待者特定も不可）。単回成功＋通知で代替。
- entitlement=false のorgでの code_only 発行は発行APIが拒否。発行レート上限（未消費 code_only コード同時存在数/org）を課す。

### 使用量メータリング（骨格）
- 真実の源 = channel_messages（既にorg帰属・全送信経路が通る）から**導出**。独立記録経路を作らない。
- クォータ/ポリシー = org_channel_policy（quota/on_exceed/state）。
- 集計ディメンション = **(org_id, account_id, 月)** で確定（org軸=本部帰属/課金、account軸=共有bot無料枠200通監視、専用botにもそのまま効く）。
- 執行は**送信境界（LINE push直前のアプリ層）のみ**。**DBトリガーでのINSERT遮断は禁止**（inbound記録と証跡は何があっても止めない＝disabledアカウントの既存原則と同型）。
  - cron が集計して state 更新（ok/soft/hard）。
  - 送信直前が state を読んで分岐（hard: digest/自動push/催促停止、soft: digest統合/頻度削減）。
  - webhook は常に200・記録継続。reply（ユーザー操作への直接応答）は hard でも維持可。

## 4. limbo（未承認グループ）= 保存しない（確定）
帰属未確定の会話はどこに置いても「RLSの読者が居ない・保持責任者が居ない・後付け帰属＝漏洩ベクトルの誘惑が残る」データ溜まりになる。保持は claims 台帳の content-free メタ（groupId/challenge/時刻/state/コードが指すorg・space・グループ表示名スナップショット・events_seen）のみ。問い合わせ対応（コード誤り/承認待ち/承認済みの判別、疎通確認）はこれで回る。未承認グループには bot が「承認完了までこのグループの内容は記録されません」と明示。

## 5. 共有→専用アップグレード（確定）
アカウント付け替えではなく **bot交代＋group新世代**:
1. 専用bot account を owner_type='org' で登録
2. 共有group の新規digest停止・実行中を完了
3. open digestタスクは共有側で消化（自動移動しない）
4. 共有bot退出・共有group世代を left
5. 専用botを招待・専用account配下に新世代作成
6. 新groupを同spaceへリンク・supersedes_group_id に旧group記録
7. sink設定は新group向けに複製してから有効化・旧sinkはdisabledで証跡保持
8. 新経路確認後、共有側の配達/pickup完全停止

過去メッセージ・完了タスクは旧group/accountの証跡として残す（付け替えない）。identityは専用bot側で再リンク（別アカウント間でLINE userIdの同一性を仮定しない）。

## 6. 移行順序（全段無停止・加算的・各段ロールバック可）
1. channel_accounts: owner_type追加(default 'org') → org_id drop not null → CHECK。既存行無変更。RB可。
2. channel_groups: 3列追加(default 'account_owner')＋CHECK＋**トリガー2本(A-1,A-2)**。既存行整合。RB可。
3. channel_link_codes: purpose(legacy)/binding_mode/target_account_id/code_hash/batch_id/consumed_at 追加・code nullable化。RB可。
4. channel_group_claims 新設＋承認RPC(service_roleのみgrant)。RB可。
4b. org_channel_policy 新設(全org暗黙false)＋（必要時）usage集計ビュー。RB可。
5. アプリデプロイ: webhook を owner_type 分岐＋code_only RPC経路＋送信境界 quota チェック(当面全org 'none' 素通し)。**owner_type='org' 経路はコードパス不変＝既存テスト全green無変更を退行ゲートに**。RB=通常巻き戻し。
6. **platform account 行 INSERT（活性化スイッチ）**。RB=status='disabled'。

## 7. Fable級（今確定・後戻り困難）vs 後から変更可
**今確定（骨格）**:
1. 単一テーブル＋owner_type/org_id nullable（fail-closed）
2. groups.org_id NOT NULL＋作成時確定＋不変（A-1/A-2）
3. limbo無保存
4. 帰属導出は常に group 行・送信は group.account_id
5. コードhash＋単回成功＋承認RPC経由でのみ紐付け
6. 共有→専用は世代方式（supersedes・account_id付替え禁止）
7. ポリシー二層（org entitlement=当社のみ書込／code焼き込み binding_mode 不変・償還はcodeのみ参照）
8. tenant_source 3値・全紐付けが単一RPC・code.org/spaceのみを紐付け先・**A-1がbound_by_link_codeのorg/space一致をトリガー検証**（RPCの正しさに依存しない構造的な網）
9. claims=共有bot全紐付け試行の統一台帳（web_approval=pending/approved/rejected/expired・code_only=auto_approved／失効消費済み再投入=rejected も記録＝盗難検知面）
10. 使用量は channel_messages 導出・(org_id, account_id, 月)ディメンション・執行は送信境界のみ（inbound不可侵）

**後から変更可**: チャレンジ文言/TTL実値・発行レート上限値・縮退ラダーの段数と閾値・カウンタ実装方式(トリガー/cron)・課金請求・バッチUI・成立通知チャネル・共有bot 1:1の将来対応・abuse上限・digest既定pickup_mode・「code_only成立後の初回digest 24h遅延」ノブ。

## 8. 検証項目（実装完了の受け入れ条件）
回帰: 既存専用bot全テスト（1:1リンク/グループリンク/digest/postback/sink）が**無変更で green**。
境界（新規必須）:
- (a) platform account + tenant_source='account_owner' の INSERT がトリガー拒否
- (b) org account + 'approved_link_code' 拒否 / org_id≠account.org_id 拒否
- (c) org_id/account_id/external_group_id の UPDATE 拒否
- (d) 未承認グループの発言・postback・join が channel_messages に **0行**
- (e) 他orgユーザーの承認RPC呼び出し拒否（membership）
- (f) 失効/消費済みコードの承認拒否
- (g) 同一グループ2claim同時承認 → 片方 23505 graceful reject
- (h) 盗難コード: B社グループにA社コード投入 → A社コンソールに（グループ名付き）pending → 拒否で保存物ゼロ
- (i) 同一LINEユーザーが2社の共有グループに居ても identity/digest/sink が混線しない
- (j) webhook再送でチャレンジ/挨拶/承認が破壊的に重複しない
- (k) entitlement=false org で code_only 発行拒否
- (l) code_only コードの2グループ目投入が「消費済み」で拒否
- (m) code_only 成立で org 通知・unlink→新世代で是正
- (n) 盗難code_onlyコード: 攻撃者グループが発行org spaceに紐付いても**他orgのデータは一切関与しない**
- (o) hard超過orgで digest/自動pushが止まり inbound記録とwebhook 200継続
- (p) (org_id, account_id, 月)集計が共有/専用両方で正しい

## 9. 残リスク（受容）
- 承認者の人為ミス（別グループのclaim承認）: 構造的にゼロ化不可。グループ名スナップショット＋短TTL＋承認UI明示が防御。
- code_only成立→検知までに digest 1回漏れる窓（受容。「初回digest 24h遅延」ノブで後日緩和可）。
- 共有botスパム参加/claim大量生成: 10社超の前に上限・自動退出を入れる（今は不要）。
- クォータ執行の並行送信での僅かな超過窓（コスト統制でありセキュリティ境界でないため受容）。
- service role新規コードのバグ: A-1/A-2トリガー2本が最後の網。**トリガー省略の実装は不可**。
- LINE仕様の不確実点（招待者特定・複数bot同席・groupId不変性）は前提にしていないため設計は影響を受けない。

## 10. 実装ステージング（推奨）
1. **PR1 migration（migration-writer）**: 手順1-4b のDDL＋A-1/A-2トリガー＋承認RPCファミリ。TDD不可のDB部分は pgTAP相当 or RPC単体テストで境界(a)-(c)(f)(g)(k)(l)を担保。
2. **PR2 app webhook分岐（impl-runner）**: owner_type分岐・limbo無保存・帰属をgroup行に統一・送信をgroup.account_idに統一。境界(d)(h)(i)(j)(n)。既存専用bot全green退行ゲート。
3. **PR3 承認フロー**: claim登録＋チャレンジ＋Web承認RPC＋コンソールUI＋code_onlyバッチ発行＋成立通知。境界(e)(m)。
4. **PR4 メータリング**: (org_id,account_id,月)集計＋org_channel_policy state更新cron＋送信境界quotaチェック＋縮退。境界(o)(p)。
各PRは code-reviewer（Opus）レビュー。PR1のRLS/境界は postgres-rls スキル適用。実機E2Eは活性化(手順6)後。
