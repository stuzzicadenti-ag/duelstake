import { pool } from '../db/schema.js';

export default async function walletRoutes(app) {
  // GET /wallet - Balance + transaction history
  app.get('/', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');

    const userId = request.user.id;

    const userResult = await pool.query(
      'SELECT wallet_balance FROM users WHERE id = $1',
      [userId]
    );

    const transactions = await pool.query(
      `SELECT * FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    return reply.view('wallet/index.ejs', {
      user: request.user,
      balance: userResult.rows[0]?.wallet_balance || 0,
      transactions: transactions.rows,
      error: request.query.error || null,
      success: request.query.success || null,
    });
  });

  // POST /wallet/deposit - Mock deposit
  app.post('/deposit', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');

    const userId = request.user.id;
    const { amount } = request.body;
    const depositAmount = parseFloat(amount);

    if (isNaN(depositAmount) || depositAmount <= 0 || depositAmount > 10000) {
      return reply.redirect('/wallet?error=invalid_amount');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
        [depositAmount, userId]
      );

      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, description)
         VALUES ($1, 'deposit', $2, 'Mock deposit')`,
        [userId, depositAmount]
      );

      await client.query('COMMIT');
      return reply.redirect('/wallet?success=deposit');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /wallet/withdraw - Mock withdraw
  app.post('/withdraw', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');

    const userId = request.user.id;
    const { amount } = request.body;
    const withdrawAmount = parseFloat(amount);

    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return reply.redirect('/wallet?error=invalid_amount');
    }

    const balance = await pool.query(
      'SELECT wallet_balance FROM users WHERE id = $1',
      [userId]
    );

    if (parseFloat(balance.rows[0].wallet_balance) < withdrawAmount) {
      return reply.redirect('/wallet?error=insufficient');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2',
        [withdrawAmount, userId]
      );

      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, description)
         VALUES ($1, 'withdrawal', $2, 'Mock withdrawal')`,
        [userId, -withdrawAmount]
      );

      await client.query('COMMIT');
      return reply.redirect('/wallet?success=withdraw');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
