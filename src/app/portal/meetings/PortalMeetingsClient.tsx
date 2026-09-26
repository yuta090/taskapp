'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, Clock, CaretRight, FileText, FilePdf, X } from '@phosphor-icons/react'
import { PortalShell } from '@/components/portal'
// 共有 barrel を経由しない（議事録の Markdown 変換器がポータル全ページの
// 共有チャンクに載るのを避けるため。components/portal/index.ts のコメント参照）
import { PortalMinutesDocument } from '@/components/portal/PortalMinutesDocument'
import { DocPollHost } from '@/components/editor/docPoll/DocPollHost'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { hasDocPollInMinutes } from '@/lib/doc-polls/logic'
import { useLiveMinutes } from '@/lib/hooks/useLiveMinutes'
import { useMyDocInsertions } from '@/lib/hooks/useMyDocInsertions'
import { PortalInsertionContext } from '@/components/portal/PortalInsertionContext'

// ポータルの議事録はエディタを使わず自前で描くので、投票の番号を振り直す相手（本文）は無い
const NO_EDITOR = { document: [] }
const PORTAL_POLL_CLOSED = 'この投票は終了しました'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface Meeting {
  id: string
  title: string
  heldAt: string | null
  status: string
  minutesMd?: string | null
  summarySubject?: string | null
  summaryBody?: string | null
  startedAt?: string | null
  endedAt?: string | null
}

interface PortalMeetingsClientProps {
  currentProject: Project
  projects: Project[]
  meetings: Meeting[]
  actionCount?: number
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

function formatTime(date: string): string {
  const d = new Date(date)
  return d.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Meeting Inspector component
function MinutesSection({ md, canInsert = false }: { md: string | null | undefined; canInsert?: boolean }) {
  // 書き足せるときは、議事録がまだ空でも本文の場所を出す（末尾に最初の1行を足せるように）
  return md?.trim() || canInsert ? (
    <div>
      <div className="text-xs font-medium text-gray-500 mb-2">議事録</div>
      <PortalMinutesDocument md={md ?? ''} />
    </div>
  ) : (
    <div className="text-center py-8 text-gray-400">
      <FileText className="w-8 h-8 mx-auto mb-2" />
      <p className="text-sm">議事録はありません</p>
    </div>
  )
}

function MeetingInspector({
  meeting,
  onClose,
}: {
  meeting: Meeting
  onClose: () => void
}) {
  const { user } = useCurrentUser()
  const currentUserId = user?.id ?? null

  // 会議中（進行中）は、社内が議事録を保存するたびに届く知らせで本文を読み直し、その場で出す
  // （DOC_VOTE_SPEC §6.1。間隔の制限・重なり防止・裏に回っている間は止める は useLiveMinutes の中）
  const isLive = meeting.status === 'in_progress'
  // 相手先は議事録に行・メモを書き足せる（DOC_VOTE_SPEC §5。社内の編集画面が取り込んでから本文に入る）。
  // 書き足せるのは相手先が読める会議（進行中・終了）だけ
  const canInsert = meeting.status === 'in_progress' || meeting.status === 'ended'
  const {
    rows: myInsertions,
    create: createInsertion,
    withdraw: withdrawInsertion,
    refresh: refreshInsertions,
  } = useMyDocInsertions(canInsert ? meeting.id : null)
  // 自分の書き足しが反映待ち・削除待ちの間は、終わった会議でも本文を読み直して入ったのが見えるようにする
  const waitingMine = myInsertions.some((r) => r.status === 'pending' || r.status === 'remove_requested')
  const minutesMd = useLiveMinutes(meeting.id, isLive || waitingMine, meeting.minutesMd)
  const hasMinutes = !!minutesMd?.trim()
  const hasPoll = hasDocPollInMinutes(minutesMd)
  // 保険: 自分の書き足しを待っている間に本文が変わったら、書き足しの状態も読み直す
  // （社内の画面からの「反映した」知らせが届かなかったときに、反映待ちの表示が残り続けないように）
  // 本文が変わったときだけ読み直す（待っているかどうかの変化では読み直さない）ので、待っているかは ref で読む
  const waitingMineRef = useRef(waitingMine)
  useEffect(() => {
    waitingMineRef.current = waitingMine
  }, [waitingMine])
  useEffect(() => {
    if (waitingMineRef.current) void refreshInsertions()
  }, [minutesMd, refreshInsertions])
  const insertionCtx = useMemo(
    () => ({ rows: myInsertions, create: createInsertion, withdraw: withdrawInsertion }),
    [myInsertions, createInsertion, withdrawInsertion]
  )

  // PDF はブラウザの印刷を借りて作る（PDF を組み立てる部品は入れていない）。紙に載せるのを
  // 会議名・日時・サマリー・本文だけに絞る指定は globals.css の @media print 側にあり、
  // 下の data-print-root の印を見ている（社内の議事録・Wiki と同じ仕組み）。
  const handlePrintPdf = () => {
    window.print()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — 押すためのものだけを置く。紙に載せるかたまり(data-print-root)の外なので
          印刷では出ない */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <span className="text-sm font-medium text-gray-900">議事録詳細</span>
        <div className="flex items-center gap-1">
          {/* 控えを持ち帰れるようにする。刷るものが無い（議事録が空）ときは出さない */}
          {hasMinutes && (
            <button
              type="button"
              onClick={handlePrintPdf}
              data-testid="portal-minutes-print-pdf"
              title="印刷の画面が開きます。保存先で「PDF」を選んでください"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <FilePdf className="w-4 h-4" />
              PDFで保存
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content — data-print-root: 「PDFで保存」で刷るとき、紙に載せるのはここだけにする */}
      <div data-print-root className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="font-medium text-gray-900">{meeting.title}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{meeting.heldAt ? formatDate(meeting.heldAt) : '-'}</span>
            {meeting.startedAt && meeting.endedAt && (
              <span>
                {formatTime(meeting.startedAt)} - {formatTime(meeting.endedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="p-4">
          {meeting.summarySubject && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="text-xs font-medium text-amber-700 mb-1">サマリー</div>
              <p className="text-sm text-amber-900">{meeting.summarySubject}</p>
              {meeting.summaryBody && (
                <p className="text-sm text-amber-800 mt-2">{meeting.summaryBody}</p>
              )}
            </div>
          )}

          {/* 中の投票を押せるようにする（相手先も押せる。読める会議＝進行中・終了の会議だけ）。
              投票の無い議事録では、投票の読み込みも合図のチャネルも張らない。
              ただし会議中は、議事録の保存の知らせを受けるために投票が無くてもチャネルを張る */}
          {hasPoll || isLive || waitingMine ? (
            <DocPollHost
              editor={NO_EDITOR}
              source={{ meetingId: meeting.id }}
              currentUserId={currentUserId}
              editable={false}
              closedNote={PORTAL_POLL_CLOSED}
              // 投票の無い進行中の会議は、保存の知らせを受けるためのチャネルだけ張る（投票は読まない）
              loadPolls={hasPoll}
            >
              <PortalInsertionContext.Provider value={canInsert ? insertionCtx : null}>
                <MinutesSection md={minutesMd} canInsert={canInsert} />
              </PortalInsertionContext.Provider>
            </DocPollHost>
          ) : (
            <PortalInsertionContext.Provider value={canInsert ? insertionCtx : null}>
              <MinutesSection md={minutesMd} canInsert={canInsert} />
            </PortalInsertionContext.Provider>
          )}
        </div>
      </div>
    </div>
  )
}

export function PortalMeetingsClient({
  currentProject,
  projects,
  meetings,
  actionCount = 0,
}: PortalMeetingsClientProps) {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)

  // Inspector content
  const inspector = selectedMeeting ? (
    <MeetingInspector
      meeting={selectedMeeting}
      onClose={() => setSelectedMeeting(null)}
    />
  ) : null

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
      inspector={inspector}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Page Header */}
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">会議・議事録</h1>
            <p className="mt-1 text-sm text-gray-600">
              過去のミーティングの議事録を確認できます
            </p>
          </div>

          {meetings.length === 0 ? (
            <div className="bg-surface rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">議事録はまだありません</p>
              <p className="text-sm text-gray-400 mt-1">
                ミーティングの議事録が作成されると、ここに表示されます
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {meetings.map((meeting) => (
                <button
                  key={meeting.id}
                  onClick={() => setSelectedMeeting(meeting)}
                  className={`w-full text-left bg-surface rounded-xl border shadow-sm p-4 hover:shadow-md transition-all ${
                    selectedMeeting?.id === meeting.id
                      ? 'border-amber-500 ring-1 ring-amber-500'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {meeting.title}
                      </h3>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDate(meeting.heldAt || '')}
                        </span>
                        {meeting.startedAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {formatTime(meeting.startedAt)}
                          </span>
                        )}
                      </div>
                      {meeting.summarySubject && (
                        <p className="mt-2 text-xs text-gray-600 line-clamp-2">
                          {meeting.summarySubject}
                        </p>
                      )}
                    </div>
                    <CaretRight className="w-5 h-5 text-gray-400 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
