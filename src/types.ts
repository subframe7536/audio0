import type { Promisable } from '@subframe7536/type-utils'

/**
 * Audio error code
 *
 * - `code = -1`: Internal logic error
 * - `code = 0`: Unknown load error
 * - `code = 1 / 2 / 3 / 4`: known load error, see in [MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/MediaError/code#media_error_code_constants)
 * - `code = 5`: Stream load error
 */
export type ZAudioErrorCode = -1 | 0 | 1 | 2 | 3 | 4 | 5

export class ZAudioError extends Error {
  public code: ZAudioErrorCode
  public constructor(code: ZAudioErrorCode, msg: string) {
    super(msg)
    this.code = code
  }
}

export const LOOP_MODE = ['list', 'single', 'random'] as const
export type LoopMode = typeof LOOP_MODE[number]

export interface TrackInfo extends MediaMetadataInit {
  score?: number
}

export interface Track extends TrackInfo {
  type: 'url'
  src: string
  mimeType?: string
}

export interface StreamTrack extends TrackInfo {
  type: 'stream'
  src: () => Promisable<ReadableStream>
  mimeType: string
}

export interface BufferTrack extends TrackInfo {
  type: 'buffer'
  src: () => Promisable<ArrayBuffer>
  mimeType: string
}

export type TrackLike = Track | StreamTrack | BufferTrack

/**
 * Shuffle an array
 * @param arr list of id and weight
 * @returns list of id
 */
export type ShuffleFn = (trackList: TrackInfo[]) => number[]

export type Codecs = Set<string>

export interface ZAudioOptions {
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
  trackList?: TrackLike[]
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
  fadeDuration: [duration: number]
  volume: [volume: number]
  mute: [isMuted: boolean]
  rate: [playbackRate: number]
  seek: [targetTime: number]
  load: [metadata: TrackInfo & { src: string }]
  error: [code: ZAudioErrorCode, err: ZAudioError]
  ended: []
}

export type ZPlayerEvents = ZAudioEvents & {
  loadTrack: [index: number, metadata: TrackLike]
  reorder: []
}
