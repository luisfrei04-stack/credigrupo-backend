const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = process.env.CELCOIN_ENV === 'production'
  ? 'https://openfinance.celcoin.com.br'
  : 'https://sandbox.openfinance.celcoin.dev';

const CLIENT_ID     = process.env.CELCOIN_CLIENT_ID;
const CLIENT_SECRET = process.env.CELCOIN_CLIENT_SECRET;

let tokenCache = { token: null, expiresAt: 0 };

const getToken = async () => {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const res = await axios.post(`${BASE_URL}/v5/token`,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  tokenCache = { token: res.data.access_token, expiresAt: Date.now() + (res.data.expires_in - 60) * 1000 };
  return tokenCache.token;
};

const cel = async (method, path, data = null, extraHeaders = {}) => {
  const token = await getToken();
  try {
    const res = await axios({
      method,
      url: `${BASE_URL}${path}`,
      data,
      headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
    });
    return res.data;
  } catch (err) {
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    throw new Error(`Celcoin KYC [${err.response?.status}]: ${msg}`);
  }
};

// ─── 1. Criar proposta KYC ───────────────────────────────────────────────────
const criarPropostaKYC = async ({
  cpf, nome, email, telefone, dataNascimento,
  cep, logradouro, numero, complemento, bairro, cidade, estado,
  renda, patrimonio, profissao,
}) => {
  const res = await cel('POST', '/onboarding/v1/onboarding-proposal/natural-person', {
    documentNumber: cpf.replace(/\D/g, ''),
    name: nome, email,
    phone: telefone.replace(/\D/g, ''),
    birthDate: dataNascimento,
    address: { zipCode: cep.replace(/\D/g, ''), street: logradouro, number: numero, complement: complemento || '', neighborhood: bairro, city: cidade, state: estado, country: 'BR' },
    financialInfo: { income: renda || 'FROM_1000_TO_3000', patrimony: patrimonio || 'FROM_10000_TO_50000', occupation: profissao || 'EMPLOYED' },
    callbackUrl: `${process.env.APP_URL}/kyc/callback`,
  }, { 'Content-Type': 'application/json' });

  return { proposalId: res.proposalId, onboardingId: res.onboardingId, webviewUrl: res.webviewUrl };
};

// ─── 2. Upload de documento de identidade ────────────────────────────────────
// filetype: 'RG_FRONT' | 'RG_BACK' | 'CNH' | 'CPF'
const uploadDocumento = async ({ cpf, onboardingId, filetype, fileBuffer, mimeType, fileName }) => {
  const form = new FormData();
  form.append('documentnumber', cpf.replace(/\D/g, ''));
  form.append('filetype', filetype);
  form.append('onboardingId', onboardingId);
  form.append('front', fileBuffer, {
    filename:    fileName || 'documento.jpg',
    contentType: mimeType || 'image/jpeg',
  });

  const res = await cel('POST', '/celcoinkyc/document/v1/fileupload', form, { ...form.getHeaders() });
  return { success: res.success, documentId: res.documentId, status: res.status };
};

// ─── 3. Upload de comprovante de residência ──────────────────────────────────
// Aceita: conta de água, luz, gás, telefone, extrato bancário (últimos 90 dias)
const uploadComprovanteResidencia = async ({ cpf, onboardingId, fileBuffer, mimeType, fileName }) => {
  const form = new FormData();
  form.append('documentnumber', cpf.replace(/\D/g, ''));
  form.append('filetype', 'PROOF_OF_RESIDENCE');
  form.append('onboardingId', onboardingId);
  form.append('front', fileBuffer, {
    filename:    fileName || 'comprovante.jpg',
    contentType: mimeType || 'image/jpeg',
  });

  const res = await cel('POST', '/celcoinkyc/document/v1/fileupload', form, { ...form.getHeaders() });
  return { success: res.success, documentId: res.documentId, status: res.status };
};

// ─── 4. Consultar status dos documentos ──────────────────────────────────────
const consultarDocumentos = async (onboardingId) => {
  const res = await cel('GET', `/celcoinkyc/document/v1/status/${onboardingId}`);
  return {
    documents:  res.documents?.map(d => ({ type: d.filetype, status: d.status, reprovacao: d.reprovationReason })),
    allApproved: res.documents?.every(d => d.status === 'APPROVED'),
  };
};

// ─── 5. Consultar proposta KYC ───────────────────────────────────────────────
const consultarPropostaKYC = async (proposalId) => {
  const res = await cel('GET', `/onboarding/v1/onboarding-proposal/${proposalId}`);
  return { proposalId: res.proposalId, status: res.status, reprovationReasons: res.reprovationReasons, accountId: res.accountId };
};

// ─── 6. FaceMatch — login biométrico ─────────────────────────────────────────
const iniciarFaceMatch = async ({ cpf, sessionId }) => {
  const res = await cel('POST', '/onboarding/v1/facematch/session', {
    documentNumber: cpf.replace(/\D/g, ''), sessionId,
    callbackUrl: `${process.env.APP_URL}/kyc/facematch-callback`,
  }, { 'Content-Type': 'application/json' });
  return { sessionId: res.sessionId, webviewUrl: res.webviewUrl, expiresAt: res.expiresAt };
};

const consultarFaceMatch = async (sessionId) => {
  const res = await cel('GET', `/onboarding/v1/facematch/session/${sessionId}`);
  return { sessionId: res.sessionId, approved: res.approved, score: res.score, status: res.status };
};

// ─── 7. Webhook ──────────────────────────────────────────────────────────────
const processarWebhookKYC = (payload) => ({
  event: payload.event, proposalId: payload.proposalId,
  status: payload.status, accountId: payload.accountId, reasons: payload.reprovationReasons,
});

module.exports = {
  criarPropostaKYC, uploadDocumento, uploadComprovanteResidencia,
  consultarDocumentos, consultarPropostaKYC,
  iniciarFaceMatch, consultarFaceMatch, processarWebhookKYC,
};
