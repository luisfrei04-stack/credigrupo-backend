const db = require('../config/db');

exports.dashboard = async (req, res) => {
  const id = req.user.id;
  try {
    const [user, loans, receita] = await Promise.all([
      db.query('SELECT balance FROM users WHERE id = $1', [id]),
      db.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'active') as ativos,
        COUNT(*) FILTER (WHERE status = 'late') as atrasados,
        COUNT(*) FILTER (WHERE status = 'completed') as concluidos,
        COALESCE(SUM(amount_requested) FILTER (WHERE status IN ('active','late','completed')), 0) as total_investido
       FROM loans WHERE investor_id = $1`, [id]),
      db.query(`SELECT COALESCE(SUM(t.amount), 0) as total_recebido
       FROM transactions t WHERE t.user_id = $1 AND t.type = 'repayment'`, [id])
    ]);

    const totalInvestido = parseFloat(loans.rows[0].total_investido);
    const totalRecebido = parseFloat(receita.rows[0].total_recebido);
    const roi = totalInvestido > 0 ? ((totalRecebido - totalInvestido) / totalInvestido * 100).toFixed(1) : 0;

    res.json({
      saldo: parseFloat(user.rows[0].balance),
      total_investido: totalInvestido,
      total_recebido: totalRecebido,
      roi,
      ...loans.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
};

exports.extrato = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar extrato' });
  }
};

exports.deposit = async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor inválido' });

  try {
    await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, req.user.id]);
    await db.query(
      'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1,$2,$3,$4)',
      [req.user.id, 'deposit', amount, 'Depósito via PIX']
    );
    res.json({ success: true, message: 'Depósito realizado!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao depositar' });
  }
};

exports.withdraw = async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valor inválido' });

  try {
    const userRes = await db.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
    if (parseFloat(userRes.rows[0].balance) < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    await db.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, req.user.id]);
    await db.query(
      'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1,$2,$3,$4)',
      [req.user.id, 'withdraw', amount, 'Saque via PIX']
    );

    res.json({ success: true, message: 'Saque solicitado! Prazo: 1 dia útil.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao sacar' });
  }
};
