# audio0

Modern audio library for browsers with automatic fade effects, media session support, and advanced playback features.

## Features

- 🎵 **Single Audio & Playlist Support** - Play individual tracks or manage playlists
- 🔄 **Auto Fade Effects** - Smooth fade in/out transitions with customizable duration
- 📱 **Media Session Integration** - Native media controls on mobile and desktop
- 🔀 **Advanced Shuffle** - Weighted shuffle by artist and score
- ⚡ **Smart Preloading** - Automatic next track preloading for seamless playback
- 🎛️ **Audio Context Control** - Custom audio nodes and equalizer support
- 📊 **Stream & Buffer Support** - Handle various audio sources including streams
- 🔁 **Loop Modes** - List, single, and random loop modes
- 🎯 **Retry Logic** - Automatic retry for network failures
- 🔇 **Auto Suspend** - Optimize battery usage with context suspension

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
```bash
bun add audio0
```

## Quick Start

### Single Audio

```ts
import { ZAudio } from 'audio0'

const audio = new ZAudio({
  mediaSession: true,
  fadeDuration: 1000, // 500ms by default
  volume: 0.8,
  autoSuspend: true, // Save battery when paused
})

// Listen to events
audio.on('timeupdate', (time) => {
  console.log('Current time:', time)
})
audio.on('error', (error, code) => {
  console.error('Audio error:', error.message, 'Code:', code)
})

// Load and play
await audio.load({ 
  src: './audio.mp3',
  title: 'My Song',
  artist: 'Artist Name'
})
await audio.play()
```

### Playlist Player

```ts
import { ZPlayer } from 'audio0'

const player = new ZPlayer({
  trackList: [
    { 
      src: './song1.mp3',
      title: 'Song 1',
      artist: 'Artist 1'
    },
    { 
      src: () => fetch('./song2.mp3').then(r => r.body!), 
      mimeType: 'audio/mpeg', 
      type: 'stream',
      title: 'Song 2',
      artist: 'Artist 2'
    },
    {
      src: () => fetch('./song3.wav').then(r => r.arrayBuffer()),
      mimeType: 'audio/wav',
      type: 'buffer',
      title: 'Song 3',
      artist: 'Artist 3'
    }
  ],
  autoNext: true,
  loopMode: 'list',
  preload: { enable: true, threshold: 80 }, // Preload at 80% progress
})

// Event listeners
player.on('loadTrack', (index, track) => {
  console.log(`Loaded track ${index}:`, track.title)
})
player.on('reorder', () => {
  console.log('Playlist reordered')
})

// Controls
player.prevTrack()
player.nextTrack()
player.changeLoopMode('random')
```

## Advanced Usage

### Custom Audio Nodes & Equalizer

```ts
import { ZAudio, createEqualizer, defaultFreq } from 'audio0'

const audio = new ZAudio({
  extraAudioNodes: (ctx) => {
    // Create equalizer
    const eq = createEqualizer(ctx, defaultFreq)
    
    // Adjust specific frequencies
    eq.handle(1000, (band) => {
      band.gain.value = 5 // Boost 1kHz by 5dB
    })
    
    return eq.nodes()
  }
})

// Or handle context dynamically
audio.handleContext((ctx, nodes) => {
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -24
  compressor.knee.value = 30
  compressor.ratio.value = 12
  
  return [...nodes, compressor]
})
```

### Stream & Buffer Handling

```ts
import { useStream, useArrayBuffer } from 'audio0'

// For streams
const response = await fetch('./audio.mp3')
const [streamUrl, cleanup1] = useStream(response.body!, 'audio/mpeg')

// For buffers
const buffer = await fetch('./audio.wav').then(r => r.arrayBuffer())
const [bufferUrl, cleanup2] = useArrayBuffer(buffer, 'audio/wav')

// Don't forget to cleanup
cleanup1()
cleanup2()
```

### Waveform Generation

```ts
import { normalizeAudioBuffer } from 'audio0'

// Decode audio for waveform
const audioContext = new AudioContext()
const response = await fetch('./audio.mp3')
const arrayBuffer = await response.arrayBuffer()
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

// Generate waveform data
const waveformData = normalizeAudioBuffer(
  audioBuffer,
  1000, // 1000 data points
  0.9,  // max amplitude
  0.1   // min amplitude
)

// Use waveformData for visualization
```

### Custom Shuffle Algorithm

```ts
import { ZPlayer, createWeightedArtistShuffle } from 'audio0'

const customShuffle = createWeightedArtistShuffle(
  (totalArtists) => Math.min(totalArtists, 10) // Limit artist diversity
)

const player = new ZPlayer({
  shuffleFn: customShuffle,
  trackList: tracks.map(track => ({
    ...track,
    score: calculateTrackScore(track) // Your scoring logic
  }))
})
```

## API Reference

### ZAudio Options

```ts
interface ZAudioOptions {
  fadeDuration?: number        // Fade duration in ms (default: 500)
  volume?: number             // Initial volume 0-1 (default: 0.5)
  mediaSession?: boolean      // Enable media session (default: false)
  timeout?: number           // Load timeout in ms (default: 10000)
  retryCount?: number        // Network retry attempts (default: 3)
  retryDelay?: number        // Retry delay in ms (default: 1000)
  autoUnlock?: boolean       // Auto unlock on mobile (default: true)
  autoSuspend?: boolean      // Auto suspend when paused (default: false)
  autoSuspendDelay?: number  // Suspend delay in ms (default: 30000)
  getAudioContext?: () => AudioContext
  extraAudioNodes?: (ctx: AudioContext) => AudioNode[]
}
```

### ZPlayer Options

```ts
interface ZPlayerOptions extends ZAudioOptions {
  trackList?: TrackLike[]           // Initial track list
  shuffleFn?: ShuffleFn            // Custom shuffle function
  autoNext?: boolean | LoadOptions  // Auto play next track
  loopMode?: 'list' | 'single' | 'random'
  preload?: boolean | PreloadConfig // Preload configuration
}
```

### Track Types

```ts
// Regular URL track
interface Track {
  src: string
  title?: string
  artist?: string
  album?: string
  artwork?: MediaImage[]
  mimeType?: string
  score?: number  // For weighted shuffle
}

// Stream track
interface StreamTrack {
  type: 'stream'
  src: () => Promise<ReadableStream> | ReadableStream
  mimeType: string
  // ... other metadata
}

// Buffer track  
interface BufferTrack {
  type: 'buffer'
  src: () => Promise<ArrayBuffer> | ArrayBuffer
  mimeType: string
  // ... other metadata
}
```

### Events

```ts
// ZAudio events
audio.on('play', () => {})
audio.on('pause', () => {})
audio.on('stop', () => {})
audio.on('ended', () => {})
audio.on('timeupdate', (currentTime: number) => {})
audio.on('volume', (volume: number) => {})
audio.on('rate', (playbackRate: number) => {})
audio.on('seek', (targetTime: number) => {})
audio.on('load', (metadata: ParsedTrackInfo) => {})
audio.on('error', (error: ZAudioError, code: number) => {})

// ZPlayer additional events
player.on('loadTrack', (index: number, metadata: TrackInfo) => {})
player.on('reorder', () => {})
```

## Utility Functions

```ts
// Audio buffer processing
function normalizeAudioBuffer(
  buf: AudioBuffer, 
  blockNum?: number,    // Result block amount (default: 1000)
  max?: number,         // Max value 0-1 (default: 0.9)
  min?: number          // Min value 0-1 (default: 0.1)
): number[]

// Equalizer creation
function createEqualizer<T extends readonly number[]>(
  ctx: AudioContext,
  freq: T,              // Frequency array (use defaultFreq)
  handleNode?: (band: BiquadFilterNode, freq: T[number], index: number) => void
): EQ<T>

// Shuffle algorithms
function createWeightedArtistShuffle(
  getLimit?: (totalArtists: number) => number
): ShuffleIndexFn

// Stream/Buffer utilities
function useStream(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  onError?: (err: string) => void
): [url: string, cleanup: VoidFunction]

function useArrayBuffer(
  buf: ArrayBuffer,
  type: string
): [url: string, cleanup: VoidFunction]

// Helper functions
function bindEventListenerWithCleanup(
  el: EventTarget,
  type: string,
  handler: EventListener,
  options?: boolean | AddEventListenerOptions
): VoidFunction

function secondToTime(second: number): string
function formatVolume(val: number): number
function clamp(min: number, val: number, max: number): number
```

## Browser Support

- **Chrome/Edge**: Full support
- **Firefox**: Full support  
- **Safari**: Full support (iOS 16+)
- **Mobile browsers**: Full support with auto-unlock

## Error Handling

```ts
audio.on('error', (error, code) => {
  switch (code) {
    case -1: // Internal logic error
    case 0:  // Unknown load error
    case 1:  // MEDIA_ERR_ABORTED
    case 2:  // MEDIA_ERR_NETWORK (auto-retry enabled)
    case 3:  // MEDIA_ERR_DECODE
    case 4:  // MEDIA_ERR_SRC_NOT_SUPPORTED
    case 5:  // Stream load error
      console.error(`Audio error (${code}):`, error.message)
      break
  }
})
```

## License

MIT

## Credits

- Inspired by [howler.js](https://howlerjs.com/)
- Uses [zen-mitt](https://github.com/subframe7536/zen-mitt) for event handling
- Weighted shuffle algorithm adapted from [weighted-shuffle](https://github.com/timoxley/weighted-shuffle)
