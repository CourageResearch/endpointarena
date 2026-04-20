const path = require('path')

const farcasterSolanaStub = path.resolve(__dirname, 'lib/privy-farcaster-solana-stub.js')

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  turbopack: {
    root: __dirname,
    resolveAlias: {
      '@farcaster/mini-app-solana': './lib/privy-farcaster-solana-stub.js',
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@farcaster/mini-app-solana': farcasterSolanaStub,
    }

    return config
  },
  async redirects() {
    return [
      {
        source: '/markets',
        destination: '/trials',
        permanent: true,
      },
      {
        source: '/markets/:path*',
        destination: '/trials/:path*',
        permanent: true,
      },
      {
        source: '/feb',
        destination: '/trials',
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'query',
            key: '_rsc',
          },
        ],
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
