import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig({
  // base: '/price-update-frontend/', // Adjust if deploying to subfolder
  plugins: [
    nodePolyfills({
      // To exclude specific polyfills, add them to this list.
      exclude: [],
      // Whether to polyfill `node:` protocol imports.
      protocolImports: true,
      // Specific Modules that should be polyfilled.
      globals: {
        Buffer: true, // Ensure Buffer is polyfilled globally
        global: true,
        process: true,
      },
    }),
  ],
  define: {
    // By default, Vite doesn't include shims for NodeJS/CJS globals.
    'global': 'globalThis',
    'process.env': {}
  },
  resolve: {
    alias: {
      // Add aliases if needed, e.g., stream: 'stream-browserify'
    }
  },
  build: {
    target: 'esnext' // Ensure modern JS features are supported
  }
}); 