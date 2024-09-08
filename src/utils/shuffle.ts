import { shuffle as weightedShuffle } from 'weighted-shuffle'
import { clamp } from './common'
import type { Track } from '../types'

export type ShuffleIndexFn = (songs: Track[]) => number[]

export const defaultShuffle: ShuffleIndexFn = (array: Track[]) => {
  const arr = Array.from({ length: array.length }, (_, i) => i)
  shuffleFn(arr)
  return arr
}

/**
 * Basic shuffle function
 * @param arr array
 */
export function shuffleFn(arr: any[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = arr[i]
    arr[i] = arr[j]
    arr[j] = temp
  }
}

type GetLimitFn = (totalArtists: number) => number

/**
 * Create shuffle function that weighted shuffle by artist and score
 * @param getLimit get limit function. The larger of result, the more shuffled, the poor performance, @default n => n * 2 / 3
 */
export function createWeightedArtistShuffle(
  getLimit: GetLimitFn = n => n * 2 / 3,
): ShuffleIndexFn {
  return (songs: Track[]) => {
    const artistMap = new Map<string, [number, number][]>()
    for (let i = 0; i < songs.length; i++) {
      const artist = songs[i].artist || 'unknown'
      if (!artistMap.has(artist)) {
        artistMap.set(artist, [])
      }
      artistMap.get(artist)!.push([i, songs[i].score ?? 3])
    }

    for (const v of artistMap.values()) {
      weightedShuffle(v)
    }

    const result: number[] = []
    const artists = Array.from(artistMap.keys())
    const totalCount = songs.length
    const windowSize = Math.min(artists.length, 5)
    const limit = getLimit(artists.length)

    for (let i = 0; i < totalCount; i++) {
      const _index = i % artists.length
      if (_index === 0) {
        shuffleFn(artists)
      }
      const artist = artists[_index]
      const artistAlbums = artistMap.get(artist)!
      const [data] = artistAlbums.shift()!

      if (artists.length < limit) {
        const windowStart = Math.max(0, i - windowSize)
        const windowEnd = Math.min(result.length, i + windowSize)
        let bestIndex = i
        let maxDistance = -1

        for (let i = windowStart; i <= windowEnd; i++) {
          let minDistance = i === result.length ? i : Infinity
          for (let j = Math.max(0, i - windowSize); j < Math.min(result.length, i + windowSize); j++) {
            if (songs[result[j]].artist === artist) {
              minDistance = Math.min(minDistance, Math.abs(i - j))
            }
          }
          if (minDistance > maxDistance) {
            maxDistance = minDistance
            bestIndex = i
          }
        }
        const targetIndex = clamp(0, bestIndex + Math.floor(Math.random() * 3) - 1, result.length)
        result.splice(targetIndex, 0, data)
      } else {
        result[i] = data
      }

      if (!artistAlbums.length) {
        artists.splice(_index, 1)
      }
    }
    return result
  }
}
