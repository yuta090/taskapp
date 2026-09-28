/**
 * 色の中央トークン（Web の globals.css の考え方に合わせ、画面では直接 hex を書かずここを使う）。
 * ライト/ダークは端末の設定に合わせて切り替える。
 */
import { useColorScheme } from 'react-native'

const light = {
  background: '#f9fafb',
  surface: '#ffffff',
  border: '#e5e7eb',
  text: '#111827',
  textSecondary: '#4b5563',
  textMuted: '#9ca3af',
  primary: '#4f46e5',
  onPrimary: '#ffffff',
  danger: '#dc2626',
  success: '#059669',
  /** 相手先に見える要素（Web と同じ Amber-500） */
  clientVisible: '#f59e0b',
  unreadDot: '#4f46e5',
  chip: '#f3f4f6',
}

const dark: typeof light = {
  background: '#0b0d12',
  surface: '#151821',
  border: '#262a36',
  text: '#f3f4f6',
  textSecondary: '#c3c7d1',
  textMuted: '#8a90a0',
  primary: '#818cf8',
  onPrimary: '#0b0d12',
  danger: '#f87171',
  success: '#34d399',
  clientVisible: '#fbbf24',
  unreadDot: '#818cf8',
  chip: '#1f2330',
}

export type Colors = typeof light

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light
}
