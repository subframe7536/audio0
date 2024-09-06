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
```

## Credit

- [howler.js](https://howlerjs.com/)
