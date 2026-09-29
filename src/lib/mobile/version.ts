/**
 * スマホアプリ（apps/mobile）が対応している最低の版。
 *
 * アプリは古い版を使い続ける人がいるので、DB の形（列名・RPC の引数）を変えて古い版が
 * 壊れるときは、壊れない版をストアに出してから、ここをその版に上げる。
 * 上げると、それより古いアプリは起動時に「更新してください」の画面になる（/api/mobile/version）。
 */
export const MOBILE_MIN_SUPPORTED_VERSION = '1.0.0'
