import type {
  LoadOptions,
  LoopMode,
  ParsedTrackInfo,
  PreloadConfig,
  ShuffleFn,
  TrackLike,
  ZPlayerEvents,
  ZPlayerOptions,
} from './types'

import { ZAudio } from './audio'
import { LOOP_MODE } from './types'
import { useArrayBuffer } from './utils/buffer'
import { defaultShuffle } from './utils/shuffle'
import { useStream } from './utils/stream'

export class ZPlayer extends ZAudio<ZPlayerEvents> {
  public shuffleFn: ShuffleFn
  private _curIdx = 0
  private _orderList: number[] = []
  private _trackList: TrackLike[] = []
  private _loopMode: number = 0
  private _streamCleanup?: () => void
  private _preload: {
    config: PreloadConfig
    track: (ParsedTrackInfo & { index: number; mimeType: string; audio: HTMLAudioElement }) | null
    triggered: boolean
  } = {
    config: { enable: true, threshold: 80 },
    track: null,
    triggered: false,
  }

  constructor(config: ZPlayerOptions = {}) {
    const {
      autoNext,
      trackList,
      shuffleFn = defaultShuffle,
      loopMode = 'list',
      preload = true,
      ...audioConfig
    } = config
    super(audioConfig)
    this.bindSession(3, () => this.prevTrack())
    this.bindSession(0, () => this.nextTrack())
    this._loopMode = LOOP_MODE.indexOf(loopMode)
    this.shuffleFn = shuffleFn
    this.setPreloadConfig(preload)

    if (trackList) {
      this.trackList = trackList
    }
    if (autoNext) {
      this.on('ended', () => this.nextTrack(typeof autoNext === 'object' ? autoNext : undefined))
    }
  }

  get currentTrack(): TrackLike {
    return this._trackList[this._orderList[this._curIdx]]
  }

  get trackList(): TrackLike[] {
    return this._orderList.map((i) => this._trackList[i])
  }

  set trackList(list: TrackLike[]) {
    this._trackList = list
    this.reorder()
  }

  get loopMode(): LoopMode {
    return LOOP_MODE[this._loopMode]
  }

  /**
   * Get track by index, return current track if index is absent
   */
  public addTrack(...track: TrackLike[]): void {
    this._trackList.push(...track)
  }

  /**
   * Get track by index, return current track if index is absent
   */
  public getTrack(index: number = this._curIdx): TrackLike | false | undefined {
    if (index < 0 || (this.trackList.length && index > this.trackList.length)) {
      return this.emitError(`Invalid track index: ${index}`)
    }
    const track = this.trackList[this._orderList[index]]
    if (!track) {
      return this.emitError('No track data, please load track first')
    }
    return track
  }

  /**
   * Reorder track list
   */
  public reorder(shuffle: boolean = this._loopMode === 2): void {
    this.emit('reorder')
    this._orderList = shuffle
      ? this.shuffleFn(this._trackList)
      : Array.from({ length: this._trackList.length }, (_, i) => i)
  }

  /**
   * Changes the loop mode of the player.
   * If a mode is provided, sets the loop mode to that value.
   * If no mode is provided, cycles through the loop modes in sequence.
   * After changing the mode, reorders the playlist according to the new loop mode.
   *
   * @param mode The specific loop mode to set. If not provided, cycles to next mode.
   */
  public changeLoopMode(mode?: LoopMode): void {
    if (mode) {
      const idx = LOOP_MODE.indexOf(mode)
      this._loopMode = idx === -1 ? 0 : idx
    } else {
      this._loopMode = (this._loopMode + 1) % 3
    }
    this.reorder()
  }

  /**
   * Preload the next track in the background
   */
  private async preloadNextTrack(): Promise<void> {
    if (!this._preload.config || this.trackList.length <= 1) {
      return
    }

    const connection = (navigator as any).connection
    if (connection?.saveData || connection?.effectiveType === 'slow-2g') {
      return
    }

    const nextIndex = this.getNextTrackIndex()
    if (nextIndex === this._curIdx) {
      return // No next track to preload (single track or single loop mode)
    }

    const nextTrack = this.getTrack(nextIndex)
    if (!nextTrack) {
      return
    }

    try {
      // Clean up any existing preloaded track
      this.cleanupPreloadedTrack()

      // Create new audio element for preloading
      const preloadAudio = new Audio()

      const { info, mimeType } = await this.parseTrack(nextTrack)
      await this.loadAudioWithRetry(preloadAudio, info.src)

      this._preload.track = {
        ...info,
        mimeType,
        index: nextIndex,
        audio: preloadAudio,
      }
    } catch (error) {
      // Silently fail preloading, it's not critical
      console.warn('Failed to preload next track:', error)
    }
  }

  /**
   * Get the index of the next track based on current loop mode
   */
  private getNextTrackIndex(): number {
    if (this.loopMode === 'single') {
      return this._curIdx
    }

    return (this._curIdx + 1) % this.trackList.length
  }

  /**
   * Clean up preloaded track resources
   */
  private cleanupPreloadedTrack(): void {
    if (this._preload.track) {
      this._preload.track.audio.src = ''
      this._preload.track.audio.load()
      this._preload.track = null
    }
  }

  /**
   * Check if we can use a preloaded track for faster loading
   */
  private canUsePreloadedTrack(index: number): boolean {
    return (
      this._preload.track !== null &&
      this._preload.track.index === index &&
      this._preload.track.audio.readyState >= 2
    ) // HAVE_CURRENT_DATA
  }

  /**
   * Loads a track at the specified index or the current track if no index is provided.
   * Handles different types of tracks including streams, buffers, and regular audio sources.
   *
   * @param index Index of the track to load. Will wrap around if outside the track list bounds.
   * @param options Loading options to be passed to the underlying load method.
   */
  public async loadTrack(index?: number, options?: LoadOptions): Promise<boolean> {
    // Use index >= 0 to allow index 0
    if (typeof index === 'number') {
      this._curIdx = Math.abs((index + this.trackList.length) % this.trackList.length)
    }

    // Check if we can use preloaded track for faster loading
    if (this.canUsePreloadedTrack(this._curIdx)) {
      const preloaded = this._preload.track!
      const ext = this.extractExt(preloaded.src, preloaded.mimeType)

      if (!ext || !this.codecs.has(ext.toLowerCase())) {
        return this.emitError(`MIMETYPE ${ext} is unsupported`)
      }

      // Use preloaded audio element
      const oldAudio = this.audio
      this.audio = preloaded.audio

      // Clean up old audio
      oldAudio.src = ''
      oldAudio.load()

      // Update audio context source
      if (this.sourceNode && this.ctx) {
        this.sourceNode.disconnect()
        this.sourceNode = this.ctx.createMediaElementSource(this.audio)
        if (this.nodes.length > 0) {
          this.sourceNode.connect(this.nodes[0])
        } else {
          this.sourceNode.connect(this.gainNode!)
        }
      }

      this._preload.track = null
      this.state = 'loaded'
      this.emit('loadTrack', this._curIdx, preloaded)
      return true
    }

    const track = this.getTrack()
    if (!track) {
      return false
    }

    // Cleanup previous stream if needed
    const { info, mimeType } = await this.parseTrack(track)
    const result = await this.load(info, { mimeType, ...options })
    if (result) {
      this.emit('loadTrack', this._curIdx, info)
    }
    return result
  }

  private async parseTrack(track: TrackLike): Promise<{ info: ParsedTrackInfo; mimeType: string }> {
    this._streamCleanup?.()
    this._streamCleanup = undefined

    let info: ParsedTrackInfo
    const mimeType = track.mimeType || ''

    switch (track.type) {
      case 'stream': {
        const [src, cleanup] = useStream(await track.src(), mimeType, (err) =>
          this.emitError(err, 5),
        )
        this._streamCleanup = cleanup
        info = { ...track, src }
        break
      }
      case 'buffer': {
        const [src, cleanup] = useArrayBuffer(await track.src(), mimeType)
        this._streamCleanup = cleanup
        info = { ...track, src }
        break
      }
      default: {
        info = track
      }
    }
    return { info, mimeType }
  }

  public async prevTrack(options?: LoadOptions): Promise<boolean> {
    if (this.trackList.length > 1 && this.loopMode !== 'single') {
      this._curIdx--
    }
    return await this.loadTrack(this._curIdx, options)
  }

  public async nextTrack(options?: LoadOptions): Promise<boolean> {
    if (this.trackList.length > 1 && this.loopMode !== 'single') {
      this._curIdx++
    }
    return await this.loadTrack(this._curIdx, options)
  }

  /**
   * Update preload configuration
   */
  public setPreloadConfig(config: boolean | PreloadConfig): void {
    this._preload.config = typeof config === 'boolean' ? { enable: config, threshold: 80 } : config

    const onTimeUpdate = (currentTime: number) => {
      if (this._preload.triggered || !this.duration) {
        return
      }

      const progress = (currentTime / this.duration) * 100
      if (progress >= this._preload.config.threshold) {
        this._preload.triggered = true
        void this.preloadNextTrack()
      }
    }

    const onTrackLoaded = () => {
      this._preload.triggered = false
      this.cleanupPreloadedTrack()
    }

    if (this._preload.config.enable) {
      this.on('timeupdate', onTimeUpdate)
      this.on('loadTrack', onTrackLoaded)
    } else {
      // Clean up preloaded track if preloading is disabled
      this.off('timeupdate', onTimeUpdate)
      this.off('loadTrack', onTrackLoaded)
      // Reset preload trigger when loading a new track
      this.cleanupPreloadedTrack()
      this._preload.triggered = false
    }
  }

  public async destroy(): Promise<void> {
    this._streamCleanup?.()
    this.cleanupPreloadedTrack()
    await super.destroy()
    this._orderList = []
    this.trackList = []
  }
}
