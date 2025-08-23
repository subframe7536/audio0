import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  dts: { oxc: true, resolve: true },
  format: ['esm', 'cjs'],
  exports: true,
})
