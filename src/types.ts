export type Promisable<T> = T | Promise<T>
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
export type LoopMode = (typeof LOOP_MODE)[number]

export interface TrackInfo extends MediaMetadataInit {
  score?: number
}

export interface Track extends TrackInfo {
  /**
   * Audio src url
   */
  src: string
  /**
   * Audio mime type
   */
  mimeType?: string
}

export interface FileTrack extends TrackInfo {
  src: File
  mimeType?: string
}

export interface StreamTrack extends TrackInfo {
  src: () => Promisable<ReadableStream<Uint8Array>>
  mimeType: string
}

export interface BufferTrack extends TrackInfo {
  src: () => Promisable<ArrayBuffer>
  mimeType: string
}

export type TrackLike = Track | FileTrack | StreamTrack | BufferTrack

/**
 * Shuffle an array
 * @param arr list of id and weight
 * @returns list of id
 */
export type ShuffleFn = (trackList: TrackInfo[]) => number[]

export type Codecs = Set<string>

interface RetryOptions {
  /**
   * Number of retry attempts for network errors
   * @default 3
   */
  retryCount?: number
  /**
   * Delay between retry attempts in milliseconds
   * @default 1000
   */
  retryDelay?: number
}

export interface ZAudioOptions extends RetryOptions {
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
  /**
   * Enable auto unlock audio on user interaction for mobile browsers
   * @default true
   */
  autoUnlock?: boolean
  /**
   * Enable auto suspend audio context when paused
   * @default false
   */
  autoSuspend?: boolean
  /**
   * Delay before auto suspending audio context in milliseconds
   * @default 30000
   */
  autoSuspendDelay?: number
}

export interface PreloadConfig {
  /**
   * Enable preload
   * @default true
   */
  enable: boolean
  /**
   * Percentage of track duration to trigger preload (0-100)
   * @default 80
   */
  threshold: number
}

export interface StreamBufferOptions {
  /**
   * Buffer size in bytes for audio chunks
   * @default 2 << 18 (256KB)
   */
  bufferSize?: number
  /**
   * Maximum buffer duration in seconds
   * @default 30
   */
  maxBufferDuration?: number
}

export interface ZPlayerOptions extends ZAudioOptions {
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
  /**
   * Preload threshold
   * @default 80
   */
  preload?: boolean | PreloadConfig
  /**
   * Stream buffer options for audio streaming optimization
   */
  streamBuffer?: StreamBufferOptions
}

export interface LoadOptions extends RetryOptions {
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

// oxlint-disable-next-line consistent-type-definitions
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
  load: [metadata: Track]
  error: [err: ZAudioError, code: ZAudioErrorCode]
  ended: []
}

export interface ZPlayerEvents extends ZAudioEvents {
  loadTrack: [index: number, metadata: Track & { type?: 'url' | 'stream' | 'buffer' }]
  reorder: []
}
