import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

/**
 * Parse a cookie header string into an object of key-value pairs.
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

export default async function wsRoutes(app) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    // Verify JWT token from cookies before allowing WebSocket interaction
    let wsUser = null;
    try {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.token) {
        wsUser = jwt.verify(cookies.token, JWT_SECRET);
      }
    } catch {
      // Invalid or missing token
    }

    if (!wsUser) {
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
      socket.close(4401, 'Unauthorized');
      return;
    }

    socket.userId = wsUser.id;

    socket.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        // Handle: join_match, leave_match, match_update
        if (data.type === 'join_match') {
          socket.matchId = data.matchId;
          socket.send(JSON.stringify({ type: 'joined', matchId: data.matchId }));
        }
        if (data.type === 'leave_match') {
          socket.matchId = null;
          socket.send(JSON.stringify({ type: 'left' }));
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });
    socket.on('close', () => {
      // Cleanup
      socket.matchId = null;
    });
  });
}
