const db     = require('../config/db');
const mova   = require('../services/movaService');
const nodemailer = require('nodemailer');

// ─── Emissor de e-mail (configure no .env) ───────────────────────────────────
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const enviarEmailCCB = async ({ toEmail, toName, ccbUrl, loanCode, tipo }) => {
  const assunto = tipo === 'assinatura'
    ? `Credigrupo — Assine sua CCB (${loanCode})`
    : `Credigrupo — CCB formalizada (${loanCode})`;

  const corpo = tipo === 'assinatura'
    ? `Olá, ${toName}!\n\nSeu empréstimo ${loanCode} foi liberado.\nPor favor, assine a CCB pelo link abaixo:\n\n${ccbUrl}\n\nO link expira em 48 horas.\n\nCredigrupo`
    : `Olá, ${toName}!\n\nSua CCB do empréstimo ${loanCode} foi formalizada com sucesso.\nBaixe o documento pelo link:\n\n${ccbUrl}\n\nCredigrupo`;

  await mailer.sendMail({
    from:    `"Credigrupo" <${process.env.SMTP_USER}>`,
    to:      toEmail,
    subject: assunto,
    text:    corpo,
  });
};

// ─── 1. Emitir CCB — chamado logo após investidor liberar empréstimo ─────────
exports.emitirCCB = async (loanId) => {
  // Busca dados completos do empréstimo + partes
  const loanRes = await db.query(
    `SELECT l.*,
       b.cpf as b_cpf, b.name as b_nome, b.email as b_email,
       b.birth_date as b_nasc,
       i.cpf as i_cpf, i.name as i_nome, i.email as i_email
     FROM loans l
     JOIN users b ON l.borrower_id  = b.id
     JOIN users i ON l.investor_id  = i.id
     WHERE l.id = $1`,
    [loanId]
  );
  const l = loanRes.rows[0];

  // 1. Cria cotação na Mova
  const cotacao = await mova.criarCotacao({
    valorSolicitado:  parseFloat(l.amount_requested),
    valorContrato:    parseFloat(l.amount_contract),
    taxaMensal:       parseFloat(l.interest_rate),
    numParcelas:      l.installments,
    valorParcela:     parseFloat(l.installment_value),
    tomadorCpf:       l.b_cpf,
    tomadorNome:      l.b_nome,
    tomadorEmail:     l.b_email,
    tomadorNascimento: l.b_nasc || '1990-01-01',
    investidorCpf:    l.i_cpf,
    investidorNome:   l.i_nome,
    investidorEmail:  l.i_email,
  });

  // 2. Cria proposta (gera CCB e links de assinatura)
  const proposta = await mova.criarProposta(cotacao.quotationId);

  // 3. Salva no banco
  await db.query(
    `UPDATE loans SET
       mova_quotation_id = $1,
       mova_proposal_id  = $2,
       ccb_number        = $3,
       ccb_url           = $4,
       ccb_status        = 'pending_signatures',
       signature_link_borrower  = $5,
       signature_link_investor  = $6
     WHERE id = $7`,
    [
      cotacao.quotationId,
      proposta.proposalId,
      cotacao.ccbNumber,
      proposta.ccbUrl,
      proposta.signatureLinkBorrower,
      proposta.signatureLinkInvestor,
      loanId,
    ]
  );

  // 4. Envia e-mail com link de assinatura para tomador e investidor
  await Promise.all([
    enviarEmailCCB({
      toEmail: l.b_email, toName: l.b_nome,
      ccbUrl:  proposta.signatureLinkBorrower,
      loanCode: l.code, tipo: 'assinatura',
    }),
    enviarEmailCCB({
      toEmail: l.i_email, toName: l.i_nome,
      ccbUrl:  proposta.signatureLinkInvestor,
      loanCode: l.code, tipo: 'assinatura',
    }),
  ]);

  return proposta;
};

// ─── 2. Endpoint — tomador/investidor busca link de assinatura ───────────────
exports.getLinkAssinatura = async (req, res) => {
  const { loan_id } = req.params;
  const userId = req.user.id;

  try {
    const loanRes = await db.query(
      'SELECT * FROM loans WHERE id = $1', [loan_id]
    );
    const loan = loanRes.rows[0];
    if (!loan) return res.status(404).json({ error: 'Empréstimo não encontrado' });

    // Determina qual link entregar baseado em quem está pedindo
    const isBorrower  = loan.borrower_id  === userId;
    const isInvestor  = loan.investor_id  === userId;

    if (!isBorrower && !isInvestor) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const link = isBorrower
      ? loan.signature_link_borrower
      : loan.signature_link_investor;

    res.json({
      signatureLink: link,
      ccbUrl:        loan.ccb_url,
      ccbStatus:     loan.ccb_status,
      ccbNumber:     loan.ccb_number,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar link de assinatura' });
  }
};

// ─── 3. Endpoint — baixar PDF da CCB assinada ───────────────────────────────
exports.downloadCCB = async (req, res) => {
  const { loan_id } = req.params;
  const userId = req.user.id;

  try {
    const loanRes = await db.query(
      'SELECT borrower_id, investor_id, ccb_signed_url, ccb_url, ccb_status, code FROM loans WHERE id = $1',
      [loan_id]
    );
    const loan = loanRes.rows[0];
    if (!loan) return res.status(404).json({ error: 'Não encontrado' });

    const temAcesso = loan.borrower_id === userId || loan.investor_id === userId;
    if (!temAcesso) return res.status(403).json({ error: 'Acesso negado' });

    const url = loan.ccb_signed_url || loan.ccb_url;
    if (!url) return res.status(404).json({ error: 'CCB ainda não disponível' });

    res.json({
      ccbUrl:    url,
      ccbStatus: loan.ccb_status,
      ccbNumber: loan.ccb_number,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar CCB' });
  }
};

// ─── 4. Webhook da Mova — processa eventos de assinatura ────────────────────
exports.webhookMova = async (req, res) => {
  const payload = req.body;
  console.log('Webhook Mova:', JSON.stringify(payload));

  try {
    const { event, proposalId, ccbUrl, signedAt } = mova.processarWebhookMova(payload);

    const loanRes = await db.query(
      'SELECT l.*, b.name as b_nome, b.email as b_email, i.name as i_nome, i.email as i_email FROM loans l JOIN users b ON l.borrower_id=b.id JOIN users i ON l.investor_id=i.id WHERE l.mova_proposal_id = $1',
      [proposalId]
    );
    if (loanRes.rows.length === 0) return res.status(200).json({ received: true });

    const loan = loanRes.rows[0];

    if (event === 'proposal.borrower_signed') {
      await db.query(
        "UPDATE loans SET ccb_status = 'borrower_signed', borrower_signed_at = $1 WHERE mova_proposal_id = $2",
        [signedAt, proposalId]
      );
      console.log(`Tomador assinou CCB do empréstimo ${loan.code}`);
    }

    if (event === 'proposal.investor_signed') {
      await db.query(
        "UPDATE loans SET ccb_status = 'investor_signed', investor_signed_at = $1 WHERE mova_proposal_id = $2",
        [signedAt, proposalId]
      );
      console.log(`Investidor assinou CCB do empréstimo ${loan.code}`);
    }

    if (event === 'proposal.fully_signed') {
      // CCB 100% formalizada — salva PDF final e notifica ambas as partes
      await db.query(
        "UPDATE loans SET ccb_status = 'signed', ccb_signed_url = $1, ccb_signed_at = $2 WHERE mova_proposal_id = $3",
        [ccbUrl, signedAt, proposalId]
      );

      // Envia PDF final por e-mail para tomador e investidor
      await Promise.all([
        enviarEmailCCB({
          toEmail: loan.b_email, toName: loan.b_nome,
          ccbUrl, loanCode: loan.code, tipo: 'pdf_final',
        }),
        enviarEmailCCB({
          toEmail: loan.i_email, toName: loan.i_nome,
          ccbUrl, loanCode: loan.code, tipo: 'pdf_final',
        }),
      ]);

      console.log(`CCB formalizada para o empréstimo ${loan.code}!`);
    }

    if (event === 'proposal.cancelled') {
      await db.query(
        "UPDATE loans SET ccb_status = 'cancelled' WHERE mova_proposal_id = $1",
        [proposalId]
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erro no webhook Mova:', err.message);
    res.status(200).json({ received: true });
  }
};
