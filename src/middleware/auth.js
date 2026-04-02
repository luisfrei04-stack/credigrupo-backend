const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.type !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
  next();
};

const investorOnly = (req, res, next) => {
  if (req.user.type !== 'investor' && req.user.type !== 'admin') {
    return res.status(403).json({ error: 'Apenas investidores' });
  }
  next();
};

const borrowerOnly = (req, res, next) => {
  if (req.user.type !== 'borrower' && req.user.type !== 'admin') {
    return res.status(403).json({ error: 'Apenas tomadores' });
  }
  next();
};

module.exports = { auth, adminOnly, investorOnly, borrowerOnly };
