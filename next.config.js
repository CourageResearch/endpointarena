/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', 'better-sqlite3'],
  turbopack: {
    root: __dirname,
  },
}

module.exports = nextConfig
