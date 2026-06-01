// Resolve the WebSocket (socket.io) endpoint.
//
// The Next.js dev server cannot proxy WebSocket traffic, so we can't always use
// the same origin. We pick the right target automatically:
//   • Explicit NEXT_PUBLIC_WS_URL set        -> use it (manual override).
//   • Opened directly on the Next port :3001 -> talk to the backend on :3000.
//   • Anything else (behind the share proxy   -> same origin; the proxy forwards
//     or an ngrok tunnel on its own port)        /socket.io to the backend.
//
// Returns `undefined` to mean "connect to the same origin".
export function getWsUrl(): string | undefined {
  const override = process.env.NEXT_PUBLIC_WS_URL
  if (override) return override

  if (typeof window !== 'undefined' && window.location.port === '3001') {
    return `${window.location.protocol}//${window.location.hostname}:3000`
  }
  return undefined
}
