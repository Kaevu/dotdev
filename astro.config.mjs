// @ts-check

import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';


export default defineConfig({
  site: 'https://kaevu.dev',
  output: 'static',
  adapter: cloudflare(),
  integrations: [react(), sitemap()],

  vite: {
    plugins: [tailwindcss()],
  },
});
