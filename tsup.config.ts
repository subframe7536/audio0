import { defineConfig } from 'tsup'

export default defineConfig({
  dts: true,
  clean: true,
  format: ['esm', 'cjs'],
  entry: ['./src/index.ts'],
  noExternal: ['weighted-shuffle'],
  treeshake: true,
})
