import { bindEventListenerWithCleanup } from './common'
import type { StreamBufferOptions, Track, TrackLike } from '../types'

async function waitForUpdate(source: SourceBuffer): Promise<void> {
  if (source.updating) {
    await new Promise<void>((resolve) =>
      source.addEventListener('updateend', () => resolve(), { once: true }),
    )
  }
}

/**
 * Creates a URL for streaming audio from a ReadableStream using MediaSource.
 * Optimized for audio playback with better buffering and error handling.
 * @param stream - The ReadableStream providing audio data
 * @param mimeType - The MIME type of the audio (e.g., 'audio/mpeg', 'audio/wav')
 * @param onError - Optional error callback
 * @param options - Streaming options for audio optimization
 * @example
 * ```ts
 * // Basic usage
 * const [url, cleanup] = createUrlFromStream(
 *   await fetch(audioUrl).then(r => r.body!),
 *   'audio/mpeg'
 * )
 *
 * // With audio-specific options
 * const [url, cleanup] = createUrlFromStream(
 *   stream,
 *   'audio/mpeg',
 *   (error) => console.error('Stream error:', error),
 *   { bufferSize: 512 * 1024 }
 * )
 *
 * // Always cleanup when done
 * cleanup()
 * ```
 */
export function createUrlFromStream(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  options: {
    onError?: (msg: string) => void
    /** Buffer size in bytes for audio chunks (default: 256KB for better audio streaming) */
    bufferSize?: number
    /** Maximum buffer duration in seconds (default: 30s) */
    maxBufferDuration?: number
  } = {},
): [url: string, cleanup: VoidFunction] {
  const {
    onError,
    bufferSize = 2 << 18, // 256KB - optimal for audio streaming
    maxBufferDuration = 30,
  } = options

  const ms = new MediaSource()
  let sourceBuffer: SourceBuffer | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let isStreamingActive = true
  let pendingBuffer: Uint8Array[] = []
  let totalBufferedBytes = 0

  const isMediaStreamOpen = (): boolean => ms.readyState === 'open'
  const isSourceBufferReady = (): boolean =>
    sourceBuffer !== null && !sourceBuffer.updating && isMediaStreamOpen()

  // Audio-optimized buffer management
  const appendBufferSafely = async (data: Uint8Array): Promise<void> => {
    if (!sourceBuffer || !isMediaStreamOpen()) {
      return
    }

    try {
      await waitForUpdate(sourceBuffer)

      // Check buffer health for audio streaming
      if (sourceBuffer.buffered.length > 0) {
        const bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1)
        const bufferedStart = sourceBuffer.buffered.start(0)
        const bufferedDuration = bufferedEnd - bufferedStart

        // Remove old buffer data if we exceed max duration (prevents memory issues)
        if (
          bufferedDuration > maxBufferDuration &&
          bufferedStart < bufferedEnd - maxBufferDuration
        ) {
          const removeEnd = bufferedEnd - maxBufferDuration
          await waitForUpdate(sourceBuffer)
          sourceBuffer.remove(bufferedStart, removeEnd)
          await waitForUpdate(sourceBuffer)
        }
      }

      const buffer =
        data.buffer instanceof ArrayBuffer
          ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
          : new ArrayBuffer(data.byteLength)

      if (!(data.buffer instanceof ArrayBuffer)) {
        new Uint8Array(buffer).set(data)
      }

      sourceBuffer.appendBuffer(buffer)
      totalBufferedBytes += data.length
    } catch (err) {
      if (isStreamingActive) {
        onError?.(`Buffer append failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Process pending buffers in chunks optimized for audio
  const processPendingBuffers = async (): Promise<void> => {
    while (pendingBuffer.length > 0 && isSourceBufferReady() && isStreamingActive) {
      const chunk = pendingBuffer.shift()!
      await appendBufferSafely(chunk)
    }
  }

  const cleanupListener = bindEventListenerWithCleanup(
    ms,
    'sourceopen',
    async (): Promise<void> => {
      if (!isStreamingActive) {
        return
      }

      try {
        reader = stream.getReader()
        sourceBuffer = ms.addSourceBuffer(mimeType)

        // Audio-specific source buffer configuration
        if ('mode' in sourceBuffer) {
          try {
            ;(sourceBuffer as any).mode = 'sequence' // Better for gapless audio
          } catch {
            // Fallback to default mode if not supported
          }
        }

        // Set up buffer monitoring for audio streaming
        const bufferUpdateListener = bindEventListenerWithCleanup(sourceBuffer, 'updateend', () => {
          if (isStreamingActive) {
            void processPendingBuffers()
          }
        })

        let accumulatedBuffer = new Uint8Array(0)

        while (isStreamingActive && isMediaStreamOpen()) {
          const { done, value } = await reader.read()

          if (done) {
            // Process any remaining accumulated buffer
            if (accumulatedBuffer.length > 0) {
              pendingBuffer.push(accumulatedBuffer)
            }

            // Process all pending buffers before ending
            await processPendingBuffers()
            await waitForUpdate(sourceBuffer!)

            if (isMediaStreamOpen() && isStreamingActive) {
              ms.endOfStream()
            }
            bufferUpdateListener()
            return
          }

          if (value && value.length > 0) {
            // Accumulate small chunks for better audio streaming performance
            const newBuffer = new Uint8Array(accumulatedBuffer.length + value.length)
            newBuffer.set(accumulatedBuffer)
            newBuffer.set(value, accumulatedBuffer.length)
            accumulatedBuffer = newBuffer

            // Process buffer when it reaches optimal size or when buffer is getting low
            const shouldFlushBuffer =
              accumulatedBuffer.length >= bufferSize ||
              sourceBuffer!.buffered.length === 0 || // Initial buffering
              (sourceBuffer!.buffered.length > 0 &&
                sourceBuffer!.buffered.end(sourceBuffer!.buffered.length - 1) -
                  (ms as any).duration <
                  2) // Low buffer threshold

            if (shouldFlushBuffer) {
              pendingBuffer.push(accumulatedBuffer)
              accumulatedBuffer = new Uint8Array(0)

              if (isSourceBufferReady()) {
                await processPendingBuffers()
              }
            }
          }
        }
      } catch (err) {
        if (isStreamingActive) {
          onError?.(err instanceof Error ? err.message : String(err))
        }
      } finally {
        isStreamingActive = false
        if (reader) {
          try {
            reader.releaseLock()
          } catch {}
          reader = null
        }
      }
    },
  )

  const url = URL.createObjectURL(ms)

  return [
    url,
    () => {
      isStreamingActive = false
      cleanupListener()

      // Cancel the reader if still active
      if (reader) {
        try {
          reader.cancel('Stream cleanup requested')
        } catch {}
        reader = null
      }

      // Clean up source buffer
      if (sourceBuffer && isMediaStreamOpen()) {
        try {
          sourceBuffer.abort()
        } catch {}
      }

      // End media source
      if (isMediaStreamOpen()) {
        try {
          ms.endOfStream()
        } catch {}
      }

      // Clear pending buffers
      pendingBuffer = []
      totalBufferedBytes = 0

      // Revoke URL asynchronously to avoid blocking
      queueMicrotask(() => {
        try {
          URL.revokeObjectURL(url)
        } catch {}
      })
    },
  ]
}

export function createUrlFromBlob(blob: Blob): [string, VoidFunction] {
  const url = URL.createObjectURL(blob)
  return [url, () => URL.revokeObjectURL(url)]
}

export type ParseTrackResult = [
  {
    src: string
    mime: string
  },
  VoidFunction,
]

/**
 * Parse track from ReadableStream with optimized audio streaming
 */
export function parseTrackFromStream(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  onError?: (msg: string) => void,
  options?: StreamBufferOptions,
): ParseTrackResult {
  const [url, cleanup] = createUrlFromStream(stream, mimeType, {
    onError,
    ...options,
  })
  return [{ src: url, mime: mimeType }, cleanup]
}

/**
 * Parse track from File
 */
export function parseTrackFromFile(file: File): ParseTrackResult {
  const [url, cleanup] = createUrlFromBlob(file)
  return [{ src: url, mime: file.type }, cleanup]
}

/**
 * Parse track from ArrayBuffer
 */
export function parseTrackFromArrayBuffer(buffer: ArrayBuffer, mimeType: string): ParseTrackResult {
  const [src, cleanup] = createUrlFromBlob(new Blob([buffer], { type: mimeType }))
  return [{ src, mime: mimeType }, cleanup]
}

/**
 * Universal track parser that returns a tuple of [ParsedTrackInfo, cleanup function]
 */
export async function parseTrack(
  track: TrackLike,
  onError?: (msg: string) => void,
  options?: StreamBufferOptions,
): Promise<[track: Track, cleanup: VoidFunction]> {
  // If it's already a string URL, return as-is with no-op cleanup
  if (typeof track.src === 'string') {
    return [track as Track, () => {}] // No cleanup needed for string URLs
  }

  // Get the actual source (resolve function if needed)
  const src = typeof track.src === 'function' ? await track.src() : track.src
  let result: ParseTrackResult

  if (src instanceof File) {
    result = parseTrackFromFile(src)
  } else if (src instanceof ArrayBuffer) {
    result = parseTrackFromArrayBuffer(src, track.mimeType!)
  } else if (src instanceof ReadableStream) {
    result = parseTrackFromStream(src, track.mimeType!, onError, options)
  } else {
    throw new Error('Unsupported track source type')
  }

  return [{ ...track, ...result[0] }, result[1]]
}
