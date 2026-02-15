---
name: taskapp-design-system
description: TaskApp固有のデザインシステムを強制する。UIコンポーネントの作成・編集時に自動適用。ステータス色、テキスト階層、ボーダー、アバター、ボタンパターンの正しい値を保証する。
---

# TaskApp Design System Skill

TaskApp の具体的なデザイントークンとコンポーネントパターンを強制するスキル。
新しいUIコンポーネントの作成・既存コンポーネントの編集時に適用される。

完全な仕様: `docs/design/DESIGN_SYSTEM.md`

## Design Personality

**Utility & Function** — Linear/GitHub-inspired。情報密度重視、装飾最小限、色は意味がある場合のみ。

---

## Quick Reference: Status Colors

**全コンポーネントで統一。コンポーネント内で個別に色を定義してはならない。**

| Status | Icon Class | Weight | Badge BG + Text |
|--------|-----------|--------|-----------------|
| `backlog` | `text-gray-300` | regular (outline) | `bg-gray-50 text-gray-500` |
| `todo` | `text-gray-400` | regular (outline) | `bg-gray-50 text-gray-600` |
| `in_progress` | `text-blue-500` | fill | `bg-blue-50 text-blue-600` |
| `in_review` | `text-amber-500` | fill | `bg-amber-50 text-amber-600` |
| `considering` | `text-gray-400` | duotone | `bg-gray-100 text-gray-500` |
| `done` | `text-green-600` | fill (CheckCircle) | `bg-green-50 text-green-600` |

## Quick Reference: Text Hierarchy

| Level | Class | Use |
|-------|-------|-----|
| Primary | `text-gray-900` | 見出し、タイトル |
| Secondary | `text-gray-700` | 本文、説明 |
| Muted | `text-gray-500` | ラベル、ヘルプ |
| Faint | `text-gray-400` | プレースホルダー |

## Quick Reference: Semantic Colors

| Role | Text | BG | Border |
|------|------|-----|--------|
| Primary (CTA) | `text-indigo-600` | `bg-indigo-600` | — |
| Success | `text-green-600` | `bg-green-50` | `border-green-100` |
| Warning | `text-amber-600` | `bg-amber-50` | `border-amber-200` |
| Danger | `text-red-600` | `bg-red-50` | `border-red-100` |
| Info | `text-blue-600` | `bg-blue-50` | `border-blue-100` |
| Client-visible | `text-amber-600` | `bg-amber-50` | `border-amber-200` |

## Quick Reference: Surfaces

| Surface | Class |
|---------|-------|
| Background | `bg-white` / `bg-gray-25` |
| Card | `bg-white border border-gray-200` |
| Hover | `hover:bg-gray-50` |
| Selected | `bg-blue-50 border-l-2 border-l-blue-500` |
| Dropdown | `bg-white rounded-lg shadow-popover border border-gray-200` |

## Quick Reference: Borders

| Level | Class |
|-------|-------|
| Subtle | `border-gray-100` |
| Default | `border-gray-200` |
| Strong | `border-gray-300` |

---

## Component Patterns

### Button (Primary)
```tsx
<button className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
```

### Button (Secondary)
```tsx
<button className="h-8 rounded-md px-3 text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors">
```

### Button (Danger)
```tsx
<button className="h-8 rounded-md px-3 text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors">
```

### Avatar (Initial)
```tsx
<div className="w-8 h-8 rounded-full bg-gray-700 text-white flex items-center justify-center text-xs font-medium">
```

### Badge
```tsx
<span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium {badgeClass}">
```

### Card
```tsx
<div className="rounded-lg border border-gray-200 bg-white p-4">
```

---

## Forbidden Patterns (App UI, LP除外)

コードレビュー・生成時にこれらを検出したら修正する:

### Color Violations
- `purple-*`, `violet-*` → `indigo-*` or `gray-*`
- `slate-*` → `gray-*`
- `from-indigo-500 to-purple-600` (avatar gradient) → `bg-gray-700`
- `blue-*` for primary CTA → `indigo-*` (blue は info/status 専用)

### Component Violations
- Status色の直書き → `STATUS_META` 定数を参照
- `shadow-lg`, `shadow-xl` → `shadow-subtle` or `shadow-popover`
- `rounded-xl`, `rounded-2xl` (小要素) → `rounded-lg` 以下
- `text-xl` 以上をリスト/カード内で使用 → `text-lg` 以下

### LP Exception
`src/components/lp/**` はマーケティング用途のため上記ルールの一部を許容。

---

## Typography

| Token | Size | Class |
|-------|------|-------|
| 2xs | 10px | `text-2xs` / `text-[10px]` |
| xs | 12px | `text-xs` |
| sm | 13px | `text-sm` |
| base | 14px | `text-base` |
| lg | 16px | `text-lg` |

Font weight: `font-normal` (body), `font-medium` (label/button), `font-semibold` (heading)

## Spacing

| Tailwind | px | Use |
|----------|----|-----|
| `gap-1` / `p-1` | 4px | Icon gap |
| `gap-2` / `p-2` | 8px | Within component |
| `gap-3` / `p-3` | 12px | Related elements |
| `gap-4` / `p-4` | 16px | Section padding |
| `gap-6` / `p-6` | 24px | Between sections |

Border radius: `rounded` (4px badge), `rounded-md` (6px button), `rounded-lg` (8px card), `rounded-full` (avatar)

## Layout Constants

- LeftNav: `w-[240px]`
- Inspector: `400px` (`.inspector-pane.open`)
- Row: `.row-h` (40px), `.row-h-sm` (32px)
- Icons: Phosphor Icons (`@phosphor-icons/react`)

---

## Validation Checklist

Before generating or modifying UI code, verify:

1. Status colors match the canonical map above (no ad-hoc colors)
2. Text uses 4-level hierarchy (gray-900/700/500/400)
3. Borders use gray-100/200/300 only
4. No purple/violet/slate in App UI
5. Avatars use `bg-gray-700 text-white` (not gradient)
6. Buttons follow Primary/Secondary/Danger patterns
7. Cards use `rounded-lg border border-gray-200`
8. Shadows are from the 4-level system (subtle/pane/popover/modal)
9. Font sizes use defined tokens (2xs/xs/sm/base/lg)
10. Icons from Phosphor, not Heroicons or Lucide
