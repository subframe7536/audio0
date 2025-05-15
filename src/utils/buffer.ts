/**
 * Creates a URL for an ArrayBuffer and returns both the URL and a cleanup function.
 * @param buf - The ArrayBuffer to create a URL for
 * @param type - The MIME type of the buffer content
 * @example
 * ```ts
 * // Use the URL
 * const [url, cleanup] = useArrayBuffer(audioBuffer, 'audio/wav')
 * // Call when done to free memory
 * cleanup()
 * ```
 */
export function useArrayBuffer(buf: ArrayBuffer, type: string): [url: string, cleanup: VoidFunction] {
  const blob = new Blob([buf], { type })
  const url = URL.createObjectURL(blob)

  return [
    url,
    () => URL.revokeObjectURL(url),
  ]
}
