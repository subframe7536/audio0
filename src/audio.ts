import type {
  Codecs,
  LoadingState,
  LoadOptions,
  Track,
  ZAudioErrorCode,
  ZAudioEvents,
  ZAudioOptions,
} from './types'
import type { Promisable } from '@subframe7536/type-utils'

import { Mitt } from 'zen-mitt/class'

import { ZAudioError } from './types'
import { bindEventListenerWithCleanup, clamp, formatVolume, getCodecs, sleep } from './utils/common'

// Keep order
const sessionEvents = [
  'nexttrack',
  'pause',
  'play',
  'previoustrack',
  'seekbackward',
  'seekforward',
  'seekto',
  'stop',
] as const
type EventIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Audio player class with fade effects and media session support
 *
 * @example
 * ```ts
 * const audio = new ZAudio();
 * await audio.load({ src: 'audio.mp3' });
 * await audio.play();
 * ```
 *
 * @description
 * This class provides the following features:
 * - Audio playback control (play, pause, stop, seek)
 * - Volume control with fade effects
 * - Media session integration
 * - Custom audio node handling
 * - Codec support detection
 * - Event emission for various audio states
 *
 * @event load - Emitted when audio is loaded successfully
 * @event play - Emitted when audio starts playing
 * @event pause - Emitted when audio is paused
 * @event stop - Emitted when audio is stopped
 * @event ended - Emitted when audio playback ends
 * @event error - Emitted when an error occurs
 * @event timeupdate - Emitted when playback time updates
 * @event volume - Emitted when volume changes
 * @event mute - Emitted when mute state changes
 * @event rate - Emitted when playback rate changes
 * @event seek - Emitted when seeking to a specific time
 */
export class ZAudio<T extends ZAudioEvents = ZAudioEvents> extends Mitt<T> {
  private _unlockCleanup?: () => void
  private _audioUnlocked: boolean = false
  private _autoSuspendTimer: ReturnType<typeof setTimeout> | undefined
  private _isEnding = false
  protected ctx: AudioContext | undefined
  protected sourceNode: MediaElementAudioSourceNode | undefined
  protected gainNode: GainNode | undefined
  protected nodes: AudioNode[] = []
  protected cleanup: VoidFunction[] = []
  protected options: Required<Omit<ZAudioOptions, 'mediaSession'>>
  protected ses: MediaSession | undefined
  public codecs: Codecs
  public audio: HTMLAudioElement = new Audio()
  public state: LoadingState = 'empty'
  public constructor(options: ZAudioOptions = {}) {
    super()
    this.codecs = getCodecs()
    this.options = {
      fadeDuration: 500,
      volume: 0.5,
      timeout: 10000,
      retryCount: 3,
      retryDelay: 1000,
      autoUnlock: true,
      autoSuspend: false,
      autoSuspendDelay: 30000,
      // @ts-expect-error polyfill
      getAudioContext: () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
      extraAudioNodes: () => [],
      ...options,
    }

    this.ses = options.mediaSession ? navigator?.mediaSession : undefined

    this.bindSession(2, () => this.play())
    this.bindSession(1, () => this.pause())
    this.bindSession(7, () => this.stop())
    this.bindSession(6, (detail) => detail.seekTime && this.seek(detail.seekTime))
    this.bindSession(
      5,
      (detail) => detail.seekOffset && this.seek(this.currentTime + detail.seekOffset),
    )
    this.bindSession(
      4,
      (detail) => detail.seekOffset && this.seek(this.currentTime - detail.seekOffset),
    )
    this.bindListener('ended', () => this.emit('ended'))
    this.bindListener('timeupdate', () => {
      this.emit('timeupdate', this.currentTime)

      if (!Number.isNaN(this.duration)) {
        this.ses?.setPositionState?.({
          duration: this.duration,
          position: this.currentTime,
          playbackRate: this.playbackRate,
        })
        if (this.fadeDuration > 0 && !this._isEnding) {
          const targetFadeDuration = (this.duration - this.currentTime) * 1e3
          if (targetFadeDuration < this.fadeDuration) {
            this._isEnding = true
            void this.fade(0, targetFadeDuration)
          }
        }
      }
    })

    this.ctx = this.options.getAudioContext()
    this.gainNode = this.ctx.createGain()
    this.gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime)
    this.sourceNode = this.ctx.createMediaElementSource(this.audio)
    this.gainNode.connect(this.ctx.destination)
    this.handleContext((ctx) => {
      const nodes = this.options.extraAudioNodes(ctx)
      return Array.isArray(nodes) ? nodes : nodes()
    })
    this._vol(this.volume)

    if (this.options.autoUnlock) {
      this._setupAutoUnlock()
    }
  }

  /**
   * Return the duration in seconds of the current media resource.
   * A NaN value is returned if duration is not available,
   * or Infinity if the media resource is streaming.
   */
  get duration(): number {
    return this.audio.duration
  }

  /**
   * Get a flag that specifies whether playback is playing.
   */
  get isPlaying(): boolean {
    return !this.audio.paused
  }

  /**
   * Get the current playback position, in seconds.
   */
  get currentTime(): number {
    return this.audio.currentTime
  }

  /**
   * Get the current rate of speed for the media resource to play.
   * This speed is expressed as a multiple of the normal speed of the media resource.
   */
  get playbackRate(): number {
    return this.audio.playbackRate
  }

  /**
   * Set the current rate of speed for the media resource to play.
   * This speed is expressed as a multiple of the normal speed of the media resource.
   *
   * Emit `"rate"` event
   */
  set playbackRate(rate: number) {
    this.audio.playbackRate = rate
    this.emit('rate', rate)
  }

  /**
   * Get the current volume for the media resource to play.
   * The value is between 0 and 1.
   */
  get volume(): number {
    return this.options.volume
  }

  /**
   * Set the current volume for the media resource to play.
   * The value is between 0 and 1.
   *
   * Emit `"volume"` event
   */
  set volume(volume: number) {
    volume = formatVolume(volume)
    this.options.volume = volume
    this._vol(volume)
    this.emit('volume', volume)
  }

  /**
   * Get a flag that indicates whether the audio
   * (either audio or the audio track on video media) is muted.
   */
  get muted(): boolean {
    return this.audio.muted
  }

  /**
   * Set a flag that indicates whether the audio
   * (either audio or the audio track on video media) is muted.
   *
   * Emit `"muted"` event
   */
  set muted(muted: boolean) {
    this.options.volume = muted ? 0 : this.audio.volume
    this.audio.muted = muted
    this.emit('mute', muted)
  }

  /**
   * Get the fade duration.
   */
  get fadeDuration(): number {
    return this.options.fadeDuration
  }

  /**
   * Set the fade duration.
   */
  set fadeDuration(duration: number) {
    this.options.fadeDuration = duration
    this.emit('fadeDuration', duration)
  }

  protected emitError(error: ZAudioError): false
  protected emitError(msg: string, code?: ZAudioErrorCode): false
  protected emitError(data: string | ZAudioError, code?: ZAudioErrorCode): false {
    this.state = 'error'
    if (data instanceof ZAudioError) {
      this.emit('error', data, data.code)
    } else {
      this.emit('error', new ZAudioError(code!, data), code!)
    }
    return false
  }

  protected bindSession<T extends EventIndex, _typeonly = (typeof sessionEvents)[T]>(
    eventIndex: T,
    handler: MediaSessionActionHandler,
  ): void {
    this.ses?.setActionHandler(sessionEvents[eventIndex], handler)
  }

  /**
   * Bind event listener
   * @param event event name
   * @param handler event listener
   */
  protected bindListener(event: keyof HTMLMediaElementEventMap, handler: EventListener): void {
    this.cleanup.push(bindEventListenerWithCleanup(this.audio, event, handler))
  }

  /**
   * Load audio with retry logic
   * @param src audio source URL
   * @param retryCount number of retry attempts
   * @param retryDelay delay between retries in milliseconds
   */
  protected async loadAudioWithRetry(
    audio: HTMLAudioElement,
    src: string,
    retry: {
      count?: number
      delay?: number
    } = {},
  ): Promise<boolean> {
    let lastError: { message: string; code: ZAudioErrorCode } | undefined
    const { count = this.options.retryCount, delay = this.options.retryDelay } = retry

    for (let attempt = 0; attempt <= count; attempt++) {
      if (attempt > 0) {
        await sleep(delay)
      }

      let _cleanup: VoidFunction | undefined
      const loadResult = await new Promise<boolean>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          _cleanup?.()
          lastError = {
            message: `Loading audio ${src} timeout after ${this.options.timeout}ms`,
            code: 2,
          }
          if (attempt < count) {
            resolve(false)
          } else {
            reject(new ZAudioError(lastError.code, lastError.message))
          }
        }, this.options.timeout)
        const cleanup1 = bindEventListenerWithCleanup(audio, 'canplay', () => resolve(true))
        const cleanup2 = bindEventListenerWithCleanup(audio, 'error', () => {
          const errorCode = (audio.error?.code || 0) as ZAudioErrorCode
          const errorMessage = audio.error?.message || 'Unknown audio error'
          lastError = { message: errorMessage, code: errorCode }
          // Network errors: code 2 (MEDIA_ERR_NETWORK)
          const isNetworkError = errorCode === 2
          if (isNetworkError && attempt < count) {
            resolve(false)
          } else {
            reject(new ZAudioError(errorCode, errorMessage))
          }
        })
        _cleanup = () => {
          cleanup1()
          cleanup2()
          clearTimeout(timeoutId)
        }
        audio.src = src
        audio.crossOrigin = 'anonymous'
        audio.load()
      }).catch((e) =>
        this.emitError(
          e instanceof ZAudioError ? e : new ZAudioError(-1, 'Unknown load error: ' + e),
        ),
      )
      _cleanup?.()

      if (loadResult) {
        return loadResult
      }

      // If it's not a network error, don't retry
      if (lastError && lastError.code !== 2) {
        break
      }
    }

    return false
  }

  protected extractExt(newSrc: string, mimeType?: string): string | undefined {
    if (newSrc.startsWith('blob:') && !mimeType) {
      this.emitError('Cannot extract extension from blob URL without MIME type')
      return undefined
    }
    return (
      mimeType?.split('/')[1]?.split(';')[0] ||
      newSrc.split('?', 1)[0].match(/\.([^.]+)$/)?.[1] ||
      newSrc.match(/^data:audio\/([^;]+);/i)?.[1]
    )
  }

  public handleContext(
    fn: (ctx: AudioContext, nodes: AudioNode[]) => AudioNode[] | undefined | void | null,
  ): void
  public handleContext(
    fn: (ctx: AudioContext, nodes: AudioNode[]) => Promise<AudioNode[] | undefined | void | null>,
  ): Promise<void>
  /**
   * Handle audio context and nodes. If return value is audio nodes, reconnect them to destination
   *
   * Do nothing if AudioContext is not created
   * @param fn Function to handle audio context and nodes
   */
  public handleContext(
    fn: (
      ctx: AudioContext,
      nodes: AudioNode[],
    ) => Promisable<AudioNode[] | undefined | void | null>,
  ): Promisable<void> {
    if (!this.ctx) {
      return
    }

    const reconnectNodes = (nodes: AudioNode[] | undefined | void | null): void => {
      if (!nodes) {
        return
      }

      this.sourceNode!.disconnect()
      this.nodes.forEach((node) => node.disconnect())

      if (!nodes.length) {
        this.sourceNode!.connect(this.gainNode!)
        this.nodes = []
        return
      }

      this.sourceNode!.connect(nodes[0])
      nodes.reduce((prev, curr) => (prev.connect(curr), curr))
      nodes[nodes.length - 1].connect(this.gainNode!)
      this.nodes = nodes
    }

    const result = fn(this.ctx, [...this.nodes])
    return result instanceof Promise ? result.then(reconnectNodes) : reconnectNodes(result)
  }

  /**
   * Load audio, auto play if isPlaying, audio is not loaded when the return value is `false`
   * @param metadata track info
   * @param options load options
   */
  public async load(metadata: Track, options: LoadOptions = {}): Promise<boolean> {
    const autoPlay = options.autoPlay ?? this.isPlaying
    if (this.isPlaying) {
      await this.stop()
    }

    const ext = this.extractExt(metadata.src, metadata.mimeType)

    if (!ext || !this.codecs.has(ext.toLowerCase())) {
      return this.emitError(`MIMETYPE ${ext} is unsupported`)
    }

    if (!this.ctx) {
      return this.emitError('Already destroyed')
    }

    if (this.ctx.state !== 'running') {
      await this.ctx.resume()
    }

    this.state = 'loading'
    this._isEnding = false

    const loadResult = await this.loadAudioWithRetry(this.audio, metadata.src, {
      count: options.retryCount,
      delay: options.retryDelay,
    })

    if (loadResult) {
      this.emit('load', metadata)

      if (this.ses) {
        this.ses.metadata = new MediaMetadata(metadata)
      }
      this.state = 'loaded'
      if (autoPlay) {
        if (options.startTime) {
          await this.seek(options.startTime)
        }
        return await this.play()
      }
      return loadResult
    }

    return false
  }

  /**
   * Play audio, audio will not play when the return value is `false`
   */
  public async play(): Promise<boolean> {
    if (this.isPlaying) {
      return true
    }
    this._clearAutoSuspend()
    if (!this.ctx || this.ctx.state === 'closed' || this.state !== 'loaded') {
      return false
    }
    try {
      // Resume AudioContext if suspended
      if (this.ctx.state !== 'running') {
        await this.ctx.resume()
      }

      this._isEnding = false

      if (this.ses) {
        this.ses.playbackState = 'playing'
      }

      await this.audio.play()
      this.emit('play')
      await this.fade(this.volume)
      return true
    } catch (e) {
      return this.emitError(`Failed to play audio, ${e}`)
    }
  }

  /**
   * Pause audio
   */
  public async pause(): Promise<void> {
    if (!this.isPlaying) {
      return
    }

    await this.fade(0)

    if (this.ses) {
      this.ses.playbackState = 'paused'
    }

    this.audio.pause()
    this.emit('pause')
    this._autoSuspend()
  }

  /**
   * Stop audio
   */
  public async stop(): Promise<void> {
    this._clearAutoSuspend()
    await this.pause()

    // Suspend context to save resources
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend()
    }

    this.audio.currentTime = 0
    if (this.ses) {
      this.ses.playbackState = 'none'
    }
    // Clear src to stop any ongoing downloads
    this.audio.src = ''
    this.audio.load()
    this.state = 'empty'
    this.emit('stop')
  }

  /**
   * Seek audio to specific time
   */
  public async seek(time: number): Promise<void> {
    time = clamp(0, time, this.duration)

    if (!this.isPlaying) {
      this.audio.currentTime = time
      this.emit('seek', time)
      return
    }

    const vol = this.volume
    const dur = this.fadeDuration / 2

    await this.fade(vol / 2, dur)
    this.audio.currentTime = time
    this.emit('seek', time)
    await this.fade(vol, dur)
  }

  /**
   * Fade audio's volume
   */
  public async fade(to: number, fadeDuration: number = this.fadeDuration): Promise<void> {
    if (fadeDuration <= 0 || !this.gainNode || !this.ctx) {
      this._vol(to)
      return
    }

    const currentTime = this.ctx.currentTime
    this.gainNode.gain
      // Cancel any existing scheduled fades and set current value
      .cancelScheduledValues(currentTime)
      // Schedule the fade in the audio graph
      .setValueCurveAtTime(
        [this.gainNode.gain.value, formatVolume(to)],
        currentTime,
        fadeDuration / 1e3,
      )

    // Wait for fade to complete
    await sleep(fadeDuration)
  }

  /**
   * Destroy instance
   */
  public async destroy(): Promise<void> {
    this._clearAutoSuspend()
    await this.stop()
    await this.ctx?.close()
    if (this.ses) {
      this.ses.playbackState = 'none'
      sessionEvents.forEach((e) => this.ses!.setActionHandler(e, null))
    }
    this.cleanup.forEach((c) => c())
    this.cleanup = null!
    this.nodes?.forEach((n) => {
      try {
        n.disconnect()
      } catch {}
    })
    this.nodes = null!
    this.audio = null!
    this.ctx = null!
    this.gainNode = null!
    this.off()
  }

  /**
   * Update volume internally
   */
  private _vol(v: number): number {
    const currentTime = this.ctx!.currentTime
    this.gainNode!.gain.cancelScheduledValues(currentTime).setValueAtTime(v, currentTime)
    return currentTime
  }

  /**
   * Setup auto unlock for mobile browsers
   */
  private _setupAutoUnlock(): void {
    if (this._audioUnlocked || typeof document === 'undefined') {
      return
    }

    const unlock = () => {
      if (this._audioUnlocked) {
        return
      }

      if (this.ctx!.state === 'suspended') {
        this.ctx!.resume()
          .then(() => {
            this._audioUnlocked = true
            this._clearUnlock()
          })
          .catch(() => {
            // Retry on next interaction
          })
      } else {
        this._audioUnlocked = true
        this._clearUnlock()
      }
    }

    // Listen for user interactions with capture phase
    const cleanup1 = bindEventListenerWithCleanup(document, 'touchstart', unlock, true)
    const cleanup2 = bindEventListenerWithCleanup(document, 'touchend', unlock, true)
    const cleanup3 = bindEventListenerWithCleanup(document, 'click', unlock, true)
    const cleanup4 = bindEventListenerWithCleanup(document, 'keydown', unlock, true)

    // Store combined cleanup function
    this._unlockCleanup = () => {
      cleanup1()
      cleanup2()
      cleanup3()
      cleanup4()
    }
  }

  /**
   * Remove unlock event listeners
   */
  private _clearUnlock(): void {
    if (this._unlockCleanup) {
      this._unlockCleanup()
      this._unlockCleanup = undefined
    }
  }

  /**
   * Schedule auto suspend of audio context after delay
   */
  private _autoSuspend(): void {
    this._clearAutoSuspend()
    if (this.options.autoSuspend && this.ctx && this.ctx.state !== 'closed') {
      this._autoSuspendTimer = setTimeout(async () => {
        if (this.ctx && this.ctx.state === 'running' && !this.isPlaying) {
          await this.ctx.suspend()
        }
      }, this.options.autoSuspendDelay)
    }
  }

  /**
   * Clear auto suspend timer
   */
  private _clearAutoSuspend(): void {
    if (this._autoSuspendTimer) {
      clearTimeout(this._autoSuspendTimer)
      this._autoSuspendTimer = undefined
    }
  }
}
