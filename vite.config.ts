import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs work for both user/organization Pages and project Pages.
  // This app has no client-side routes, so a fixed /<repo>/ base is unnecessary.
  base: './',
});
