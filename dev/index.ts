import { ZAudio, ZPlayer } from '../src'
import {
  createWaveformGenerator,
  createEqualizer,
  createSmartShuffle,
  secondToTime,
} from '../src/utils'
import mp3 from './test.mp3?url'
import ogg from './test.ogg?url'

// ============================================================================
// Demo State Management
// ============================================================================

interface DemoState {
  singleAudio: ZAudio | null
  player: ZPlayer | null
  equalizer: any
  isShuffled: boolean
  autoNext: boolean
  preloadNext: boolean
  currentWaveform: number[]
  animationId: number | null
  currentAudioSource: 'single' | 'player' | null
}

const state: DemoState = {
  singleAudio: null,
  player: null,
  equalizer: null,
  isShuffled: false,
  autoNext: true,
  preloadNext: true,
  currentWaveform: [],
  animationId: null,
  currentAudioSource: null,
}

// ============================================================================
// Global Player Controls
// ============================================================================

function updateGlobalPlayer(title: string, artist: string) {
  const titleEl = document.getElementById('current-track-title')!
  const artistEl = document.getElementById('current-track-artist')!
  titleEl.textContent = title
  artistEl.textContent = artist
}

function updateGlobalPlayButton(isPlaying: boolean) {
  const globalPlayBtn = document.getElementById('global-play')!
  const icon = globalPlayBtn.querySelector('i')!
  icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play'
}

function updateGlobalProgress(currentTime: number, duration: number) {
  const currentTimeEl = document.getElementById('current-time')!
  const totalTimeEl = document.getElementById('total-time')!
  const progressFill = document.getElementById('progress-fill')!

  currentTimeEl.textContent = secondToTime(currentTime)
  totalTimeEl.textContent = secondToTime(duration)

  const progress = (currentTime / duration) * 100
  progressFill.style.width = `${progress}%`
}

function initGlobalControls() {
  const globalPlayBtn = document.getElementById('global-play')!
  const globalPrevBtn = document.getElementById('global-prev')!
  const globalNextBtn = document.getElementById('global-next')!
  const globalVolumeSlider = document.getElementById('global-volume') as HTMLInputElement
  const muteBtn = document.getElementById('mute-btn')!

  globalPlayBtn.addEventListener('click', async () => {
    const currentAudio = state.currentAudioSource === 'player' ? state.player : state.singleAudio
    if (currentAudio?.isPlaying) {
      await currentAudio.pause()
    } else if (currentAudio) {
      await currentAudio.play()
    }
  })

  globalPrevBtn.addEventListener('click', () => {
    if (state.player && state.currentAudioSource === 'player') {
      state.player.prevTrack()
    }
  })

  globalNextBtn.addEventListener('click', () => {
    if (state.player && state.currentAudioSource === 'player') {
      state.player.nextTrack()
    }
  })

  globalVolumeSlider.addEventListener('input', () => {
    const volume = parseInt(globalVolumeSlider.value) / 100
    const currentAudio = state.currentAudioSource === 'player' ? state.player : state.singleAudio
    if (currentAudio) {
      currentAudio.volume = volume
    }
  })

  muteBtn.addEventListener('click', () => {
    const currentAudio = state.currentAudioSource === 'player' ? state.player : state.singleAudio
    if (currentAudio) {
      currentAudio.muted = !currentAudio.muted
      const icon = muteBtn.querySelector('i')!
      icon.className = currentAudio.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up'
    }
  })
}

// ============================================================================
// Single Audio Player Demo
// ============================================================================

function initSingleAudioDemo() {
  const loadBtn = document.getElementById('single-load')!
  const playBtn = document.getElementById('single-play')!
  const stopBtn = document.getElementById('single-stop')!
  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement
  const fadeSlider = document.getElementById('fade-slider') as HTMLInputElement
  const volumeDisplay = document.getElementById('volume-display')!
  const fadeDisplay = document.getElementById('fade-display')!
  const status = document.getElementById('single-status')!

  // Create single audio instance
  state.singleAudio = new ZAudio({
    mediaSession: true,
    fadeDuration: 500,
    volume: 0.5,
    autoUnlock: true,
  })

  // Event listeners
  state.singleAudio.on('load', (metadata) => {
    status.textContent = `✅ Loaded: ${metadata.title || 'Audio Track'}`
    updatePlayButton()
    updateGlobalPlayer(metadata.title || 'Demo Track', metadata.artist || 'Audio0 Library')
  })

  state.singleAudio.on('play', () => {
    status.textContent = '▶️ Playing with fade-in effect...'
    state.currentAudioSource = 'single'
    updatePlayButton()
    updateGlobalPlayButton(true)
  })

  state.singleAudio.on('pause', () => {
    status.textContent = '⏸️ Paused with fade-out effect'
    updatePlayButton()
    updateGlobalPlayButton(false)
  })

  state.singleAudio.on('timeupdate', (time) => {
    const duration = state.singleAudio!.duration
    if (duration && !isNaN(duration)) {
      status.textContent = `⏱️ ${secondToTime(time)} / ${secondToTime(duration)}`
      if (state.currentAudioSource === 'single') {
        updateGlobalProgress(time, duration)
      }
    }
  })

  state.singleAudio.on('error', (error) => {
    status.textContent = `❌ Error: ${error.message}`
  })

  state.singleAudio.on('ended', () => {
    status.textContent = '🏁 Playback ended'
    updatePlayButton()
    updateGlobalPlayButton(false)
  })

  // Button handlers
  loadBtn.addEventListener('click', async () => {
    status.textContent = '⏳ Loading audio...'
    await state.singleAudio!.load({
      src: ogg,
      title: 'Demo Track',
      artist: 'Audio0 Library',
      album: 'Demo Collection',
    })
  })

  playBtn.addEventListener('click', async () => {
    // Pause other audio sources
    if (state.player?.isPlaying) {
      await state.player.pause()
    }

    if (state.singleAudio!.isPlaying) {
      await state.singleAudio!.pause()
    } else {
      await state.singleAudio!.play()
    }
  })

  stopBtn.addEventListener('click', async () => {
    await state.singleAudio!.stop()
    status.textContent = '⏹️ Stopped'
    updatePlayButton()
    updateGlobalPlayButton(false)
  })

  // Slider handlers
  volumeSlider.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value) / 100
    state.singleAudio!.volume = volume
    volumeDisplay.textContent = `${volumeSlider.value}%`

    // Update global volume slider
    const globalVolume = document.getElementById('global-volume') as HTMLInputElement
    globalVolume.value = volumeSlider.value
  })

  fadeSlider.addEventListener('input', () => {
    const duration = parseInt(fadeSlider.value)
    state.singleAudio!.fadeDuration = duration
    fadeDisplay.textContent = `${duration}ms`
  })

  function updatePlayButton() {
    const icon = playBtn.querySelector('i')!
    const isPlaying = state.singleAudio!.isPlaying
    icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play'
  }
}

// ============================================================================
// Multi-Track Player Demo
// ============================================================================

function initPlayerDemo() {
  const loadBtn = document.getElementById('player-load')!
  const playBtn = document.getElementById('player-play')!
  const prevBtn = document.getElementById('player-prev')!
  const nextBtn = document.getElementById('player-next')!
  const loopBtn = document.getElementById('loop-mode')!
  const shuffleBtn = document.getElementById('shuffle-mode')!
  const autoNextBtn = document.getElementById('auto-next')!
  const preloadNextBtn = document.getElementById('preload-next')!
  const trackList = document.getElementById('track-list')!
  const status = document.getElementById('player-status')!

  // Sample track data with metadata
  const tracks = [
    {
      src: ogg,
      title: 'Demo Track 1',
      artist: 'Artist A',
      album: 'Album X',
      score: 3,
    },
    {
      src: () => fetch(mp3).then((r) => r.arrayBuffer()),
      mimeType: 'audio/mpeg',
      type: 'buffer' as const,
      title: 'Demo Track 2',
      artist: 'Artist B',
      album: 'Album Y',
      score: 4,
    },
    {
      src: () => fetch(mp3).then((r) => r.body!),
      mimeType: 'audio/mpeg',
      type: 'stream' as const,
      title: 'Demo Track 3',
      artist: 'Artist A',
      album: 'Album Z',
      score: 3,
    },
  ]

  // Create player with weighted shuffle and preload configuration
  state.player = new ZPlayer({
    trackList: tracks,
    autoNext: state.autoNext,
    mediaSession: true,
    shuffleFn: createSmartShuffle(),
    loopMode: 'list',
  })

  // Event listeners
  state.player.on('loadTrack', (index, metadata) => {
    status.textContent = `✅ Loaded: ${metadata.title} by ${metadata.artist}`
    updateTrackList(index)
    updatePlayButton()
    updateGlobalPlayer(metadata.title || 'Unknown Track', metadata.artist || 'Unknown Artist')
  })

  state.player.on('play', () => {
    status.textContent = '▶️ Playing...'
    state.currentAudioSource = 'player'
    updatePlayButton()
    updateGlobalPlayButton(true)
  })

  state.player.on('pause', () => {
    status.textContent = '⏸️ Paused'
    updatePlayButton()
    updateGlobalPlayButton(false)
  })

  state.player.on('timeupdate', (time) => {
    const duration = state.player!.duration
    if (duration && !isNaN(duration) && state.currentAudioSource === 'player') {
      updateGlobalProgress(time, duration)
    }
  })

  state.player.on('reorder', () => {
    status.textContent = '🔀 Playlist reordered'
    updateTrackList()
  })

  state.player.on('error', (error) => {
    status.textContent = `❌ Error: ${error.message}`
    // Auto-skip to next track on error
    setTimeout(() => state.player!.nextTrack(), 1000)
  })

  state.player.on('ended', () => {
    updateGlobalPlayButton(false)
  })

  // Button handlers
  loadBtn.addEventListener('click', async () => {
    status.textContent = '⏳ Loading playlist...'
    await state.player!.loadTrack(0)
  })

  playBtn.addEventListener('click', async () => {
    // Pause other audio sources
    if (state.singleAudio?.isPlaying) {
      await state.singleAudio.pause()
    }

    if (state.player!.isPlaying) {
      await state.player!.pause()
    } else {
      await state.player!.play()
    }
  })

  prevBtn.addEventListener('click', () => {
    state.player!.prevTrack()
  })

  nextBtn.addEventListener('click', () => {
    state.player!.nextTrack()
  })

  loopBtn.addEventListener('click', () => {
    state.player!.changeLoopMode()
    const icon = loopBtn.querySelector('i')!
    const mode = state.player!.loopMode

    // Update icon based on loop mode
    switch (mode) {
      case 'list':
        icon.className = 'fas fa-redo'
        loopBtn.classList.remove('active')
        break
      case 'single':
        icon.className = 'fas fa-redo-alt'
        loopBtn.classList.add('active')
        break
      case 'random':
        icon.className = 'fas fa-random'
        loopBtn.classList.add('active')
        break
    }

    status.textContent = `🔄 Loop mode: ${mode}`
  })

  shuffleBtn.addEventListener('click', () => {
    state.isShuffled = !state.isShuffled
    state.player!.reorder(state.isShuffled)
    shuffleBtn.classList.toggle('active', state.isShuffled)
    status.textContent = `🔀 Shuffle: ${state.isShuffled ? 'On' : 'Off'}`
  })

  // Auto-next button event
  autoNextBtn.addEventListener('click', () => {
    state.autoNext = !state.autoNext
    autoNextBtn.classList.toggle('active', state.autoNext)
    status.textContent = `⏭️ Auto-Next: ${state.autoNext ? 'On' : 'Off'}`
  })

  // Preload next track button event
  preloadNextBtn.addEventListener('click', () => {
    state.preloadNext = !state.preloadNext
    preloadNextBtn.classList.toggle('active', state.preloadNext)

    if (state.preloadNext) {
      // Demonstrate preloading next track
      state.player!.setPreloadConfig(true)
      status.textContent = `📥 Preload Next: On - Next track will be preloaded for instant playback`
    } else {
      status.textContent = `📥 Preload Next: Off - Tracks load on demand`
    }
  })

  // Track list click handlers
  trackList.addEventListener('click', (e) => {
    const trackItem = (e.target as Element).closest('.track-item')
    if (trackItem) {
      const index = Array.from(trackList.children).indexOf(trackItem)
      state.player!.loadTrack(index)
    }
  })

  function updatePlayButton() {
    const icon = playBtn.querySelector('i')!
    const isPlaying = state.player!.isPlaying
    icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play'
  }

  function updateTrackList(activeIndex?: number) {
    const items = trackList.querySelectorAll('.track-item')
    items.forEach((item, index) => {
      item.classList.toggle('active', index === activeIndex)
    })
  }
}

// ============================================================================
// Equalizer Demo
// ============================================================================

function initEqualizerDemo() {
  const enableBtn = document.getElementById('eq-enable')!
  const resetBtn = document.getElementById('eq-reset')!
  const rockBtn = document.getElementById('eq-preset-rock')!
  const jazzBtn = document.getElementById('eq-preset-jazz')!
  const sliders = document.querySelectorAll('.eq-slider') as NodeListOf<HTMLInputElement>
  const status = document.getElementById('eq-status')!

  let isEnabled = false

  // Presets
  const presets = {
    rock: [3, 2, -1, 2, 4],
    jazz: [-2, 1, 2, 1, -1],
    flat: [0, 0, 0, 0, 0],
  }

  enableBtn.addEventListener('click', () => {
    isEnabled = !isEnabled

    if (isEnabled) {
      // Create equalizer and connect to current audio
      const sliderList = Array.from(sliders)
      const currentAudio = state.player || state.singleAudio
      if (currentAudio) {
        currentAudio.handleContext((ctx) => {
          state.equalizer = createEqualizer(ctx, [60, 250, 1000, 4000, 16000], (band, freq) => {
            // Find the slider for this frequency and apply its current value
            const slider = sliderList.find((s) => parseInt(s.dataset.freq!) === freq)
            if (slider) {
              const gain = parseFloat(slider.value)
              band.gain.value = gain
            } else {
              band.gain.value = 0 // Default to 0dB if no slider found
            }
          })

          status.textContent = '🎛️ Equalizer enabled'
          return state.equalizer.nodes()
        })
      }
      enableBtn.innerHTML = '<i class="fas fa-power-off"></i> Disable EQ'
    } else {
      // Disconnect equalizer
      const currentAudio = state.player || state.singleAudio
      if (currentAudio) {
        currentAudio.handleContext(() => {
          state.equalizer = null
          status.textContent = '🔇 Equalizer disabled'
          return []
        })
      }
      enableBtn.innerHTML = '<i class="fas fa-power-off"></i> Enable EQ'
    }
  })

  resetBtn.addEventListener('click', () => {
    applyPreset(presets.flat)
  })

  rockBtn.addEventListener('click', () => {
    applyPreset(presets.rock)
  })

  jazzBtn.addEventListener('click', () => {
    applyPreset(presets.jazz)
  })

  // Slider handlers
  sliders.forEach((slider) => {
    slider.addEventListener('input', () => {
      if (state.equalizer && isEnabled) {
        const freq = parseInt(slider.dataset.freq!)
        const gain = parseFloat(slider.value)
        state.equalizer.handle(freq, (band: BiquadFilterNode) => {
          band.gain.value = gain
        })

        // Update the value display
        const eqBand = slider.closest('.eq-band')
        const valueDisplay = eqBand?.querySelector('.eq-value')
        if (valueDisplay) {
          valueDisplay.textContent = `${gain > 0 ? '+' : ''}${gain}dB`
        }

        status.textContent = `🎛️ ${freq}Hz: ${gain > 0 ? '+' : ''}${gain}dB`
      }
    })
  })

  function applyPreset(values: number[]) {
    values.forEach((value, index) => {
      sliders[index].value = value.toString()

      // Update value display
      const eqBand = sliders[index].closest('.eq-band')
      const valueDisplay = eqBand?.querySelector('.eq-value')
      if (valueDisplay) {
        valueDisplay.textContent = `${value > 0 ? '+' : ''}${value}dB`
      }

      if (state.equalizer && isEnabled) {
        const freq = parseInt(sliders[index].dataset.freq!)
        state.equalizer.handle(freq, (band: BiquadFilterNode) => {
          band.gain.value = value
        })
      }
    })
    status.textContent = '🎵 Preset applied'
  }
}

// ============================================================================
// Waveform Visualization Demo
// ============================================================================

function initWaveformDemo() {
  const generateBtn = document.getElementById('waveform-generate')!
  const animateBtn = document.getElementById('waveform-animate')!
  const container = document.getElementById('waveform-container')!
  const status = document.getElementById('waveform-status')!

  generateBtn.addEventListener('click', async () => {
    status.textContent = '⏳ Generating waveform...'

    try {
      // Fetch and decode audio
      const response = await fetch(ogg)
      const arrayBuffer = await response.arrayBuffer()

      // Generate waveform data
      console.time('Waveform Generation')
      state.currentWaveform = await createWaveformGenerator(arrayBuffer).then((calc) =>
        Array.from(calc(100)),
      )
      console.timeEnd('Waveform Generation')

      // Render waveform
      renderWaveform(state.currentWaveform)
      status.textContent = `📊 Waveform generated (${state.currentWaveform.length} bars)`
    } catch (error) {
      status.textContent = `❌ Error generating waveform: ${error}`
    }
  })

  animateBtn.addEventListener('click', () => {
    if (state.animationId) {
      cancelAnimationFrame(state.animationId)
      state.animationId = null
      animateBtn.innerHTML = '<i class="fas fa-play"></i> Animate'
      status.textContent = '⏹️ Animation stopped'
    } else {
      startWaveformAnimation()
      animateBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Animation'
      status.textContent = '🎬 Animating waveform...'
    }
  })

  function renderWaveform(data: number[]) {
    container.innerHTML = ''
    data.forEach((value) => {
      const bar = document.createElement('div')
      bar.className = 'waveform-bar'
      bar.style.height = `${value * 60}px` // Adjusted for new container height
      container.append(bar)
    })
  }

  function startWaveformAnimation() {
    const bars = container.querySelectorAll('.waveform-bar') as NodeListOf<HTMLElement>
    let frame = 0

    function animate() {
      bars.forEach((bar, index) => {
        const wave = Math.sin((frame + index) * 0.1) * 0.3 + 0.7
        const originalHeight = state.currentWaveform[index] || 0.1
        bar.style.height = `${originalHeight * wave * 60}px` // Adjusted for new container height
      })

      frame += 1
      state.animationId = requestAnimationFrame(animate)
    }

    animate()
  }
}

// ============================================================================
// Navigation
// ============================================================================

function initNavigation() {
  const navLinks = document.querySelectorAll('.nav-link')

  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault()

      // Update active nav item
      navLinks.forEach((l) => l.classList.remove('active'))
      link.classList.add('active')

      // Scroll to section
      const href = link.getAttribute('href')
      if (href) {
        const section = document.querySelector(href)
        if (section) {
          section.scrollIntoView({ behavior: 'smooth' })
        }
      }
    })
  })
}

// ============================================================================
// Initialize All Demos
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  console.log('🎵 Audio0 Spotify-Style Demo Loading...')

  // Initialize all demo sections
  initGlobalControls()
  initSingleAudioDemo()
  initPlayerDemo()
  initEqualizerDemo()
  initWaveformDemo()
  initNavigation()

  // Log supported codecs
  if (state.singleAudio) {
    console.log('🎵 Supported Codecs:', Array.from(state.singleAudio.codecs))
  }

  console.log('✅ Audio0 Spotify-Style Demo Ready!')

  // Add some helpful console commands for developers
  ;(window as any).audio0Demo = {
    singleAudio: () => state.singleAudio,
    player: () => state.player,
    equalizer: () => state.equalizer,
    waveform: () => state.currentWaveform,
    logState: () => console.log('Demo State:', state),
  }

  console.log('💡 Try: audio0Demo.logState() in console for debug info')
})

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
  if (state.singleAudio) {
    await state.singleAudio.destroy()
  }
  if (state.player) {
    await state.player.destroy()
  }
  if (state.animationId) {
    cancelAnimationFrame(state.animationId)
  }
})
