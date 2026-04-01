/** @type {import('next').NextConfig} */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url) // Get the file's absolute path
const __dirname = path.dirname(__filename) // Get the directory name of the file

const nextConfig = {
  reactStrictMode: false,
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
  redirects: async () => [
    {
      source: '/app',
      destination: '/app/redirect',
      permanent: false,
    },
    {
      source: '/admin',
      destination: '/admin/redirect',
      permanent: false,
    },
  ],
}

export default nextConfig
