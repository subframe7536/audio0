async function waitForUpdate(source: SourceBuffer): Promise<void> {
  if (source.updating) {
    await new Promise<void>(resolve =>
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
 * const [url, cleanup] = useStream(await fetch(url).then(r => r.body!), 'audio/wav')
 * // Call when done to free memory
 * cleanup()
 * ```
 */
export function useStream(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  onError?: (err: string) => void,
): [url: string, cleanup: VoidFunction] {
  const ms = new MediaSource()
  let sourceBuffer: SourceBuffer | null = null

  const isMediaStreamOpen = (): boolean => ms.readyState === 'open'

  const onSourceOpen = async (): Promise<void> => {
    const reader = stream.getReader()
    try {
      sourceBuffer = ms.addSourceBuffer(mimeType)
      while (isMediaStreamOpen()) {
        const { done, value } = await reader.read()

        if (done) {
          await waitForUpdate(sourceBuffer)
          ms.endOfStream()
          reader.releaseLock()
          return
        }

        if (value) {
          await waitForUpdate(sourceBuffer)
          sourceBuffer.appendBuffer(value)
        }
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err))
    } finally {
      reader.releaseLock()
    }
  }

  ms.addEventListener('sourceopen', onSourceOpen)

  const url = URL.createObjectURL(ms)

  return [
    url,
    () => {
      ms.removeEventListener('sourceopen', onSourceOpen)

      if (isMediaStreamOpen()) {
        try {
          sourceBuffer?.abort()
        } catch { }

        ms.endOfStream()
      }
      URL.revokeObjectURL(url)
    },
  ]
}
