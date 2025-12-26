// oxlint-disable no-new-array
import type { ShuffleFn, TrackInfo } from '../types'

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

export const defaultShuffle: ShuffleFn = (array: TrackInfo[]) => {
  const arr = Array.from({ length: array.length }, (_, i) => i)
  shuffleFn(arr)
  return arr
}

/**
 * Generates a weighted random permutation of indices based on optional scores.
 * Higher `score` values increase the chance of an index appearing earlier.
 * Does not modify the input array.
 *
 * @param array - Array of track info objects with optional `score` property
 * @returns An array of shuffled indices (0-based), length equals `tracks.length`
 */
export const weightedShuffle: ShuffleFn = (array: TrackInfo[]) => {
  const len = array.length
  if (len <= 1) {
    return len === 0 ? [] : [0]
  }

  const weights = new Float32Array(len)
  const result = new Array<number>(len)

  // Single pass: initialize indices and compute weights
  for (let i = 0; i < len; i++) {
    result[i] = i
    weights[i] = Math.random() * (array[i].score ?? 3)
  }

  // Sort indices by weights in descending order
  result.sort((a, b) => weights[b] - weights[a])

  return result
}

interface SmartShuffleOptions {
  factor?: (score?: number) => number
  getSeed?: () => number
  desc?: boolean
}

export function createSmartShuffle(options: SmartShuffleOptions = {}): ShuffleFn {
  const { getSeed = () => Date.now(), factor = () => 1, desc = false } = options
  const sortFn: (pos: Float64Array, a: number, b: number) => number = desc
    ? (pos, a, b) => pos[b] - pos[a]
    : (pos, a, b) => pos[a] - pos[b]
  return (songs: TrackInfo[]) => {
    const len = songs.length
    if (len <= 1) {
      return len === 0 ? [] : [0]
    }

    // 1. Create index array and group by artist
    const artistsMap = new Map<string, number[]>()
    const result = new Array<number>(len)

    for (let i = 0; i < len; i++) {
      result[i] = i
      const artist = songs[i].artist || 'DEFAULT'
      let indices = artistsMap.get(artist)
      if (!indices) {
        indices = []
        artistsMap.set(artist, indices)
      }
      indices.push(i)
    }

    // 2. Prepare positions array
    const positions = new Float64Array(len)
    const globalOffset = Math.abs(Math.sin(getSeed()) * 10000) % 1

    // 3. Iterate through artists to calculate positions
    for (const [artist, artistItems] of artistsMap.entries()) {
      const count = artistItems.length
      const density = count / len

      // 4. Calculate hash per artist based on the Golden Ratio
      const hash = (stringHash(artist) + globalOffset) % 1
      const artistBaseOffset = (hash * 0.618033988749895) % (1 - density + 0.001)

      // 5. Shuffle in-place
      shuffleFn(artistItems)

      // 6. Calculate positions
      for (let i = 0; i < count; i++) {
        const randomJitter = (Math.random() * 0.1) / count
        positions[artistItems[i]] =
          ((artistBaseOffset + i / count + randomJitter) % 1) * factor(songs[artistItems[i]].score)
      }
    }

    // 7. Sort indices by referencing the positions array
    result.sort((a, b) => sortFn(positions, a, b))

    return result
  }
}

function stringHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) / 2147483647
}
