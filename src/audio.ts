import { Mitt } from 'zen-mitt'
import type { Promisable } from '@subframe7536/type-utils'
import { bindEventListenerWithCleanup, clamp, formatVolume, getCodecs, sleep } from './utils'
import { type Codecs, type LoadOptions, type LoadingState, type Track, ZAudioError, type ZAudioErrorCode, type ZAudioEvents, type ZAudioOptions } from './types'

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

  get duration(): number {
    return this.audio.duration || 0
  }

  get isPlaying(): boolean {
    return !this.audio.paused
  }

  get currentTime(): number {
    return this.audio.currentTime
  }

  get playbackRate(): number {
    return this.audio.playbackRate
  }

  set playbackRate(rate: number) {
    this.audio.playbackRate = rate
    this.emit('rate', rate)
  }

  get volume(): number {
    return this.options.volume
  }

  set volume(volume: number) {
    volume = formatVolume(volume)
    this.options.volume = volume
    this.setVolume(volume)
    this.emit('volume', volume)
  }

  get muted(): boolean {
    return this.audio.muted
  }

  set muted(muted: boolean) {
    this.options.volume = muted ? 0 : this.audio.volume
    this.audio.muted = muted
    this.emit('mute', muted)
  }

  get fadeDuration(): number {
    return this.options.fadeDuration
  }

  set fadeDuration(duration: number) {
    this.options.fadeDuration = duration
  }

  private setVolume(v: number, cb?: (time: number) => void): void {
    const currentTime = this.ctx!.currentTime
    this.gainNode!.gain.cancelAndHoldAtTime(currentTime)
    this.gainNode!.gain.setValueAtTime(v, currentTime)
    cb?.(currentTime)
  }

  protected emitError(msg: string, code: ZAudioErrorCode = -1): false {
    this.state = 'error'
    this.emit('error', code, new ZAudioError(code, msg))
    return false
  }

  protected bindSession<T extends EventIndex, _typeonly = typeof sessionEvents[T]>(eventIndex: T, handler: MediaSessionActionHandler): void {
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
   * Handle audio context and nodes. If return value is audio nodes, reconnect them to destination
   *
   * Will do nothing if audio context is not created
   */
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
  public handleContext(
    fn: (
      ctx: AudioContext,
      nodes: AudioNode[]
    ) => Promisable<AudioNode[] | undefined | void | null>,
  ): Promisable<void> {
    const conn = (nodes: AudioNode[] | undefined | void | null): void => {
      const len = nodes?.length
      if (!len) {
        return
      }
      this.sourceNode!.disconnect()
      for (let i = 0; i < this.nodes.length; i++) {
        this.nodes[i].disconnect()
      }
      this.sourceNode!.connect(nodes[0])
      for (let i = 0; i < len - 1; i++) {
        nodes[i].connect(nodes[i + 1])
      }
      nodes[len - 1].connect(this.gainNode!)
      this.nodes = nodes
    }
    if (!this.ctx) {
      return
    }
    const result = fn(this.ctx, this.nodes)
    if (result instanceof Promise) {
      result.then(nodes => conn(nodes))
    } else {
      conn(result)
    }
  }

  /**
   * Load audio, auto play if isPlaying, audio is not loaded when the return value is `false`
   * @param metadata track info
   * @param options load options
   */
  public async load(metadata: Track, options: LoadOptions = {}): Promise<boolean> {
    const newSrc = metadata.src

    const ext = newSrc.match(/^data:audio\/([^;]+);/i)?.[1]
      || options.mimeType?.split('/')[1]
      || newSrc.split('.').pop()

    if (!ext || !this.codecs.has(ext)) {
      return this.emitError('No mime type or unsupported')
    }

    const autoPlay = options.autoPlay ?? this.isPlaying
    if (autoPlay) {
      await this.stop()
    }

    if (!this.ctx) {
      this.ctx = this.options.getAudioContext()
      this.gainNode = this.ctx.createGain()
      this.gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime)
      this.sourceNode = this.ctx.createMediaElementSource(this.audio)
      this.gainNode.connect(this.ctx.destination)
      this.handleContext(ctx => this.options.extraAudioNodes(ctx))
      this.setVolume(this.volume)
    }
    await this.ctx?.suspend()

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
      if (this.ctx.state === 'suspended') {
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
    from = formatVolume(from)
    to = formatVolume(to)
    const fadeSeconds = fadeDuration / 1e3
    this.setVolume(
      from,
      currentTime => this.gainNode!.gain.setValueCurveAtTime(
        [from, (from + to) / 1.5, to],
        currentTime,
        fadeSeconds,
      ),
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
