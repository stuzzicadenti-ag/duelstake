export default async function wsRoutes(app) {
  app.get('/ws', { websocket: true }, (socket, req) => {
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
