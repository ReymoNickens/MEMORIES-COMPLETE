// Next 14 does not load next.config.ts — it refuses to build and tells you to
// rename the file. This config had been a .ts since the repo was created, so
// `next build` had never once succeeded and neither transpilePackages nor the
// otpauth externals setting had ever been applied. Nothing in CI built the
// app, so nobody found out.
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@evolveit/shared'],
  experimental: {
    serverComponentsExternalPackages: ['otpauth'],
  },
}

export default nextConfig
