import type { StreamBufferOptions, Track, TrackLike } from '../types'

import { bindEventListenerWithCleanup } from './common'

async function waitForUpdate(source: SourceBuffer): Promise<void> {
  if (source.updating) {
    await new Promise<void>((resolve) =>
      source.addEventListener('updateend', () => resolve(), { once: true }),
    )
  }
}

const MAX_POOL_SIZE = 10
const KB_64 = 1 << 16
const KB_256 = 1 << 18
const MB_1 = 1 << 20
const STANDARD_SIZE = [KB_64, KB_256, MB_1] // 64KB, 256KB, 1MB

/**
 * Memory pool for reusing ArrayBuffers to prevent allocations
 */
class BufferPool {
  private pools = new Map<number, ArrayBuffer[]>()

  /**
   * Get a buffer from the pool or create a new one
   */
  acquire(size: number): ArrayBuffer {
    const poolSize = this.getNearestPoolSize(size)
    const pool = this.pools.get(poolSize) || []

    if (pool.length > 0) {
      return pool.pop()!
    }

    return new ArrayBuffer(poolSize)
  }

  /**
   * Return a buffer to the pool for reuse
   */
  release(buffer: ArrayBuffer): void {
    const size = buffer.byteLength
    const poolSize = this.getNearestPoolSize(size)

    // Only pool if it matches a standard size and pool isn't full
    if (size === poolSize) {
      const pool = this.pools.get(poolSize) || []
      if (pool.length < MAX_POOL_SIZE) {
        pool.push(buffer)
        this.pools.set(poolSize, pool)
      }
    }
  }

  /**
   * Clear all pooled buffers
   */
  clear(): void {
    this.pools.clear()
  }

  private getNearestPoolSize(size: number): number {
    // Find the smallest standard size that can fit the requested size
    for (const standardSize of STANDARD_SIZE) {
      if (size <= standardSize) {
        return standardSize
      }
    }
    // For very large sizes, round up to nearest MB
    return Math.ceil(size / MB_1) * MB_1
  }
}

/**
 * Transferable buffer wrapper for zero-copy operations
 */
class TransferableBuffer {
  private buffer: ArrayBuffer
  private view: Uint8Array
  private _transferred = false
  private _isZeroCopy: boolean
  private _actualLength: number

  constructor(buffer: ArrayBuffer, actualLength?: number) {
    this.buffer = buffer
    this._actualLength = actualLength ?? buffer.byteLength
    this.view = new Uint8Array(buffer, 0, this._actualLength)
    this._isZeroCopy = actualLength === undefined || actualLength === buffer.byteLength
  }

  /**
   * Get the underlying ArrayBuffer (marks as transferred)
   * Returns a slice if the buffer is larger than the actual data
   */
  getTransferableBuffer(): ArrayBuffer {
    if (this._transferred) {
      throw new Error('Buffer already transferred')
    }
    this._transferred = true

    // For zero-copy optimization, return the buffer directly if it matches exactly
    if (this._isZeroCopy) {
      return this.buffer
    }

    // Otherwise, return a slice with only the actual data
    return this.buffer.slice(0, this._actualLength)
  }

  /**
   * Get a view of the buffer data
   */
  getView(offset = 0, length?: number): Uint8Array {
    if (this._transferred) {
      throw new Error('Buffer already transferred')
    }
    return length !== undefined
      ? this.view.subarray(offset, offset + length)
      : this.view.subarray(offset)
  }

  /**
   * Copy data into the buffer
   */
  set(data: Uint8Array, offset = 0): void {
    if (this._transferred) {
      throw new Error('Buffer already transferred')
    }
    this.view.set(data, offset)
  }

  get byteLength(): number {
    return this._actualLength
  }

  get transferred(): boolean {
    return this._transferred
  }

  get isZeroCopy(): boolean {
    return this._isZeroCopy
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
  let totalBufferedBytes = 0
  let pendingBuffers: TransferableBuffer[] = []

  // Memory pool for buffer reuse
  const bufferPool = new BufferPool()

  const isMediaStreamOpen = (): boolean => ms.readyState === 'open'
  const isSourceBufferReady = (): boolean =>
    sourceBuffer !== null && !sourceBuffer.updating && isMediaStreamOpen()

  // Use smaller buffer size for first MB to improve initial loading
  const getAdaptiveBufferSize = (): number => {
    return totalBufferedBytes < MB_1 ? KB_64 : bufferSize // 64KB for first MB, then normal size
  }

  // Create a transferable buffer from pooled memory
  const createTransferableBuffer = (size: number): TransferableBuffer => {
    const pooledBuffer = bufferPool.acquire(size)
    return new TransferableBuffer(pooledBuffer)
  }

  // Create transferable buffer directly from existing ArrayBuffer (zero-copy)
  const createTransferableBufferFromArrayBuffer = (buffer: ArrayBuffer): TransferableBuffer => {
    return new TransferableBuffer(buffer)
  }

  // Release a transferable buffer back to the pool
  const releaseTransferableBuffer = (transferableBuffer: TransferableBuffer): void => {
    if (!transferableBuffer.transferred) {
      // If not transferred, we can reclaim the buffer
      const buffer = transferableBuffer.getTransferableBuffer()
      bufferPool.release(buffer)
    }
  }

  // Check if a Uint8Array can be used as zero-copy (has its own ArrayBuffer)
  const canUseZeroCopy = (data: Uint8Array): boolean => {
    return (
      data.byteOffset === 0 &&
      data.byteLength === data.buffer.byteLength &&
      data.buffer instanceof ArrayBuffer
    )
  }

  // Audio-optimized buffer management with transferable objects
  const appendBufferSafely = async (transferableBuffer: TransferableBuffer): Promise<void> => {
    if (!sourceBuffer || !isMediaStreamOpen()) {
      releaseTransferableBuffer(transferableBuffer)
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

      // Use transferable buffer directly (zero-copy)
      const buffer = transferableBuffer.getTransferableBuffer()
      sourceBuffer.appendBuffer(buffer)
      totalBufferedBytes += buffer.byteLength
    } catch (err) {
      releaseTransferableBuffer(transferableBuffer)
      if (isStreamingActive) {
        onError?.(`Buffer append failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Process pending transferable buffers in chunks optimized for audio
  const processPendingBuffers = async (): Promise<void> => {
    while (pendingBuffers.length > 0 && isSourceBufferReady() && isStreamingActive) {
      const transferableBuffer = pendingBuffers.shift()!
      await appendBufferSafely(transferableBuffer)
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

        let accumulatedData: Uint8Array[] = []
        let accumulatedSize = 0

        while (isStreamingActive && isMediaStreamOpen()) {
          const { done, value } = await reader.read()

          if (done) {
            // Process any remaining accumulated data
            if (accumulatedSize > 0) {
              if (accumulatedData.length === 1 && canUseZeroCopy(accumulatedData[0])) {
                // Zero-copy: use the ArrayBuffer directly
                const transferableBuffer = createTransferableBufferFromArrayBuffer(
                  accumulatedData[0].buffer as ArrayBuffer,
                )
                pendingBuffers.push(transferableBuffer)
              } else {
                // Need to copy multiple chunks
                const transferableBuffer = createTransferableBuffer(accumulatedSize)
                let offset = 0
                for (const chunk of accumulatedData) {
                  transferableBuffer.set(chunk, offset)
                  offset += chunk.length
                }
                pendingBuffers.push(transferableBuffer)
              }
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
            const currentBufferSize = getAdaptiveBufferSize()

            // Check if we can use this chunk directly (zero-copy optimization)
            const canUseDirectly =
              canUseZeroCopy(value) &&
              value.length >= currentBufferSize &&
              accumulatedData.length === 0

            if (canUseDirectly) {
              // Zero-copy: use the chunk's ArrayBuffer directly
              const transferableBuffer = createTransferableBufferFromArrayBuffer(
                value.buffer as ArrayBuffer,
              )
              pendingBuffers.push(transferableBuffer)

              if (isSourceBufferReady()) {
                await processPendingBuffers()
              }
            } else {
              // Accumulate chunks without copying until we reach threshold
              accumulatedData.push(value)
              accumulatedSize += value.length

              // Process buffer when it reaches adaptive size or when buffer is getting low
              const shouldFlushBuffer =
                accumulatedSize >= currentBufferSize ||
                sourceBuffer!.buffered.length === 0 || // Initial buffering
                (sourceBuffer!.buffered.length > 0 &&
                  sourceBuffer!.buffered.end(sourceBuffer!.buffered.length - 1) -
                    (ms as any).duration <
                    2) // Low buffer threshold

              if (shouldFlushBuffer) {
                if (accumulatedData.length === 1 && canUseZeroCopy(accumulatedData[0])) {
                  // Zero-copy: use the ArrayBuffer directly
                  const transferableBuffer = createTransferableBufferFromArrayBuffer(
                    accumulatedData[0].buffer as ArrayBuffer,
                  )
                  pendingBuffers.push(transferableBuffer)
                } else {
                  // Need to copy multiple chunks
                  const transferableBuffer = createTransferableBuffer(accumulatedSize)
                  let offset = 0
                  for (const chunk of accumulatedData) {
                    transferableBuffer.set(chunk, offset)
                    offset += chunk.length
                  }
                  pendingBuffers.push(transferableBuffer)
                }

                accumulatedData = []
                accumulatedSize = 0

                if (isSourceBufferReady()) {
                  await processPendingBuffers()
                }
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

      // Clear pending buffers and release memory back to pool
      for (const transferableBuffer of pendingBuffers) {
        releaseTransferableBuffer(transferableBuffer)
      }
      pendingBuffers = []
      bufferPool.clear()
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

export type ParseTrackResult = [{ src: string; mimeType: string }, VoidFunction]

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
  return [{ src: url, mimeType }, cleanup]
}

/**
 * Parse track from File
 */
export function parseTrackFromFile(file: File): ParseTrackResult {
  const [url, cleanup] = createUrlFromBlob(file)
  return [{ src: url, mimeType: file.type }, cleanup]
}

/**
 * Parse track from ArrayBuffer
 */
export function parseTrackFromArrayBuffer(buffer: ArrayBuffer, mimeType: string): ParseTrackResult {
  const [src, cleanup] = createUrlFromBlob(new Blob([buffer], { type: mimeType }))
  return [{ src, mimeType }, cleanup]
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
