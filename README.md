# audio0

Audio library for the modern browser. Auto fade in actions.

## Installation

```bash
npm install audio0
```
```bash
yarn add audio0
```
```bash
pnpm add audio0
```

## Usage

### Single Audio

```ts
import { ZAudio } from 'audio0'

const audio = new ZAudio({
  mediaSession: true,
  fadeDuration: 1000, // 500 by default
})
audio.on('timeupdate', (time) => {
  console.log('current time', time)
})

await audio.load({ src: './audio.mp3' })
await audio.play()
```

### Player

```ts
import { ZPlayer } from 'audio0'
import mp3 from './test.mp3?url'
import ogg from './test.ogg?url'

const player = new ZPlayer({
  trackList: [{ src: ogg }, { src: mp3 }],
  autoNext: true,
})

player.on('timeupdate', (time) => {
  player.handleContext(ctx => console.log(time, ctx.currentTime, player.duration))
})

player.on('error', console.error)
player.on('reorder', () => console.log('reorder'))

prevButton.addEventListener('click', () => {
  player.prevTrack()
})
nextButton.addEventListener('click', () => {
  player.nextTrack()
})
```

### Utils

```ts
/**
 * Parse audio buffer to array, use for generate audio waveform
 * @param buf source audio buffer
 * @param blockNum result block amount
 * @param max max value (0 ~ 1), default 0.9
 * @param min min value (0 ~ 1), default 0.1
 */
function normalizeAudioBuffer(buf: AudioBuffer, blockNum?: number, max?: number, min?: number): number[]

/**
 * Create shuffle function that weighted shuffle by artist and score
 * @param getLimit get limit function. The larger of result, the more shuffled, the poor performance, @default n => n * 2 / 3
 */
function createWeightedArtistShuffle(getLimit?: GetLimitFn): ShuffleIndexFn

/**
 * Create equalizer
 * @param ctx audioContext
 * @param freq frequency array, you can use {@link defaultFreq}
 * @param handleNode biquad filter node handler
 * @example
 * const eq = createEqualizer(ctx, defaultFeq)
 * const eq1 = createEqualizer(ctx, [100, 200, 300, 400, 500] as const)
 */
function createEqualizer<T extends readonly number[]>(ctx: AudioContext, freq: T, handleNode?: (band: BiquadFilterNode, freq: T[number], index: number) => void): EQ<T>

function bindEventListenerWithCleanup(el: EventTarget, type: string, handler: EventListener): VoidFunction

function secondToTime(second: number): string

function formatVolume(val: number): number

function clamp(min: number, val: number, max: number): number
```

## Credit

- [howler.js](https://howlerjs.com/)
