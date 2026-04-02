const axios = require('axios');

// ─── WhatsApp (Meta Cloud API — API oficial) ─────────────────────────────────
// Documentação: developers.facebook.com/docs/whatsapp/cloud-api
// Você precisa: META_WHATSAPP_TOKEN e META_PHONE_NUMBER_ID
// Obtidos em: business.facebook.com → WhatsApp → API Setup

const sendWhatsApp = async ({ to, templateName, params = [] }) => {
  // 'to' deve ser no formato internacional sem +: ex: 5511999999999
  const phone = to.replace(/\D/g, '');

  const body = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'pt_BR' },
      components: params.length > 0 ? [{
        type: 'body',
        parameters: params.map(p => ({ type: 'text', text: String(p) })),
      }] : undefined,
    },
  };

  const res = await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`,
    body,
    { headers: { Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
};

// ─── SMS (Twilio) ─────────────────────────────────────────────────────────────
// Alternativa: Zenvia, TotalVoice, Infobip — mesma estrutura
const sendSMS = async ({ to, message }) => {
  const phone = '+55' + to.replace(/\D/g, '').replace(/^55/, '');
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  const res = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    new URLSearchParams({ To: phone, From: process.env.TWILIO_PHONE_NUMBER, Body: message }),
    { auth: { username: accountSid, password: authToken }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
};

// ─── Push Notification (Expo Push) ───────────────────────────────────────────
// Expo envia para iOS e Android sem precisar de APNs/FCM direto
const sendPush = async ({ expoPushToken, title, body, data = {} }) => {
  if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken')) return;

  await axios.post('https://exp.host/--/api/v2/push/send', {
    to:    expoPushToken,
    sound: 'default',
    title,
    body,
    data,
  }, { headers: { 'Content-Type': 'application/json' } });
};

// ─── Envio multi-canal (dispara todos ao mesmo tempo) ─────────────────────────
const notify = async ({ user, title, message, whatsappTemplate, whatsappParams, pushData = {} }) => {
  const errors = [];
  const tasks  = [];

  // Push (se usuário tem token registrado)
  if (user.push_token) {
    tasks.push(sendPush({ expoPushToken: user.push_token, title, body: message, data: pushData })
      .catch(e => errors.push(`Push: ${e.message}`)));
  }

  // WhatsApp (se tem telefone e template definido)
  if (user.phone && whatsappTemplate) {
    tasks.push(sendWhatsApp({ to: user.phone, templateName: whatsappTemplate, params: whatsappParams })
      .catch(e => errors.push(`WhatsApp: ${e.message}`)));
  }

  // SMS (se tem telefone)
  if (user.phone) {
    tasks.push(sendSMS({ to: user.phone, message: `Credigrupo: ${message}` })
      .catch(e => errors.push(`SMS: ${e.message}`)));
  }

  await Promise.all(tasks);
  if (errors.length > 0) console.warn('Erros de notificação (não críticos):', errors.join(' | '));

  return { sent: tasks.length, errors };
};

module.exports = { sendWhatsApp, sendSMS, sendPush, notify };
