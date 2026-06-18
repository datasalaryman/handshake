import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  envPrefix: ["VITE_", "BUN_PUBLIC_", "RPC_URL", "VECTOR_PROGRAM"],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      crypto: fileURLToPath(new URL("./src/lib/nodeCryptoShim.ts", import.meta.url)),
    },
  },
  server: {
    port: 3000,
  },
  plugins: [tanstackStart(), react(), tailwindcss()],
});
