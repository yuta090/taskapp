import { useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { PickerSheet } from '~/components/PickerSheet'
import { markProjectRestoreDone } from '~/hooks/useLastProject'
import { useSession } from '~/hooks/useSession'
import { useColors } from '~/theme/colors'

/** 右上の組織名。組織が2つ以上あれば、押して切り替えられる */
export function OrgSwitcher() {
  const c = useColors()
  const { orgs, activeOrg, setActiveOrg } = useSession()
  const [open, setOpen] = useState(false)

  if (!activeOrg) return null
  if (orgs.length <= 1) return <Text style={[styles.org, { color: c.textMuted }]}>{activeOrg.orgName}</Text>

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="組織を切り替える" onPress={() => {
          // シートを開いている間に、覚えていたプロジェクトが下で開かないようにする
          markProjectRestoreDone()
          setOpen(true)
        }} style={styles.button}>
        <Text style={[styles.org, { color: c.textMuted }]} numberOfLines={1}>
          {activeOrg.orgName} ▾
        </Text>
      </Pressable>
      <PickerSheet
        visible={open}
        title="組織を切り替える"
        options={orgs.map((o) => ({ key: o.orgId, label: o.orgName, selected: o.orgId === activeOrg.orgId }))}
        onSelect={(key) => {
          setActiveOrg(key)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'flex-end', maxWidth: '60%' },
  org: { fontSize: 13 },
})
