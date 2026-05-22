import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 5174,
    proxy: {
      "/wds-api": {
        target: "https://redive.estertion.win",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wds-api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "./index.html",
      },
    },
  },
});
