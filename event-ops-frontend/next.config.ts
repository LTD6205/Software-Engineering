import type { NextConfig } from 'next'

// The backend lives on port 3000. We proxy API and websocket traffic through
// the Next.js server so the browser only ever talks to the frontend's own
// origin. This means a single public URL (e.g. one ngrok tunnel) works for
// remote users, with no CORS setup and nothing pointing at "localhost".
const BACKEND = process.env.BACKEND_ORIGIN || 'http://localhost:3000'

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Allow the dev server to serve assets when the app is opened from a tunnel
  // domain (e.g. ngrok) instead of localhost. Without this, Next.js 16 blocks
  // cross-origin dev requests and the page is stuck on "Loading...".
  allowedDevOrigins: [
    '*.ngrok-free.dev',
    '*.ngrok-free.app',
    '*.ngrok.app',
    '*.ngrok.io',
  ],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${BACKEND}/socket.io/:path*` },
    ]
  },
}

export default nextConfig
