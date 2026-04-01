/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  turbopack: {
    root: __dirname,
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
