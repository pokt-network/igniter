/** @type {import('next').NextConfig} */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url) // Get the file's absolute path
const __dirname = path.dirname(__filename) // Get the directory name of the file

// Security headers on every response. The CSP sets only frame-ancestors on
// purpose: a script-src policy would break the Next.js inline scripts and the
// wallet extension flows unless it is built and tested with nonces.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
]

const nextConfig = {
  poweredByHeader: false,
  // The app does not use next/image: turn the image optimizer off and allow no local or remote
  // source, so /_next/image cannot be used to make the server fetch anything.
  images: { unoptimized: true, remotePatterns: [], localPatterns: [] },
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  transpilePackages: ['@igniter/logger', '@igniter/db', '@igniter/commons'],
  webpack: (config) => {
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    })

    config.resolve.fallback = { fs: false }

    return config
  },
  output: 'standalone',
}

export default nextConfig
