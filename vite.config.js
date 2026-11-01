import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const dracoDirectory = path.resolve(path.dirname(require.resolve('three')), '../examples/jsm/libs/draco/gltf')
const decoderFiles = ['draco_decoder.js', 'draco_wasm_wrapper.js', 'draco_decoder.wasm']

// Keep the model decoder local in development and in the production artifact.
function localDraco() {
  return {
    name: 'local-draco',
    configureServer(server) {
      server.middlewares.use('/draco', async (request, response, next) => {
        const name = request.url?.split('?')[0].replace(/^\//, '')
        if (!decoderFiles.includes(name)) return next()
        try {
          const bytes = await readFile(path.join(dracoDirectory, name))
          response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
          response.setHeader('Cache-Control', 'public, max-age=86400')
          response.end(bytes)
        } catch (error) {
          next(error)
        }
      })
    },
    async generateBundle() {
      await Promise.all(decoderFiles.map(async (name) => {
        this.emitFile({ type: 'asset', fileName: `draco/${name}`, source: await readFile(path.join(dracoDirectory, name)) })
      }))
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/printstream-studio/' : '/',
  plugins: [react(), localDraco()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
}))
