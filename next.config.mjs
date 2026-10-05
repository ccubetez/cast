/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone-бандл для Docker (prod deploy, Railway/Fly): node server.js
  output: 'standalone',
  // security headers (alpha-readiness 1.4)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
