import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GunRaid',
    short_name: 'GunRaid',
    start_url: '/',
    display: 'standalone',
    background_color: '#121117',
    theme_color: '#121117',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
