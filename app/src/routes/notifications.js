import { pool } from '../db/schema.js';

export default async function notificationRoutes(app) {

  // GET /notifications - List all notifications
  app.get('/', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');

    const userId = request.user.id;

    const notifications = await pool.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );

    // Mark all as read
    await pool.query(
      `UPDATE notifications SET read = true
       WHERE user_id = $1 AND read = false`,
      [userId]
    );

    return reply.view('notifications/index.ejs', {
      user: request.user,
      notifications: notifications.rows,
    });
  });

  // GET /notifications/count - JSON API for unread count (used by nav)
  app.get('/count', async (request, reply) => {
    if (!request.user) return reply.send({ count: 0 });

    const result = await pool.query(
      `SELECT COUNT(*) as count FROM notifications
       WHERE user_id = $1 AND read = false`,
      [request.user.id]
    );

    return reply.send({ count: parseInt(result.rows[0].count) });
  });

  // POST /notifications/:id/read - Mark single notification as read
  app.post('/:id/read', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' });

    const notifId = parseInt(request.params.id);
    await pool.query(
      `UPDATE notifications SET read = true
       WHERE id = $1 AND user_id = $2`,
      [notifId, request.user.id]
    );

    return reply.send({ ok: true });
  });
}
