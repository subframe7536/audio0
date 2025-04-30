import type { StreamTrack, Track } from '../types'

export function useStreamURL(stream: ReadableStream, mimeType: string): [src: string, clean: VoidFunction] {
  const ms = new MediaSource()
  ms.addEventListener('sourceopen', async () => {
    const source = ms.addSourceBuffer(mimeType)
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        ms.endOfStream()
        return
      }
      if (source.updating) {
        await new Promise((resolve) => {
          source.addEventListener('updateend', resolve, { once: true })
        })
      }
      if (value instanceof ArrayBuffer) {
        source.appendBuffer(new Uint8Array(value))
      } else if (value instanceof Uint8Array) {
        source.appendBuffer(value)
      }
    }
  })
  const url = URL.createObjectURL(ms)
  return [
    url,
    () => {
      ms.endOfStream()
      URL.revokeObjectURL(url)
    },
  ]
}

export function isStreamTrack(track: Track | StreamTrack): track is StreamTrack {
  return typeof track.src === 'function'
}
