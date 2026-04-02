const db  = require('../config/db');
const kyc = require('../services/celcoinKYCService');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Use JPG, PNG ou PDF.'));
  },
});
exports.uploadMiddleware = upload.single('file');

exports.iniciarKYC = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows: [u] } = await db.query('SELECT * FROM users WHERE id=$1', [userId]);
    if (u.kyc_status === 'APPROVED') return res.json({ status: 'APPROVED' });
    const { dataNascimento, cep, logradouro, numero, complemento, bairro, cidade, estado, renda, patrimonio, profissao } = req.body;
    const proposta = await kyc.criarPropostaKYC({ cpf: u.cpf, nome: u.name, email: u.email, telefone: u.phone || '', dataNascimento, cep, logradouro, numero, complemento, bairro, cidade, estado, renda, patrimonio, profissao });
    await db.query('UPDATE users SET kyc_proposal_id=$1, kyc_onboarding_id=$2, kyc_status=$3 WHERE id=$4', [proposta.proposalId, proposta.onboardingId, 'PENDING', userId]);
    res.json({ proposalId: proposta.proposalId, onboardingId: proposta.onboardingId, webviewUrl: proposta.webviewUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const uploadDoc = (filetype, campo) => async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows: [u] } = await db.query('SELECT cpf, kyc_onboarding_id FROM users WHERE id=$1', [userId]);
    if (!u.kyc_onboarding_id) return res.status(400).json({ error: 'Inicie o KYC primeiro' });
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
    const result = await kyc.uploadDocumento({ cpf: u.cpf, onboardingId: u.kyc_onboarding_id, filetype, fileBuffer: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname });
    await db.query(`UPDATE users SET ${campo}=$1 WHERE id=$2`, [result.documentId, userId]);
    res.json({ success: true, documentId: result.documentId, status: result.status });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.uploadRGFrente  = uploadDoc('RG_FRONT', 'kyc_doc_rg_frente');
exports.uploadRGVerso   = uploadDoc('RG_BACK',  'kyc_doc_rg_verso');
exports.uploadCNH       = uploadDoc('CNH',       'kyc_doc_cnh');
exports.uploadCPF       = uploadDoc('CPF',       'kyc_doc_cpf');

exports.uploadComprovante = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows: [u] } = await db.query('SELECT cpf, kyc_onboarding_id FROM users WHERE id=$1', [userId]);
    if (!u.kyc_onboarding_id) return res.status(400).json({ error: 'Inicie o KYC primeiro' });
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
    const result = await kyc.uploadComprovanteResidencia({ cpf: u.cpf, onboardingId: u.kyc_onboarding_id, fileBuffer: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname });
    await db.query('UPDATE users SET kyc_doc_residencia=$1 WHERE id=$2', [result.documentId, userId]);
    res.json({ success: true, documentId: result.documentId, status: result.status, message: 'Aceitos: conta de água, luz, gás, telefone ou extrato bancário (últimos 90 dias)' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.statusDocumentos = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows: [u] } = await db.query('SELECT kyc_onboarding_id, kyc_doc_rg_frente, kyc_doc_rg_verso, kyc_doc_cnh, kyc_doc_cpf, kyc_doc_residencia FROM users WHERE id=$1', [userId]);
    if (!u.kyc_onboarding_id) return res.json({ documents: [] });
    const status = await kyc.consultarDocumentos(u.kyc_onboarding_id);
    res.json({ documents: status.documents, allApproved: status.allApproved, sent: { rgFrente: !!u.kyc_doc_rg_frente, rgVerso: !!u.kyc_doc_rg_verso, cnh: !!u.kyc_doc_cnh, cpf: !!u.kyc_doc_cpf, residencia: !!u.kyc_doc_residencia } });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.statusKYC = async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows: [u] } = await db.query('SELECT kyc_status, kyc_proposal_id, kyc_reproval_reason FROM users WHERE id=$1', [userId]);
    if (u.kyc_status === 'PENDING' && u.kyc_proposal_id) {
      const s = await kyc.consultarPropostaKYC(u.kyc_proposal_id);
      if (s.status !== 'PENDING') {
        await db.query('UPDATE users SET kyc_status=$1, kyc_reproval_reason=$2 WHERE id=$3', [s.status, s.reprovationReasons?.join(', ') || null, userId]);
        u.kyc_status = s.status;
      }
    }
    res.json({ status: u.kyc_status, reprovalReason: u.kyc_reproval_reason, approved: u.kyc_status === 'APPROVED' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.iniciarLoginBiometrico = async (req, res) => {
  const { cpf } = req.body;
  if (!cpf) return res.status(400).json({ error: 'CPF obrigatório' });
  try {
    const { rows } = await db.query('SELECT id, kyc_status FROM users WHERE cpf=$1 AND active=true', [cpf.replace(/\D/g, '')]);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (rows[0].kyc_status !== 'APPROVED') return res.status(403).json({ error: 'Complete o KYC primeiro' });
    const sessionId = uuid();
    const sessao = await kyc.iniciarFaceMatch({ cpf, sessionId });
    await db.query('INSERT INTO kyc_sessions (id, user_id, celcoin_session_id, expires_at) VALUES ($1,$2,$3,$4)', [sessionId, rows[0].id, sessao.sessionId, sessao.expiresAt]);
    res.json({ sessionId, webviewUrl: sessao.webviewUrl, expiresAt: sessao.expiresAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.confirmarLoginBiometrico = async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId obrigatório' });
  try {
    const { rows } = await db.query('SELECT * FROM kyc_sessions WHERE id=$1 AND used=false AND expires_at>NOW()', [sessionId]);
    if (!rows.length) return res.status(400).json({ error: 'Sessão inválida ou expirada' });
    const resultado = await kyc.consultarFaceMatch(rows[0].celcoin_session_id);
    if (!resultado.approved) return res.status(401).json({ error: 'Biometria não reconhecida', score: resultado.score });
    await db.query('UPDATE kyc_sessions SET used=true WHERE id=$1', [sessionId]);
    const { rows: [user] } = await db.query('SELECT id, name, cpf, email, type, balance FROM users WHERE id=$1', [rows[0].user_id]);
    const token = jwt.sign({ id: user.id, type: user.type }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user, biometricScore: resultado.score });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.webhookKYC = async (req, res) => {
  try {
    const { event, proposalId, status, accountId, reasons } = kyc.processarWebhookKYC(req.body);
    if (event === 'onboarding-proposal') {
      await db.query('UPDATE users SET kyc_status=$1, kyc_reproval_reason=$2, celcoin_account_id=$3 WHERE kyc_proposal_id=$4',
        [status, reasons?.join(', ') || null, accountId || null, proposalId]);
    }
    res.status(200).json({ received: true });
  } catch (err) { res.status(200).json({ received: true }); }
};
