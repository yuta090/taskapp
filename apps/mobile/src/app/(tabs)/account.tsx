import Constants from 'expo-constants'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '~/components/ui'
import { useSession } from '~/hooks/useSession'
import { useColors } from '~/theme/colors'

const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://agentpm.app'

export default function AccountScreen() {
  const c = useColors()
  const { session, orgs, activeOrg, setActiveOrg, signOut } = useSession()

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.title, { color: c.text }]}>アカウント</Text>
        <Text style={[styles.email, { color: c.textSecondary }]}>{session?.user.email}</Text>

        {orgs.length > 1 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: c.textMuted }]}>組織</Text>
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
              {orgs.map((org) => (
                <Pressable
                  key={org.orgId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: org.orgId === activeOrg?.orgId }}
                  onPress={() => setActiveOrg(org.orgId)}
                  style={[styles.orgRow, { borderColor: c.border }]}>
                  <Text style={[styles.orgName, { color: c.text }]}>{org.orgName}</Text>
                  {org.orgId === activeOrg?.orgId ? <Text style={{ color: c.primary }}>✓</Text> : null}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.note, { color: c.textSecondary }]}>
            ガント・Wiki・議事録・設定・お支払いは Web で行います。
          </Text>
          <Button label="Web 版を開く" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(`${WEB_BASE_URL}/my`)} />
        </View>

        <View style={styles.section}>
          <Button label="ログアウト" variant="secondary" onPress={signOut} />
        </View>

        <Text style={[styles.version, { color: c.textMuted }]}>版 {Constants.expoConfig?.version}</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { padding: 16, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  email: { fontSize: 14 },
  section: { marginTop: 24, gap: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  orgRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  orgName: { fontSize: 15 },
  note: { fontSize: 13 },
  version: { fontSize: 12, textAlign: 'center', marginTop: 32 },
})
