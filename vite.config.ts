import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    // Resolve the `~/*` alias from tsconfig.json natively (Vite 8+).
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    // Nitro builds the production server to `.output/server/index.mjs` and
    // traces native deps (better-sqlite3) into `.output`. Without it, Start
    // emits a bare `{ fetch }` handler to `dist/` that can't listen on a port.
    nitro({
      plugins: ['./src/server/database-plugin.ts'],
    }),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
})
