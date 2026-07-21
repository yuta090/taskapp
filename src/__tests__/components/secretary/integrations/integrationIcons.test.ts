import { describe, it, expect } from 'vitest'
import { ALL_INTEGRATION_IDS } from '@/lib/integrations/registry'
import { INTEGRATION_ICONS } from '@/components/secretary/integrations/integrationIcons'

/**
 * ツール連携カタログのアイコンMap。registry(真実の源)に対する見た目の付随情報を
 * UI層に閉じる(channelIcons.tsxと同じ約束)。全IntegrationIdを網羅すること。
 */
describe('integrationIcons', () => {
  it('全IntegrationIdにアイコンが割り当てられている', () => {
    for (const id of ALL_INTEGRATION_IDS) {
      expect(INTEGRATION_ICONS[id], `${id} missing icon`).toBeDefined()
    }
  })
})
