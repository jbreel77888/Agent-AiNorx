/**
 * WebSocket polyfill for Node.js < 22.
 * If global WebSocket is already available (Node 22+, Bun, browsers), this is a no-op.
 * Otherwise, it loads the `ws` package and assigns it to globalThis.WebSocket.
 */
if (typeof globalThis.WebSocket === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    globalThis.WebSocket = ws.default || ws;
  } catch {
    console.error(
      '[agent-tunnel] WebSocket is not available. Install the "ws" package or use Node.js 22+.',
    );
    process.exit(1);
  }
}
