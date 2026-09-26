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
  test: {
    include: ['src/**/*.test.ts'],
    // hfp.ts uses window.setInterval/clearInterval (see its own comment on
    // that choice) - plain Node has no `window`, so the default 'node'
    // environment would throw as soon as connectVehiclePositions() runs.
    environment: 'happy-dom',
  },
});
