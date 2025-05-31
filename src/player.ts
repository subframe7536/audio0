import type {
  LoadOptions,
  LoopMode,
  ParsedTrackInfo,
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
  private currentIndex = 0
  private _orderList: number[] = []
  private _trackList: TrackLike[] = []
  private _loopMode: number = 0
  public shuffleFn: ShuffleFn = defaultShuffle
  private streamCleanup?: () => void

  constructor(config: ZPlayerOptions = {}) {
    const { autoNext, trackList, shuffleFn, loopMode = 'list', ...audioConfig } = config
    super(audioConfig)
    this.bindSession(3, () => this.prevTrack())
    this.bindSession(0, () => this.nextTrack())
    this._loopMode = LOOP_MODE.indexOf(loopMode)
    if (trackList) {
      this.trackList = trackList
    }
    if (autoNext) {
      this.on('ended', () => this.nextTrack(typeof autoNext === 'object' ? autoNext : undefined))
    }
  }

  get currentTrack(): TrackLike {
    return this._trackList[this._orderList[this.currentIndex]]
  }

  get trackList(): TrackLike[] {
    return this._orderList.map(i => this._trackList[i])
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
  public getTrack(index = this.currentIndex): TrackLike | false | undefined {
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
  public reorder(shuffle = this._loopMode === 2): void {
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
   * Loads a track at the specified index or the current track if no index is provided.
   * Handles different types of tracks including streams, buffers, and regular audio sources.
   *
   * @param index Index of the track to load. Will wrap around if outside the track list bounds.
   * @param options Loading options to be passed to the underlying load method.
   */
  public async loadTrack(index?: number, options?: LoadOptions): Promise<boolean> {
    // Use index >= 0 to allow index 0
    if (typeof index === 'number') {
      this.currentIndex = Math.abs((index + this.trackList.length) % this.trackList.length)
    }
    const track = this.getTrack()
    if (!track) {
      return false
    }

    // Cleanup previous stream if needed
    this.streamCleanup?.()
    this.streamCleanup = undefined

    let info: ParsedTrackInfo
    const mimeType = track.mimeType || ''

    switch (track.type) {
      case 'stream': {
        if (!window.MediaSource) {
          return this.emitError('Unsupported platform')
        } else if (!MediaSource.isTypeSupported(mimeType)) {
          return this.emitError(`Unsupported mime type: ${mimeType}`)
        } else {
          const [src, cleanup] = useStream(
            await track.src(),
            mimeType,
            err => this.emitError(err, 5),
          )
          this.streamCleanup = cleanup
          info = { ...track, src }
        }
        break
      }
      case 'buffer': {
        const [src, cleanup] = useArrayBuffer(await track.src(), mimeType)
        this.streamCleanup = cleanup
        info = { ...track, src }
        break
      }
      default: {
        info = track
      }
    }
    const result = await super.load(info, { mimeType, ...options })
    if (result) {
      this.emit('loadTrack', this.currentIndex, info)
    }
    return result
  }

  public async prevTrack(options?: LoadOptions): Promise<boolean> {
    if (this.trackList.length > 1 && this.loopMode !== 'single') {
      this.currentIndex--
    }
    return await this.loadTrack(this.currentIndex, options)
  }

  public async nextTrack(options?: LoadOptions): Promise<boolean> {
    if (this.trackList.length > 1 && this.loopMode !== 'single') {
      this.currentIndex++
    }
    return await this.loadTrack(this.currentIndex, options)
  }

  public async destroy(): Promise<void> {
    this.streamCleanup?.()
    await super.destroy()
    this._orderList = []
    this.trackList = []
  }
}
