import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { signInWithGoogle } from '~/api/googleSignIn'
import { supabase } from '~/api/supabase'
import { Button, Field } from '~/components/ui'
import { loginErrorMessage } from '~/lib/loginError'
import { useColors } from '~/theme/colors'

/**
 * メールアドレスとパスワード、または Google でログインする（Web の /login と同じアカウント）。
 * 新規登録・パスワード再設定は Web で行う。
 */
export default function LoginScreen() {
  const c = useColors()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)

  const onGoogle = async () => {
    setGoogleSubmitting(true)
    setError(null)
    const result = await signInWithGoogle()
    setGoogleSubmitting(false)
    if (!result.ok && !result.cancelled) setError(result.message ?? 'ログインできませんでした')
  }

  const onSubmit = async () => {
    setSubmitting(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setSubmitting(false)
    if (signInError) setError(loginErrorMessage(signInError))
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <Text style={[styles.brand, { color: c.text }]}>AgentPM</Text>
        <Text style={[styles.lead, { color: c.textSecondary }]}>Web と同じアカウントでログインします</Text>
        <View style={styles.form}>
          <Field
            label="メールアドレス"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
          />
          <Field
            label="パスワード"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={onSubmit}
          />
          {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
          <Button label="ログイン" onPress={onSubmit} loading={submitting} disabled={!email || !password || googleSubmitting} />
          <Text style={[styles.or, { color: c.textMuted }]}>または</Text>
          <Button label="Google でログイン" variant="secondary" onPress={onGoogle} loading={googleSubmitting} disabled={submitting} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  brand: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  lead: { fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 32 },
  form: { gap: 16 },
  error: { fontSize: 13 },
  or: { fontSize: 12, textAlign: 'center' },
})
