/* eslint-disable prefer-template */
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
    Object
      .entries({
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
): VoidFunction {
  el.addEventListener(type, handler)
  return () => el.removeEventListener(type, handler)
}
export function clamp(min: number, val: number, max: number): number {
  return Math.min(Math.max(min, val), max)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function formatVolume(val: number): number {
  return clamp(0, val, 1)
}

export function padStartZero(num: number, length = 2): string {
  return ('' + Math.floor(num)).padStart(length, '0')
}

export function secondToTime(second: number): string {
  return (second < 3600 ? '' : padStartZero(second / 3600) + ':')
    + padStartZero((second / 60) % 60) + ':'
    + padStartZero(second % 60)
}/* eslint-disable unicorn/no-new-array */
/**
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
    result[i] = Math.round(Math.max(result[i] * max / tempMax, min) * 1e5) / 1e5
  }
  return result
}
