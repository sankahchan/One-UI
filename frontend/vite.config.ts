import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // In production, VITE_PANEL_PATH sets the base path for asset loading.
  // e.g., VITE_PANEL_PATH=/a1b2c3d4 → base: '/a1b2c3d4/'
  const panelPath = process.env.VITE_PANEL_PATH?.replace(/\/+$/, '') || '';
  const base = panelPath ? `${panelPath}/` : '/';

  return {
    plugins: [react()],
    base,
  }
})
