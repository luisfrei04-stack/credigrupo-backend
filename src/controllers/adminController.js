const db = require('../config/db');

exports.dashboard = async (req, res) => {
  try {
    const [volume, receita, users, loans, inadimplencia] = await Promise.all([
      db.query(`SELECT 
        COALESCE(SUM(amount_requested) FILTER (WHERE status IN ('active','late')), 0) as volume_ativo,
        COALESCE(SUM(amount_requested) FILTER (WHERE status != 'open'), 0) as total_emprestado
       FROM loans`),
      db.query(`SELECT
        COALESCE(SUM(taxa_entrada), 0) as receita_entrada,
        COALESCE(SUM(taxa_parcela), 0) as receita_parcelas
       FROM loans l
       LEFT JOIN repayments r ON r.loan_id = l.id AND r.paid = true`),
      db.query(`SELECT
        COUNT(*) FILTER (WHERE type = 'investor') as total_investidores,
        COUNT(*) FILTER (WHERE type = 'borrower') as total_tomadores
       FROM users WHERE active = true`),
      db.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'open') as abertos,
        COUNT(*) FILTER (WHERE status = 'active') as ativos,
        COUNT(*) FILTER (WHERE status = 'late') as atrasados,
        COUNT(*) FILTER (WHERE status = 'completed') as concluidos
       FROM loans`),
      db.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'late')::float / NULLIF(COUNT(*) FILTER (WHERE status IN ('active','late','completed')),0) * 100 as taxa
       FROM loans`)
    ]);

    res.json({
      volume: volume.rows[0],
      receita: receita.rows[0],
      users: users.rows[0],
      loans: loans.rows[0],
      inadimplencia: parseFloat(inadimplencia.rows[0].taxa || 0).toFixed(1)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
};

exports.getAllLoans = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT l.*, b.name as borrower_name, i.name as investor_name
       FROM loans l
       LEFT JOIN users b ON l.borrower_id = b.id
       LEFT JOIN users i ON l.investor_id = i.id
       ORDER BY l.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar empréstimos' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, cpf, email, phone, type, balance, active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
};

exports.toggleUser = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE users SET active = NOT active WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
};

exports.getConfig = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM platform_config WHERE id = 1');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configuração' });
  }
};

exports.updateConfig = async (req, res) => {
  const { taxa_entrada_percent, taxa_parcela_reais } = req.body;
  try {
    await db.query(
      'UPDATE platform_config SET taxa_entrada_percent = $1, taxa_parcela_reais = $2, updated_at = NOW() WHERE id = 1',
      [taxa_entrada_percent, taxa_parcela_reais]
    );
    res.json({ success: true, message: 'Configurações salvas!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
};

exports.cancelLoan = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("UPDATE loans SET status = 'cancelled' WHERE id = $1 AND status = 'open'", [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao cancelar empréstimo' });
  }
};
