import type { StreamTrack, Track } from '../types'

function eos(ms: MediaSource): void {
  if (ms.readyState === 'open') {
    ms.endOfStream()
  }
}

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
 * @returns A tuple of URL and cleanup function
 */
export function useStreamURL(
  stream: ReadableStream<Uint8Array>,
  mimeType: string,
  onError?: (err: string) => void,
): [string, VoidFunction] {
  const ms = new MediaSource()

  ms.addEventListener('sourceopen', async () => {
    const source = ms.addSourceBuffer(mimeType)
    const reader = stream.getReader()

    const appendToSource = async (chunk: Uint8Array): Promise<void> => {
      await waitForUpdate(source)
      source.appendBuffer(chunk)
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          await waitForUpdate(source)
          eos(ms)
          return
        }
        if (value) {
          await appendToSource(value)
        }
      }
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error))
    }
  })

  const url = URL.createObjectURL(ms)

  return [
    url,
    () => {
      if (ms.readyState === 'open') {
        eos(ms)
      }
      URL.revokeObjectURL(url)
    },
  ]
}

export function isStreamTrack(track: Track | StreamTrack): track is StreamTrack {
  return typeof track.src === 'function'
}
