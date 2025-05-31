import type {
  Codecs,
  LoadingState,
  LoadOptions,
  ParsedTrackInfo,
  ZAudioErrorCode,
  ZAudioEvents,
  ZAudioOptions,
} from './types'
import type { Promisable } from '@subframe7536/type-utils'

import { Mitt } from 'zen-mitt/class'

import { ZAudioError } from './types'
import { bindEventListenerWithCleanup, clamp, formatVolume, getCodecs, sleep } from './utils/common'

/// keep-sorted
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
 * @remarks
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
  private ctx: AudioContext | undefined
  private sourceNode: MediaElementAudioSourceNode | undefined
  private gainNode: GainNode | undefined
  private nodes: AudioNode[] = []
  protected cleanup: VoidFunction[] = []
  protected isEnding = false
  protected options: Required<Omit<ZAudioOptions, 'mediaSession'>>
  protected ses: MediaSession | undefined
  public codecs: Codecs
  public audio = new Audio()
  public state: LoadingState = 'empty'
  public constructor(options: ZAudioOptions = {}) {
    super()
    this.codecs = getCodecs()
    this.options = {
      fadeDuration: 500,
      volume: 0.5,
      timeout: 10000,
      // @ts-expect-error polyfill
      getAudioContext: () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
      extraAudioNodes: () => [],
      ...options,
    }

    this.ses = options.mediaSession ? navigator?.mediaSession : undefined

    this.bindSession(2, () => this.play())
    this.bindSession(1, () => this.pause())
    this.bindSession(7, () => this.stop())
    this.bindSession(6, detail => detail.seekTime && this.seek(detail.seekTime))
    this.bindSession(5, detail => detail.seekOffset && this.seek(this.currentTime + detail.seekOffset))
    this.bindSession(4, detail => detail.seekOffset && this.seek(this.currentTime - detail.seekOffset))
    this.bindListener('ended', () => this.emit('ended'))
    this.bindListener('timeupdate', () => {
      this.ses?.setPositionState?.({
        duration: this.duration,
        position: this.currentTime,
        playbackRate: this.playbackRate,
      })

      this.emit('timeupdate', this.currentTime)
      if (this.fadeDuration > 0 && !this.isEnding) {
        const targetFadeDuration = (this.duration - this.currentTime) * 1e3
        if (targetFadeDuration < this.fadeDuration) {
          this.isEnding = true
          this.fade(this.gainNode!.gain.value, 0, targetFadeDuration)
        }
      }
    })
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
    this.setVolume(volume)
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

  private setVolume(v: number): number {
    const currentTime = this.ctx!.currentTime
    this.gainNode!
      .gain
      .cancelScheduledValues(currentTime)
      .setValueAtTime(v, currentTime)
    return currentTime
  }

  protected emitError(msg: string, code: ZAudioErrorCode = -1): false {
    this.state = 'error'
    this.emit('error', new ZAudioError(code, msg), code)
    return false
  }

  protected bindSession<T extends EventIndex, _typeonly = typeof sessionEvents[T]>(
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

  public handleContext(
    fn: (
      ctx: AudioContext,
      nodes: AudioNode[]
    ) => AudioNode[] | undefined | void | null,
  ): void
  public handleContext(
    fn: (
      ctx: AudioContext,
      nodes: AudioNode[]
    ) => Promise<AudioNode[] | undefined | void | null>,
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
      nodes: AudioNode[]
    ) => Promisable<AudioNode[] | undefined | void | null>,
  ): Promisable<void> {
    if (!this.ctx) {
      return
    }

    const reconnectNodes = (
      nodes: AudioNode[] | undefined | void | null,
    ): void => {
      if (!nodes) {
        return
      }

      this.sourceNode!.disconnect()
      this.nodes.forEach(node => node.disconnect())

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
    return result instanceof Promise
      ? result.then(reconnectNodes)
      : reconnectNodes(result)
  }

  /**
   * Load audio, auto play if isPlaying, audio is not loaded when the return value is `false`
   * @param metadata track info
   * @param options load options
   */
  public async load(metadata: ParsedTrackInfo, options: LoadOptions = {}): Promise<boolean> {
    const autoPlay = options.autoPlay ?? this.isPlaying
    if (this.isPlaying) {
      await this.stop()
    }

    const newSrc = metadata.src
    const ext = newSrc.split('?', 1)[0].match(/\.([^.]+)$/)?.[1]
      || options.mimeType?.split('/')[1]?.split(';')[0]
      || newSrc.match(/^data:audio\/([^;]+);/i)?.[1]

    if (!ext || !this.codecs.has(ext.toLowerCase())) {
      return this.emitError(`MIMETYPE ${ext} is unsupported`)
    }

    if (!this.ctx) {
      this.ctx = this.options.getAudioContext()
      this.gainNode = this.ctx.createGain()
      this.gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime)
      this.sourceNode = this.ctx.createMediaElementSource(this.audio)
      this.gainNode.connect(this.ctx.destination)
      this.handleContext((ctx) => {
        const nodes = this.options.extraAudioNodes(ctx)
        return Array.isArray(nodes) ? nodes : nodes()
      })
      this.setVolume(this.volume)
    }
    await this.ctx.suspend()

    this.state = 'loading'
    this.isEnding = false

    let _cleanup: VoidFunction | undefined
    const loadResult = await new Promise<boolean>((resolve) => {
      let _timeout = this.options.timeout
      const timeoutId = setTimeout(() => {
        _cleanup?.()
        resolve(
          this.emitError(`Loading audio ${newSrc} timeout after ${_timeout}ms`, 2),
        )
      }, _timeout)
      const cleanup1 = bindEventListenerWithCleanup(this.audio, 'canplay', () => resolve(true))
      const cleanup2 = bindEventListenerWithCleanup(this.audio, 'error', () => {
        this.state = 'error'
        resolve(
          this.emitError(
            this.audio.error?.message || 'Unknown audio error',
            (this.audio.error?.code || 0) as ZAudioErrorCode,
          ),
        )
      })
      _cleanup = () => {
        cleanup1()
        cleanup2()
        clearTimeout(timeoutId)
      }
      this.audio.src = newSrc
      this.audio.crossOrigin = 'anonymous'
      this.audio.load()
    }).catch(e => this.emitError(e.toString(), 0))
    _cleanup?.()

    if (!loadResult) {
      return false
    }
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

  /**
   * Play audio, audio will not play when the return value is `false`
   */
  public async play(): Promise<boolean> {
    if (this.isPlaying) {
      return true
    }
    if (!this.ctx || this.state !== 'loaded') {
      return false
    }
    try {
      // @ts-expect-error https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state#resuming_interrupted_play_states_in_ios_safari
      if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
        await this.ctx.resume()
      }
      this.isEnding = false
      this.setVolume(0)
      if (this.ses) {
        this.ses.playbackState = 'playing'
      }
      await this.audio.play()
      this.emit('play')
      await this.fade(0, this.volume)
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
    await this.fade(this.volume, 0)
    if (this.ses) {
      this.ses.playbackState = 'paused'
    }
    await this.ctx?.suspend()
    this.audio.pause()
    this.emit('pause')
  }

  /**
   * Stop audio
   */
  public async stop(): Promise<void> {
    await this.pause()
    this.audio.currentTime = 0
    if (this.ses) {
      this.ses.playbackState = 'none'
    }
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
      return
    }
    const vol = this.volume
    const dur = this.fadeDuration / 2
    await this.fade(vol, vol / 2, dur)
    this.audio.currentTime = time
    this.emit('seek', time)
    await this.fade(vol / 2, vol, dur)
  }

  /**
   * Fade audio's volume
   */
  public async fade(
    from: number,
    to: number,
    fadeDuration = this.fadeDuration,
  ): Promise<void> {
    if (fadeDuration <= 0) {
      this.setVolume(to)
      return
    }
    const currentTime = this.setVolume(formatVolume(from))
    this.gainNode?.gain.linearRampToValueAtTime(
      formatVolume(to),
      currentTime + fadeDuration / 1e3,
    )
    await sleep(fadeDuration)
  }

  /**
   * Destroy instance
   */
  public async destroy(): Promise<void> {
    await this.pause()
    await this.ctx?.close()
    if (this.ses) {
      this.ses.playbackState = 'none'
      sessionEvents.forEach(e => this.ses!.setActionHandler(e, null))
    }
    this.cleanup.forEach(c => c())
    this.cleanup = null!
    this.nodes?.forEach(n => n.disconnect())
    this.nodes = null!
    this.audio = null!
    this.ctx = null!
    this.gainNode = null!
    this.off()
  }
}
