import { defineConfig } from 'vitest/config'
import path from 'node:path'

const __dirname = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
