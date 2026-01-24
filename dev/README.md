# 🎵 Audio0 Demo - Spotify-Style Showcase

This demo showcases all the powerful features of the **Audio0** library in a beautiful Spotify-inspired interface. Experience modern web audio with auto cross-fade capabilities, intelligent preloading, and advanced audio processing features.

## 🚀 Quick Start

```bash
# Start the development server
bun run dev
# or
npm run dev
```

Then open your browser to see the interactive demo at `http://localhost:5173`

## 🎯 Featured Demos

### 🎨 Spotify-Style Interface

- **Modern Design**: Dark theme with Spotify's signature green accents
- **Responsive Layout**: Sidebar navigation with main content area
- **Global Player**: Bottom player bar with unified controls
- **Smooth Animations**: Hover effects and smooth transitions
- **Professional UI**: Cards, buttons, and sliders with glassmorphism effects

### 1. 🎧 Single Audio Player

**Demonstrates:** Basic audio playback with advanced features

- **Auto Cross-Fade**: Smooth fade-in/out effects with customizable duration
- **Media Session Integration**: Native media controls on mobile/desktop
- **Volume Control**: Real-time volume adjustment with smooth transitions
- **Error Handling**: Robust error handling with retry mechanisms
- **Mobile Support**: Auto-unlock for mobile browsers

**Key Features Shown:**

```typescript
const audio = new ZAudio({
  mediaSession: true, // Enable native media controls
  fadeDuration: 500, // Smooth 500ms fade effects
  volume: 0.5, // Initial volume
  autoUnlock: true, // Auto-unlock for mobile
})
```

### 2. 🎵 Multi-Track Player

**Demonstrates:** Advanced playlist management and playback

- **Multiple Audio Sources**: URL, ArrayBuffer, and ReadableStream support
- **Smart Shuffle**: Weighted artist shuffle algorithm for better diversity
- **Loop Modes**: List, Single, and Random loop options
- **Auto-Next**: Automatic track progression with error recovery
- **Next-Track Preloading**: Intelligent preloading of upcoming tracks for instant playback
- **Track Metadata**: Rich metadata support with Media Session API

**Key Features Shown:**

```typescript
const player = new ZPlayer({
  trackList: [
    { src: 'audio.ogg', title: 'Track 1', artist: 'Artist A' },
    {
      src: () => fetch('audio.mp3').then((r) => r.arrayBuffer()),
      type: 'buffer',
      mimeType: 'audio/mpeg',
    },
    {
      src: () => fetch('audio.mp3').then((r) => r.body!),
      type: 'stream',
      mimeType: 'audio/mpeg',
    },
  ],
  shuffleFn: createWeightedArtistShuffle(), // Smart shuffle
  autoNext: true,
  loopMode: 'list',
  // ZPlayer automatically preloads next tracks for seamless playback
})
```

### 3. 🎛️ Audio Equalizer

**Demonstrates:** Real-time audio processing and effects

- **5-Band EQ**: Frequency bands at 60Hz, 250Hz, 1kHz, 4kHz, 16kHz
- **Real-time Adjustment**: Live frequency response modification
- **Preset Configurations**: Rock, Jazz, and Flat presets
- **Custom Audio Nodes**: Integration with Web Audio API

**Key Features Shown:**

```typescript
// Create equalizer with custom frequencies
const eq = createEqualizer(audioContext, [60, 250, 1000, 4000, 16000])

// Connect to audio chain
audio.handleContext((ctx) => eq.nodes())

// Adjust specific frequency
eq.handle(1000, (band) => {
  band.gain.value = 3 // +3dB boost at 1kHz
})
```

### 4. 📊 Waveform Visualization

**Demonstrates:** Audio buffer analysis and visualization

- **Buffer Parsing**: Extract waveform data from audio files
- **Performance Optimized**: Fast processing of large audio buffers
- **Visual Feedback**: Real-time waveform rendering
- **Animation Support**: Animated waveform effects

**Key Features Shown:**

```typescript
// Parse audio buffer into waveform data
const waveformData = normalizeAudioBuffer(
  audioBuffer,
  100, // Number of bars
  0.9, // Max amplitude
  0.1, // Min amplitude
)

// Result: Array of normalized values for visualization
console.log(waveformData) // [0.1, 0.3, 0.7, 0.5, ...]
```

## 🛠️ Technical Features Highlighted

### Cross-Fade Technology

- **Automatic End Fade**: Detects approaching track end and fades out smoothly
- **Seek Fade**: Temporary fade during seek operations for seamless experience
- **Customizable Duration**: Adjustable fade timing from 0ms to 2000ms+

### Media Session Integration

- **Native Controls**: Play/pause/skip controls in notification panel
- **Metadata Display**: Track info, artwork, and progress in system UI
- **Keyboard Shortcuts**: Media key support across platforms

### Smart Shuffle Algorithm

- **Artist Diversity**: Prevents clustering of same-artist tracks
- **Weighted Scoring**: Uses track scores for intelligent ordering
- **Performance Optimized**: Efficient algorithm for large playlists

### Multi-Format Support

- **Codec Detection**: Automatic browser capability detection
- **Stream Processing**: Handle ReadableStream sources efficiently
- **Buffer Management**: Optimized ArrayBuffer processing
- **Error Recovery**: Automatic retry with exponential backoff

### Audio Processing Chain

- **Custom Nodes**: Easy integration of custom Web Audio nodes
- **Equalizer**: Built-in multi-band equalizer with presets
- **Context Management**: Automatic AudioContext lifecycle management
- **Mobile Optimization**: Battery-efficient suspend/resume cycles

## 🎮 Interactive Controls

### Global Player Bar (Bottom)

- **Unified Playback**: Single play/pause button for all audio sources
- **Track Info**: Current track title and artist display
- **Progress Bar**: Visual progress with time display
- **Volume Control**: Global volume slider with mute button
- **Navigation**: Previous/Next buttons for playlist control

### Single Player Controls

- **Load Audio**: Load demo track with metadata
- **Play/Pause**: Toggle playback with fade effects
- **Stop**: Complete stop with context cleanup
- **Volume Slider**: Real-time volume adjustment (0-100%)
- **Fade Duration**: Adjust cross-fade timing (0-2000ms)

### Multi-Player Controls

- **Load Playlist**: Initialize 3-track demo playlist
- **Navigation**: Previous/Next track with smart transitions
- **Loop Mode**: Cycle through List → Single → Random
- **Shuffle Toggle**: Enable/disable weighted artist shuffle
- **Preload Next**: Toggle next-track preloading for instant playback
- **Track Selection**: Click tracks to jump directly

### Equalizer Controls

- **Enable/Disable**: Toggle EQ processing on/off
- **5-Band Sliders**: Adjust frequency response (-12dB to +12dB)
- **Presets**: Quick Rock/Jazz configurations
- **Reset**: Return all bands to flat response

### Waveform Controls

- **Generate**: Parse audio and create waveform visualization
- **Animate**: Start/stop animated waveform effects

### Navigation

- **Sidebar Menu**: Click navigation items to jump to sections
- **Smooth Scrolling**: Animated scroll to selected demo section
- **Active States**: Visual indication of current section

## 🔧 Developer Tools

Open browser console for additional debugging tools:

```javascript
// Access demo instances
audio0Demo.singleAudio() // Get single audio instance
audio0Demo.player() // Get player instance
audio0Demo.equalizer() // Get equalizer instance
audio0Demo.waveform() // Get current waveform data
audio0Demo.logState() // Log complete demo state
```

## 📱 Mobile Features

- **Touch Optimization**: Responsive design for mobile devices
- **Auto-Unlock**: Automatic audio unlock on first user interaction
- **Media Session**: Native notification controls on iOS/Android
- **Performance**: Optimized for mobile battery life

## 🎨 Visual Design

- **Modern UI**: Glassmorphism design with backdrop blur effects
- **Responsive Layout**: Adapts to desktop, tablet, and mobile screens
- **Real-time Feedback**: Live status updates and visual indicators
- **Smooth Animations**: CSS transitions and JavaScript animations

## 🚀 Performance Features

- **Lazy Loading**: Audio files loaded only when needed
- **Memory Management**: Automatic cleanup and resource disposal
- **Error Recovery**: Graceful handling of network/decode errors
- **Battery Optimization**: Smart context suspend/resume cycles

## 📚 Learning Resources

This demo serves as both a showcase and learning tool. Each section demonstrates:

1. **Basic Usage**: Simple API calls for common tasks
2. **Advanced Features**: Complex scenarios and edge cases
3. **Best Practices**: Proper error handling and resource management
4. **Performance Tips**: Optimization techniques for production use

## 🔗 API Reference

For complete API documentation, see the main README.md and source code comments. Key classes demonstrated:

- `ZAudio`: Single audio player with fade effects
- `ZPlayer`: Multi-track playlist player
- `createEqualizer()`: Audio equalizer factory
- `normalizeAudioBuffer()`: Waveform data extraction
- `createWeightedArtistShuffle()`: Smart shuffle algorithm

---

**Built with Audio0** - Modern web audio made simple 🎵
