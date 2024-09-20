export const defaultFreq = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

type EQ<T extends readonly number[]> = {
  nodes: () => BiquadFilterNode[]
  handle: (targetFreq: T[number], fn: (band: BiquadFilterNode) => void) => void
}

/**
 * Create equalizer
 * @param ctx audioContext
 * @param freq frequency array, you can use {@link defaultFreq}
 * @param handleNode biquad filter node handler
 * @example
 * const eq = createEqualizer(ctx, defaultFeq)
 * const eq1 = createEqualizer(ctx, [100, 200, 300, 400, 500] as const)
 */
export function createEqualizer<T extends readonly number[]>(
  ctx: AudioContext,
  freq: T,
  handleNode?: (band: BiquadFilterNode, freq: T[number], index: number) => void,
): EQ<T> {
  const result: BiquadFilterNode[] = []
  // https://github.com/DIDAVA/dAudio/blob/master/src/dAudio.js
  for (let i = 0; i < freq.length; i++) {
    const band = ctx.createBiquadFilter()
    switch (i) {
      case 0:
        band.type = 'lowshelf'
        break
      case freq.length - 1:
        band.type = 'highshelf'
        break
      default:
        band.type = 'peaking'
    }
    band.frequency.value = freq[i]
    handleNode?.(band, freq[i], i)
    result.push(band)
  }

  return {
    nodes: () => result,
    handle(targetFreq: T[number], fn: (band: BiquadFilterNode) => void) {
      fn(result[freq.indexOf(targetFreq)])
    },
  }
}

// const eq = createEqualizer(new AudioContext(), defaultFreq)
// eq.handle(1000, band => (band.gain.value = 0))
