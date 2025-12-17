import { bindEventListenerWithCleanup } from './common'

async function waitForUpdate(source: SourceBuffer): Promise<void> {
  if (source.updating) {
    await new Promise<void>((resolve) =>
      source.addEventListener('updateend', () => resolve(), { once: true }),
    )
  }
}

/**
 * Creates a URL for streaming media from a ReadableStream using MediaSource.
 * @param stream - The ReadableStream providing media data
 * @param mimeType - The MIME type of the media
 * @example
 * ```ts
 * // Use the URL
 * const [url, cleanup] = createUrlFromStream(await fetch(url).then(r => r.body!), 'audio/wav')
 * // Call when done to free memory
 * cleanup()
 * ```
 */
function createUrlFromStream(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  onError?: (msg: string) => void,
): [url: string, cleanup: VoidFunction] {
  const ms = new MediaSource()
  let sourceBuffer: SourceBuffer | null = null
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  const isMediaStreamOpen = (): boolean => ms.readyState === 'open'

  const onSourceOpen = async (): Promise<void> => {
    reader = stream.getReader()
    try {
      sourceBuffer = ms.addSourceBuffer(mimeType)
      while (isMediaStreamOpen()) {
        const { done, value } = await reader.read()

        if (done) {
          await waitForUpdate(sourceBuffer)
          if (isMediaStreamOpen()) {
            ms.endOfStream()
          }
          return
        }

        if (value) {
          await waitForUpdate(sourceBuffer)
          sourceBuffer.appendBuffer(value as Uint8Array<ArrayBuffer>)
        }
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      reader?.releaseLock()
      reader = null
    }
  }

  const cleanupListener = bindEventListenerWithCleanup(ms, 'sourceopen', onSourceOpen)

  const url = URL.createObjectURL(ms)

  return [
    url,
    () => {
      cleanupListener()

      // Cancel the reader if still active
      if (reader) {
        try {
          reader.cancel()
        } catch {}
        reader = null
      }

      if (isMediaStreamOpen()) {
        try {
          sourceBuffer?.abort()
        } catch {}

        try {
          ms.endOfStream()
        } catch {}
      }
      URL.revokeObjectURL(url)
    },
  ]
}

interface ParseTrackResult {
  url: string
  mime: string
  cleanup: VoidFunction
}

export function parseTrack(src: File): ParseTrackResult
export function parseTrack(src: ArrayBuffer, mime: string): ParseTrackResult
export function parseTrack(
  src: ReadableStream<Uint8Array>,
  mime: string,
  onError: (msg: string) => void,
): ParseTrackResult
export function parseTrack(
  src: ReadableStream<Uint8Array> | ArrayBuffer | File,
  mime?: string,
  onError?: (msg: string) => void,
): ParseTrackResult {
  let stream: ReadableStream<Uint8Array>
  if (src instanceof File) {
    stream = src.stream()
    mime = src.type
  } else if (src instanceof ArrayBuffer) {
    stream = new Blob([src], { type: mime }).stream()
  } else {
    stream = src
  }
  const [result, cleanup] = createUrlFromStream(stream, mime!, onError)
  return { url: result, mime: mime!, cleanup }
}
