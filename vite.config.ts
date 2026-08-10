import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep heavy libs in their own chunks so the initial page bundle stays lean
        // and repeat visits hit browser cache for large vendor code that rarely changes.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs'
          if (id.includes('pdf-lib')) return 'vendor-pdflib'
          if (id.includes('@radix-ui')) return 'vendor-radix'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('react-dom')) return 'vendor-react'
          if (id.includes('/react/')) return 'vendor-react'
          if (id.includes('@fontsource')) return 'vendor-fonts'
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
