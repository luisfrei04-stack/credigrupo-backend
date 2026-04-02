const db = require('../config/db');
const { gerarCodigo, calcularParcelas, gerarDatasVencimento } = require('../utils/helpers');

exports.createLoan = async (req, res) => {
  const { amount_requested, installments } = req.body;

  if (!amount_requested || !installments) {
    return res.status(400).json({ error: 'Valor e número de parcelas obrigatórios' });
  }

  if (amount_requested < 100) return res.status(400).json({ error: 'Valor mínimo: R$ 100' });
  if (installments < 1 || installments > 48) return res.status(400).json({ error: 'Prazo entre 1 e 48 meses' });

  try {
    const config = await db.query('SELECT * FROM platform_config WHERE id = 1');
    const { taxa_entrada_percent, taxa_parcela_reais } = config.rows[0];

    const taxa_entrada = parseFloat((amount_requested * taxa_entrada_percent / 100).toFixed(2));
    const amount_contract = parseFloat((parseFloat(amount_requested) + taxa_entrada).toFixed(2));
    const installment_value = calcularParcelas(amount_contract, installments, taxa_parcela_reais);

    let code, exists;
    do {
      code = gerarCodigo();
      exists = await db.query('SELECT id FROM loans WHERE code = $1', [code]);
    } while (exists.rows.length > 0);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const result = await db.query(
      `INSERT INTO loans (code, borrower_id, amount_requested, amount_contract, taxa_entrada, installments, installment_value, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [code, req.user.id, amount_requested, amount_contract, taxa_entrada, installments, installment_value, expiresAt]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar empréstimo' });
  }
};

exports.getByCode = async (req, res) => {
  const { code } = req.params;
  try {
    const result = await db.query(
      `SELECT l.*, u.name as borrower_name FROM loans l
       JOIN users u ON l.borrower_id = u.id
       WHERE l.code = $1`,
      [code.toUpperCase()]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Código inválido ou não encontrado' });

    const loan = result.rows[0];
    if (loan.status !== 'open') return res.status(400).json({ error: 'Este empréstimo já foi financiado ou cancelado' });
    if (new Date() > new Date(loan.expires_at)) return res.status(400).json({ error: 'Código expirado' });

    res.json(loan);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar código' });
  }
};

exports.fundLoan = async (req, res) => {
  const { code } = req.body;
  const investor_id = req.user.id;

  try {
    const loanRes = await db.query('SELECT * FROM loans WHERE code = $1', [code.toUpperCase()]);
    if (loanRes.rows.length === 0) return res.status(404).json({ error: 'Código inválido' });

    const loan = loanRes.rows[0];
    if (loan.status !== 'open') return res.status(400).json({ error: 'Empréstimo já financiado' });
    if (new Date() > new Date(loan.expires_at)) return res.status(400).json({ error: 'Código expirado' });
    if (loan.borrower_id === investor_id) return res.status(400).json({ error: 'Você não pode financiar seu próprio empréstimo' });

    const investorRes = await db.query('SELECT balance FROM users WHERE id = $1', [investor_id]);
    const investor = investorRes.rows[0];
    if (parseFloat(investor.balance) < parseFloat(loan.amount_requested)) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [loan.amount_requested, investor_id]);
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [loan.amount_requested, loan.borrower_id]);

      await client.query(
        'UPDATE loans SET status = $1, investor_id = $2, funded_at = NOW() WHERE id = $3',
        ['active', investor_id, loan.id]
      );

      const datas = gerarDatasVencimento(loan.installments);
      const config = await client.query('SELECT taxa_parcela_reais FROM platform_config WHERE id = 1');
      const taxa_parcela = config.rows[0].taxa_parcela_reais;

      for (let i = 0; i < datas.length; i++) {
        await client.query(
          'INSERT INTO repayments (loan_id, installment_number, due_date, amount, taxa_parcela) VALUES ($1,$2,$3,$4,$5)',
          [loan.id, i + 1, datas[i], loan.installment_value, taxa_parcela]
        );
      }

      await client.query(
        'INSERT INTO transactions (user_id, type, amount, description, loan_id) VALUES ($1,$2,$3,$4,$5)',
        [investor_id, 'invest', loan.amount_requested, `Investimento CRD-${loan.code}`, loan.id]
      );

      await client.query('COMMIT');
      res.json({ success: true, message: 'Empréstimo liberado com sucesso!', loan_id: loan.id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao liberar empréstimo' });
  }
};

exports.myLoans = async (req, res) => {
  try {
    const field = req.user.type === 'investor' ? 'investor_id' : 'borrower_id';
    const result = await db.query(
      `SELECT l.*, 
        (SELECT COUNT(*) FROM repayments r WHERE r.loan_id = l.id AND r.paid = true) as parcelas_pagas,
        (SELECT COUNT(*) FROM repayments r WHERE r.loan_id = l.id) as total_parcelas
       FROM loans l WHERE l.${field} = $1 ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar empréstimos' });
  }
};

exports.getLoanDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const loanRes = await db.query(
      `SELECT l.*, 
        b.name as borrower_name, b.cpf as borrower_cpf,
        i.name as investor_name
       FROM loans l
       LEFT JOIN users b ON l.borrower_id = b.id
       LEFT JOIN users i ON l.investor_id = i.id
       WHERE l.id = $1`,
      [id]
    );
    if (loanRes.rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });

    const parcelas = await db.query(
      'SELECT * FROM repayments WHERE loan_id = $1 ORDER BY installment_number',
      [id]
    );

    res.json({ ...loanRes.rows[0], repayments: parcelas.rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar detalhe' });
  }
};

exports.payInstallment = async (req, res) => {
  const { repayment_id } = req.body;
  try {
    const repRes = await db.query(
      'SELECT r.*, l.investor_id, l.taxa_entrada FROM repayments r JOIN loans l ON r.loan_id = l.id WHERE r.id = $1',
      [repayment_id]
    );
    if (repRes.rows.length === 0) return res.status(404).json({ error: 'Parcela não encontrada' });

    const rep = repRes.rows[0];
    if (rep.paid) return res.status(400).json({ error: 'Parcela já paga' });

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      await client.query('UPDATE repayments SET paid = true, paid_at = NOW() WHERE id = $1', [repayment_id]);

      const valorInvestidor = parseFloat(rep.amount) - parseFloat(rep.taxa_parcela);
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [valorInvestidor, rep.investor_id]);

      await client.query(
        'INSERT INTO transactions (user_id, type, amount, description, loan_id) VALUES ($1,$2,$3,$4,$5)',
        [rep.investor_id, 'repayment', valorInvestidor, `Parcela ${rep.installment_number} recebida`, rep.loan_id]
      );

      const pendentes = await client.query(
        'SELECT COUNT(*) FROM repayments WHERE loan_id = $1 AND paid = false',
        [rep.loan_id]
      );
      if (parseInt(pendentes.rows[0].count) === 0) {
        await client.query('UPDATE loans SET status = $1 WHERE id = $2', ['completed', rep.loan_id]);
      }

      await client.query('COMMIT');
      res.json({ success: true, message: 'Parcela paga com sucesso!' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: 'Erro ao pagar parcela' });
  }
};
