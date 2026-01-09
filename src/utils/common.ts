/* eslint-disable prefer-template */
import type { Promisable } from '@subframe7536/type-utils'
import type { Codecs } from '../types'

export function getCodecs(): Codecs {
  let testAudio = new Audio()
  const checkAudioMime = (mime: string): boolean => !!testAudio.canPlayType('audio/' + mime)

  const ua = globalThis.navigator.userAgent
  const isSafari = ua.includes('Safari') && !ua.includes('Chrome')
  const safariVersion = ua.match(/Version\/(.*?) /)
  const isOldSafari = isSafari && safariVersion && Number.parseInt(safariVersion[1]) < 16

  const mpegTest = checkAudioMime('mpeg')
  const aacTest = checkAudioMime('aac')
  const resultSet: Codecs = new Set(
    Object.entries({
      mp3: mpegTest || checkAudioMime('mp3'),
      mpeg: mpegTest,
      opus: checkAudioMime('ogg;codecs="opus"'),
      ogg: checkAudioMime('ogg;codecs="vorbis"'),
      aac: aacTest,
      m4a: checkAudioMime('x-m4a') || checkAudioMime('m4a') || aacTest,
      mp4: checkAudioMime('x-mp4') || checkAudioMime('mp4') || aacTest,
      webm: !isOldSafari && checkAudioMime('webm;codecs="vorbis"'),
      wav: checkAudioMime('wav;codecs="1"') || checkAudioMime('wav'),
      flac: checkAudioMime('x-flac') || checkAudioMime('flac'),
    })
      .filter(([_, value]) => value)
      .map(([key]) => key),
  )

  // @ts-expect-error dispose
  testAudio = null
  return resultSet
}

export function bindEventListenerWithCleanup(
  el: EventTarget,
  type: string,
  handler: EventListener,
  options?: boolean | AddEventListenerOptions,
): VoidFunction {
  el.addEventListener(type, handler, options)
  return () => el.removeEventListener(type, handler, options)
}
export function clamp(min: number, val: number, max: number): number {
  return Math.min(Math.max(min, val), max)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatVolume(val: number): number {
  return clamp(0, val, 1)
}

export function padStartZero(num: number, length = 2): string {
  return ('' + Math.floor(num)).padStart(length, '0')
}

export function secondToTime(second: number): string {
  return (
    (second < 3600 ? '' : padStartZero(second / 3600) + ':') +
    padStartZero((second / 60) % 60) +
    ':' +
    padStartZero(second % 60)
  )
}

/**
 * @deprecated use {@link createWaveformGenerator} instead
 *
 * Parse audio buffer to array, use for generate audio waveform
 * @param buf source audio buffer
 * @param blockNum result block amount
 * @param max max value (0 ~ 1), default 0.9
 * @param min min value (0 ~ 1), default 0.1
 */
export function normalizeAudioBuffer(
  buf: AudioBuffer,
  blockNum = 1000,
  max = 0.9,
  min = 0.1,
): number[] {
  const rawData = buf.getChannelData(0)
  // `Math.floor` is faster than `~~`
  const blockSize = Math.floor(rawData.length / blockNum)
  // static array length
  // eslint-disable-next-line unicorn/no-new-array
  const result = new Array<number>(blockNum)
  let tempMax = 0

  for (let i = 0; i < blockNum; i++) {
    let sum = 0
    const start = i * blockSize

    for (let j = start; j < start + blockSize; j++) {
      sum += Math.abs(rawData[j])
    }

    result[i] = sum / blockSize
    tempMax = Math.max(tempMax, result[i])
  }

  // use fori to avoid array copy
  for (let i = 0; i < blockNum; i++) {
    result[i] = Math.round(Math.max((result[i] * max) / tempMax, min) * 1e5) / 1e5
  }
  return result
}

interface WaveformOptions {
  /**
   * Minimum normalized value
   * @default 0.1
   */
  min?: number
  /**
   * Maximum normalized value
   * @default 0.9
   */
  max?: number
  /**
   * Percentile for determining the visual peak (0.0 to 1.0).
   * 0.95 means the top 5% loudest peaks are ignored/clamped to max.
   * Lower values = Fuller waveform, Less headroom.
   * @default 0.95
   */
  amplitudePercentile?: number
}

interface ResampleFn {
  (blockCount: number, options?: Omit<WaveformOptions, 'amplitudePercentile'>): Float32Array
  (dts: Float32Array, options?: Omit<WaveformOptions, 'amplitudePercentile'>): void
}

export async function createWaveformGenerator(
  buffer: Promisable<ArrayBuffer>,
  globalOptions: WaveformOptions = {},
): Promise<ResampleFn> {
  const arrayBuffer = await Promise.resolve(buffer)
  const offlineCtx = new OfflineAudioContext(1, 1, 44100)
  const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer.slice(0))

  const channelData = audioBuffer.getChannelData(0)
  const totalSamples = channelData.length

  // 1. Precompute RMS Blocks
  const TARGET_PRECOMPUTE_BLOCKS = 2000
  const precomputeBlockSize = Math.max(1, Math.ceil(totalSamples / TARGET_PRECOMPUTE_BLOCKS))
  const precomputeBlockCount = Math.ceil(totalSamples / precomputeBlockSize)
  const precomputedRMS = new Float32Array(precomputeBlockCount)

  for (let i = 0; i < precomputeBlockCount; i++) {
    const start = i * precomputeBlockSize
    const end = Math.min(start + precomputeBlockSize, totalSamples)

    let sumOfSquares = 0
    for (let j = start; j < end; j++) {
      const sample = channelData[j]
      sumOfSquares += sample * sample
    }

    const blockLen = end - start
    precomputedRMS[i] = Math.sqrt(sumOfSquares / blockLen)
  }

  // 2. Calculate Reference Max (Percentile-based)
  // Instead of absolute max, we take the 95th percentile (by default).
  // This "pushes up" the body of the waveform and ignores extreme transient spikes.
  const { amplitudePercentile = 0.95 } = globalOptions

  // Sort a copy of the RMS data to find the percentile value
  const sortedRMS = new Float32Array(precomputedRMS).sort()
  const percentileIndex = Math.floor(sortedRMS.length * amplitudePercentile)
  // Fallback for silence to prevent division by zero
  const refMaxRMS = sortedRMS[percentileIndex] || 1

  return (data, options = {}) => {
    const { min = globalOptions.min ?? 0.1, max = globalOptions.max ?? 0.9 } = options
    const scale = max - min

    let blockCount
    let result
    if (typeof data === 'number') {
      blockCount = Math.max(1, data)
      result = new Float32Array(blockCount)
    } else {
      blockCount = data.length
      result = data
    }

    const ratio = precomputeBlockCount / blockCount

    for (let i = 0; i < blockCount; i++) {
      const startBlock = Math.floor(i * ratio)
      const endBlock = Math.min(
        Math.ceil((i + 1) * ratio),
        precomputeBlockCount
      )

      const range = endBlock - startBlock
      let sumRMS = 0

      for (let j = startBlock; j < endBlock; j++) {
        sumRMS += precomputedRMS[j]
      }

      const avgRMS = range > 0 ? sumRMS / range : 0

      // Normalize against the reference max (percentile peak) and clamp
      let normalized = clamp(0, avgRMS / refMaxRMS, 1)
      result[i] = min + normalized * scale
    }

    return result
  }
}