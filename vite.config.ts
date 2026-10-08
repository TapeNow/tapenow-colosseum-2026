import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4310,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4311" },
  },
  build: { sourcemap: false },
});
