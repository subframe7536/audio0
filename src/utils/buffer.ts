/* eslint-disable unicorn/no-new-array */
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
