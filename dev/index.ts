import { ZPlayer } from '../src'
// import { createWeightedArtistShuffle, defaultShuffle } from '../src/utils/shuffle'
import { normalizeAudioBuffer } from '../src/utils/buffer'
import mp3 from './test.mp3?url'
import ogg from './test.ogg?url'

const loadButton = document.querySelector('.load')!
const playButton = document.querySelector('.btn')!
const prevButton = document.querySelector('.prev')!
const nextButton = document.querySelector('.next')!
const forwardButton = document.querySelector('.forward')!
const backwardButton = document.querySelector('.backward')!

const player = new ZPlayer({
  trackList: [{ src: ogg }, { src: mp3 }],
  autoNext: true,
})

player.on('timeupdate', (time) => {
  player.handleContext(ctx => console.log(time, ctx.currentTime, player.duration))
})

player.on('error', console.error)
player.on('reorder', () => console.log('reorder'))
// window._audio = audio
loadButton.addEventListener('click', async () => {
  await player.loadTrack()
  fetch(ogg)
    .then(res => res.arrayBuffer())
    .then(data => new OfflineAudioContext({ length: 1, sampleRate: 44100 }).decodeAudioData(data))
    .then((buffer) => {
      console.time('parseAudioBuffer')
      let arr
      for (let i = 0; i < 1e2; i++) {
        arr = normalizeAudioBuffer(buffer)
      }
      console.timeEnd('parseAudioBuffer')
      console.log(arr)
    })
})
playButton.addEventListener('click', async () => {
  if (player.isPlaying) {
    await player.pause()
    playButton.textContent = 'play'
  } else {
    // await audio.seek(80)
    if (await player.play()) {
      playButton.textContent = 'pause'
    }
  }
})
prevButton.addEventListener('click', () => {
  player.prevTrack()
})
nextButton.addEventListener('click', () => {
  player.nextTrack()
})
forwardButton.addEventListener('click', () => {
  player.seek(player.currentTime + 10)
})
backwardButton.addEventListener('click', () => {
  player.seek(player.currentTime - 10)
})

// const arr: { title: string, artist: string, album: string }[] = [
//   {
//     title: '1',
//     artist: '2',
//     album: '3',
//   },
//   {
//     title: '11',
//     artist: '2',
//     album: '3',
//   },
//   {
//     title: '111',
//     artist: '2',
//     album: '31',
//   },
//   {
//     title: '1111',
//     artist: '2',
//     album: '31',
//   },
//   {
//     title: '11111',
//     artist: '2',
//     album: '311',
//   },
//   {
//     title: '00',
//     artist: '0',
//     album: '000',
//   },
//   {
//     title: '000',
//     artist: '0',
//     album: '999',
//   },
//   {
//     title: 'b000',
//     artist: 'a',
//     album: '1999',
//   },
//   {
//     title: 'a000',
//     artist: 'b',
//     album: '2999',
//   },
//   {
//     title: 'a001',
//     artist: 'b',
//     album: '2991',
//   },
//   {
//     title: 'a001',
//     artist: 'c',
//     album: '2991',
//   },
//   {
//     title: 'a001',
//     artist: 'd',
//     album: '2991',
//   },
// ]

// function longest<T>(nums: T[]): number {
//   if (nums.length === 0) {
//     return 0
//   }

//   let maxLength = 1
//   let currentLength = 1

//   for (let i = 1; i < nums.length; i++) {
//     if (nums[i] === nums[i - 1]) {
//       currentLength++
//     } else {
//       maxLength = Math.max(maxLength, currentLength)
//       currentLength = 1
//     }
//   }

//   maxLength = Math.max(maxLength, currentLength)

//   return maxLength
// }

// let sum = 0
// console.time('defaultShuffle')
// for (let i = 0; i < 1e6; i++) {
//   // sum += longest(weightedArtistShuffle(arr as any).map(i => arr[i].artist))
//   sum += longest(defaultShuffle(arr as any).map(i => arr[i].artist))
// }
// console.log(sum / 1e6)
// console.timeEnd('defaultShuffle')
// console.log(createWeightedArtistShuffle()(arr as any).map(i => arr[i].album))
// console.log(defaultShuffle(arr as any).map(i => arr[i].album))
