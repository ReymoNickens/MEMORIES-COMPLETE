import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@evolveit/shared', '@evolveit/ui'],
  experimental: {
    serverComponentsExternalPackages: ['otpauth'],
  },
}

export default nextConfig
