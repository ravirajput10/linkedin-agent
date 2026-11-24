import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Local dev servers for the web app; always trusted. */
const DEV_APP_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://localhost:8000', 'http://127.0.0.1:8000', 'https://staging.divergentsl.com']

/**
 * `VITE_APP_ORIGIN` is a comma-separated list of web app origins, read from
 * the repo-root `.env` (or the environment). Each deployment sets its own.
 */
function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value)
      const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      if (url.protocol !== 'https:' && !local) {
        throw new Error(`VITE_APP_ORIGIN must use https: ${value}`)
      }
      return url.origin
    })
}

/**
 * Narrows the built extension to the trusted web app origins.
 *
 * Files in `public/` are copied verbatim, so the manifest's content script
 * matches and host permissions, and the service worker's allowlist, are
 * rewritten in `dist/` after the copy. The checked-in copies list only the
 * dev origins, which keeps an unbuilt load of `public/` safe too.
 */
function trustedAppOrigins(origins: string[]): Plugin {
  let outDir = 'dist'
  return {
    name: 'trusted-app-origins',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const patterns = origins.map((origin) => `${origin}/*`)

      const manifestPath = path.join(outDir, 'manifest.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      manifest.content_scripts[0].matches = patterns
      manifest.host_permissions = [...new Set([...manifest.host_permissions, ...patterns])]
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

      const workerPath = path.join(outDir, 'service_worker.js')
      const worker = fs.readFileSync(workerPath, 'utf8')
      const allowlist = /const TRUSTED_APP_ORIGINS = \[[^\]]*\];/
      if (!allowlist.test(worker)) {
        throw new Error('service_worker.js no longer declares TRUSTED_APP_ORIGINS')
      }
      fs.writeFileSync(
        workerPath,
        worker.replace(allowlist, `const TRUSTED_APP_ORIGINS = ${JSON.stringify(origins)};`),
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Only this one key: the root .env also holds the web app's VITE_* values,
  // which must not leak into the extension's own import.meta.env.
  const env = loadEnv(mode, path.resolve(here, '..'), 'VITE_APP_ORIGIN')
  const origins = [...new Set([...DEV_APP_ORIGINS, ...parseOrigins(env.VITE_APP_ORIGIN)])]

  return {
    base: './',
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      trustedAppOrigins(origins),
    ],
  }
})
