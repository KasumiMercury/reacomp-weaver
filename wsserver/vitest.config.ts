import {defineConfig} from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'path'

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, './src'),
      'cloudflare:workers': path.resolve(__dirname, './src/__tests__/__mocks__/cloudflare-workers.ts')
    }
  },
  test: {
    globals: true
  },
})
