import type { VideoConferenceProvider, VideoConferenceProviderName } from './types'

class VideoConferenceRegistry {
  private providers: Map<VideoConferenceProviderName, VideoConferenceProvider> = new Map()

  register(provider: VideoConferenceProvider): void {
    this.providers.set(provider.name, provider)
  }

  get(name: VideoConferenceProviderName): VideoConferenceProvider | undefined {
    return this.providers.get(name)
  }

  /** 設定済みプロバイダー一覧を返す */
  listConfigured(): VideoConferenceProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isConfigured())
  }
}

export const videoConferenceRegistry = new VideoConferenceRegistry()
