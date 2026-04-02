// Templates de mensagem para cada evento da régua de cobrança
// Os parâmetros {{nome}}, {{valor}}, {{vencimento}} são substituídos dinamicamente
// Os nomes de template WhatsApp precisam ser aprovados pela Meta antes de usar

const templates = {

  // ─── ANTES DO VENCIMENTO ──────────────────────────────────────────────────

  antes_3dias: {
    push: {
      title: 'Parcela vence em 3 dias',
      body:  (d) => `Olá ${d.nome}! Sua parcela de ${d.valor} vence em ${d.vencimento}. Pague em dia e evite juros.`,
    },
    sms: (d) => `Credigrupo: Ola ${d.nome}, sua parcela de ${d.valor} vence em 3 dias (${d.vencimento}). Acesse o app para pagar.`,
    whatsapp: {
      template: 'credigrupo_lembrete_3dias',
      params:   (d) => [d.nome, d.valor, d.vencimento],
    },
  },

  antes_1dia: {
    push: {
      title: 'Parcela vence amanhã',
      body:  (d) => `${d.nome}, sua parcela de ${d.valor} vence amanhã (${d.vencimento}). Abra o app para pagar via PIX.`,
    },
    sms: (d) => `Credigrupo: ${d.nome}, sua parcela de ${d.valor} vence AMANHA (${d.vencimento}). Pague pelo app e evite multa.`,
    whatsapp: {
      template: 'credigrupo_lembrete_1dia',
      params:   (d) => [d.nome, d.valor, d.vencimento],
    },
  },

  // ─── NO DIA DO VENCIMENTO ─────────────────────────────────────────────────

  dia_vencimento: {
    push: {
      title: 'Parcela vence hoje!',
      body:  (d) => `${d.nome}, sua parcela de ${d.valor} vence HOJE. Pague agora via PIX e evite atraso.`,
    },
    sms: (d) => `Credigrupo: ${d.nome}, parcela de ${d.valor} vence HOJE. Acesse o app e pague via PIX agora.`,
    whatsapp: {
      template: 'credigrupo_vencimento_hoje',
      params:   (d) => [d.nome, d.valor],
    },
  },

  // ─── APÓS ATRASO ──────────────────────────────────────────────────────────

  atraso_1dia: {
    push: {
      title: 'Parcela em atraso',
      body:  (d) => `${d.nome}, sua parcela de ${d.valor} está em atraso há 1 dia. Regularize agora pelo app.`,
    },
    sms: (d) => `Credigrupo: ${d.nome}, parcela de ${d.valor} esta em atraso. Regularize pelo app para evitar multa adicional.`,
    whatsapp: {
      template: 'credigrupo_atraso_1dia',
      params:   (d) => [d.nome, d.valor],
    },
  },

  atraso_3dias: {
    push: {
      title: '3 dias em atraso — regularize',
      body:  (d) => `${d.nome}, sua parcela de ${d.valor} está atrasada há 3 dias. Não deixe acumular — pague pelo app.`,
    },
    sms: (d) => `Credigrupo ATENCAO: ${d.nome}, parcela de ${d.valor} com 3 dias de atraso. Regularize pelo app agora.`,
    whatsapp: {
      template: 'credigrupo_atraso_3dias',
      params:   (d) => [d.nome, d.valor, '3'],
    },
  },

  atraso_7dias: {
    push: {
      title: '7 dias em atraso — ação necessária',
      body:  (d) => `${d.nome}, parcela de ${d.valor} com 7 dias de atraso. Entre em contato para evitar restrições.`,
    },
    sms: (d) => `Credigrupo: ${d.nome}, sua parcela de ${d.valor} acumula 7 dias de atraso. Regularize ou entre em contato: ${process.env.SUPPORT_PHONE}.`,
    whatsapp: {
      template: 'credigrupo_atraso_7dias',
      params:   (d) => [d.nome, d.valor, process.env.SUPPORT_PHONE || ''],
    },
  },

  atraso_15dias: {
    push: {
      title: '15 dias em atraso — urgente',
      body:  (d) => `${d.nome}, sua parcela de ${d.valor} está há 15 dias em atraso. Regularize agora para evitar medidas legais.`,
    },
    sms: (d) => `Credigrupo URGENTE: ${d.nome}, debito de ${d.valor} com 15 dias de atraso. Regularize HOJE ou sofrera restricoes. Fone: ${process.env.SUPPORT_PHONE}.`,
    whatsapp: {
      template: 'credigrupo_atraso_15dias',
      params:   (d) => [d.nome, d.valor, process.env.SUPPORT_PHONE || ''],
    },
  },
};

module.exports = templates;
