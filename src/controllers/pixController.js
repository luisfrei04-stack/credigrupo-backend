const db = require('../config/db');
const celcoin = require('../services/celcoinService');

// ─── Abrir conta digital para o tomador ─────────────────────────────────────
exports.abrirConta = async (req, res) => {
  const userId = req.user.id;

  try {
    // Verifica se já tem conta
    const existing = await db.query(
      'SELECT celcoin_account FROM users WHERE id = $1', [userId]
    );
    if (existing.rows[0]?.celcoin_account) {
      return res.status(400).json({ error: 'Conta digital já criada' });
    }

    const user = await db.query(
      'SELECT * FROM users WHERE id = $1', [userId]
    );
    const u = user.rows[0];

    const { dataNascimento, cep, logradouro, numero, bairro, cidade, estado } = req.body;

    const conta = await celcoin.abrirContaTomador({
      cpf:            u.cpf,
      nome:           u.name,
      email:          u.email,
      telefone:       u.phone || '',
      dataNascimento,
      cep, logradouro, numero, bairro, cidade, estado,
    });

    // Salva os dados da conta no banco
    await db.query(
      `UPDATE users SET
         celcoin_account = $1,
         celcoin_agency  = $2,
         updated_at      = NOW()
       WHERE id = $3`,
      [conta.accountNumber, conta.agency, userId]
    );

    res.json({
      success:       true,
      accountNumber: conta.accountNumber,
      agency:        conta.agency,
      message:       'Conta digital criada com sucesso!',
    });
  } catch (err) {
    console.error('Erro ao abrir conta Celcoin:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao criar conta digital. Tente novamente.' });
  }
};

// ─── Gerar QR Code PIX para investidor depositar ────────────────────────────
exports.gerarDeposito = async (req, res) => {
  const { amount } = req.body;
  const userId = req.user.id;

  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'Valor mínimo para depósito: R$ 1,00' });
  }

  try {
    const userRes = await db.query(
      'SELECT celcoin_account FROM users WHERE id = $1', [userId]
    );
    const accountNumber = userRes.rows[0]?.celcoin_account;

    const pix = await celcoin.gerarPixDeposito({
      accountNumber,
      amount:    parseFloat(amount),
      descricao: `Depósito Credigrupo - ${req.user.id}`,
    });

    // Salva transação pendente no banco
    await db.query(
      `INSERT INTO transactions
         (user_id, type, amount, description, external_id, status)
       VALUES ($1, 'deposit_pending', $2, 'Depósito via PIX', $3, 'pending')`,
      [userId, amount, pix.transactionId]
    );

    res.json({
      qrCode:        pix.qrCode,       // string para copia e cola
      qrCodeImage:   pix.qrCodeImage,  // base64 da imagem
      transactionId: pix.transactionId,
      amount,
      message:       'Escaneie o QR code ou use o código copia e cola no seu banco',
    });
  } catch (err) {
    console.error('Erro ao gerar PIX:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao gerar QR Code PIX' });
  }
};

// ─── Solicitar saque para chave PIX do investidor ───────────────────────────
exports.solicitarSaque = async (req, res) => {
  const { amount, pixKey, pixKeyType } = req.body;
  const userId = req.user.id;

  if (!amount || !pixKey || !pixKeyType) {
    return res.status(400).json({ error: 'Informe valor, chave PIX e tipo da chave' });
  }

  try {
    // Verifica saldo
    const userRes = await db.query(
      'SELECT balance, name, cpf FROM users WHERE id = $1', [userId]
    );
    const user = userRes.rows[0];

    if (parseFloat(user.balance) < parseFloat(amount)) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Deduz saldo imediatamente (reserva)
      await client.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2',
        [amount, userId]
      );

      // Executa transferência PIX
      const transferencia = await celcoin.sacarParaInvestidor({
        amount:     parseFloat(amount),
        pixKey,
        pixKeyType,
        nome:       user.name,
        cpf:        user.cpf,
        descricao:  'Saque Credigrupo',
      });

      // Registra transação
      await client.query(
        `INSERT INTO transactions
           (user_id, type, amount, description, external_id, status)
         VALUES ($1, 'withdraw', $2, 'Saque via PIX', $3, $4)`,
        [userId, amount, transferencia.transactionId, transferencia.status]
      );

      await client.query('COMMIT');

      res.json({
        success:       true,
        transactionId: transferencia.transactionId,
        status:        transferencia.status,
        message:       transferencia.status === 'APPROVED'
          ? 'Saque realizado com sucesso!'
          : 'Saque em processamento — prazo: até 1 hora',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Erro no saque:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao processar saque' });
  }
};

// ─── Gerar PIX de parcela para o tomador pagar ──────────────────────────────
exports.gerarPixParcela = async (req, res) => {
  const { repayment_id } = req.body;

  try {
    const repRes = await db.query(
      `SELECT r.*, l.id as loan_id, u.name as borrower_name
       FROM repayments r
       JOIN loans l ON r.loan_id = l.id
       JOIN users u ON l.borrower_id = u.id
       WHERE r.id = $1`,
      [repayment_id]
    );

    if (repRes.rows.length === 0) {
      return res.status(404).json({ error: 'Parcela não encontrada' });
    }

    const rep = repRes.rows[0];
    if (rep.paid) return res.status(400).json({ error: 'Parcela já paga' });

    const pix = await celcoin.gerarPixParcela({
      loanId:            rep.loan_id,
      installmentNumber: rep.installment_number,
      amount:            parseFloat(rep.amount),
      borrowerName:      rep.borrower_name,
    });

    // Salva o QR code na parcela para reutilizar se não expirou
    await db.query(
      'UPDATE repayments SET pix_qr = $1, pix_expires_at = $2 WHERE id = $3',
      [pix.qrCode, pix.expiresAt, repayment_id]
    );

    res.json({
      qrCode:        pix.qrCode,
      qrCodeImage:   pix.qrCodeImage,
      transactionId: pix.transactionId,
      amount:        rep.amount,
      expiresAt:     pix.expiresAt,
    });
  } catch (err) {
    console.error('Erro ao gerar PIX parcela:', err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao gerar PIX da parcela' });
  }
};

// ─── Webhook — Celcoin avisa quando PIX cair ────────────────────────────────
// Esta rota recebe notificações automáticas da Celcoin (não precisa de token JWT)
exports.webhook = async (req, res) => {
  const payload = req.body;
  console.log('Webhook Celcoin recebido:', JSON.stringify(payload));

  try {
    const { event, transactionId, amount, description } = celcoin.processarWebhook(payload);

    if (event === 'PIX_PAYMENT_RECEIVED') {
      // Procura transação pendente pelo ID externo
      const txRes = await db.query(
        "SELECT * FROM transactions WHERE external_id = $1 AND status = 'pending'",
        [transactionId]
      );

      if (txRes.rows.length > 0) {
        const tx = txRes.rows[0];

        if (tx.type === 'deposit_pending') {
          // Credita saldo do investidor
          await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, tx.user_id]);
          await db.query("UPDATE transactions SET status = 'completed' WHERE id = $1", [tx.id]);
          console.log(`Depósito confirmado: R$${amount} para usuário ${tx.user_id}`);
        }
      }

      // Verifica se é pagamento de parcela (busca pela descrição)
      if (description && description.includes('Parcela')) {
        const loanIdMatch = description.match(/Empréstimo ([a-f0-9-]+)/);
        const parcelaMatch = description.match(/Parcela (\d+)/);

        if (loanIdMatch && parcelaMatch) {
          const loanId     = loanIdMatch[1];
          const parcelaNum = parseInt(parcelaMatch[1]);

          const repRes = await db.query(
            'SELECT * FROM repayments WHERE loan_id = $1 AND installment_number = $2 AND paid = false',
            [loanId, parcelaNum]
          );

          if (repRes.rows.length > 0) {
            const rep = repRes.rows[0];

            // Busca investidor do empréstimo
            const loanRes = await db.query(
              'SELECT investor_id FROM loans WHERE id = $1', [loanId]
            );
            const investorId = loanRes.rows[0]?.investor_id;

            if (investorId) {
              const valorInvestidor = parseFloat(rep.amount) - parseFloat(rep.taxa_parcela);

              // Marca parcela como paga e credita investidor
              await db.query('UPDATE repayments SET paid = true, paid_at = NOW() WHERE id = $1', [rep.id]);
              await db.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [valorInvestidor, investorId]);
              await db.query(
                'INSERT INTO transactions (user_id, type, amount, description, loan_id) VALUES ($1,$2,$3,$4,$5)',
                [investorId, 'repayment', valorInvestidor, `Parcela ${parcelaNum} recebida`, loanId]
              );

              // Verifica se empréstimo foi quitado
              const pendentes = await db.query(
                'SELECT COUNT(*) FROM repayments WHERE loan_id = $1 AND paid = false', [loanId]
              );
              if (parseInt(pendentes.rows[0].count) === 0) {
                await db.query("UPDATE loans SET status = 'completed' WHERE id = $1", [loanId]);
              }

              console.log(`Parcela ${parcelaNum} do empréstimo ${loanId} paga! Investidor creditado: R$${valorInvestidor}`);
            }
          }
        }
      }
    }

    // Sempre responde 200 para a Celcoin confirmar recebimento
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.status(200).json({ received: true }); // mesmo com erro, confirma recebimento
  }
};
