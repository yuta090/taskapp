/**
 * 画面で共通に使う小さな部品。色は ~/theme/colors のトークンだけを使う。
 */
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useColors } from '~/theme/colors'

export function Screen({ children }: { children: ReactNode }) {
  const c = useColors()
  return <View style={[styles.screen, { backgroundColor: c.background }]}>{children}</View>
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'secondary'
}) {
  const c = useColors()
  const primary = variant === 'primary'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? c.primary : c.surface,
          borderColor: primary ? c.primary : c.border,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator color={primary ? c.onPrimary : c.text} />
      ) : (
        <Text style={[styles.buttonLabel, { color: primary ? c.onPrimary : c.text }]}>{label}</Text>
      )}
    </Pressable>
  )
}

export function Field(props: TextInputProps & { label: string }) {
  const c = useColors()
  const { label, style, ...rest } = props
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={c.textMuted}
        style={[styles.input, { color: c.text, backgroundColor: c.surface, borderColor: c.border }, style]}
        {...rest}
      />
    </View>
  )
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>
}

export function Loading() {
  const c = useColors()
  return (
    <Centered>
      <ActivityIndicator color={c.textMuted} />
    </Centered>
  )
}

export function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  const c = useColors()
  return (
    <Centered>
      <Text style={[styles.muted, { color: c.textSecondary }]}>{message}</Text>
      <View style={{ height: 12 }} />
      <Button label="もう一度読み込む" variant="secondary" onPress={onRetry} />
    </Centered>
  )
}

export function EmptyState({ message }: { message: string }) {
  const c = useColors()
  return (
    <Centered>
      <Text style={[styles.muted, { color: c.textMuted }]}>{message}</Text>
    </Centered>
  )
}

export function Chip({ label, tone = 'default' }: { label: string; tone?: 'default' | 'client' | 'danger' | 'primary' }) {
  const c = useColors()
  const color = tone === 'client' ? c.clientVisible : tone === 'danger' ? c.danger : tone === 'primary' ? c.primary : c.textSecondary
  return (
    <View style={[styles.chip, { backgroundColor: c.chip, borderColor: tone === 'default' ? c.chip : color }]}>
      <Text style={[styles.chipLabel, { color }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  button: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '500' },
  input: { minHeight: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { fontSize: 14, textAlign: 'center' },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  chipLabel: { fontSize: 12, fontWeight: '500' },
})
