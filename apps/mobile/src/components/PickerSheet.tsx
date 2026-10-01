import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '~/theme/colors'

export interface PickerOption {
  key: string
  label: string
  selected?: boolean
}

interface Props {
  visible: boolean
  title: string
  options: PickerOption[]
  onSelect: (key: string) => void
  onClose: () => void
}

/** 下から出る選択シート（組織・プロジェクトの切り替え）。背景を押すと閉じる */
export function PickerSheet({ visible, title, options, onSelect, onClose }: Props) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessibilityRole="button" accessibilityLabel="閉じる" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 8 }]}>
          <Text style={[styles.title, { color: c.textSecondary, borderColor: c.border }]}>{title}</Text>
          <ScrollView style={{ maxHeight: height * 0.6 }}>
            {options.map((o) => (
              <Pressable
                key={o.key}
                accessibilityRole="button"
                accessibilityState={{ selected: !!o.selected }}
                onPress={() => onSelect(o.key)}
                style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.chip : c.surface, borderColor: c.border }]}>
                <Text style={[styles.label, { color: c.text }]} numberOfLines={2}>
                  {o.label}
                </Text>
                {o.selected ? <Text style={[styles.check, { color: c.primary }]}>✓</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  // 背景の暗幕。色トークンに無いので透過の黒だけ直接書く（有彩色ではない）
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' },
  title: { fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, fontSize: 16 },
  check: { fontSize: 18, fontWeight: '700' },
})
