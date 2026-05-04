/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack is the default bundler in Next.js 16
  // Web Workers using `new Worker(new URL(...), { type: 'module' })`
  // are supported natively by Turbopack without additional config.
  turbopack: {},
};

export default nextConfig;
