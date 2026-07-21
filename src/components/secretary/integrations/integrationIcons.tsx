import {
  GoogleLogo,
  ArrowsClockwise,
  Kanban,
  SquaresFour,
  Ticket,
  HardDrives,
  CheckCircle,
  CheckSquare,
  FlowArrow,
  Stack,
  CursorClick,
  CalendarBlank,
  ChatCircleText,
  Buildings,
  Broadcast,
  NotionLogo,
  Table,
  Database,
  GridFour,
  FileCsv,
  Calculator,
  Receipt,
  Cardholder,
} from '@phosphor-icons/react/dist/ssr'
import type { IntegrationId } from '@/lib/integrations/registry'

/**
 * ツールID → 表示アイコンの対応。registry(真実の源)に対する見た目の付随情報を
 * UI層に閉じておく（channelIcons.tsxと同じ約束: registryはサーバー/型でも使うため
 * JSXアイコンを持たせない）。
 */
export const INTEGRATION_ICONS: Record<IntegrationId, typeof GoogleLogo> = {
  google_tasks: GoogleLogo,
  multica: ArrowsClockwise,
  backlog: Kanban,
  jooto: SquaresFour,
  jira: Ticket,
  redmine: HardDrives,
  asana: CheckCircle,
  trello: Kanban,
  microsoft_todo: CheckSquare,
  linear: FlowArrow,
  wrike: Stack,
  clickup: CursorClick,
  monday: CalendarBlank,
  chatwork: ChatCircleText,
  garoon: Buildings,
  webhook: Broadcast,
  notion: NotionLogo,
  google_sheets: Table,
  kintone: Database,
  airtable: GridFour,
  csv_export: FileCsv,
  freee: Calculator,
  money_forward: Receipt,
  misoca: Cardholder,
}
