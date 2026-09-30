const { createHash } = require('node:crypto');
const attempts = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const allowedHosts = new Set(['www.ziskaluvwebsites.com', 'ziskaluvwebsites.com']);
  let originHost = '';
  try { originHost = new URL(String(req.headers.origin || '')).host.toLowerCase(); } catch {}
  const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const isAllowedSite = allowedHosts.has(originHost) || (originHost && originHost === requestHost);
  if (!isAllowedSite) return res.status(403).json({ error: 'Request not allowed.' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'Invalid request format.' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: 'Invalid request.' }); }
  if (!body || typeof body !== 'object' || JSON.stringify(body).length > 14000) return res.status(400).json({ error: 'Invalid request.' });
  if (body.companyWebsite) return res.status(400).json({ error: 'Invalid request.' });
  const fields = {
    businessName: ['Business Name', 160], contactName: ['Contact Name', 160],
    email: ['Email', 254], websitePackage: ['Website Package', 100],
    businessType: ['Type of Business', 160], websiteNeeds: ['Website Needs', 5000],
    additionalDetails: ['Additional Details', 5000]
  };
  const values = {};
  for (const [key, [, limit]] of Object.entries(fields)) {
    if (typeof body[key] !== 'string' && key !== 'additionalDetails') return res.status(400).json({ error: 'Please complete all required fields.' });
    values[key] = typeof body[key] === 'string' ? body[key].trim() : '';
    if (values[key].length > limit || (key !== 'additionalDetails' && !values[key])) return res.status(400).json({ error: 'Please check your request details.' });
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(values.email) || /[\r\n]/.test(values.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!['Starter — $199', 'Business — $349', 'Business Plus — $499', 'Custom — From $699'].includes(values.websitePackage)) return res.status(400).json({ error: 'Please select a website package.' });
  const requestId = body.requestId;
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) return res.status(400).json({ error: 'Please refresh and try again.' });
  if (!process.env.RESEND_API_KEY || !process.env.WEBSITE_REQUEST_FROM) return res.status(503).json({ error: 'Your request could not be sent. Please contact us using the email link below.' });
  // Best-effort per-instance throttling; Vercel Firewall can enforce global limits.
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0];
  const entry = attempts.get(ip) || { count: 0, until: now + 600000 };
  if (entry.count >= 5) return res.status(429).json({ error: 'Please wait a few minutes before trying again.' });
  entry.count++; attempts.set(ip, entry);
  const text = Object.entries(fields).map(([key, [label]]) => `${label}: ${values[key] || 'Not provided'}`).join('\n\n');
  const digest = createHash('sha256').update(requestId + text).digest('hex');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `website-request-${digest}` },
      body: JSON.stringify({ from: process.env.WEBSITE_REQUEST_FROM, to: ['ziskaluvgroup@gmail.com'], reply_to: values.email, subject: 'New website request — Ziska Luv Websites', text })
    });
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error('Email provider rejected request');
    return res.status(200).json({ success: true });
  } catch {
    return res.status(502).json({ error: 'Your request could not be confirmed. Please try again or contact us using the email link below.' });
  }
};
