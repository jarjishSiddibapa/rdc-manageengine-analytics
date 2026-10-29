import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_API_TARGET lets a second backend be used while developing (default: the normal app port).
const target = process.env.VITE_API_TARGET || 'http://localhost:7780'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target, changeOrigin: true } } },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // React and the router change rarely, so they get their own long-cached chunk; everything else splits along the lazy routes.
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
})
