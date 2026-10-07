import vue from '@vitejs/plugin-vue';
// vitest/config re-exports Vite's defineConfig with the `test` field typed -
// importing from plain 'vite' here would make that field a type error.
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  build: {
    rolldownOptions: {
      output: {
        // The map library and the MQTT client are most of the bundle's weight
        // and change only when their versions do. Kept in their own hashed
        // chunks, a deploy that touches app code leaves both of them valid in
        // everyone's cache instead of making the whole ~400 kB download again.
        advancedChunks: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/ },
            { name: 'mqtt', test: /node_modules[\\/]mqtt[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // hfp.ts uses window.setInterval/clearInterval (see its own comment on
    // that choice) - plain Node has no `window`, so the default 'node'
    // environment would throw as soon as connectVehiclePositions() runs.
    environment: 'happy-dom',
  },
});
