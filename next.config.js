/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', 'better-sqlite3'],
}

module.exports = nextConfig
