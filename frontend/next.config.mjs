/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // When NEXT_PUBLIC_API_URL is empty the browser calls /api/* on the frontend origin,
  // and Next.js proxies it to the backend (BACKEND_INTERNAL_URL inside Docker).
  async rewrites() {
    const target = process.env.BACKEND_INTERNAL_URL || 'http://localhost:5000';
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
