import { describe, it, expect } from 'vitest'
import { computeSetupChecklist, type SetupChecklistData } from '@/lib/onboarding/computeSetupChecklist'

const SPACE_ID = 'space-1'
const ORG_ID = 'org-1'

const allFalse: SetupChecklistData = {
  hasNonSampleTask: false,
  hasTeamInvite: false,
  hasClientInvite: false,
  hasPublishedTask: false,
  hasPreviewedPortal: false,
  hasLineLinked: false,
  // 既定は「orgにLINE秘書が用意されている（=ユーザーが自分で連携できる）」状態でテストする。
  // 未準備(準備中)ケースは専用テストで lineAccountReady:false を渡す。
  lineAccountReady: true,
  aiConfigured: false,
}

/** 全ステップ完了状態のデータ（LINE準備済み・連携済み・AI設定済み） */
const allTrue: SetupChecklistData = {
  hasNonSampleTask: true,
  hasTeamInvite: true,
  hasClientInvite: true,
  hasPublishedTask: true,
  hasPreviewedPortal: true,
  hasLineLinked: true,
  lineAccountReady: true,
  aiConfigured: true,
}

describe('computeSetupChecklist', () => {
  it('LINE準備済みでは connect_line と configure_ai を含む7ステップになる', () => {
    const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)

    expect(result.steps.map((s) => s.key)).toEqual([
      'create_task',
      'invite_team',
      'invite_client',
      'publish_task',
      'preview_portal',
      'connect_line',
      'configure_ai',
    ])
    expect(result.totalCount).toBe(7)
    expect(result.completedCount).toBe(0)
    expect(result.allDone).toBe(false)
    for (const step of result.steps) {
      expect(step.done).toBe(false)
    }
  })

  it('marks create_task done and gives it no CTA link (in-page action)', () => {
    const result = computeSetupChecklist({ ...allFalse, hasNonSampleTask: true }, SPACE_ID, ORG_ID)

    const step = result.steps.find((s) => s.key === 'create_task')!
    expect(step.done).toBe(true)
    expect(step.href).toBeNull()
    expect(result.completedCount).toBe(1)
  })

  it('gives invite_team a CTA link to /settings/members when undone, and clears it when done', () => {
    const undone = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
    const undoneStep = undone.steps.find((s) => s.key === 'invite_team')!
    expect(undoneStep.href).toBe('/settings/members')
    expect(undoneStep.ctaLabel).not.toBeNull()

    const done = computeSetupChecklist({ ...allFalse, hasTeamInvite: true }, SPACE_ID, ORG_ID)
    const doneStep = done.steps.find((s) => s.key === 'invite_team')!
    expect(doneStep.href).toBeNull()
    expect(doneStep.ctaLabel).toBeNull()
  })

  it('gives invite_client a CTA link to /settings/members when undone', () => {
    const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
    const step = result.steps.find((s) => s.key === 'invite_client')!
    expect(step.href).toBe('/settings/members')
  })

  it('gives publish_task no CTA link (in-page action) regardless of done state', () => {
    const undone = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
    expect(undone.steps.find((s) => s.key === 'publish_task')!.href).toBeNull()

    const done = computeSetupChecklist({ ...allFalse, hasPublishedTask: true }, SPACE_ID, ORG_ID)
    expect(done.steps.find((s) => s.key === 'publish_task')!.href).toBeNull()
  })

  it('points preview_portal at /portal/preview/{spaceId} when undone', () => {
    const result = computeSetupChecklist(allFalse, 'my-space-42', ORG_ID)
    const step = result.steps.find((s) => s.key === 'preview_portal')!
    expect(step.href).toBe('/portal/preview/my-space-42')
  })

  it('clears preview_portal CTA once previewed', () => {
    const result = computeSetupChecklist({ ...allFalse, hasPreviewedPortal: true }, SPACE_ID, ORG_ID)
    const step = result.steps.find((s) => s.key === 'preview_portal')!
    expect(step.href).toBeNull()
    expect(step.done).toBe(true)
  })

  describe('connect_line ステップ', () => {
    it('LINE秘書が準備済みで未連携なら、秘書コンソールへのCTAを持つ未完了ステップになる', () => {
      const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.done).toBe(false)
      expect(step.pending).not.toBe(true)
      expect(step.href).toBe(`/${ORG_ID}/secretary/connect/line`)
      expect(step.ctaLabel).not.toBeNull()
    })

    it('連携済みなら done かつ CTA なし', () => {
      const result = computeSetupChecklist({ ...allFalse, hasLineLinked: true }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.done).toBe(true)
      expect(step.href).toBeNull()
      expect(step.ctaLabel).toBeNull()
    })

    it('LINE秘書が未準備(準備中)なら pending 表示・CTAなし・進捗の分母に含めない', () => {
      const result = computeSetupChecklist({ ...allFalse, lineAccountReady: false }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      expect(step.pending).toBe(true)
      expect(step.done).toBe(false)
      expect(step.href).toBeNull()
      expect(step.ctaLabel).toBeNull()
      // pending ステップ(connect_line)は表示はするが分母に含めない。
      // 分母は他6つ（create/invite_team/invite_client/publish/preview/configure_ai）。
      expect(result.totalCount).toBe(6)
    })

    it('準備中の文言は「当社が開通し、メールでご案内する」申込制モデルを明示する（自動で使えるようになる誤解を与えない）', () => {
      const result = computeSetupChecklist({ ...allFalse, lineAccountReady: false }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'connect_line')!
      // 運営が開通する主体であることと、能動的なご案内(メール)を約束する
      expect(step.description).toContain('当社')
      expect(step.description).toContain('ご案内')
      // 「ここから連携できます」= 待てば画面上で自動的に使えるという誤解を残さない
      expect(step.description).not.toContain('ここから連携できます')
    })

    it('準備中で他の実行可能ステップ(configure_ai含む)が完了なら allDone に到達できる（連携不能ステップで詰まらない）', () => {
      const result = computeSetupChecklist(
        {
          hasNonSampleTask: true,
          hasTeamInvite: true,
          hasClientInvite: true,
          hasPublishedTask: true,
          hasPreviewedPortal: true,
          hasLineLinked: false,
          lineAccountReady: false,
          aiConfigured: true,
        },
        SPACE_ID,
        ORG_ID
      )
      expect(result.totalCount).toBe(6)
      expect(result.completedCount).toBe(6)
      expect(result.allDone).toBe(true)
    })
  })

  describe('configure_ai ステップ（AI未設定の可視化）', () => {
    it('AI未設定なら未完了・設定画面へのCTAを持ち、自動タスク化が止まる旨を説明する', () => {
      const result = computeSetupChecklist(allFalse, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'configure_ai')!
      expect(step.done).toBe(false)
      expect(step.pending).not.toBe(true)
      expect(step.href).toBe('/settings/org-integrations')
      expect(step.ctaLabel).not.toBeNull()
      // 「未設定だと自動タスク化されない」= サイレントに止まっていることを文言で可視化する
      expect(step.description).toContain('自動')
    })

    it('AI設定済みなら done かつ CTA なし', () => {
      const result = computeSetupChecklist({ ...allFalse, aiConfigured: true }, SPACE_ID, ORG_ID)
      const step = result.steps.find((s) => s.key === 'configure_ai')!
      expect(step.done).toBe(true)
      expect(step.href).toBeNull()
      expect(step.ctaLabel).toBeNull()
    })
  })

  describe('currentStepKey（現在地）', () => {
    it('最初の未完了かつ実行可能なステップを指す', () => {
      const result = computeSetupChecklist({ ...allFalse, hasNonSampleTask: true }, SPACE_ID, ORG_ID)
      expect(result.currentStepKey).toBe('invite_team')
    })

    it('全完了なら null', () => {
      const result = computeSetupChecklist(allTrue, SPACE_ID, ORG_ID)
      expect(result.currentStepKey).toBeNull()
    })

    it('pending ステップは現在地にしない（完了不能なので飛ばす）', () => {
      const result = computeSetupChecklist(
        {
          hasNonSampleTask: true,
          hasTeamInvite: true,
          hasClientInvite: true,
          hasPublishedTask: true,
          hasPreviewedPortal: true,
          hasLineLinked: false,
          lineAccountReady: false, // connect_line は pending
          aiConfigured: true,
        },
        SPACE_ID,
        ORG_ID
      )
      expect(result.currentStepKey).toBeNull()
    })
  })

  it('computes partial completion counts correctly', () => {
    const result = computeSetupChecklist(
      { ...allFalse, hasNonSampleTask: true, hasTeamInvite: true },
      SPACE_ID,
      ORG_ID
    )
    expect(result.completedCount).toBe(2)
    expect(result.allDone).toBe(false)
  })

  it('marks allDone true only when every applicable step is done', () => {
    const result = computeSetupChecklist(allTrue, SPACE_ID, ORG_ID)
    expect(result.totalCount).toBe(7)
    expect(result.completedCount).toBe(7)
    expect(result.allDone).toBe(true)
    for (const step of result.steps) {
      expect(step.href).toBeNull()
    }
  })
})
