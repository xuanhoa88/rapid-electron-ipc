import { defineConfig } from 'tsup';

// Define entry points for the build
const entries = [
  './src/main/index.js', // Main process entry
  './src/preload/index.js', // Preload script entry
  './src/renderer/index.js', // Renderer process entry
  './src/common/index.js', // Shared utilities
];

export default defineConfig(() => ({
  // Define input files for bundling
  entry: entries,

  // Disable code splitting to generate a single output per format
  splitting: false,

  // Disable source maps for smaller builds
  sourcemap: false,

  // Disable minification for easier debugging (set to true for production)
  minify: false,

  // Clean the output directory before building
  clean: true,

  // Output formats: ESM (ES Modules) and CJS (CommonJS)
  format: ['esm', 'cjs'],

  // Generate TypeScript declaration files (d.ts)
  dts: {
    resolve: true, // Resolve types across dependencies
    entry: entries, // Use the same entry points for type generation
  },
}));
