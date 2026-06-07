import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  envPrefix: ["VITE_", "BUN_PUBLIC_", "RPC_URL"],
  server: {
    port: 3000,
  },
  plugins: [tanstackStart(), react(), tailwindcss()],
});
