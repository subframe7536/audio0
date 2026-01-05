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
   * Exponent for non-linear scaling
   * > 1.0 increases contrast (quieter sounds get smaller, peaks stay high)
   * < 1.0 boosts quiet sounds (compression)
   * @default 2.5
   */
  power?: number
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
  globalOptions: WaveformOptions = {},
): Promise<(blockCount: number, options?: WaveformOptions) => Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 44100)

  // 1. Decode Audio
  const audioData = await ctx.decodeAudioData(await buffer)
  const channelData = audioData.getChannelData(0)
  const sourceLen = channelData.length

  // 2. Precompute Global Peak (Single pass scan)
  // We do NOT create a new 'absData' array here to save RAM.
  let globalPeak = 0
  for (let i = 0; i < sourceLen; i++) {
    const val = Math.abs(channelData[i])
    if (val > globalPeak) {
      globalPeak = val
    }
  }

  // Prevent division by zero if silence
  if (globalPeak === 0) {
    globalPeak = 1
  }

  /**
   * Generator Function
   */
  return (blockCount: number, options: WaveformOptions = {}) => {
    const {
      min = globalOptions.min || 0.1,
      max = globalOptions.max || 0.9,
      power = globalOptions.power || 2.5,
    } = options

    if (!Number.isInteger(blockCount) || blockCount <= 0) {
      throw new RangeError(`Invalid block count: ${blockCount}. Must be positive integer.`)
    }

    if (min < 0 || max > 1 || min >= max) {
      throw new RangeError(
        `Invalid normalization range [${min}, ${max}]. Must satisfy 0 <= min < max <= 1.`,
      )
    }

    const output = new Float32Array(blockCount)

    // Calculate stride
    // step: how many source samples per 1 output pixel
    const step = sourceLen / blockCount

    // Pre-calculate scale factor for the final output range
    const range = max - min
    const invGlobalPeak = 1 / globalPeak

    // DOWNSAMPLING (Standard Case: Audio is longer than output pixels)
    if (step >= 1) {
      for (let i = 0; i < blockCount; i++) {
        const start = Math.floor(i * step)
        const end = Math.floor((i + 1) * step)

        // Find Peak in chunk
        let localPeak = 0
        // Optimization: Use a while loop or check bounds safely
        const safeEnd = end < sourceLen ? end : sourceLen

        for (let j = start; j < safeEnd; j++) {
          const val = Math.abs(channelData[j])
          if (val > localPeak) {
            localPeak = val
          }
        }

        // Processing Pipeline:
        // 1. Normalize (0 to 1) relative to song volume
        let n = localPeak * invGlobalPeak

        // 2. Apply Power Curve (Increases difference/contrast)
        if (power !== 1) {
          n = Math.pow(n, power)
        }

        // 3. Map to output range (min to max)
        output[i] = min + n * range
      }
    }
    // UPSAMPLING (Rare Case: Zoomed in extremely close)
    else {
      for (let i = 0; i < blockCount; i++) {
        const index = Math.min(Math.floor(i * step), sourceLen - 1)
        let n = Math.abs(channelData[index]) * invGlobalPeak

        if (power !== 1) {
          n = Math.pow(n, power)
        }

        output[i] = min + n * range
      }
    }

    return output
  }
}
