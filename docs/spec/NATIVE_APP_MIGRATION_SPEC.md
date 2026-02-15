# ネイティブアプリ移行 仕様書

> **Version**: v1.0
> **Created**: 2026-02-15
> **Status**: Draft

---

## 目次

1. [概要](#1-概要)
2. [モノレポ構成](#2-モノレポ構成)
3. [共有パッケージ設計](#3-共有パッケージ設計)
4. [React Native (Expo) セットアップ](#4-react-native-expo-セットアップ)
5. [Supabase クライアント統合](#5-supabase-クライアント統合)
6. [画面・ナビゲーション設計](#6-画面ナビゲーション設計)
7. [プッシュ通知](#7-プッシュ通知)
8. [環境変数・設定管理](#8-環境変数設定管理)
9. [Vercel 設定変更](#9-vercel-設定変更)
10. [CI/CD パイプライン](#10-cicd-パイプライン)
11. [ストア申請準備](#11-ストア申請準備)
12. [移行手順（フェーズ別）](#12-移行手順フェーズ別)

---

## 1. 概要

### 1.1 目的

TaskApp の Web 版（Next.js 16）を維持しつつ、iOS / Android ネイティブアプリを React Native (Expo) で追加する。コードの重複を最小化するためモノレポ構成に移行し、型定義・ビジネスロジック・Supabase クライアントを共有パッケージとして切り出す。

### 1.2 技術スタック

| レイヤー | Web (既存) | Mobile (新規) |
|---------|-----------|--------------|
| フレームワーク | Next.js 16 (App Router) | Expo SDK 53 + React Native |
| 言語 | TypeScript 5.9 | TypeScript 5.9 (共通) |
| UI | Tailwind CSS 4 | NativeWind 4 (Tailwind for RN) |
| 状態管理 | TanStack Query 5 | TanStack Query 5 (共通) |
| DB/Auth | Supabase JS 2.93 + SSR | Supabase JS 2.93 + AsyncStorage |
| ナビゲーション | Next.js App Router | Expo Router v4 |
| アイコン | @phosphor-icons/react | @phosphor-icons/react-native |
| モノレポ | — | Turborepo |

### 1.3 対象外

- ランディングページ (`src/app/page.tsx`, `src/components/lp/`)
- サーバーサイド API Routes (`src/app/api/`)
- Slack/GitHub/Zoom/Teams インテグレーションのサーバー側
- Wiki (BlockNote エディタは Web 専用)
- ガントチャート (SVG ベースのため Web 専用、Phase 2 以降検討)

---

## 2. モノレポ構成

### 2.1 ディレクトリ構造

```
taskapp/                          # リポジトリルート
├── apps/
│   ├── web/                      # 既存 Next.js アプリ (src/ を移動)
│   │   ├── src/
│   │   │   ├── app/              # Next.js App Router
│   │   │   ├── components/       # Web 専用コンポーネント
│   │   │   └── lib/
│   │   │       └── supabase/     # Web 用 Supabase (SSR + cookies)
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── mobile/                   # 新規 Expo アプリ
│       ├── app/                  # Expo Router (ファイルベースルーティング)
│       │   ├── (tabs)/
│       │   │   ├── _layout.tsx
│       │   │   ├── tasks.tsx
│       │   │   ├── meetings.tsx
│       │   │   ├── notifications.tsx
│       │   │   └── settings.tsx
│       │   ├── (auth)/
│       │   │   ├── login.tsx
│       │   │   └── signup.tsx
│       │   ├── task/[id].tsx
│       │   ├── meeting/[id].tsx
│       │   └── _layout.tsx
│       ├── components/           # Mobile 専用コンポーネント
│       ├── lib/
│       │   └── supabase/         # Mobile 用 Supabase (AsyncStorage)
│       ├── app.json
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── shared/                   # 共有ビジネスロジック
│   │   ├── src/
│   │   │   ├── types/            # database.ts (型定義)
│   │   │   ├── hooks/            # データフック (useTasks, useMeetings, etc.)
│   │   │   ├── rpc/              # RPC ラッパー
│   │   │   ├── labels/           # labels.ts (UI ラベル)
│   │   │   ├── date/             # dateUtils.ts (日付ユーティリティ)
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── tsconfig/                 # 共有 TypeScript 設定
│       ├── base.json
│       ├── nextjs.json
│       └── react-native.json
│
├── supabase/                     # DB マイグレーション (現状維持)
│   ├── config.toml
│   ├── migrations/
│   └── seed.sql
│
├── turbo.json                    # Turborepo 設定
├── package.json                  # ルート (workspaces 定義)
├── pnpm-workspace.yaml           # pnpm ワークスペース
└── docs/                         # ドキュメント (現状維持)
```

### 2.2 ルート package.json

```jsonc
{
  "name": "taskapp-monorepo",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "turbo dev",
    "dev:web": "turbo dev --filter=@taskapp/web",
    "dev:mobile": "turbo dev --filter=@taskapp/mobile",
    "build": "turbo build",
    "build:web": "turbo build --filter=@taskapp/web",
    "lint": "turbo lint",
    "test": "turbo test",
    "clean": "turbo clean"
  },
  "devDependencies": {
    "turbo": "^2.5.0"
  }
}
```

### 2.3 pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 2.4 turbo.json

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

---

## 3. 共有パッケージ設計

### 3.1 packages/shared/package.json

```jsonc
{
  "name": "@taskapp/shared",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "lint": "eslint src/",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.93.3",
    "@tanstack/react-query": "^5.90.20"
  },
  "peerDependencies": {
    "react": ">=18"
  }
}
```

### 3.2 切り出し対象ファイル一覧

現在の `src/` から `packages/shared/src/` へ移動するファイル:

| 移動元 | 移動先 | 備考 |
|--------|--------|------|
| `src/types/database.ts` | `packages/shared/src/types/database.ts` | 型定義全体 |
| `src/lib/supabase/rpc.ts` | `packages/shared/src/rpc/index.ts` | RPC ラッパー (Supabase Client は注入パターンに変更) |
| `src/lib/labels.ts` | `packages/shared/src/labels/index.ts` | ラベル定義 |
| `src/lib/gantt/dateUtils.ts` | `packages/shared/src/date/dateUtils.ts` | `formatDateToLocalString` 等 |
| `src/lib/gantt/constants.ts` | `packages/shared/src/date/constants.ts` | ガント定数 |
| `src/lib/hooks/useTasks.ts` | `packages/shared/src/hooks/useTasks.ts` | クライアント注入パターンに変更 |
| `src/lib/hooks/useMeetings.ts` | `packages/shared/src/hooks/useMeetings.ts` | 同上 |
| `src/lib/hooks/useReviews.ts` | `packages/shared/src/hooks/useReviews.ts` | 同上 |
| `src/lib/hooks/useConsidering.ts` | `packages/shared/src/hooks/useConsidering.ts` | 同上 |
| `src/lib/hooks/useNotifications.ts` | `packages/shared/src/hooks/useNotifications.ts` | 同上 |
| `src/lib/hooks/useCurrentUser.ts` | `packages/shared/src/hooks/useCurrentUser.ts` | 同上 |
| `src/lib/hooks/useSpaceMembers.ts` | `packages/shared/src/hooks/useSpaceMembers.ts` | 同上 |
| `src/lib/hooks/useSpaceSettings.ts` | `packages/shared/src/hooks/useSpaceSettings.ts` | 同上 |
| `src/lib/hooks/useTaskComments.ts` | `packages/shared/src/hooks/useTaskComments.ts` | 同上 |
| `src/lib/hooks/useMilestones.ts` | `packages/shared/src/hooks/useMilestones.ts` | 同上 |
| `src/lib/hooks/useSchedulingProposals.ts` | `packages/shared/src/hooks/useSchedulingProposals.ts` | 同上 |
| `src/lib/hooks/useProposalResponses.ts` | `packages/shared/src/hooks/useProposalResponses.ts` | 同上 |

### 3.3 Supabase クライアント注入パターン

共有 hooks は環境 (Web/Mobile) に依存しないよう、Supabase クライアントを React Context 経由で注入する。

```typescript
// packages/shared/src/supabase/context.ts
import { createContext, useContext } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

type TypedClient = SupabaseClient<Database>

const SupabaseContext = createContext<TypedClient | null>(null)

export const SupabaseProvider = SupabaseContext.Provider

export function useSupabase(): TypedClient {
  const client = useContext(SupabaseContext)
  if (!client) {
    throw new Error('useSupabase must be used within a SupabaseProvider')
  }
  return client
}
```

```typescript
// packages/shared/src/hooks/useTasks.ts (変更後イメージ)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabase } from '../supabase/context'

export function useTasks(spaceId: string) {
  const supabase = useSupabase()  // Context から取得 (Web/Mobile 共通)
  return useQuery({
    queryKey: ['tasks', spaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('space_id', spaceId)
      if (error) throw error
      return data
    },
  })
}
```

```tsx
// apps/web/src/app/providers.tsx (Web 側)
import { SupabaseProvider } from '@taskapp/shared'
import { createClient } from '@/lib/supabase/client'

export function Providers({ children }: { children: React.ReactNode }) {
  const supabase = createClient() // @supabase/ssr の Browser Client
  return (
    <SupabaseProvider value={supabase}>
      {children}
    </SupabaseProvider>
  )
}
```

```tsx
// apps/mobile/app/_layout.tsx (Mobile 側)
import { SupabaseProvider } from '@taskapp/shared'
import { createClient } from '@/lib/supabase/client'

export default function RootLayout({ children }) {
  const supabase = createClient() // AsyncStorage ベースのクライアント
  return (
    <SupabaseProvider value={supabase}>
      {children}
    </SupabaseProvider>
  )
}
```

### 3.4 packages/shared エクスポート構成

```typescript
// packages/shared/src/index.ts

// Types
export * from './types/database'

// Supabase Context
export { SupabaseProvider, useSupabase } from './supabase/context'

// RPC
export * from './rpc'

// Hooks
export { useTasks } from './hooks/useTasks'
export { useMeetings } from './hooks/useMeetings'
export { useReviews } from './hooks/useReviews'
export { useConsidering } from './hooks/useConsidering'
export { useNotifications } from './hooks/useNotifications'
export { useCurrentUser } from './hooks/useCurrentUser'
export { useSpaceMembers } from './hooks/useSpaceMembers'
export { useSpaceSettings } from './hooks/useSpaceSettings'
export { useTaskComments } from './hooks/useTaskComments'
export { useMilestones } from './hooks/useMilestones'
export { useSchedulingProposals } from './hooks/useSchedulingProposals'
export { useProposalResponses } from './hooks/useProposalResponses'

// Labels
export * from './labels'

// Date Utils
export { formatDateToLocalString } from './date/dateUtils'
```

---

## 4. React Native (Expo) セットアップ

### 4.1 Expo プロジェクト初期化手順

```bash
# 1. ルートから実行
cd taskapp/apps

# 2. Expo プロジェクト作成
npx create-expo-app@latest mobile --template tabs

# 3. 依存パッケージ追加
cd mobile
npx expo install expo-router expo-linking expo-constants expo-status-bar
npx expo install @supabase/supabase-js @tanstack/react-query
npx expo install react-native-url-polyfill
npx expo install @react-native-async-storage/async-storage
npx expo install expo-secure-store
npx expo install expo-notifications expo-device
npx expo install nativewind tailwindcss react-native-reanimated
npx expo install @phosphor-icons/react-native react-native-svg

# 4. 共有パッケージリンク
pnpm add @taskapp/shared --workspace
```

### 4.2 apps/mobile/app.json

```jsonc
{
  "expo": {
    "name": "TaskApp",
    "slug": "taskapp",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "taskapp",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.yourcompany.taskapp",
      "infoPlist": {
        "UIBackgroundModes": ["remote-notification"]
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "com.yourcompany.taskapp",
      "googleServicesFile": "./google-services.json"
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#f59e0b"
        }
      ]
    ],
    "extra": {
      "eas": {
        "projectId": "your-eas-project-id"
      },
      "router": {
        "origin": "https://your-domain.com"
      }
    }
  }
}
```

### 4.3 apps/mobile/package.json

```jsonc
{
  "name": "@taskapp/mobile",
  "version": "1.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "dev": "expo start",
    "dev:ios": "expo run:ios",
    "dev:android": "expo run:android",
    "build:ios": "eas build --platform ios",
    "build:android": "eas build --platform android",
    "submit:ios": "eas submit --platform ios",
    "submit:android": "eas submit --platform android",
    "lint": "eslint app/ components/ lib/",
    "clean": "rm -rf node_modules .expo"
  },
  "dependencies": {
    "@taskapp/shared": "workspace:*",
    "@phosphor-icons/react-native": "^2.1.0",
    "@react-native-async-storage/async-storage": "^2.1.0",
    "@supabase/supabase-js": "^2.93.3",
    "@tanstack/react-query": "^5.90.20",
    "expo": "~53.0.0",
    "expo-constants": "~17.0.0",
    "expo-device": "~7.0.0",
    "expo-linking": "~7.0.0",
    "expo-notifications": "~0.31.0",
    "expo-router": "~5.0.0",
    "expo-secure-store": "~14.0.0",
    "expo-status-bar": "~2.2.0",
    "nativewind": "^4.1.0",
    "react": "19.2.3",
    "react-native": "~0.79.0",
    "react-native-reanimated": "~3.17.0",
    "react-native-safe-area-context": "~5.4.0",
    "react-native-screens": "~4.10.0",
    "react-native-svg": "~16.0.0",
    "react-native-url-polyfill": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^19",
    "tailwindcss": "^4",
    "typescript": "5.9.3"
  }
}
```

### 4.4 apps/mobile/tsconfig.json

```jsonc
{
  "extends": "../../packages/tsconfig/react-native.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@taskapp/shared": ["../../packages/shared/src"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts"]
}
```

---

## 5. Supabase クライアント統合

### 5.1 Mobile 用 Supabase クライアント

```typescript
// apps/mobile/lib/supabase/client.ts
import 'react-native-url-polyfill/auto'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import type { Database } from '@taskapp/shared'

// Expo SecureStore は 2048 バイト制限があるため
// セッショントークンは SecureStore、その他は AsyncStorage を使用
const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    return await SecureStore.getItemAsync(key)
  },
  setItem: async (key: string, value: string) => {
    await SecureStore.setItemAsync(key, value)
  },
  removeItem: async (key: string) => {
    await SecureStore.deleteItemAsync(key)
  },
}

export function createClient() {
  return createSupabaseClient<Database>(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storage: ExpoSecureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,  // Mobile では URL 検出を無効化
      },
    }
  )
}
```

### 5.2 Web 用 Supabase クライアント（変更なし）

```typescript
// apps/web/src/lib/supabase/client.ts (既存のまま)
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@taskapp/shared'  // import 先を変更

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

### 5.3 認証フロー比較

| 項目 | Web | Mobile |
|------|-----|--------|
| ログイン | `supabase.auth.signInWithPassword()` | 同左 |
| セッション保持 | Cookie (`@supabase/ssr`) | SecureStore |
| OAuth | ブラウザリダイレクト | `expo-auth-session` + Deep Link |
| セッションリフレッシュ | Middleware (`middleware.ts`) | `autoRefreshToken: true` |
| ログアウト | `supabase.auth.signOut()` + Cookie 削除 | `supabase.auth.signOut()` + SecureStore 削除 |

---

## 6. 画面・ナビゲーション設計

### 6.1 タブ構成

```
┌─────────────────────────────────┐
│          TaskApp                │
│   ┌─────────────────────────┐   │
│   │                         │   │
│   │    コンテンツエリア       │   │
│   │                         │   │
│   │                         │   │
│   └─────────────────────────┘   │
│                                 │
│  ┌──────┬──────┬──────┬──────┐  │
│  │タスク │会議  │通知  │設定  │  │
│  └──────┴──────┴──────┴──────┘  │
└─────────────────────────────────┘
```

| タブ | 画面 | Web の対応画面 |
|------|------|---------------|
| タスク | タスク一覧 + フィルタ | `(internal)/[orgId]/project/[spaceId]/page.tsx` |
| 会議 | 会議一覧 | `(internal)/[orgId]/project/[spaceId]/meetings/` |
| 通知 | 通知一覧 | `(internal)/inbox/` |
| 設定 | アカウント・スペース設定 | `settings/` |

### 6.2 画面遷移

```
(auth)
  ├── login.tsx          → ログイン
  └── signup.tsx         → サインアップ

(tabs)
  ├── tasks.tsx          → タスク一覧 (ball フィルタ付き)
  │   └── → task/[id]   → タスク詳細 (push)
  ├── meetings.tsx       → 会議一覧
  │   └── → meeting/[id] → 会議詳細 (push)
  ├── notifications.tsx  → 通知一覧
  └── settings.tsx       → 設定

task/[id].tsx            → タスク詳細 (フルスクリーン)
  ├── コメント表示・投稿
  ├── ボール移動
  ├── ステータス変更
  └── 担当者変更

meeting/[id].tsx         → 会議詳細 (フルスクリーン)
  ├── 参加者一覧
  ├── 開始/終了
  └── 決定事項一覧

scheduling/[id].tsx      → 日程調整詳細
  └── スロット回答
```

### 6.3 Web 3ペイン → Mobile 変換ルール

| Web | Mobile |
|-----|--------|
| LeftNav (240px) | Bottom Tab Bar |
| Main (flex-1) | フルスクリーンリスト |
| Inspector (400px) | Push ナビゲーション (フルスクリーン詳細) |
| Amber-500 (クライアント可視) | 同じカラールール維持 |
| 楽観的更新 | 同じパターン維持 (TanStack Query) |

---

## 7. プッシュ通知

### 7.1 アーキテクチャ

```
┌──────────┐     ┌──────────┐     ┌──────────────┐
│ Supabase │────→│ Edge Fn  │────→│ Expo Push    │
│ DB       │ trigger │ (notify) │  POST  │ Service      │
│ (INSERT) │     │          │     │ (expo.dev)   │
└──────────┘     └──────────┘     └──────┬───────┘
                                         │
                                    ┌────┴────┐
                                    │         │
                                  APNs     FCM
                                    │         │
                                  iOS     Android
```

### 7.2 Expo Push Token 登録

```typescript
// apps/mobile/lib/notifications/register.ts
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'

export async function registerForPushNotifications(
  supabase: SupabaseClient,
  userId: string
) {
  if (!Device.isDevice) return null

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return null

  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: 'your-eas-project-id',
  })).data

  // Supabase に push_token を保存
  await supabase
    .from('push_tokens')
    .upsert({
      user_id: userId,
      token,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,token' })

  // Android 通知チャンネル設定
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  return token
}
```

### 7.3 必要な DB マイグレーション

```sql
-- supabase/migrations/YYYYMMDD_000_push_tokens.sql

CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tokens"
  ON push_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

---

## 8. 環境変数・設定管理

### 8.1 環境変数マッピング

| 用途 | Web (`NEXT_PUBLIC_*`) | Mobile (`EXPO_PUBLIC_*`) |
|------|----------------------|--------------------------|
| Supabase URL | `NEXT_PUBLIC_SUPABASE_URL` | `EXPO_PUBLIC_SUPABASE_URL` |
| Supabase Anon Key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| App Name | `NEXT_PUBLIC_APP_NAME` | `EXPO_PUBLIC_APP_NAME` |
| App URL | `NEXT_PUBLIC_APP_URL` | `EXPO_PUBLIC_APP_URL` |

### 8.2 apps/mobile/.env.local

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
EXPO_PUBLIC_APP_NAME=TaskApp
EXPO_PUBLIC_APP_URL=https://your-domain.com
```

### 8.3 EAS Build 環境変数 (eas.json)

```jsonc
{
  "cli": {
    "version": ">= 13.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "https://your-project.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your-anon-key"
      }
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "https://your-project.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your-anon-key"
      }
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_SUPABASE_URL": "https://your-project.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your-production-anon-key"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your@apple.id",
        "ascAppId": "your-app-store-connect-id",
        "appleTeamId": "YOUR_TEAM_ID"
      },
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

---

## 9. Vercel 設定変更

### 9.1 モノレポ対応

Vercel はモノレポを自動検出するが、以下を明示設定する。

#### Vercel Dashboard 設定手順

1. **Project Settings → General**
   - **Root Directory**: `apps/web`
   - **Framework Preset**: Next.js (自動検出)

2. **Project Settings → Build & Output**
   - **Build Command**: `cd ../.. && pnpm turbo build --filter=@taskapp/web`
   - **Output Directory**: `.next` (デフォルト)
   - **Install Command**: `pnpm install`

3. **Project Settings → Environment Variables**
   - 既存の環境変数はそのまま維持 (変更不要)

### 9.2 vercel.json (apps/web/vercel.json)

```jsonc
{
  "installCommand": "cd ../.. && pnpm install",
  "buildCommand": "cd ../.. && pnpm turbo build --filter=@taskapp/web"
}
```

### 9.3 Ignore Build Step (任意)

Mobile 側の変更だけでは Web をリビルドしないよう最適化:

```bash
# apps/web/.vercelignore は使えないため、Vercel Dashboard で設定
# Project Settings → Git → Ignored Build Step:
# npx turbo-ignore @taskapp/web
```

---

## 10. CI/CD パイプライン

### 10.1 GitHub Actions: Web (既存の延長)

```yaml
# .github/workflows/web.yml
name: Web CI

on:
  push:
    branches: [main]
    paths:
      - 'apps/web/**'
      - 'packages/shared/**'
      - 'package.json'
      - 'pnpm-lock.yaml'
  pull_request:
    branches: [main]
    paths:
      - 'apps/web/**'
      - 'packages/shared/**'

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint --filter=@taskapp/web
      - run: pnpm turbo test --filter=@taskapp/web
```

### 10.2 GitHub Actions: Mobile

```yaml
# .github/workflows/mobile.yml
name: Mobile CI

on:
  push:
    branches: [main]
    paths:
      - 'apps/mobile/**'
      - 'packages/shared/**'
  pull_request:
    branches: [main]
    paths:
      - 'apps/mobile/**'
      - 'packages/shared/**'

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint --filter=@taskapp/mobile
      - name: TypeScript check
        run: cd apps/mobile && npx tsc --noEmit

  eas-build:
    needs: lint-and-typecheck
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - run: cd apps/mobile && eas build --platform all --profile preview --non-interactive
```

### 10.3 EAS Build ワークフロー図

```
PR マージ → main
  │
  ├─→ Vercel (Web 自動デプロイ)
  │     └─→ apps/web → Production URL
  │
  └─→ GitHub Actions (Mobile)
        └─→ EAS Build
              ├─→ iOS: .ipa → TestFlight
              └─→ Android: .aab → Play Console (Internal)
```

---

## 11. ストア申請準備

### 11.1 Apple App Store (iOS)

#### 前提条件
- [ ] Apple Developer Program ($99/年) 登録済み
- [ ] App Store Connect にアプリ登録済み
- [ ] 証明書 & Provisioning Profile 作成済み (EAS が自動管理)

#### 必要なアセット

| アセット | サイズ | 備考 |
|---------|-------|------|
| App Icon | 1024x1024 px | 角丸なし (システムが適用) |
| iPhone スクリーンショット (6.7") | 1290x2796 px | 最低 3 枚 |
| iPhone スクリーンショット (6.5") | 1242x2688 px | 最低 3 枚 |
| iPad スクリーンショット (12.9") | 2048x2732 px | iPad 対応する場合 |
| プライバシーポリシー URL | — | 必須 |
| サポート URL | — | 必須 |

#### App Store Connect 設定

```
カテゴリ: ビジネス > プロジェクト管理
年齢制限: 4+
価格: 無料 (アプリ内課金あり → Stripe は外部決済のため該当しない可能性あり)
```

### 11.2 Google Play Store (Android)

#### 前提条件
- [ ] Google Play Developer アカウント ($25 一回払い) 登録済み
- [ ] Play Console にアプリ登録済み
- [ ] サービスアカウント JSON 作成済み (EAS Submit 用)

#### 必要なアセット

| アセット | サイズ | 備考 |
|---------|-------|------|
| App Icon | 512x512 px | |
| Feature Graphic | 1024x500 px | ストアページ上部 |
| Phone スクリーンショット | 最低 2 枚 | 16:9 or 9:16 |
| 7" タブレット スクリーンショット | 最低 1 枚 | タブレット対応の場合 |
| プライバシーポリシー URL | — | 必須 |

#### Play Console 設定

```
カテゴリ: 仕事効率化
コンテンツのレーティング: アンケート回答が必要
ターゲットユーザー: 18 歳以上
```

---

## 12. 移行手順（フェーズ別）

### Phase 0: 準備 (1日)

```
目標: モノレポ基盤を構築し、既存の Web アプリが壊れないことを確認
```

| # | 作業 | コマンド / 操作 | 確認方法 |
|---|------|----------------|---------|
| 0-1 | pnpm へ移行 | `corepack enable && corepack prepare pnpm@9.15.0 --activate` | `pnpm --version` |
| 0-2 | ルート package.json 作成 | §2.2 の内容で作成 | — |
| 0-3 | pnpm-workspace.yaml 作成 | §2.3 の内容で作成 | — |
| 0-4 | turbo.json 作成 | §2.4 の内容で作成 | — |
| 0-5 | `apps/web/` ディレクトリ作成 | `mkdir -p apps/web` | — |
| 0-6 | 既存ファイルを `apps/web/` に移動 | `git mv src apps/web/src && git mv public apps/web/public && git mv next.config.ts apps/web/` 等 | — |
| 0-7 | `apps/web/package.json` 作成 | 既存 `package.json` をベースに `name: "@taskapp/web"` に変更 | — |
| 0-8 | `apps/web/tsconfig.json` 調整 | パスエイリアス維持、shared パッケージ参照追加 | — |
| 0-9 | ルートから `pnpm install` | `pnpm install` | lock ファイル生成確認 |
| 0-10 | Web ビルド確認 | `pnpm dev:web` | localhost:4000 でアプリ動作確認 |
| 0-11 | Vercel 設定更新 | §9.1 の手順で Dashboard 設定 | Vercel Preview デプロイ成功 |

### Phase 1: 共有パッケージ切り出し (2-3日)

```
目標: @taskapp/shared パッケージを作成し、Web が shared 経由で動作することを確認
```

| # | 作業 | 詳細 | 確認方法 |
|---|------|------|---------|
| 1-1 | `packages/shared/` 作成 | §3.1 の package.json で作成 | — |
| 1-2 | 型定義を移動 | `database.ts` → `packages/shared/src/types/` | import エラーなし |
| 1-3 | SupabaseProvider 作成 | §3.3 のコード作成 | — |
| 1-4 | RPC ラッパー移動 | `rpc.ts` を Client 注入パターンに変更して移動 | — |
| 1-5 | hooks を段階的に移動 | §3.2 の一覧に従い 1 hook ずつ移動 + テスト | 各 hook の動作確認 |
| 1-6 | labels / dateUtils 移動 | 純粋関数なのでそのまま移動 | — |
| 1-7 | Web 側の import パス更新 | `@/types/database` → `@taskapp/shared` 等 | `pnpm build:web` 成功 |
| 1-8 | 既存テスト実行 | `pnpm test` | 全テストパス |

### Phase 2: Mobile アプリ基盤 (3-5日)

```
目標: Expo アプリで認証〜タスク一覧表示まで動作
```

| # | 作業 | 詳細 | 確認方法 |
|---|------|------|---------|
| 2-1 | Expo プロジェクト作成 | §4.1 の手順 | `expo start` 成功 |
| 2-2 | Supabase クライアント作成 | §5.1 のコード | — |
| 2-3 | SupabaseProvider 接続 | §3.3 の Mobile 側コード | — |
| 2-4 | ログイン画面実装 | Email/Password ログイン | 認証成功・セッション保持 |
| 2-5 | タスク一覧画面 | `useTasks` で一覧表示 | タスクが表示される |
| 2-6 | タスク詳細画面 | コメント、ボール移動、ステータス変更 | CRUD 動作確認 |
| 2-7 | Bottom Tab 設定 | §6.1 の 4 タブ構成 | タブ遷移動作 |

### Phase 3: 機能拡充 (5-7日)

```
目標: 主要機能の Mobile 対応完了
```

| # | 作業 |
|---|------|
| 3-1 | 会議一覧・詳細画面 |
| 3-2 | 通知一覧画面 |
| 3-3 | プッシュ通知 (§7 全体) |
| 3-4 | 日程調整 (提案一覧・スロット回答) |
| 3-5 | 設定画面 (アカウント・スペース) |
| 3-6 | Deep Link 対応 (通知タップ → 該当画面) |

### Phase 4: ストア申請 (3-5日)

```
目標: TestFlight / 内部テスト → 本番申請
```

| # | 作業 |
|---|------|
| 4-1 | アプリアイコン・スプラッシュ画面作成 |
| 4-2 | ストア用スクリーンショット撮影 |
| 4-3 | プライバシーポリシー・利用規約ページ作成 |
| 4-4 | EAS Build (production) 実行 |
| 4-5 | TestFlight / 内部テストトラック配信 |
| 4-6 | 社内テスト (1 週間) |
| 4-7 | ストア審査提出 |

---

## 付録 A: 移動しないファイル (Web 専用)

以下は `apps/web/` に残し、shared には含めない:

| ファイル/ディレクトリ | 理由 |
|---------------------|------|
| `src/app/api/` | Server-side API Routes |
| `src/lib/supabase/server.ts` | Next.js Server Component 専用 |
| `src/lib/supabase/middleware.ts` | Next.js Middleware 専用 |
| `src/lib/slack/` | Slack API (サーバーサイド) |
| `src/lib/github/` | GitHub API (サーバーサイド) |
| `src/lib/teams/` | Teams API (サーバーサイド) |
| `src/lib/email/` | Resend (サーバーサイド) |
| `src/lib/ai/` | AI 機能 (サーバーサイド) |
| `src/lib/notifications/` | サーバーサイド通知ロジック |
| `src/components/lp/` | ランディングページ |
| `src/lib/hooks/useGitHub.ts` | GitHub 連携 UI (Web 専用) |
| `src/lib/hooks/useSlack.ts` | Slack 連携 UI (Web 専用) |
| `src/lib/hooks/useWikiPages.ts` | Wiki (BlockNote = Web 専用) |
| `src/lib/hooks/useBurndown.ts` | バーンダウンチャート (Web 専用) |
| `src/lib/hooks/useEstimationAssist.ts` | AI 見積 (Web 専用) |
| `src/lib/hooks/useRiskForecast.ts` | AI リスク予測 (Web 専用) |
| `src/lib/presets/` | ジャンルプリセット (Web 専用) |

## 付録 B: 共有 TypeScript 設定

```jsonc
// packages/tsconfig/base.json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["ES2020"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true
  }
}
```

```jsonc
// packages/tsconfig/nextjs.json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "react-jsx",
    "noEmit": true,
    "plugins": [{ "name": "next" }]
  }
}
```

```jsonc
// packages/tsconfig/react-native.json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2020"],
    "jsx": "react-jsx",
    "noEmit": true,
    "types": ["react-native", "expo"]
  }
}
```

## 付録 C: 日付処理ルール (再掲)

Mobile でも Web と同じルールを厳守:

```typescript
// NG: タイムゾーンずれ (UTC 変換で日本時間 1 日ずれ)
const dateStr = date.toISOString().split('T')[0]

// OK: ローカルタイムゾーン維持
import { formatDateToLocalString } from '@taskapp/shared'
const dateStr = formatDateToLocalString(date)
```

---

## 変更履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2026-02-15 | v1.0 | 初版作成 |
