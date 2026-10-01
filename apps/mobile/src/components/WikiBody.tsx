/**
 * Wiki の本文（parseWikiBody のブロック列）を React Native の Text / View で描く。
 * 長い本文でもまず先頭が出るよう、一覧部品（FlatList など）ではなく、呼ぶ側の ScrollView の中に素直に並べる。
 * 色は ~/theme/colors のトークンだけ。文字は選択できる。HTML は描かない（文字のまま）。
 */
import * as WebBrowser from 'expo-web-browser'
import { useState, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { WEB_BASE_URL } from '~/api/webApi'
import type { WikiBlock, WikiSpan } from '~/lib/wikiBody'
import { useColors, type Colors } from '~/theme/colors'

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' })
const HEADING_SIZE = { 1: 24, 2: 20, 3: 17 } as const

/** リンクを開く。parseWikiBody が通した http/https と Web 内のパスだけが来る */
function openLink(href: string) {
  const url = href.startsWith('/') ? `${WEB_BASE_URL}${href}` : href
  void WebBrowser.openBrowserAsync(url)
}

function Spans({ spans, c, bold }: { spans: WikiSpan[]; c: Colors; bold?: boolean }) {
  return (
    <>
      {spans.map((s, i) => (
        <Text
          key={i}
          onPress={s.href ? () => openLink(s.href as string) : undefined}
          style={[
            (s.bold || bold) && styles.bold,
            s.italic && styles.italic,
            s.strike && styles.strike,
            s.code && { fontFamily: MONO, backgroundColor: c.chip },
            s.href && { color: c.primary, textDecorationLine: 'underline' },
          ]}>
          {s.text}
        </Text>
      ))}
    </>
  )
}

function Line({ spans, c, style, bold }: { spans: WikiSpan[]; c: Colors; style?: object; bold?: boolean }) {
  return (
    <Text selectable style={[styles.text, { color: c.text }, style]}>
      <Spans spans={spans} c={c} bold={bold} />
    </Text>
  )
}

/** 先頭に印（•・番号・チェック）を置き、右に文字を置く行 */
function MarkedRow({ mark, c, children }: { mark: string; c: Colors; children: ReactNode }) {
  return (
    <View style={styles.markedRow}>
      <Text style={[styles.mark, { color: c.textSecondary }]}>{mark}</Text>
      <View style={styles.markedBody}>{children}</View>
    </View>
  )
}

function Children({ blocks, c }: { blocks: WikiBlock[]; c: Colors }) {
  if (blocks.length === 0) return null
  return (
    <View style={styles.children}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} c={c} />
      ))}
    </View>
  )
}

function ToggleBlock({ block, c }: { block: Extract<WikiBlock, { type: 'toggle' }>; c: Colors }) {
  // 読むための画面なので、はじめは開いておく
  const [open, setOpen] = useState(true)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={styles.toggleHead}>
        <Text style={[styles.mark, { color: c.textSecondary }]}>{open ? '▾' : '▸'}</Text>
        <View style={styles.markedBody}>
          <Line spans={block.spans} c={c} />
        </View>
      </Pressable>
      {open ? <Children blocks={block.children} c={c} /> : null}
    </View>
  )
}

function TableBlock({ block, c }: { block: Extract<WikiBlock, { type: 'table' }>; c: Colors }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={[styles.table, { borderColor: c.border }]}>
        {block.rows.map((row, r) => (
          <View key={r} style={styles.tableRow}>
            {row.map((cell, k) => (
              <View key={k} style={[styles.cell, { borderColor: c.border, backgroundColor: c.surface }]}>
                <Line spans={cell} c={c} style={styles.cellText} />
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

function Block({ block, c }: { block: WikiBlock; c: Colors }) {
  switch (block.type) {
    case 'heading':
      return (
        <View>
          <Line
            spans={block.spans}
            c={c}
            bold
            style={{ fontSize: HEADING_SIZE[block.level], lineHeight: HEADING_SIZE[block.level] + 8, marginTop: 8 }}
          />
          <Children blocks={block.children} c={c} />
        </View>
      )
    case 'paragraph':
      return (
        <View>
          <Line spans={block.spans} c={c} />
          <Children blocks={block.children} c={c} />
        </View>
      )
    case 'bullet':
      return (
        <View>
          <MarkedRow mark="•" c={c}>
            <Line spans={block.spans} c={c} />
          </MarkedRow>
          <Children blocks={block.children} c={c} />
        </View>
      )
    case 'numbered':
      return (
        <View>
          <MarkedRow mark={`${block.number}.`} c={c}>
            <Line spans={block.spans} c={c} />
          </MarkedRow>
          <Children blocks={block.children} c={c} />
        </View>
      )
    case 'check':
      return (
        <View>
          <MarkedRow mark={block.checked ? '☑' : '☐'} c={c}>
            <Line
              spans={block.spans}
              c={c}
              style={block.checked ? { color: c.textMuted, textDecorationLine: 'line-through' } : undefined}
            />
          </MarkedRow>
          <Children blocks={block.children} c={c} />
        </View>
      )
    case 'toggle':
      return <ToggleBlock block={block} c={c} />
    case 'quote':
      return (
        <View style={[styles.quote, { borderLeftColor: c.border }]}>
          <Line spans={block.spans} c={c} style={{ color: c.textSecondary }} />
          <Children blocks={block.children} c={c} />
        </View>
      )
    case 'code':
      return (
        <ScrollView horizontal style={[styles.code, { backgroundColor: c.chip }]}>
          <Text selectable style={{ fontFamily: MONO, fontSize: 13, lineHeight: 19, color: c.text }}>
            {block.text}
          </Text>
        </ScrollView>
      )
    case 'divider':
      return <View style={[styles.divider, { backgroundColor: c.border }]} />
    case 'table':
      return <TableBlock block={block} c={c} />
    case 'notice':
      return (
        <View>
          <View style={[styles.notice, { backgroundColor: c.chip }]}>
            <Text style={{ color: c.textMuted, fontSize: 13 }}>{block.message}</Text>
          </View>
          <Children blocks={block.children} c={c} />
        </View>
      )
  }
}

export function WikiBody({ blocks }: { blocks: WikiBlock[] }) {
  const c = useColors()
  return (
    <View style={styles.root}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} c={c} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  text: { fontSize: 16, lineHeight: 25 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  children: { marginLeft: 20, marginTop: 6, gap: 6 },
  markedRow: { flexDirection: 'row' },
  mark: { width: 24, fontSize: 16, lineHeight: 25 },
  markedBody: { flex: 1 },
  toggleHead: { flexDirection: 'row', minHeight: 32 },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
  code: { borderRadius: 8, padding: 12 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  table: { borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth },
  tableRow: { flexDirection: 'row' },
  cell: {
    minWidth: 96,
    maxWidth: 240,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cellText: { fontSize: 14, lineHeight: 20 },
  notice: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
})
