export * from './types'
export { videoConferenceRegistry } from './registry'

// プロバイダーを登録
import { videoConferenceRegistry } from './registry'
import { GoogleMeetProvider } from './providers/google-meet'
import { ZoomProvider } from './providers/zoom'
import { TeamsProvider } from './providers/teams'

videoConferenceRegistry.register(new GoogleMeetProvider())
videoConferenceRegistry.register(new ZoomProvider())
videoConferenceRegistry.register(new TeamsProvider())
