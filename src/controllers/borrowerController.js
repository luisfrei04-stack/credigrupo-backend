const db = require('../config/db');
const celcoin = require('../services/celcoinService');

// ─── 1. Dashboard da conta do tomador ────────────────────────────────────────
exports.dashboard = async (req, res) => {
  const userId = req.user.id;
  try {
    const [userRes, loansRes, parcelasRes] = await Promise.all([
      db.query('SELECT balance, name, celcoin_account, celcoin_agency FROM users WHERE id=$1', [userId]),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')   as ativos,
          COUNT(*) FILTER (WHERE status = 'late')     as atrasados,
          COUNT(*) FILTER (WHERE status = 'completed') as concluidos,
          COALESCE(SUM(amount_requested) FILTER (WHERE status IN ('active','late','completed')), 0) as total_tomado,
          COALESCE(SUM(amount_contract)  FILTER (WHERE status IN ('active','late','completed')), 0) as total_contrato
        FROM loans WHERE borrower_id=$1`, [userId]),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE r.paid = true)  as pagas,
          COUNT(*) FILTER (WHERE r.paid = false AND r.due_date < CURRENT_DATE) as atrasadas,
          COUNT(*) FILTER (WHERE r.paid = false AND r.due_date >= CURRENT_DATE) as futuras,
          COALESCE(SUM(r.amount) FILTER (WHERE r.paid = true), 0) as total_pago,
          COALESCE(SUM(r.amount) FILTER (WHERE r.paid = false), 0) as total_restante
        FROM repayments r
        JOIN loans l ON r.loan_id = l.id
        WHERE l.borrower_id=$1`, [userId]),
    ]);

    const u  = userRes.rows[0];
    const lo = loansRes.rows[0];
    const pa = parcelasRes.rows[0];

    // Próxima parcela a vencer
    const { rows: [proxima] } = await db.query(`
      SELECT r.*, l.code, l.periodicidade
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.borrower_id=$1 AND r.paid=false AND l.status IN ('active','late')
      ORDER BY r.due_date ASC LIMIT 1`, [userId]);

    res.json({
      saldo:          parseFloat(u.balance),
      conta:          u.celcoin_account,
      agencia:        u.celcoin_agency,
      emprestimos: {
        ativos:     parseInt(lo.ativos),
        atrasados:  parseInt(lo.atrasados),
        concluidos: parseInt(lo.concluidos),
        totalTomado:   parseFloat(lo.total_tomado),
        totalContrato: parseFloat(lo.total_contrato),
      },
      parcelas: {
        pagas:        parseInt(pa.pagas),
        atrasadas:    parseInt(pa.atrasadas),
        futuras:      parseInt(pa.futuras),
        totalPago:    parseFloat(pa.total_pago),
        totalRestante: parseFloat(pa.total_restante),
      },
      proximaParcela: proxima || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
};

// ─── 2. Lista de empréstimos do tomador ──────────────────────────────────────
exports.meusEmprestimos = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(`
      SELECT l.*,
        i.name as investor_name,
        (SELECT COUNT(*) FROM repayments r WHERE r.loan_id=l.id AND r.paid=true)  as parcelas_pagas,
        (SELECT COUNT(*) FROM repayments r WHERE r.loan_id=l.id)                  as total_parcelas,
        (SELECT SUM(r.amount) FROM repayments r WHERE r.loan_id=l.id AND r.paid=true) as valor_pago,
        (SELECT MIN(r.due_date) FROM repayments r WHERE r.loan_id=l.id AND r.paid=false) as proxima_parcela
      FROM loans l
      LEFT JOIN users i ON l.investor_id=i.id
      WHERE l.borrower_id=$1
      ORDER BY l.created_at DESC`, [userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar empréstimos' });
  }
};

// ─── 3. Detalhe de um empréstimo com todas as parcelas ───────────────────────
exports.detalheEmprestimo = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const { rows: [loan] } = await db.query(`
      SELECT l.*, i.name as investor_name
      FROM loans l LEFT JOIN users i ON l.investor_id=i.id
      WHERE l.id=$1 AND l.borrower_id=$2`, [id, userId]);

    if (!loan) return res.status(404).json({ error: 'Empréstimo não encontrado' });

    const { rows: parcelas } = await db.query(
      'SELECT * FROM repayments WHERE loan_id=$1 ORDER BY installment_number', [id]
    );

    res.json({ ...loan, parcelas });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar detalhe' });
  }
};

// ─── 4. Gerar PIX para pagar uma parcela ─────────────────────────────────────
exports.gerarPixParcela = async (req, res) => {
  const { repayment_id } = req.body;
  const userId = req.user.id;
  try {
    const { rows: [rep] } = await db.query(`
      SELECT r.*, l.borrower_id, l.code, l.id as loan_id
      FROM repayments r JOIN loans l ON r.loan_id=l.id
      WHERE r.id=$1`, [repayment_id]);

    if (!rep) return res.status(404).json({ error: 'Parcela não encontrada' });
    if (rep.borrower_id !== userId) return res.status(403).json({ error: 'Acesso negado' });
    if (rep.paid) return res.status(400).json({ error: 'Parcela já paga' });

    // Se já tem QR Code válido, reutiliza
    if (rep.pix_qr && rep.pix_expires_at && new Date(rep.pix_expires_at) > new Date()) {
      return res.json({
        qrCode:      rep.pix_qr,
        amount:      rep.amount,
        expiresAt:   rep.pix_expires_at,
        installment: rep.installment_number,
        loanCode:    rep.code,
      });
    }

    // Gera novo QR Code PIX via Celcoin
    const { rows: [user] } = await db.query('SELECT name FROM users WHERE id=$1', [userId]);
    const pix = await celcoin.gerarPixParcela({
      loanId:            rep.loan_id,
      installmentNumber: rep.installment_number,
      amount:            parseFloat(rep.amount),
      borrowerName:      user.name,
    });

    // Salva QR Code na parcela
    await db.query(
      'UPDATE repayments SET pix_qr=$1, pix_expires_at=$2 WHERE id=$3',
      [pix.qrCode, pix.expiresAt, repayment_id]
    );

    res.json({
      qrCode:      pix.qrCode,
      qrCodeImage: pix.qrCodeImage,
      amount:      rep.amount,
      expiresAt:   pix.expiresAt,
      installment: rep.installment_number,
      loanCode:    rep.code,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar PIX' });
  }
};

// ─── 5. Saque PIX — tomador transfere saldo para qualquer conta ───────────────
exports.sacar = async (req, res) => {
  const { amount, pixKey, pixKeyType } = req.body;
  const userId = req.user.id;

  if (!amount || !pixKey || !pixKeyType) {
    return res.status(400).json({ error: 'Informe valor, chave PIX e tipo da chave' });
  }
  if (parseFloat(amount) < 1) {
    return res.status(400).json({ error: 'Valor mínimo para saque: R$ 1,00' });
  }

  const tiposValidos = ['CPF', 'EMAIL', 'PHONE', 'EVP'];
  if (!tiposValidos.includes(pixKeyType)) {
    return res.status(400).json({ error: 'Tipo de chave inválido. Use: CPF, EMAIL, PHONE ou EVP' });
  }

  try {
    const { rows: [user] } = await db.query(
      'SELECT balance, name, cpf FROM users WHERE id=$1', [userId]
    );

    if (parseFloat(user.balance) < parseFloat(amount)) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Debita saldo imediatamente
      await client.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2',
        [amount, userId]
      );

      // Executa PIX via Celcoin
      const celcoin = require('../services/celcoinService');
      const transferencia = await celcoin.sacarParaInvestidor({
        amount:     parseFloat(amount),
        pixKey,
        pixKeyType,
        nome:       user.name,
        cpf:        user.cpf,
        descricao:  'Saque Credigrupo — Tomador',
      });

      // Registra transação
      await client.query(
        `INSERT INTO transactions
           (user_id, type, amount, description, external_id, status)
         VALUES ($1, 'withdraw', $2, $3, $4, $5)`,
        [userId, amount, `Saque PIX para ${pixKeyType}: ${pixKey}`,
         transferencia.transactionId, transferencia.status]
      );

      await client.query('COMMIT');

      res.json({
        success:       true,
        transactionId: transferencia.transactionId,
        status:        transferencia.status,
        message:       transferencia.status === 'APPROVED'
          ? 'Saque realizado! O dinheiro já está a caminho.'
          : 'Saque em processamento — prazo: até 1 hora.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar saque' });
  }
};

// ─── 6. Extrato de movimentações do tomador ───────────────────────────────────
exports.extrato = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(`
      SELECT t.*, l.code as loan_code
      FROM transactions t
      LEFT JOIN loans l ON t.loan_id=l.id
      WHERE t.user_id=$1
      ORDER BY t.created_at DESC LIMIT 50`, [userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar extrato' });
  }
};
