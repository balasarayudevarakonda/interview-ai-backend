require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// CORS
app.use(cors({ origin: [process.env.FRONTEND_URL, 'http://localhost:3000'] }));

// Raw body for webhook (must come before express.json)
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Generate license key: INTV-XXXX-XXXX-XXXX-XXXX
function generateLicenseKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `INTV-${seg()}-${seg()}-${seg()}-${seg()}`;
}

// ── Send license key email
async function sendLicenseEmail(email, licenseKey, plan) {
  const downloadUrl = 'https://github.com/balasarayudevarakonda/interview-ai/releases/download/v1.0.0/Interview.AI.Setup.1.0.0.exe';
  await transporter.sendMail({
    from: `"Interview AI" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '🎉 Your Interview AI License Key',
    html: `
      <div style="font-family:Inter,sans-serif;background:#080812;color:#e2e8f0;padding:40px;max-width:500px;margin:0 auto;border-radius:16px;">
        <h2 style="color:#a78bfa;">🤖 Interview AI</h2>
        <h3 style="margin:16px 0;">Your license key is ready!</h3>
        <p style="color:#888;">Plan: <strong style="color:#e2e8f0;">${plan}</strong></p>
        <div style="background:#1a1a2e;border:1px solid #2a2a45;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <p style="color:#888;font-size:13px;margin-bottom:8px;">Your license key</p>
          <p style="font-family:monospace;font-size:22px;color:#a78bfa;letter-spacing:3px;">${licenseKey}</p>
        </div>
        <a href="${downloadUrl}" style="display:block;background:#7c3aed;color:white;padding:14px;border-radius:10px;text-decoration:none;font-weight:600;text-align:center;margin-bottom:20px;">
          ⬇ Download Interview AI (.exe)
        </a>
        <p style="color:#555;font-size:13px;">Open the app → click Activate → enter this key. Keep this email safe!</p>
      </div>
    `
  });
}

// ════════════════════════════════════
// POST /webhook — Razorpay calls this after payment
// ════════════════════════════════════
app.post('/webhook', async (req, res) => {
  try {
    // Verify signature
    const signature = req.headers['x-razorpay-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    if (signature !== expected) {
      console.log('❌ Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body.toString());
    console.log('📩 Webhook:', event.event);

    if (event.event !== 'payment_link.paid') {
      return res.json({ status: 'ignored' });
    }

    const payment = event.payload.payment_link.entity;
    const email = payment.customer?.email || payment.notify?.email;
    const amount = payment.amount / 100;
    const paymentId = payment.id;

    let plan = 'Monthly';
    if (amount >= 9999) plan = 'Lifetime';
    else if (amount >= 4999) plan = 'Yearly';

    console.log(`✅ Payment: ${email} — ₹${amount} — ${plan}`);

    // Check duplicate
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      console.log('ℹ️ Already exists:', email);
      return res.json({ status: 'already exists' });
    }

    // Generate key & save to DB
    const licenseKey = generateLicenseKey();
    const { error: dbError } = await supabase.from('users').insert({
      email,
      license_key: licenseKey,
      plan,
      amount,
      payment_id: paymentId,
      active: true,
      created_at: new Date().toISOString()
    });

    if (dbError) {
      console.error('❌ DB error:', dbError);
      return res.status(500).json({ error: 'Database error' });
    }

    // Send email
    await sendLicenseEmail(email, licenseKey, plan);
    console.log(`📧 License sent to ${email}: ${licenseKey}`);

    res.json({ status: 'success' });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ════════════════════════════════════
// POST /get-license — Website calls this
// ════════════════════════════════════
app.post('/get-license', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('license_key, plan, active')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !user) {
    return res.status(404).json({ error: 'No license found for this email. Contact support.' });
  }
  if (!user.active) {
    return res.status(403).json({ error: 'License inactive. Contact support.' });
  }

  res.json({ licenseKey: user.license_key, plan: user.plan });
});

// ════════════════════════════════════
// POST /verify-license — Your Electron app calls this on startup
// ════════════════════════════════════
app.post('/verify-license', async (req, res) => {
  const { licenseKey, email } = req.body;
  if (!licenseKey || !email) {
    return res.json({ valid: false, error: 'Missing fields' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('plan, active')
    .eq('license_key', licenseKey.trim())
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !user) return res.json({ valid: false, error: 'Invalid license key' });
  if (!user.active) return res.json({ valid: false, error: 'License inactive' });

  res.json({ valid: true, plan: user.plan });
});

// ════════════════════════════════════
// GET / — Health check
// ════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ status: '✅ Interview AI Backend running' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
});
