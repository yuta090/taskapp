# Stripe 決済の試し方と、本番で開けるまでの手順

本番ではまだ決済を受け付けていない（`STRIPE_SELF_SERVE_ENABLED` が未設定＝閉）。
**本番を開けずに一通り試す**方法と、開けるときの順番をまとめる。

---

## 前提: 2つのスイッチ

| | 何を表すか | 決めるもの |
|---|---|---|
| **鍵**（`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRO_PRICE_ID`） | 技術的に Stripe を呼べるか | 既存契約の管理（支払い方法の変更・請求書・解約）が使えるか |
| **元栓**（`STRIPE_SELF_SERVE_ENABLED`） | サイト全体で新規の申し込みを受け付けるか | 全員に「Proにアップグレード」が開くか |
| **許可リスト**（`STRIPE_SELF_SERVE_ORG_IDS`） | この組織だけ受け付けるか | **その組織だけ**申し込みが開く（他は「準備中」のまま） |

**鍵がそろっていて、かつ「元栓が開いている」か「その組織が許可リストに入っている」ときだけ、新規の申し込みが開く。**
どちらも既定は閉じているので、鍵を入れただけでは開かない。

---

## 0. 本番URLで、自分の組織だけ試す（いちばん安全）

全員に開けずに、本番の URL で購入からプラン反映・解約まで通したいときはこれを使う。

```bash
# 自分の組織IDを許可リストに入れる（本番）
vercel env add STRIPE_SELF_SERVE_ORG_IDS production   # 例: 00000000-0000-0000-0000-000000000001
```

- 組織IDは、アプリの URL に出ている（`https://agentpm.app/<組織ID>/project/...`）
- **その組織のオーナーだけ**が「Proにアップグレード」を押せるようになる。ほかのお客様の画面は「準備中」のまま
- 判定はサーバ側でも組織を見るので、**他の組織が API を直接叩いても通らない**
- **確認が終わったら必ず空に戻す**（`vercel env rm STRIPE_SELF_SERVE_ORG_IDS production`）

試す前に、下の「3. Webhook」と「6. 本番で開けるときの順番」の 1〜5 を済ませておくこと
（Webhook が繋がっていないと、払えてもプランが上がらない）。

---

## 1. どこで試すか — Vercel の Preview 環境

ローカルの dev サーバーは起動しない環境があるため、**Preview 環境に「テストモードの鍵」を入れて試す**のがいちばん早い。
Vercel の環境変数は Production / Preview / Development でスコープを分けられるので、**Preview だけ**に入れれば本番は一切変わらない。

```bash
# Preview だけに入れる（Production には入れない）
vercel env add STRIPE_SECRET_KEY preview          # sk_test_... を貼る
vercel env add STRIPE_PRO_PRICE_ID preview        # テストモードで作った price_...
vercel env add STRIPE_WEBHOOK_SECRET preview      # 下の 3. で取得する whsec_...
vercel env add STRIPE_SELF_SERVE_ENABLED preview  # true
```

> **必ずテストモードの鍵（`sk_test_` で始まる）を使う。**本番の鍵を Preview に入れると、
> プレビューでの操作が実際の請求になる。

---

## 2. テストモードで商品と価格を作る

1. Stripe ダッシュボード右上を **テストモード** に切り替える
2. 商品（Pro）と価格（月額）を作る → `price_...` を控える → `STRIPE_PRO_PRICE_ID`
3. Enterprise の価格は**作らなくてよい**（営業窓口での個別契約で、決済画面を通らないため）

---

## 3. Webhook を受け取れるようにする

決済が終わったあと、プランを上げるのは Webhook の仕事。ここを繋がないと
「払えたのにプランが上がらない」状態になる。

**方法A: Stripe CLI（手元で確認するとき）**

```bash
stripe login
stripe listen --forward-to https://<プレビューのURL>/api/stripe/webhook
# 表示される whsec_... を STRIPE_WEBHOOK_SECRET に入れる
```

**方法B: ダッシュボードでエンドポイント登録（プレビューを継続的に使うとき）**

テストモード → 開発者 → Webhook → エンドポイントを追加 → `https://<プレビューのURL>/api/stripe/webhook`
送るイベント: `checkout.session.completed` / `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`

---

## 4. テスト用のカード番号

| 目的 | 番号 |
|------|------|
| 成功する | `4242 4242 4242 4242` |
| 本人認証（3Dセキュア）が出る | `4000 0027 6000 3184` |
| 残高不足で失敗する | `4000 0000 0000 9995` |

有効期限は未来の日付、CVC・郵便番号は任意の値でよい。

---

## 5. 確認する筋道（受け入れ条件）

1. 「設定 → プランと請求」で **「Proにアップグレード」が押せる**（元栓を開けた Preview、または許可リストに入れた組織で）
2. 押す → Stripe の決済画面 → テストカードで支払う → 戻ってくる
3. **プラン表示が Pro になる**（Webhook が効いている証拠。ならなければ 3. を見直す）
4. 上限が Pro の値になる（プロジェクト30・メンバー30 など）
5. **「Stripeで管理」** が出る → ポータルが開く → 支払い方法の変更・請求書の取得ができる
6. ポータルから解約 → しばらくして **Free に戻る**
7. 元栓を閉じる（`STRIPE_SELF_SERVE_ENABLED` を消す）→ 申し込みは閉じるが、
   **「Stripeで管理」は出たまま**（既に払っている人の解約手段を塞がないため）

---

## 6. 本番で開けるときの順番（厳守）

**元栓は最後に開ける。**途中で開けると、準備が終わる前にお客様が決済画面に進んでしまう。

1. Stripe アカウントを**本番モードで有効化**（事業情報・銀行口座の登録）
2. 特商法表記・返金ポリシー・問い合わせ先を用意（Stripe の審査でも見られる）
3. 本番モードで商品と価格を作る → `STRIPE_PRO_PRICE_ID` を **live の price に差し替え**
4. 本番の Webhook エンドポイント（`https://agentpm.app/api/stripe/webhook`）を登録 →
   `STRIPE_WEBHOOK_SECRET` を **live のものに差し替え**
5. **カスタマーポータルの設定でプラン変更を無効**にし、その設定IDを
   `STRIPE_PORTAL_CONFIGURATION_ID` に入れる（支払い方法・請求書・解約だけを許す）
6. `/api/stripe/status` を開き、`keysConfigured: true` になっていることを確認
7. **最後に `STRIPE_SELF_SERVE_ENABLED=true`** を本番に追加してデプロイ
8. 自分のアカウントで**実際に1回購入 → 返金**して、請求と解約の両方を確認する

> 現在の本番の鍵がテスト用か本番用かは、Vercel 側では暗号化されていて中身が見えない。
> Stripe ダッシュボードの「開発者 → APIキー」と照合すること。

---

## 7. 自動テストでどこまで見ているか

- **決済そのものは E2E に載せない**（外部サービス・カード情報が絡むため）
- E2E（`tests/e2e/billing.spec.ts`）で見ているのは、**受け付け状態と画面の一致**・
  環境変数名を画面に出していないこと・**API を直接叩いても止まること**・未ログインに設定状況を返さないこと
- Webhook の処理は単体テスト（`src/__tests__/app/api/stripe/webhook/route.test.ts`）で担保する
- 決済の受け付け判定そのものは `canCreateCheckout()` に集約し、画面・status・checkout の
  3か所が同じ関数を通る（判定を二重に持たない）
