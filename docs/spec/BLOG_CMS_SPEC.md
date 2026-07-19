# ブログCMS＋CTA管理 設計書 v0.1

作成: 2026-07-14 / 状態: **承認待ち**

## 目的

SEO記事を継続的に出すための基盤。記事本文とCTA（誘導先）を**管理画面から後から変更できる**ようにする。
記事をMarkdownファイルでコミットする運用は採らない（公開後の差し替えにデプロイが要るため）。

## スコープ

1. `blog_posts` — 記事のCRUD（管理画面）＋公開ページ `/blog`, `/blog/[slug]`
2. `cta_blocks` — CTAブロックのマスタ管理。記事ごとに「本文中CTA」「末尾CTA」を選んで差し替える
3. `sitemap.ts` / `robots.ts` の新設（現状どちらも存在しない。SEO記事を出す以上必要）

**スコープ外**: 記事の予約公開ジョブ、カテゴリ階層、著者マスタ、コメント、多言語。必要になったら足す。

---

## DB設計

マイグレーション: `supabase/migrations/<date +%Y%m%d%H%M%S>_blog_cms.sql`

### `cta_blocks`（先に作る。blog_posts が参照するため）

| 列 | 型 | 備考 |
|----|----|------|
| `id` | uuid pk | |
| `key` | text unique not null | `shindan` / `tax-lp` / `contact` など。コードから既定CTAを引くときに使う |
| `name` | text not null | 管理用の名前 |
| `heading` | text not null | 見出し |
| `body` | text | 補足文 |
| `button_label` | text not null | |
| `button_url` | text not null | **check: `/` 始まり or `https://` 始まりのみ**（`javascript:` を排除） |
| `variant` | text not null default `'inline'` | check in (`inline`,`band`,`card`) |
| `enabled` | boolean not null default true | |
| `created_at` / `updated_at` | timestamptz | |

### `blog_posts`

| 列 | 型 | 備考 |
|----|----|------|
| `id` | uuid pk | |
| `slug` | text unique not null | check `^[a-z0-9-]+$` |
| `title` | text not null | check 1〜120文字 |
| `description` | text | メタディスクリプション（〜160文字） |
| `body_md` | text not null default `''` | Markdown原文 |
| `status` | text not null default `'draft'` | check in (`draft`,`published`,`archived`) |
| `published_at` | timestamptz | 公開時にセット。一覧のソートキー |
| `cover_image_url` | text | OGP兼用 |
| `tags` | text[] not null default `'{}'` | |
| `author_name` | text | |
| `inline_cta_id` | uuid → `cta_blocks(id)` on delete set null | 本文中CTA |
| `footer_cta_id` | uuid → `cta_blocks(id)` on delete set null | 末尾CTA |
| `noindex` | boolean not null default false | 実験記事用 |
| `created_at` / `updated_at` | timestamptz | |

インデックス: `(status, published_at desc)`、`slug` unique、`tags` に GIN。
`updated_at` トリガは既存テーブルと同方式。

### RLS（Stage0 で anon 権限が剥奪済みのため GRANT を明示する）

```sql
alter table public.blog_posts enable row level security;
alter table public.cta_blocks enable row level security;

-- 公開記事だけ誰でも読める
create policy "anyone can view published posts" on public.blog_posts for select
  using (status = 'published' and published_at is not null and published_at <= now());

create policy "anyone can view enabled cta blocks" on public.cta_blocks for select
  using (enabled = true);

grant select on public.blog_posts, public.cta_blocks to anon, authenticated;
```

**書き込みポリシーは作らない**。管理画面からの書き込みは API ルートで `verifySuperadmin()` → service role（`createAdminClient()`）で行う（`api/admin/integrations` と同じ型）。
理由: 書き込みRLSを superadmin 述語で4本書くより、既存の admin API パターンに揃えるほうが認可の入口が1つで済み、監査しやすい。

---

## API（`src/app/api/admin/blog/`）

`integrations/route.ts` の型をそのまま踏襲する。

- `POST /api/admin/blog` — 作成
- `PATCH /api/admin/blog` — 更新（id 必須）
- `DELETE /api/admin/blog?id=` — 削除
- `POST|PATCH|DELETE /api/admin/blog/cta` — CTAブロックのCRUD

共通:
1. `verifySuperadmin()` → 失敗は **403 `{ error: 'Forbidden' }`**
2. バリデーション失敗は 400（slug形式、title長、status enum、button_url のスキーム）
3. slug 重複は **409 `{ error: 'slug already exists' }`**（unique 制約違反 `23505` を拾う）
4. DBエラーは `console.error` して 500（内部詳細は返さない）
5. 成功は `{ success: true, post }` 形式

`status` を `published` に変更する際、`published_at` が null なら `now()` を自動セットする（サーバー側で。クライアントに任せない）。

---

## 管理画面（`src/app/admin/(panel)/blog/`）

| ルート | 内容 |
|--------|------|
| `/admin/blog` | 記事一覧。Server で `createAdminClient()` 全件取得 → `BlogPageClient` に `initialData`。`AdminPageHeader` + `AdminDataTable`（タイトル / slug / ステータス`AdminBadge` / 公開日 / 更新日）+ 「新規作成」ボタン |
| `/admin/blog/[id]` | 記事エディタ |
| `/admin/blog/cta` | CTAブロックのCRUD（一覧＋インラインフォーム） |

`AdminSidebar` の `NAV_ITEMS` に「ブログ」を追加（アイコン: `Article`）。

### エディタの作り

**Markdown直編集＋ライブプレビューの2ペイン**とする。BlockNote（wikiで使用中）は採らない。

理由: 記事はClaudeがMarkdownで書く。BlockNoteはブロックJSONが正になるため、生成したMarkdownの貼り付け・差分確認・再生成がやりにくい。Markdownならファイル運用とCMS運用を行き来できる。

フィールド:
- 本文（Markdown textarea）／プレビュー（`renderMarkdownToHtml` の結果を `prose` で表示）
- SEO: title / slug / description（文字数カウンタ付き。全角32・160の目安を表示）/ cover_image_url / noindex
- CTA: 本文中CTA・末尾CTA をそれぞれ `cta_blocks` からセレクトで選択
- ステータス: 下書き / 公開（明示的な「保存」「公開する」ボタン）

CLAUDE.md の「保存ボタン禁止・楽観更新」は内部3ペインUIの規則であり、admin配下は既存も明示ボタン方式。ここは明示保存とする（誤公開を防ぐため）。

### 本文中CTAの差し込み方

本文Markdownに **`{{cta}}` プレースホルダ**を置く。レンダリング時にそこで本文を分割し、`inline_cta_id` のCTAコンポーネントを挿入する。プレースホルダが無ければ本文中CTAは出さない（勝手に挿入しない）。
末尾CTAは本文の後に常に描画（`footer_cta_id` が設定されていれば）。

---

## 公開ページ

| ルート | 内容 |
|--------|------|
| `/blog` | 記事一覧（公開記事のみ、`published_at` 降順）。`LPHeader` / `LPFooter` |
| `/blog/[slug]` | 記事詳細 |

- `params: Promise<{ slug: string }>`（Next 15+）、`generateMetadata` で title / description / OGP / canonical、`noindex` なら robots メタ
- 記事が無い・非公開なら `notFound()`
- JSON-LD（`Article`）を埋める（LLMO/AI検索の引用対象になりやすくするため）
- 本文は `renderMarkdownToHtml` → `prose prose-gray max-w-none`（`@tailwindcss/typography` は導入済み）
- **`middleware.ts` の `publicPaths` に `'/blog'` を追加**（無いと未ログインで `/login` に飛ぶ）

### `src/lib/markdown.ts` の小リファクタ

現在パイプラインは `getManualPage`（ファイル読み込み専用）の内部に埋まっている。
文字列を受ける `renderMarkdownToHtml(md: string): Promise<string>` を切り出し、`getManualPage` からもそれを使う。サニタイズ設定（`rehype-sanitize`）は現行のまま流用する。

---

## SEO基盤（新設）

- `src/app/sitemap.ts` — 静的ページ＋公開記事を列挙（現状 sitemap.xml が存在しない）
- `src/app/robots.ts` — sitemap の場所を明示

---

## セキュリティ

- `body_md` を書けるのは superadmin のみ。表示は `rehype-sanitize` を通すためXSSは遮断される（生HTML埋め込みは許可しない）
- `button_url` は `/` または `https://` 始まりのみ許可（DBのcheck制約＋APIバリデーションの二重）
- 公開クエリは `status='published'` を RLS とアプリ側クエリの両方で縛る
- service role キーはサーバー専用（`createAdminClient()` をクライアントから import しない）

---

## テスト（TDD必須・CLAUDE.md）

Red → Green → Refactor で進める。

| 対象 | テスト |
|------|--------|
| `lib/markdown` | `renderMarkdownToHtml`: 見出しにid付与 / `<script>` がサニタイズされる |
| `lib/blog/validation` | slug 正規表現 / title長 / button_url のスキーム（`javascript:` を弾く） |
| `api/admin/blog` | 未認証→403 / 不正slug→400 / slug重複→409 / status=published で published_at が自動セット |
| `/blog/[slug]` | draft記事は404 / 公開記事は200 + metadata / noindex がmetaに出る |
| E2E (Playwright) | 管理画面で作成→公開→`/blog/<slug>` が表示され、CTAボタンのリンク先が正しい |

---

## 作業手順

CLAUDE.md の並行作業ルールに従い、専用 worktree で行う。

```bash
git worktree add -b feat/blog-cms-<YYYYMMDDHHMM> ../taskapp-wt-blog-cms origin/develop
```

1. マイグレーション作成 → 共有DBへ psql 個別適用＋`applied_migrations` へ記録（CLI管理外のため）
2. `lib/markdown` リファクタ＋テスト
3. API ルート＋テスト
4. 管理画面（一覧 → エディタ → CTA管理）
5. 公開ページ＋sitemap/robots＋middleware
6. E2E → `develop` へPR

---

## 別件で見つかったバグ（要判断）

`middleware.ts` の `publicPaths` に **`/features` `/use-cases` `/company` `/compare` `/tokushoho` が入っていない**。matcher は全パスを対象にしているため、未ログインのユーザーがこれらを開くと `/login` にリダイレクトされる。**特商法ページ（`/tokushoho`）が公開されていないのは法的にも問題**。

対応案: 本PRで `publicPaths` に `/blog` を足すついでに修正する（1行の追加で済み、ブログの公開経路と同じ仕組みのため）。別PRに切る場合はそれでも良い。
