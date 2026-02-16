# TaskApp Design System

> Version 1.0 — 2026-02-15
> Design personality: **Utility & Function** (Linear/GitHub-inspired)

本ドキュメントは TaskApp の具体的なデザイントークンとコンポーネントパターンを定義する。
抽象的な原則ではなく、コードベースで使う具体的な値を定める。

---

## 1. Color Tokens

### 1.1 Gray Scale（構造色）

| Token | Hex | Tailwind | 用途 |
|-------|-----|----------|------|
| gray-25 | `#FCFCFD` | `bg-gray-25` | アプリ背景 |
| gray-50 | `#F9FAFB` | `bg-gray-50` | ホバー、ストライプ |
| gray-100 | `#F3F4F6` | `bg-gray-100` | 選択状態、セクション背景 |
| gray-200 | `#E5E7EB` | `border-gray-200` | デフォルトボーダー |
| gray-300 | `#D1D5DB` | `border-gray-300` | 強調ボーダー |
| gray-400 | `#9CA3AF` | `text-gray-400` | Faint テキスト |
| gray-500 | `#6B7280` | `text-gray-500` | Muted テキスト |
| gray-600 | `#4B5563` | `text-gray-600` | — |
| gray-700 | `#374151` | `text-gray-700` | Secondary テキスト |
| gray-800 | `#1F2937` | `text-gray-800` | — |
| gray-900 | `#111827` | `text-gray-900` | Primary テキスト |
| gray-950 | `#0B0F19` | `text-gray-950` | — |

### 1.2 Semantic Colors

| Role | Token | Tailwind Text | Tailwind BG | 用途 |
|------|-------|---------------|-------------|------|
| **Primary** | indigo-600 | `text-indigo-600` | `bg-indigo-600` | CTA、リンク、アクティブ状態 |
| **Success** | green-600 | `text-green-600` | `bg-green-50` | 完了、承認、成功 |
| **Warning** | amber-600 | `text-amber-600` | `bg-amber-50` | 注意、警告 |
| **Danger** | red-600 | `text-red-600` | `bg-red-50` | エラー、削除、期限切れ |
| **Info** | blue-600 | `text-blue-600` | `bg-blue-50` | 情報、進行中ステータス |
| **Client** | amber-600 | `text-amber-600` | `bg-amber-50` | クライアント可視要素 |

### 1.3 Text Hierarchy（4段階）

| Level | Class | 用途 |
|-------|-------|------|
| Primary | `text-gray-900` | 見出し、タイトル、重要テキスト |
| Secondary | `text-gray-700` | 本文、説明文 |
| Muted | `text-gray-500` | ラベル、ヘルプテキスト |
| Faint | `text-gray-400` | プレースホルダー、補助情報 |

### 1.4 Surface Colors

| Surface | Class | 用途 |
|---------|-------|------|
| Background | `bg-white` or `bg-gray-25` | ペイン背景 |
| Card | `bg-white border border-gray-200` | カード |
| Elevated | `bg-white shadow-popover` | ポップオーバー、ドロップダウン |
| Hover | `hover:bg-gray-50` | リスト行ホバー |
| Selected | `bg-blue-50 border-l-2 border-l-blue-500` | 選択行 |

### 1.5 Border Colors

| Level | Class | 用途 |
|-------|-------|------|
| Subtle | `border-gray-100` | セクション内仕切り |
| Default | `border-gray-200` | カード、ペインボーダー |
| Strong | `border-gray-300` | 強調区切り |

---

## 2. Status System

### 2.1 Canonical Status Color Map

**全コンポーネントでこのマップを使用する。コンポーネント内での個別定義は禁止。**

| Status | 日本語 | Icon Class | Icon Weight | Badge Class |
|--------|--------|------------|-------------|-------------|
| `backlog` | バックログ | `text-gray-300` | `regular` (outline) | `bg-gray-50 text-gray-500` |
| `todo` | Todo | `text-gray-400` | `regular` (outline) | `bg-gray-50 text-gray-600` |
| `in_progress` | 進行中 | `text-blue-500` | `fill` | `bg-blue-50 text-blue-600` |
| `in_review` | 承認確認中 | `text-amber-500` | `fill` | `bg-amber-50 text-amber-600` |
| `considering` | 検討中 | `text-gray-400` | `duotone` | `bg-gray-100 text-gray-500` |
| `done` | 完了 | `text-green-600` | `fill` (CheckCircle) | `bg-green-50 text-green-600` |

### 2.2 Review Status Badge

| Status | Badge Class |
|--------|-------------|
| `open` (承認待ち) | `bg-amber-50 text-amber-600` |
| `approved` (承認済) | `bg-green-50 text-green-600` |
| `changes_requested` (差戻) | `bg-red-50 text-red-600` |

### 2.3 共有定数としての実装

```typescript
// src/lib/design/status.ts
import { Circle, CheckCircle } from '@phosphor-icons/react'

export const STATUS_META = {
  backlog:     { labelJa: 'バックログ',  iconClass: 'text-gray-300',  iconWeight: 'regular',  badgeClass: 'bg-gray-50 text-gray-500' },
  todo:        { labelJa: 'Todo',        iconClass: 'text-gray-400',  iconWeight: 'regular',  badgeClass: 'bg-gray-50 text-gray-600' },
  in_progress: { labelJa: '進行中',      iconClass: 'text-blue-500',  iconWeight: 'fill',     badgeClass: 'bg-blue-50 text-blue-600' },
  in_review:   { labelJa: '承認確認中',  iconClass: 'text-amber-500', iconWeight: 'fill',     badgeClass: 'bg-amber-50 text-amber-600' },
  considering: { labelJa: '検討中',      iconClass: 'text-gray-400',  iconWeight: 'duotone',  badgeClass: 'bg-gray-100 text-gray-500' },
  done:        { labelJa: '完了',        iconClass: 'text-green-600', iconWeight: 'fill',     badgeClass: 'bg-green-50 text-green-600' },
} as const

export type TaskStatus = keyof typeof STATUS_META
```

---

## 3. Typography

### 3.1 Font Scale

| Token | Size | Class | 用途 |
|-------|------|-------|------|
| 2xs | 10px | `text-2xs` | タグ、バッジ内テキスト |
| xs | 12px | `text-xs` | メタ情報、タイムスタンプ |
| sm | 13px | `text-sm` | 本文、フォーム入力 |
| base | 14px | `text-base` | デフォルト |
| lg | 16px | `text-lg` | セクション見出し |

### 3.2 Font Weight

| Weight | Class | 用途 |
|--------|-------|------|
| Regular | `font-normal` (400) | 本文 |
| Medium | `font-medium` (500) | ラベル、ボタン |
| Semibold | `font-semibold` (600) | 見出し、強調 |

### 3.3 日本語テキスト設定

```css
body {
  line-height: 1.8;           /* 日本語向け広めの行間 */
  letter-spacing: 0.05em;     /* 読みやすさのための字間 */
}
```

### 3.4 Monospace（データ表示）

ID、コード、タイムスタンプには `font-mono tabular-nums` を使用。

---

## 4. Spacing & Layout

### 4.1 3-Pane Layout

| Pane | Width | Class |
|------|-------|-------|
| LeftNav | 240px | `w-[240px]` |
| Main | flex | `flex-1 min-w-0` |
| Inspector | 400px | `.inspector-pane.open` |

### 4.2 Row Density

| Variant | Height | Class |
|---------|--------|-------|
| Standard | 40px | `.row-h` |
| Compact | 32px | `.row-h-sm` |

### 4.3 Spacing Scale

| Value | Tailwind | 用途 |
|-------|----------|------|
| 4px | `gap-1`, `p-1` | アイコン間隔 |
| 8px | `gap-2`, `p-2` | コンポーネント内 |
| 12px | `gap-3`, `p-3` | 関連要素間 |
| 16px | `gap-4`, `p-4` | セクションパディング |
| 24px | `gap-6`, `p-6` | セクション間 |

### 4.4 Border Radius

| Size | Class | 用途 |
|------|-------|------|
| Small | `rounded` (4px) | バッジ、タグ |
| Medium | `rounded-md` (6px) | ボタン、入力 |
| Large | `rounded-lg` (8px) | カード、パネル |
| Full | `rounded-full` | アバター、ドット |

---

## 5. Component Patterns

### 5.1 Primary Button

```tsx
<button className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
  保存
</button>
```

### 5.2 Secondary Button

```tsx
<button className="h-8 rounded-md px-3 text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors">
  キャンセル
</button>
```

### 5.3 Danger Button

```tsx
<button className="h-8 rounded-md px-3 text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors">
  削除
</button>
```

### 5.4 Card

```tsx
<div className="rounded-lg border border-gray-200 bg-white p-4">
  <h3 className="text-sm font-semibold text-gray-900">タイトル</h3>
  <p className="mt-1 text-sm text-gray-500">説明テキスト</p>
</div>
```

### 5.5 Badge（汎用）

```tsx
<span className="inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium bg-gray-100 text-gray-500">
  SPEC
</span>
```

### 5.6 Avatar（ユーザーアイコン）

```tsx
{/* イニシャル表示 */}
<div className="w-8 h-8 rounded-full bg-gray-700 text-white flex items-center justify-center text-xs font-medium">
  {initial}
</div>

{/* 画像あり */}
<Image src={url} alt="Avatar" width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
```

### 5.7 Dropdown Menu

```tsx
<div className="absolute z-50 bg-white rounded-lg shadow-popover border border-gray-200 py-1 min-w-[140px]">
  <button className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors">
    <span className="text-base">{icon}</span>
    <span>{label}</span>
  </button>
</div>
```

### 5.8 Shadow Levels

| Level | Token | 用途 |
|-------|-------|------|
| Subtle | `shadow-subtle` | カード微小リフト |
| Pane | `shadow-pane` | ペイン境界 |
| Popover | `shadow-popover` | ドロップダウン、ツールチップ |
| Modal | `shadow-modal` | モーダル（使用非推奨） |

---

## 6. Forbidden Patterns

### 6.1 Color Violations

| 禁止 | 代替 | 理由 |
|------|------|------|
| `purple-*`, `violet-*` (App UI) | `indigo-*` or `gray-*` | 統一パレット外 |
| `slate-*` (App UI) | `gray-*` | Tailwind v4 標準grayに統一 |
| `from-indigo-500 to-purple-600` | `bg-gray-700` | アバター統一 |
| `blue-*` for primary CTA | `indigo-*` | blueはinfo/statusに予約 |
| `green-*` without theme token | green-50/100/600のみ使用 | 未定義トークン防止 |

### 6.2 Component Violations

| 禁止 | 代替 | 理由 |
|------|------|------|
| Status colorをコンポーネント内で直書き | `STATUS_META` 定数を参照 | 一元管理 |
| `text-xl` 以上をリスト/カード内で使用 | `text-lg` 以下 | 情報密度維持 |
| `shadow-lg`, `shadow-xl` | `shadow-subtle` or `shadow-popover` | 過剰な影は禁止 |
| `rounded-xl`, `rounded-2xl` (小要素) | `rounded-lg` 以下 | 角丸の統一 |

### 6.3 LP例外

`src/components/lp/**` 内のファイルはマーケティング用途のため、
上記ルールの一部（slate, 大きなshadow, 装飾グラデーション）を許容する。
ただし App UI との境界を明確にすること。

---

## 7. Theme Token 追加（必要分）

現在の `globals.css @theme inline` に以下の追加が必要:

```css
/* Green (Success/Done) — 現在未定義 */
--color-green-50: #F0FDF4;
--color-green-100: #DCFCE7;
--color-green-500: #22C55E;
--color-green-600: #16A34A;

/* Blue (in_progress status) — blue-400/500 追加 */
--color-blue-400: #60A5FA;
--color-blue-500: #3B82F6;
```

---

## Appendix: Checklist for New Components

新しいUIコンポーネントを作成する際のチェックリスト:

- [ ] Status色は `STATUS_META` 定数を参照しているか
- [ ] テキスト色は4段階（gray-900/700/500/400）のいずれかか
- [ ] ボーダーは gray-100/200/300 のいずれかか
- [ ] ボタンは定義済みパターン（Primary/Secondary/Danger）に従っているか
- [ ] アバターは `bg-gray-700 text-white` か画像か
- [ ] purple/violet/slate を使用していないか（LP除く）
- [ ] Icon は Phosphor Icons から選択しているか
- [ ] `rounded-lg` 以下の角丸を使用しているか
