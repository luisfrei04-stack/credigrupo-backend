const db      = require('../config/db');
const celccb  = require('../services/celcoinCCBService');
const nodemailer = require('nodemailer');

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const enviarEmail = async (to, subject, text) => {
  await mailer.sendMail({ from: `"Credigrupo" <${process.env.SMTP_USER}>`, to, subject, text });
};

// ─── 1. Emitir CCB automaticamente após investidor liberar ───────────────────
exports.emitirCCB = async (loanId) => {
  const loanRes = await db.query(
    `SELECT l.*,
       b.celcoin_borrower_id as b_borrower_id,
       b.name as b_nome, b.email as b_email, b.cpf as b_cpf,
       i.name as i_nome, i.email as i_email
     FROM loans l
     JOIN users b ON l.borrower_id = b.id
     JOIN users i ON l.investor_id = i.id
     WHERE l.id = $1`,
    [loanId]
  );
  const l = loanRes.rows[0];
  if (!l) throw new Error('Empréstimo não encontrado');

  // Calcula data da primeira parcela (30 dias a partir de hoje)
  const primeiraParcela = new Date();
  primeiraParcela.setMonth(primeiraParcela.getMonth() + 1);
  const dataPrimeiraParcela = primeiraParcela.toISOString().split('T')[0];
  const dataDesembolso = new Date().toISOString().split('T')[0];

  // Se tomador não tem borrower_id na Celcoin, lança erro orientando cadastro
  if (!l.b_borrower_id) {
    throw new Error('Tomador não cadastrado na Celcoin. Complete o cadastro primeiro.');
  }

  // Simula para confirmar valores antes de emitir
  const simulacao = await celccb.simularCCB({
    valorSolicitado:    parseFloat(l.amount_requested),
    taxaMensal:         parseFloat(l.interest_rate) / 100, // converte % para decimal
    numParcelas:        l.installments,
    dataPrimeiraParcela,
  });

  // Emite a CCB
  const ccb = await celccb.emitirCCB({
    borrowerId:          l.b_borrower_id,
    valorSolicitado:     parseFloat(l.amount_requested),
    taxaMensal:          parseFloat(l.interest_rate) / 100,
    numParcelas:         l.installments,
    dataPrimeiraParcela,
    dataDesembolso,
  });

  // Salva no banco
  await db.query(
    `UPDATE loans SET
       celcoin_application_id = $1,
       ccb_status             = $2,
       ccb_simulated_total    = $3,
       ccb_simulated_parcela  = $4,
       ccb_iof                = $5,
       ccb_updated_at         = NOW()
     WHERE id = $6`,
    [ccb.applicationId, ccb.status, simulacao.valorTotalDevido, simulacao.valorParcela, simulacao.iof, loanId]
  );

  console.log(`CCB emitida para empréstimo ${l.code} — applicationId: ${ccb.applicationId}`);
  return ccb;
};

// ─── 2. Buscar link de assinatura para o usuário logado ──────────────────────
exports.getLinkAssinatura = async (req, res) => {
  const { loan_id } = req.params;
  const userId = req.user.id;

  try {
    const loanRes = await db.query(
      'SELECT * FROM loans WHERE id = $1', [loan_id]
    );
    const loan = loanRes.rows[0];
    if (!loan) return res.status(404).json({ error: 'Empréstimo não encontrado' });

    const isBorrower = loan.borrower_id === userId;
    const isInvestor = loan.investor_id === userId;
    if (!isBorrower && !isInvestor) return res.status(403).json({ error: 'Acesso negado' });

    // Se não tem links ainda, consulta na Celcoin
    if (!loan.ccb_signature_url_borrower && loan.celcoin_application_id) {
      const ccbData = await celccb.consultarCCB(loan.celcoin_application_id);

      if (ccbData.signatureUrlBorrower) {
        await db.query(
          `UPDATE loans SET
             ccb_signature_url_borrower = $1,
             ccb_signature_url_investor = $2,
             ccb_document_url           = $3,
             ccb_status                 = $4
           WHERE id = $5`,
          [ccbData.signatureUrlBorrower, ccbData.signatureUrlInvestor, ccbData.ccbDocumentUrl, ccbData.status, loan_id]
        );
        loan.ccb_signature_url_borrower = ccbData.signatureUrlBorrower;
        loan.ccb_signature_url_investor = ccbData.signatureUrlInvestor;
        loan.ccb_document_url           = ccbData.ccbDocumentUrl;
        loan.ccb_status                 = ccbData.status;
      }
    }

    const signatureLink = isBorrower
      ? loan.ccb_signature_url_borrower
      : loan.ccb_signature_url_investor;

    res.json({
      signatureLink,
      ccbDocumentUrl: loan.ccb_document_url,
      ccbStatus:      loan.ccb_status,
      applicationId:  loan.celcoin_application_id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar link de assinatura' });
  }
};

// ─── 3. Webhook CCB — Celcoin notifica status da CCB ─────────────────────────
exports.webhookCCB = async (req, res) => {
  const payload = req.body;
  console.log('Webhook Celcoin CCB:', JSON.stringify(payload));

  try {
    const { event, applicationId, status, ccbUrl, signedAt } = celccb.processarWebhookCCB(payload);

    const loanRes = await db.query(
      `SELECT l.*, b.email as b_email, b.name as b_nome, i.email as i_email, i.name as i_nome
       FROM loans l
       JOIN users b ON l.borrower_id = b.id
       JOIN users i ON l.investor_id = i.id
       WHERE l.celcoin_application_id = $1`,
      [applicationId]
    );
    if (loanRes.rows.length === 0) return res.status(200).json({ received: true });

    const loan = loanRes.rows[0];

    // Atualiza status no banco conforme evento
    const updates = { ccb_status: status, ccb_updated_at: 'NOW()' };

    if (event === 'application.pending_signature') {
      // Links de assinatura disponíveis — busca e salva
      const ccbData = await celccb.consultarCCB(applicationId);
      await db.query(
        `UPDATE loans SET
           ccb_status                 = $1,
           ccb_signature_url_borrower = $2,
           ccb_signature_url_investor = $3,
           ccb_document_url           = $4
         WHERE celcoin_application_id = $5`,
        [status, ccbData.signatureUrlBorrower, ccbData.signatureUrlInvestor, ccbData.ccbDocumentUrl, applicationId]
      );

      // Envia e-mail com link de assinatura para ambas as partes
      await Promise.all([
        enviarEmail(loan.b_email,
          `Credigrupo — Assine sua CCB (${loan.code})`,
          `Olá, ${loan.b_nome}!\n\nSeu empréstimo ${loan.code} foi liberado.\nAssine a CCB pelo link abaixo:\n\n${ccbData.signatureUrlBorrower}\n\nO link expira em 48 horas.\n\nCredigrupo`
        ),
        enviarEmail(loan.i_email,
          `Credigrupo — Assine a CCB do investimento (${loan.code})`,
          `Olá, ${loan.i_nome}!\n\nSeu investimento ${loan.code} foi confirmado.\nAssine a CCB pelo link abaixo:\n\n${ccbData.signatureUrlInvestor}\n\nO link expira em 48 horas.\n\nCredigrupo`
        ),
      ]);
      console.log(`Links de assinatura enviados por e-mail para ${loan.code}`);
    }

    if (event === 'application.borrower_signed') {
      await db.query(
        'UPDATE loans SET ccb_status = $1, ccb_borrower_signed_at = $2 WHERE celcoin_application_id = $3',
        [status, signedAt, applicationId]
      );
      console.log(`Tomador assinou CCB — ${loan.code}`);
    }

    if (event === 'application.investor_signed') {
      await db.query(
        'UPDATE loans SET ccb_status = $1, ccb_investor_signed_at = $2 WHERE celcoin_application_id = $3',
        [status, signedAt, applicationId]
      );
      console.log(`Investidor assinou CCB — ${loan.code}`);
    }

    if (event === 'application.signed') {
      // CCB totalmente assinada — salva PDF e notifica
      await db.query(
        'UPDATE loans SET ccb_status = $1, ccb_signed_url = $2, ccb_signed_at = $3 WHERE celcoin_application_id = $4',
        [status, ccbUrl, signedAt, applicationId]
      );

      await Promise.all([
        enviarEmail(loan.b_email,
          `Credigrupo — CCB formalizada! (${loan.code})`,
          `Olá, ${loan.b_nome}!\n\nSua CCB do empréstimo ${loan.code} está formalizada.\nBaixe o PDF: ${ccbUrl}\n\nCredigrupo`
        ),
        enviarEmail(loan.i_email,
          `Credigrupo — CCB formalizada! (${loan.code})`,
          `Olá, ${loan.i_nome}!\n\nA CCB do seu investimento ${loan.code} está formalizada.\nBaixe o PDF: ${ccbUrl}\n\nCredigrupo`
        ),
      ]);
      console.log(`CCB formalizada — ${loan.code}!`);
    }

    if (event === 'application.disbursed') {
      await db.query(
        "UPDATE loans SET ccb_status = 'DISBURSED' WHERE celcoin_application_id = $1",
        [applicationId]
      );
    }

    if (event === 'application.cancelled') {
      await db.query(
        "UPDATE loans SET ccb_status = 'CANCELLED' WHERE celcoin_application_id = $1",
        [applicationId]
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erro no webhook CCB:', err.message);
    res.status(200).json({ received: true });
  }
};

// ─── 4. Cadastrar tomador na Celcoin (chamado no onboarding) ─────────────────
exports.cadastrarTomador = async (req, res) => {
  const userId = req.user.id;

  try {
    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    const u = userRes.rows[0];

    if (u.celcoin_borrower_id) {
      return res.json({ borrowerId: u.celcoin_borrower_id, message: 'Já cadastrado' });
    }

    const { dataNascimento, cep, logradouro, numero, complemento, bairro, cidade, estado } = req.body;

    const result = await celccb.cadastrarTomador({
      cpf: u.cpf, nome: u.name, email: u.email, telefone: u.phone || '',
      dataNascimento, cep, logradouro, numero, complemento, bairro, cidade, estado,
    });

    await db.query(
      'UPDATE users SET celcoin_borrower_id = $1 WHERE id = $2',
      [result.borrowerId, userId]
    );

    res.json({ borrowerId: result.borrowerId, status: result.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao cadastrar tomador na Celcoin' });
  }
};

// ─── 5. Download do PDF da CCB assinada ──────────────────────────────────────
exports.downloadCCB = async (req, res) => {
  const { loan_id } = req.params;
  const userId = req.user.id;

  try {
    const loanRes = await db.query(
      'SELECT borrower_id, investor_id, ccb_signed_url, ccb_document_url, ccb_status, code FROM loans WHERE id = $1',
      [loan_id]
    );
    const loan = loanRes.rows[0];
    if (!loan) return res.status(404).json({ error: 'Não encontrado' });

    const temAcesso = loan.borrower_id === userId || loan.investor_id === userId;
    if (!temAcesso) return res.status(403).json({ error: 'Acesso negado' });

    const url = loan.ccb_signed_url || loan.ccb_document_url;
    if (!url) return res.status(404).json({ error: 'PDF ainda não disponível' });

    res.json({ ccbUrl: url, ccbStatus: loan.ccb_status });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar CCB' });
  }
};
