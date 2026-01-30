import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), tanstackRouter({}), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3001,
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy, self-contained libs to load in parallel and cache separately
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (id.includes("jspdf") || id.includes("html2canvas")) return "pdf";
            if (id.includes("lucide-react")) return "icons";
            if (id.includes("socket.io-client")) return "socket";
          }
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
