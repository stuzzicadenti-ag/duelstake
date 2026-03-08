import { pool } from '../db/schema.js';
import { logUserActivity } from './admin.js';

export default async function walletRoutes(app) {
  // GET /wallet - Balance + transaction history
  app.get('/', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');

    const userId = request.user.id;

    const userResult = await pool.query(
      'SELECT wallet_balance, kyc_status FROM users WHERE id = $1',
      [userId]
    );

    const transactions = await pool.query(
      `SELECT * FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    const kycStatus = userResult.rows[0]?.kyc_status || 'none';

    // Calculate deposit/withdrawal totals for billing view (Task 9)
    const totals = await pool.query(
      `SELECT type, COALESCE(SUM(ABS(amount)), 0) as total
       FROM wallet_transactions
       WHERE user_id = $1
       GROUP BY type`,
      [userId]
    );
    const totalsByType = {};
    totals.rows.forEach(r => { totalsByType[r.type] = parseFloat(r.total); });

    return reply.view('wallet/index.ejs', {
      user: request.user,
      balance: userResult.rows[0]?.wallet_balance || 0,
      transactions: transactions.rows,
      error: request.query.error || null,
      success: request.query.success || null,
      kycStatus,
      totalsByType,
    });
  });

  // POST /wallet/deposit - Mock deposit
  app.post('/deposit', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');
    if (app.checkActionRateLimit && !app.checkActionRateLimit(request, reply)) return;

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
      logUserActivity(userId, 'deposit', request.ip, `Deposited ${depositAmount}`);
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
    if (app.checkActionRateLimit && !app.checkActionRateLimit(request, reply)) return;

    const userId = request.user.id;
    const { amount } = request.body;
    const withdrawAmount = parseFloat(amount);

    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return reply.redirect('/wallet?error=invalid_amount');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock user row to prevent race conditions on concurrent withdrawals
      const balance = await client.query(
        'SELECT wallet_balance, kyc_status FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );

      const currentBalance = parseFloat(balance.rows[0].wallet_balance);
      const kycStatus = balance.rows[0].kyc_status || 'none';

      if (currentBalance <= 0) {
        await client.query('ROLLBACK');
        return reply.redirect('/wallet?error=no_funds');
      }

      if (currentBalance < withdrawAmount) {
        await client.query('ROLLBACK');
        return reply.redirect('/wallet?error=insufficient');
      }

      // KYC limit check: unverified users max 100/day
      if (kycStatus !== 'verified') {
        const todayWithdrawals = await client.query(
          `SELECT COALESCE(SUM(ABS(amount)), 0) as total
           FROM wallet_transactions
           WHERE user_id = $1 AND type = 'withdrawal' AND created_at >= CURRENT_DATE`,
          [userId]
        );
        const todayTotal = parseFloat(todayWithdrawals.rows[0].total);
        if (todayTotal + withdrawAmount > 100) {
          await client.query('ROLLBACK');
          return reply.redirect('/wallet?error=kyc_limit');
        }
      }

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
      logUserActivity(userId, 'withdrawal', request.ip, `Withdrew ${withdrawAmount}`);
      return reply.redirect('/wallet?success=withdraw');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
