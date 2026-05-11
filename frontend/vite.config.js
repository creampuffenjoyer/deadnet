import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const _sig = Buffer.from('hidden: /terminal | key: up up down down left right left right B A').toString('base64')

const _banner = `/*
 * ·▄▄▄▄  ▄▄▄ . ▄▄▄· ·▄▄▄▄  ▐ ▄ ▄▄▄ .▄▄▄▄▄
 * ██▪ ██ ▀▄.▀·▐█ ▀█ ██▪ ██ •█▌▐█▀▄.▀·•██
 * ▐█· ▐█▌▐▀▀▪▄▄█▀▀█ ▐█· ▐█▌▐█▐▐▌▐▀▀▪▄ ▐█.▪
 * ██. ██ ▐█▄▄▌▐█ ▪▐▌██. ██ ██▐█▌▐█▄▄▌ ▐█▌·
 * ▀▀▀▀▀•  ▀▀▀  ▀  ▀ ▀▀▀▀▀• ▀▀ █▪ ▀▀▀  ▀▀▀
 *
 * DEADNET — Built by s0L
 * "the void is not empty as everyone may seem"
 *
 * ${_sig}
 */`

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        banner: _banner,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // Polling required for hot reload inside Docker on Windows
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      '/files': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
      '/organizations': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
})
