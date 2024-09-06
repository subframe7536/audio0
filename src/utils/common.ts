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
}
