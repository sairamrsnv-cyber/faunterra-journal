/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',          // Static export for Cloudflare Pages
  images: {
    unoptimized: true,       // Required for static export
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  trailingSlash: true,
};

export default nextConfig;
