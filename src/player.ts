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
import { defaultShuffle, parseTrack } from './utils'

export class ZPlayer extends ZAudio<ZPlayerEvents> {
  public shuffleFn: ShuffleFn
  private _curIdx = 0
  private _orderList: number[] = []
  private _trackList: TrackLike[] = []
  private _loopMode: number = 0
  /**
   * Cleanup for stream and buffer
   */
  private _cleanup?: () => void
  private _preload = {
    enable: true,
    threshold: 80,
    audio: null as HTMLAudioElement | null,
    trackIndex: null as number | null,
    triggered: false,
    info: null as ParsedTrackInfo | null,
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
    if (index < 0 || (this.trackList.length && index >= this.trackList.length)) {
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
    if (!this._preload.enable || this.trackList.length <= 1) {
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

      // Create audio element if needed
      if (!this._preload.audio) {
        this._preload.audio = new Audio()
      }

      const info = await this._parseTrack(nextTrack)
      await this.loadAudioWithRetry(this._preload.audio, info.src)

      this._preload.trackIndex = nextIndex
      this._preload.info = info
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
    if (this._preload.trackIndex !== null && this._preload.audio) {
      this._preload.audio.src = ''
      this._preload.audio.load()
      this._preload.trackIndex = null
      this._preload.info = null
    }
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

    const loadAndEmit = async (info: ParsedTrackInfo): Promise<boolean> => {
      const result = await this.load(info, options)
      if (result) {
        this.emit('loadTrack', this._curIdx, info)
      }
      return result
    }

    // Check if we can use preloaded track data
    if (this._preload.enable && this._preload.trackIndex === this._curIdx && this._preload.info) {
      // Clean up preload data since we're using it
      this.cleanupPreloadedTrack()
      this._preload.triggered = false

      return await loadAndEmit(this._preload.info as Awaited<ReturnType<typeof this._parseTrack>>)
    }

    const track = this.getTrack()
    if (!track) {
      return false
    }

    return await loadAndEmit(await this._parseTrack(track))
  }

  private async _parseTrack(track: TrackLike): Promise<ParsedTrackInfo> {
    this._cleanup?.()
    this._cleanup = undefined
    if (typeof track.src === 'string') {
      return track as ParsedTrackInfo
    }
    const src = typeof track.src === 'function' ? await track.src() : track.src
    const { url, mime, cleanup } = parseTrack(src as any, track.mimeType as any, (msg) =>
      this.emitError(msg, 5),
    )
    this._cleanup = cleanup
    return {
      ...track,
      src: url,
      mimeType: mime,
    }
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
    if (typeof config === 'boolean') {
      this._preload.enable = config
      this._preload.threshold = 80
    } else {
      this._preload.enable = config.enable
      this._preload.threshold = config.threshold
    }

    const onTimeUpdate = (currentTime: number) => {
      if (this._preload.triggered || !this.duration) {
        return
      }

      const progress = (currentTime / this.duration) * 100
      if (progress >= this._preload.threshold) {
        this._preload.triggered = true
        void this.preloadNextTrack()
      }
    }

    if (this._preload.enable) {
      this.on('timeupdate', onTimeUpdate)
    } else {
      // Clean up preloaded track if preloading is disabled
      this.off('timeupdate', onTimeUpdate)
      // Reset preload trigger when loading a new track
      this.cleanupPreloadedTrack()
      this._preload.triggered = false
    }
  }

  public async destroy(): Promise<void> {
    this._cleanup?.()
    this.cleanupPreloadedTrack()
    await super.destroy()
    this._orderList = []
    this.trackList = []
  }
}
