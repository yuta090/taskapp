/**
 * 会議 / 日程調整インスペクタを開くためのクエリパラメータの単一情報源。
 *
 * ダッシュボードのリンク生成と会議ページの読み取りが別々の文字列
 * (`meetingId` vs `meeting`) を使っていたため、ダッシュボードから会議を
 * 開いてもインスペクタが開かない「死にクリック」が発生していた。
 * リンク生成・読み取りの双方が本モジュールを参照することでズレを防ぐ。
 */
export const MEETING_QUERY_PARAM = 'meeting'
export const PROPOSAL_QUERY_PARAM = 'proposal'

/** `${basePath}/meetings?meeting=<id>` を組み立てる。basePath 例: `/${orgId}/project/${spaceId}` */
export function buildMeetingHref(basePath: string, meetingId: string): string {
  return `${basePath}/meetings?${MEETING_QUERY_PARAM}=${meetingId}`
}

/** `${basePath}/meetings?proposal=<id>` を組み立てる。 */
export function buildProposalHref(basePath: string, proposalId: string): string {
  return `${basePath}/meetings?${PROPOSAL_QUERY_PARAM}=${proposalId}`
}
