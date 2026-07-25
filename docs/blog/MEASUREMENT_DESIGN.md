# TASK6 計測設計(UTM/アトリビューション) v1.0

着手前関門の最後のひとつ「記事→CTA→登録/DL の追跡」の設計と運用手順。
撤退/継続の関門(12週/24週・CONTENT_PLAN.md)の判定はこの計測に基づく。

- 作成日: 2026-07-25
- 方式: **自前DBで完結(GA不要)**。外部ツール依存なし・cookie同意バナー不要の範囲で設計

## 何をどこで測るか

| 知りたいこと | 仕組み | データの場所 |
|---|---|---|
| 記事が検索に出た回数 | Google Search Console(GSC) | GSC(要セットアップ・下記TODO) |
| 記事→テンプレDL登録 | DownloadFormが流入元記事を送信 | `template_leads.source_path` |
| 記事→agentpm登録 | CTAリンクの `?ref=task6&art=<slug>` → signupがmetadataに保存 | `auth.users.raw_user_meta_data` (signup_ref / signup_art) |
| 記事→診断 | 診断公開後に同じref方式を流用(予定) | shindan-app側(未実装) |

## 仕組みの流れ(agentpm登録)

1. 記事ページのCTA(`CtaBlock`)が内部リンクに `?ref=task6&art=<記事slug>` を自動付与
   (`src/lib/task6/attribution.ts` の `appendAttribution`。外部リンク・不正slugには付けない)
2. `/signup` がパラメータを検証(`sanitizeAttribution`・ホワイトリスト方式)し、
   **first-touchでlocalStorageに保存**(後日直接signupに来ても最初の記事が残る。上書きしない)
3. 登録時に `auth.signUp` の metadata へ `signup_ref` / `signup_art` として保存
   → `auth.users.raw_user_meta_data` に永続

## 集計SQL(月次レビューで使う)

```sql
-- 記事別のagentpm登録数
select raw_user_meta_data->>'signup_art' as article_slug,
       count(*) as signups
from auth.users
where raw_user_meta_data->>'signup_ref' = 'task6'
group by 1 order by 2 desc;

-- 記事別のテンプレDL登録数(お知らせ希望の内訳つき)
select source_path,
       count(*) as leads,
       count(*) filter (where newsletter_opt_in) as newsletter_ok
from template_leads
group by 1 order by 2 desc;
```

## 12週/24週関門の判定手順(CONTENT_PLAN.mdの関門の実務)

1. GSCでクラスタ別の表示回数・クリックを確認(12週: 表示回数が立っているか)
2. 上記SQLで記事別のCV(テンプレDL・登録)を確認(24週: CVが生まれているか)
3. 結果をクラスタ単位で判断(記事単位で一喜一憂しない)

## 制約(v1・知っておくこと)

- **Google(OAuth)ボタン経由の登録は計測できない**(OAuthはmetadataを渡せない)。
  メール登録のみ計測対象。Google経由が主流になったら callback 側での対応を別途検討
- ref はホワイトリスト方式(`task6` のみ)。LP等に広げるときは `attribution.ts` の
  `KNOWN_REFS` に追加する(自由文字列は受け付けない=データ汚染防止)
- 診断(shindan-app)へのリンク計測は診断公開後に実装

## セットアップTODO(ユーザー操作・公開前に)

- [ ] **Google Search Console に agentpm.app を登録**(所有権確認+sitemap.xml送信)。
  12週関門の表示回数はこれが無いと測れない。OpenSEOのGSC連携も同時に有効化するとよい
- [ ] (任意)GA4を入れる場合は測定IDの発行から。v1はGA無しで関門判定まで可能
