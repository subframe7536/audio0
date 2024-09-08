import type { Prettify } from '@subframe7536/type-utils'

/**
 * Audio error code
 *
 * - `code < 0`: internal logic error
 * - `code = 0`: unknown load error
 * - `code > 1`: known load error, see in [MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/MediaError/code#media_error_code_constants)
 */
export type ZAudioErrorCode = -1 | 0 | 1 | 2 | 3 | 4

export class ZAudioError extends Error {
  public code: ZAudioErrorCode
  public constructor(code: ZAudioErrorCode, msg: string) {
    super(msg)
    this.code = code
  }
}

export type LoopMode = 'random' | 'list' | 'single'
export type Track = Prettify<MediaMetadataInit & {
  src: string
  score?: number
}>
/**
 * Shuffle an array
 * @param arr list of id and weight
 * @returns list of id
 */
export type ShuffleFn = (trackList: Track[]) => number[]

export type Codecs = Set<string>
export type ZAudioOptions = {
  /**
   * Fade duration
   * @default 500
   */
  fadeDuration?: number
  /**
   * Audio volume
   * @default 0.5
   */
  volume?: number
  /**
   * Whether to bind media session
   */
  mediaSession?: boolean
  /**
   * Audio load timeout
   * @default 10000
   */
  timeout?: number
  /**
   * Custom audio context
   */
  getAudioContext?: () => AudioContext
  /**
   * Create extra audio nodes to the destination
   *
   * @param ctx audio context
   */
  extraAudioNodes?: (ctx: AudioContext) => AudioNode[] | (() => AudioNode[])
}

export type ZPlayerOptions = ZAudioOptions & {
  /**
   * track list
   */
  trackList?: Track[]
  /**
   * Track list shuffle function
   * @default {@link defaultShuffle}
   */
  shuffleFn?: ShuffleFn
  /**
   * Auto play next track
   */
  autoNext?: boolean | LoadOptions
  /**
   * Loop mode
   */
  loopMode?: LoopMode
}

export type LoadOptions = {
  /**
   * Audio mime type
   */
  mimeType?: string
  /**
   * Audio start time
   */
  startTime?: number
  /**
   * Whether to autoplay
   * @default isPlaying
   */
  autoPlay?: boolean
}

export type LoadingState = 'empty' | 'loading' | 'loaded' | 'error'

export type ZAudioEvents = {
  play: []
  pause: []
  stop: []
  timeupdate: [currentTime: number]
  volume: [volume: number]
  mute: [isMuted: boolean]
  rate: [playbackRate: number]
  seek: [targetTime: number]
  load: [metadata: Track]
  error: [code: ZAudioErrorCode, err: ZAudioError]
  ended: []
}

export type ZPlayerEvents = ZAudioEvents & {
  loadTrack: [index: number, metadata: Track]
  reorder: []
}
