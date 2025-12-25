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
/**
 * Resamples audio data to a target length using peak hold algorithm.
 * For downsampling (targetLength < source.length), it takes the maximum absolute value in each block.
 * For upsampling (targetLength > source.length), it uses nearest-neighbor interpolation.
 *
 * @param source - Original audio data as absolute values (Float32Array)
 * @param targetLength - Desired number of samples in output
 * @returns Resampled waveform data
 */
function resampleAudioData(source: Float32Array, targetLength: number): Float32Array {
  const sourceLen = source.length
  if (targetLength <= 0 || sourceLen === 0) {
    return new Float32Array(0)
  }

  // Handle direct copy case
  if (targetLength === sourceLen) {
    return source.slice()
  }

  const result = new Float32Array(targetLength)
  const scale = sourceLen / targetLength

  // Downsampling: peak detection
  if (scale >= 1) {
    for (let i = 0; i < targetLength; i++) {
      const start = Math.floor(i * scale)
      const end = Math.min(Math.floor((i + 1) * scale), sourceLen)

      let peak = 0
      for (let j = start; j < end; j++) {
        const val = source[j]
        if (val > peak) {
          peak = val
        }
      }
      result[i] = peak
    }
  }
  // Upsampling: nearest-neighbor
  else {
    for (let i = 0; i < targetLength; i++) {
      const pos = Math.min(Math.floor(i * scale), sourceLen - 1)
      result[i] = source[pos]
    }
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
   * Maximum normalized value (default: 0.9)
   * @default 0.9
   */
  max?: number
}

/**
 * Creates a waveform generator function from raw audio data.
 * The generator produces normalized waveform blocks suitable for visualization.
 *
 * **NO CACHE BUILT-IN !!!**
 *
 * @param buffer - Raw audio data in ArrayBuffer format
 * @returns A generator function that creates waveform blocks
 *
 * @example
 * const generateWaveform = await createWaveformGenerator(file.arrayBuffer());
 * const waveform = generateWaveform(128, { min: 0.2, max: 0.8 });
 */
export async function createWaveformGenerator(
  buffer: Promisable<ArrayBuffer>,
): Promise<(blockCount: number, options?: WaveformOptions) => Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 44100)

  const audioData = await ctx.decodeAudioData(await buffer)
  const channelData = audioData.getChannelData(0)
  const absData = new Float32Array(channelData.length)
  let globalPeak = 0

  // Precompute absolute values and global peak
  for (let i = 0; i < channelData.length; i++) {
    const val = Math.abs(channelData[i])
    absData[i] = val
    if (val > globalPeak) {
      globalPeak = val
    }
  }

  return (blockCount: number, { min = 0.1, max = 0.9 } = {}) => {
    // Validate inputs
    if (globalPeak === 0) {
      throw new Error('Cannot generate waveform from silent audio')
    }

    if (!Number.isInteger(blockCount) || blockCount <= 0) {
      throw new RangeError(`Invalid block count: ${blockCount}. Must be positive integer.`)
    }

    if (min < 0 || max > 1 || min >= max) {
      throw new RangeError(
        `Invalid normalization range [${min}, ${max}]. Must satisfy 0 <= min < max <= 1.`,
      )
    }

    // Normalize cached data (always create new array to prevent mutation)
    const scale = (max - min) / globalPeak
    const data = resampleAudioData(absData, blockCount)!

    for (let i = 0; i < data.length; i++) {
      data[i] = min + data[i] * scale
    }

    return data
  }
}
