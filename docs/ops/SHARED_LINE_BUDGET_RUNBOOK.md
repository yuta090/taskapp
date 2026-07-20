# 共通LINE 送信予算 運用ランブック

共通LINE（共有Bot・`owner_type='platform'`）の送信量を監視し、原価暴走を止めるための運用手順。
**誰が・いつ・どう state を立てるか**を確定させるのが目的。

設計正本: `docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md` §3
関連プラン: `CLAUDE.md`（⚠ 共通LINE送信クォータの節）

---

## なぜ監視が要るか

- LINE無料枠は **200通/月・LINEアカウント（=platform account）単位**。共通LINEは**全orgが1つのアカウントに相乗り**するため、送信コストの上限は org 数に比例せず **account 単位で有界**。
- org 別 cap（`org_channel_policy.monthly_push_quota`）だけでは、org を増やすほど合算の持ち出しが無界になる。だから **二層**で守る:
  1. **org 層**: org ごとの月間上限（無料=50通）。超過で `state` が `ok→soft→hard`。
  2. **グローバル層**: platform account 単位の実物理上限（既定200通）。超過で `state` が `ok→soft→hard`。
- 執行は**送信境界**（`decideSharedSendBudget`）が state を読んで行う。**最も厳しい層が勝つ**・fail-closed（読めなければ止める側に倒す）。ここで立てるのは「状態」だけ。

> ⚠ **重要（層で執行が違う）**:
> - **グローバル層（platform account 200通）は state=hard で必ず抑止する**（`on_exceed` に関係なく `decideSharedSendBudget` が止める）。＝**原価の実ガードはこの層**。
> - **org 層（無料50通）の執行は `org_channel_policy.on_exceed` 次第**。既定は `none`＝**state が soft/hard でも抑止しない（可視化のみ）**。`degrade`（隔日）/`block`（停止）を設定した org だけ実際に絞られる。現行は「既存を切らない」方針で `none` を既定にしているため、**50通は"見える化"であって、それ単体では送信を止めない**（止めるのは200通のグローバル層）。

## state の意味と、層ごとの執行

| state | 意味 | グローバル層(200/account) | org 層(50/org) |
|---|---|---|---|
| `ok` | 上限内 | 通常送信 | 通常送信 |
| `soft` | 80%到達 | 隔日縮退 | `degrade`のみ隔日縮退。`none`/`block`は送信 |
| `hard` | 100%到達 | **抑止** | `degrade`/`block`のみ抑止。**`none`(既定)は送信継続** |

※いずれも auto-push（digest/承認催促）のみ対象。対話的push・console手動送信・既存グループは切らない。

## 自動化されている部分（cron・pg_cron前提）

| ジョブ | スケジュール | 役割 |
|---|---|---|
| `channel-metering-state` | 毎時0分 | org 層集計 → `org_channel_policy.state` 更新（`monthly_push_quota` が非NULLの org のみ） |
| `platform-budget-state` | 毎時5分 | グローバル層集計 → `platform_channel_budget.state` 更新。platform account の予算行を既定200で**自動プロビジョニング** |

> ⚠ **pg_cron 依存**: どちらの `cron.schedule` も `pg_extension` に `pg_cron` がある環境でのみ登録される。pg_cron が無い環境では **state が一切更新されず**、予算行の自動プロビジョニングも走らない。その場合は下記「手動リフレッシュ」を定期実行するか、pg_cron を導入する。

---

## 日常運用

### 1. 残量を見る（service role / SQLコンソール）

```sql
select * from public.app_platform_budget_overview();
```

- `remaining` 昇順で返る。**`remaining` が 0 に近い account が持ち出しリスク**。
- 列: `monthly_push_budget`（月上限）/ `used_current_month`（当月使用）/ `remaining`（残量）/ `soft_threshold`（縮退開始点=ceil(budget*0.8)）/ `state` / `updated_at`。

### 2. 手動リフレッシュ（pg_cron が無い環境・即時に state を合わせたいとき）

```sql
select public.app_refresh_platform_budget_state();  -- グローバル層
select public.app_refresh_channel_metering_state();  -- org 層
```

### 3. 緊急ブレーキ（out-of-band の急増を即時に止める）

cron は毎時なので、スパイク時は手で `hard` を立てて即抑止できる。

```sql
-- 特定 account の共通LINE auto-push を即時停止（既存グループは切らない）
update public.platform_channel_budget
  set state = 'hard', updated_at = now()
  where account_id = '<account_id>';
```

解除は `state = 'ok'` に戻すか、次回 cron の再計算に任せる（当月使用が閾値未満なら `ok` に戻る）。

### 4. 予算値の調整

```sql
-- 例: 有料LINEプラン移行で account の月上限を引き上げる
update public.platform_channel_budget
  set monthly_push_budget = 1000, updated_at = now()
  where account_id = '<account_id>';
```

自動プロビジョニングは既定200で行を作るだけ・既存行の `monthly_push_budget` は上書きしない（手調整が消えない）。

---

## エスカレーション目安

- `used_current_month >= soft_threshold`（=`remaining <= budget - soft_threshold`。budget=200 なら残量40以下・使用160以上＝`state` が `soft`）: 監視強化。増勢が続くなら有料LINEプラン移行 or グループ追加を検討。
  - ※`remaining <= soft_threshold` ではない（それは使用40で成立してしまい早すぎる）。soft は**使用が soft_threshold 以上**。
- `remaining = 0`（=`state` が `hard`）: 当月はその account 相乗り分の auto-push が**グローバル層で抑止**。新規 org の共通LINE紐付けを一時停止し、原因 org を `app_platform_budget_overview` と org 層で切り分ける。

## 関連

- org 層の `monthly_push_quota` は**プラン（無料=50）から同期**される。即時性は DBトリガー `trg_org_billing_sync_push_quota`（`org_billing` 書込契機）、最終的整合性は日次 cron `org-push-quota-resync`（`app_resync_all_org_push_quota()`＝全org再計算・billing欠落org や past_due猶予切れの drift を是正）。値の正本は `entitlements.ts` の `PLAN_LIMITS.monthlySharedPushQuota`。
- 送信境界の判定ロジック: `src/lib/channels/metering/decideSharedSendBudget.ts` / `decideAutoPush.ts`（`on_exceed` × `state` の真理値表）。
