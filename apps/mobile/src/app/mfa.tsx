import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { supabase } from '~/api/supabase'
import { Button, Field, Screen } from '~/components/ui'
import { useSession } from '~/hooks/useSession'
import { useColors } from '~/theme/colors'

/**
 * 2段階認証（認証アプリの6桁のコード）。Web の /login/mfa と同じ手順。
 * 通るまで DB が読み書きを拒否するので、ここを抜けるまで一覧は出さない。
 */
export default function MfaScreen() {
  const c = useColors()
  const { refreshAuthLevel, signOut } = useSession()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      const factor = factors.totp.find((f) => f.status === 'verified')
      if (!factor) throw new Error('2段階認証の設定が見つかりません。Web で設定を確認してください')
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
      if (verifyError) throw new Error('コードが違うか、有効期限が切れています')
      await refreshAuthLevel()
    } catch (e) {
      setError(e instanceof Error ? e.message : '確認できませんでした')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen>
      <View style={styles.container}>
        <Text style={[styles.lead, { color: c.textSecondary }]}>認証アプリに表示されている6桁のコードを入力してください</Text>
        <Field
          label="確認コード"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
        />
        {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
        <Button label="確認する" onPress={onSubmit} loading={submitting} disabled={code.trim().length !== 6} />
        <Button label="ログアウト" variant="secondary" onPress={signOut} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  lead: { fontSize: 14 },
  error: { fontSize: 13 },
})
