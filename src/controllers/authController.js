const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { formatCPF, validarCPF } = require('../utils/helpers');

exports.register = async (req, res) => {
  const { name, cpf, email, phone, password, type } = req.body;

  if (!name || !cpf || !email || !password || !type) {
    return res.status(400).json({ error: 'Campos obrigatórios: name, cpf, email, password, type' });
  }

  if (!['investor', 'borrower'].includes(type)) {
    return res.status(400).json({ error: 'Tipo deve ser investor ou borrower' });
  }

  const cpfLimpo = formatCPF(cpf);
  if (!validarCPF(cpfLimpo)) {
    return res.status(400).json({ error: 'CPF inválido' });
  }

  try {
    const exists = await db.query('SELECT id FROM users WHERE cpf = $1 OR email = $2', [cpfLimpo, email]);
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: 'CPF ou e-mail já cadastrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (name, cpf, email, phone, password_hash, type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, type',
      [name, cpfLimpo, email, phone, hash, type]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, type: user.type }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao cadastrar usuário' });
  }
};

exports.login = async (req, res) => {
  const { cpf, password } = req.body;

  if (!cpf || !password) {
    return res.status(400).json({ error: 'CPF e senha obrigatórios' });
  }

  const cpfLimpo = formatCPF(cpf);

  try {
    const result = await db.query('SELECT * FROM users WHERE cpf = $1 AND active = true', [cpfLimpo]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'CPF ou senha incorretos' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'CPF ou senha incorretos' });

    const token = jwt.sign({ id: user.id, type: user.type }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        cpf: user.cpf,
        email: user.email,
        type: user.type,
        balance: user.balance,
        pix_key: user.pix_key
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
};

exports.me = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, cpf, email, phone, type, balance, pix_key, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
};
