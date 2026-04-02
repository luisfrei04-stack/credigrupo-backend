const axios = require('axios');

// ─── Configuração ────────────────────────────────────────────────────────────
const BASE_URL = process.env.CELCOIN_ENV === 'production'
  ? 'https://openfinance.celcoin.com.br'
  : 'https://sandbox.openfinance.celcoin.dev';

const CLIENT_ID     = process.env.CELCOIN_CLIENT_ID;
const CLIENT_SECRET = process.env.CELCOIN_CLIENT_SECRET;
const PRODUCT_ID    = process.env.CELCOIN_CCB_PRODUCT_ID; // fornecido pela Celcoin após setup

let tokenCache = { token: null, expiresAt: 0 };

// ─── Autenticação (reutiliza token em cache) ─────────────────────────────────
const getToken = async () => {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const res = await axios.post(`${BASE_URL}/v5/token`,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  tokenCache = { token: res.data.access_token, expiresAt: Date.now() + (res.data.expires_in - 60) * 1000 };
  return tokenCache.token;
};

const cel = async (method, path, data = null) => {
  const token = await getToken();
  try {
    const res = await axios({ method, url: `${BASE_URL}${path}`, data, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    throw new Error(`Celcoin CCB error [${err.response?.status}]: ${msg}`);
  }
};

// ─── 1. CADASTRAR TOMADOR na plataforma Celcoin ──────────────────────────────
// Deve ser chamado no cadastro do tomador no app
// Retorna borrower_id que será usado na emissão da CCB
const cadastrarTomador = async ({
  cpf, nome, email, telefone, dataNascimento,
  cep, logradouro, numero, complemento, bairro, cidade, estado,
}) => {
  const payload = {
    document:     cpf.replace(/\D/g, ''),
    name:         nome,
    email,
    phone:        telefone.replace(/\D/g, ''),
    birthDate:    dataNascimento, // "YYYY-MM-DD"
    address: {
      zipCode:      cep.replace(/\D/g, ''),
      street:       logradouro,
      number,
      complement:   complemento || '',
      neighborhood: bairro,
      city:         cidade,
      state:        estado, // "SP"
      country:      'BR',
    },
  };

  // POST /banking/originator/borrowers
  const res = await cel('POST', '/banking/originator/borrowers', payload);

  // Retorna: { borrower_id: "uuid", status: "APPROVED" | "PENDING_KYC" }
  return {
    borrowerId: res.borrower_id,
    status:     res.status,
  };
};

// ─── 2. CONSULTAR STATUS DO TOMADOR (KYC) ───────────────────────────────────
const consultarTomador = async (borrowerId) => {
  const res = await cel('GET', `/banking/originator/borrowers/${borrowerId}`);
  return { borrowerId: res.borrower_id, status: res.status, kycStatus: res.kyc_status };
};

// ─── 3. EMITIR CCB ───────────────────────────────────────────────────────────
// Chamado logo após o investidor liberar o empréstimo
// Baseado nos endpoints reais: POST /banking/originator/applications
const emitirCCB = async ({
  borrowerId,        // UUID do tomador na Celcoin
  fundingId,         // UUID do investidor/funding na Celcoin (configurado com a Celcoin)
  valorSolicitado,   // valor que o tomador recebe (ex: 1000)
  taxaMensal,        // taxa em decimal (ex: 0.20 para 20%)
  numParcelas,       // número de parcelas (ex: 12)
  dataPrimeiraParcela, // "YYYY-MM-DD"
  dataDesembolso,    // "YYYY-MM-DD" (hoje)
  tacAmount,         // Taxa de Abertura de Crédito (pode ser 0)
  financeFee,        // taxa de serviço adicional (pode ser 0)
}) => {
  const payload = {
    borrower_id:          borrowerId,
    product_id:           PRODUCT_ID,
    funding_id:           fundingId || process.env.CELCOIN_FUNDING_ID,
    requested_amount:     valorSolicitado,
    interest_rate:        taxaMensal,        // 0.20 = 20% ao mês
    num_payments:         numParcelas,
    first_payment_date:   dataPrimeiraParcela,
    disbursement_date:    dataDesembolso,
    tac_amount:           tacAmount || 0,
    finance_fee:          financeFee || 0,
    entry_url:            `${process.env.APP_URL}/ccb/callback`, // URL de retorno após assinatura
  };

  // POST /banking/originator/applications
  const res = await cel('POST', '/banking/originator/applications', payload);

  // Retorna status inicial: "AGREEMENT_RENDERING" (gerando documento)
  // Outros status: "PENDING_SIGNATURE" | "SIGNED" | "DISBURSED" | "CANCELLED"
  return {
    applicationId:  res.id,
    status:         res.status,
    // Detalhes financeiros calculados pela Celcoin
    totalAmountOwed:    res.loan_details?.total_amount_owed,
    installmentValue:   res.loan_details?.payment_amount,
    iofAmount:          res.loan_details?.iof_amount,
    financedAmount:     res.loan_details?.financed_amount,
    annualRate:         res.loan_details?.annual_effective_interest_rate,
  };
};

// ─── 4. CONSULTAR CCB (status + links de assinatura) ────────────────────────
const consultarCCB = async (applicationId) => {
  const res = await cel('GET', `/banking/originator/applications/${applicationId}`);
  return {
    applicationId:      res.id,
    status:             res.status,
    // Links de assinatura digital (disponíveis quando status = PENDING_SIGNATURE)
    signatureUrlBorrower:  res.signature_url_borrower,
    signatureUrlInvestor:  res.signature_url_investor,
    // PDF do contrato
    ccbDocumentUrl:     res.ccb_document_url,
    // Datas
    signedAt:           res.signed_at,
    disbursedAt:        res.disbursed_at,
    // Detalhes financeiros
    loanDetails:        res.loan_details,
  };
};

// ─── 5. WEBHOOK — Celcoin avisa sobre mudanças de status da CCB ──────────────
// Configure: https://SEU_BACKEND/api/webhooks/celcoin-ccb
const processarWebhookCCB = (payload) => {
  // Eventos CCB:
  // 'application.agreement_rendering'  — gerando documento
  // 'application.pending_signature'    — aguardando assinaturas
  // 'application.borrower_signed'      — tomador assinou
  // 'application.investor_signed'      — investidor assinou
  // 'application.signed'               — todos assinaram
  // 'application.disbursed'            — dinheiro liberado
  // 'application.cancelled'            — cancelado
  return {
    event:         payload.event,
    applicationId: payload.application_id,
    status:        payload.status,
    ccbUrl:        payload.ccb_document_url,
    signedAt:      payload.signed_at,
  };
};

// ─── 6. CANCELAR CCB ─────────────────────────────────────────────────────────
const cancelarCCB = async (applicationId, motivo) => {
  // POST /banking/originator/applications/{id}/cancel
  await cel('POST', `/banking/originator/applications/${applicationId}/cancel`, {
    reason: motivo || 'Cancelado pelo originador',
  });
  return { success: true };
};

// ─── 7. SIMULAR CCB (antes de emitir) ───────────────────────────────────────
// Útil para mostrar ao tomador os detalhes exatos antes de confirmar
const simularCCB = async ({ valorSolicitado, taxaMensal, numParcelas, dataPrimeiraParcela }) => {
  const payload = {
    product_id:          PRODUCT_ID,
    requested_amount:    valorSolicitado,
    interest_rate:       taxaMensal,
    num_payments:        numParcelas,
    first_payment_date:  dataPrimeiraParcela,
    simulation_type:     'REQUESTED_AMOUNT', // simula pelo valor solicitado
  };

  const res = await cel('POST', '/banking/originator/simulations', payload);

  return {
    valorFinanciado:   res.financed_amount,
    valorTotalDevido:  res.total_amount_owed,
    valorParcela:      res.payment_amount,
    iof:               res.iof_amount,
    taxaAnual:         res.annual_effective_interest_rate,
    taxaMensal:        res.monthly_effective_interest_rate,
  };
};

module.exports = {
  cadastrarTomador,
  consultarTomador,
  emitirCCB,
  consultarCCB,
  processarWebhookCCB,
  cancelarCCB,
  simularCCB,
};
