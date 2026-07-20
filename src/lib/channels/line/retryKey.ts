import { createHash } from 'node:crypto'

/**
 * 任意のシード文字列から、LINE の `X-Line-Retry-Key` が要求する **UUID v4 形状**の決定的な値を導出する。
 *
 * LINE push API は retry key が UUID(8-4-4-4-12)でないと 400 を返す。一方 multica の event_id は
 * ULID など UUID でない文字列であり、そのまま渡すと全 push が 400 になる。そこで
 * buildDigestRetryKey（src/lib/channels/digest/compute.ts）と同型に、シードを SHA-256 して
 * UUID v4 形状へ整形する（値はハッシュ由来の決定論。同一シード→同一キーで二重配信防止が効く）。
 */
export function toLineRetryKey(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}
