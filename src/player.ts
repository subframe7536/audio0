import type {
  LoadOptions,
  LoopMode,
  ShuffleFn,
  StreamTrack,
  Track,
  ZPlayerEvents,
  ZPlayerOptions,
} from './types'

import { ZAudio } from './audio'
import { defaultShuffle } from './utils/shuffle'
import { isStreamTrack, useStreamURL } from './utils/stream'

export class ZPlayer extends ZAudio<ZPlayerEvents> {
  private currentIndex = 0
  private _orderList: number[] = []
  private _trackList: (Track | StreamTrack)[] = []
  private _loopMode: LoopMode = 'list'
  public shuffleFn: ShuffleFn = defaultShuffle
  private streamCleanup?: () => void

  constructor(config: ZPlayerOptions = {}) {
    const { autoNext, trackList, shuffleFn, loopMode = 'list', ...audioConfig } = config
    super(audioConfig)
    this.bindSession(3, () => this.prevTrack())
    this.bindSession(0, () => this.nextTrack())
    this._loopMode = loopMode
    if (trackList) {
      this.trackList = trackList
    }
    if (autoNext) {
      this.on('ended', () => this.nextTrack(typeof autoNext === 'object' ? autoNext : undefined))
    }
  }

  get currentTrack(): Track | StreamTrack {
    return this._trackList[this._orderList[this.currentIndex]]
  }

  get trackList(): (Track | StreamTrack)[] {
    return this._orderList.map(i => this._trackList[i])
  }

  set trackList(list: (Track | StreamTrack)[]) {
    this._trackList = list
    this.reorder()
  }

  get loopMode(): LoopMode {
    return this._loopMode
  }

  set loopMode(mode: LoopMode) {
    this._loopMode = mode
    if (!this.trackList.length) {
      return
    }
    this.reorder()
  }

  /**
   * Get track by index, return current track if index is absent
   */
  public getTrack(index = this.currentIndex): Track | StreamTrack | false | undefined {
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
  public reorder(shuffle = this._loopMode === 'random'): void {
    this.emit('reorder')
    this._orderList = shuffle
      ? this.shuffleFn(this._trackList)
      : Array.from({ length: this._trackList.length }, (_, i) => i)
  }

  /**
   * Load track in track list
   * @param index track index
   * @param options load options
   */
  public async loadTrack(index?: number, options?: LoadOptions): Promise<boolean> {
    if (index) {
      this.currentIndex = Math.abs((index + this.trackList.length) % this.trackList.length)
    }
    const track = this.getTrack()

    if (!track) {
      return false
    }

    if (this.streamCleanup) {
      this.streamCleanup()
      this.streamCleanup = undefined
    }

    let result
    if (isStreamTrack(track)) {
      const [src, cleanup] = useStreamURL(await track.src(), track.mimeType)
      this.streamCleanup = cleanup
      result = await super.load(
        { ...track, src },
        { mimeType: track.mimeType, ...options },
      )
    } else {
      result = await super.load(track, options)
    }
    if (result) {
      this.emit('loadTrack', this.currentIndex, track)
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
    if (this.streamCleanup) {
      this.streamCleanup()
    }
    await super.destroy()
    this._orderList = []
    this.trackList = []
  }
}
