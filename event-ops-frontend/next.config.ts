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
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${BACKEND}/socket.io/:path*` },
    ]
  },
}

export default nextConfig
