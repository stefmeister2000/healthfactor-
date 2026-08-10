// Healthfactor site + lead capture server (geen dependencies nodig)
// Start:  node server.js   →  http://localhost:4174
// Leads worden bewaard in leads.csv (openen met Excel/Numbers)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 4174;
const LEADS_FILE = path.join(ROOT, 'leads.csv');
const CSV_HEADER = 'datum;type;voornaam;naam;email;telefoon;doel\n';

// .env inladen (geen dependency) — RESEND_API_KEY en RESEND_AUDIENCE_ID
function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1][0] !== '#' && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch { /* geen .env — dan slaan we Resend gewoon over */ }
}
loadEnv();

// Event dat de welkom-automation in Resend triggert
const RESEND_EVENT_NAME = process.env.RESEND_EVENT_NAME || 'healthfactor.email_signup';

// Voeg een lead toe als contact aan de Resend audience én vuur het signup-event
// (dat laatste start de welkomflow-automation). Beide alleen als geconfigureerd.
async function syncToResend(data) {
  const key = process.env.RESEND_API_KEY;
  const audience = process.env.RESEND_AUDIENCE_ID;
  if (!key || !data.email) return; // niet geconfigureerd → overslaan

  // 1) Contact toevoegen aan de audience (moet eerst bestaan voor de automation)
  if (audience) {
    try {
      const r = await fetch(`https://api.resend.com/audiences/${audience}/contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          first_name: data.voornaam || '',
          last_name: data.naam || '',
          unsubscribed: false,
          // Telefoon als custom property bewaren (alleen als aanwezig — popup heeft er geen)
          ...(data.telefoon ? { properties: { telefoon: data.telefoon } } : {}),
        }),
      });
      if (r.ok) console.log('[resend] contact toegevoegd:', data.email);
      else console.error('[resend] contact niet toegevoegd:', r.status, await r.text());
    } catch (e) {
      console.error('[resend] contact fout:', e.message);
    }
  }

  // 2) Signup-event vuren → start de welkomflow-automation
  try {
    const r = await fetch('https://api.resend.com/events/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: RESEND_EVENT_NAME, email: data.email }),
    });
    if (r.ok) console.log('[resend] event gevuurd:', RESEND_EVENT_NAME, data.email);
    else console.error('[resend] event mislukt:', r.status, await r.text());
  } catch (e) {
    console.error('[resend] event fout:', e.message);
  }
}

// Notificatie-mail naar de gym bij elke nieuwe lead (zodat je meteen kunt bellen)
const LEAD_NOTIFY_TO = process.env.LEAD_NOTIFY_TO || 'info@healthfactor.be';
const LEAD_NOTIFY_FROM = process.env.LEAD_NOTIFY_FROM || 'Healthfactor Leads <leads@healthfactor.be>';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function sendLeadNotification(data) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // niet geconfigureerd → overslaan
  const naam = `${data.voornaam || ''} ${data.naam || ''}`.trim() || '—';
  const rows = [
    ['Naam', naam],
    ['Telefoon', data.telefoon || '—'],
    ['E-mail', data.email || '—'],
    ['Doel', data.doel || '—'],
    ['Bron', data.type || 'onbekend'],
  ];
  const trs = rows.map(([k, v]) =>
    `<tr><td style="padding:8px 0;color:#8a8a90;font-size:13px;width:120px">${k}</td>` +
    `<td style="padding:8px 0;color:#0a0a0a;font-size:15px;font-weight:600">${esc(v)}</td></tr>`
  ).join('');
  const telLink = data.telefoon
    ? `<a href="tel:${esc(data.telefoon)}" style="display:inline-block;margin-top:20px;background:#e8232e;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;font-size:14px">Bel ${esc(naam)} →</a>`
    : '';
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:14px;overflow:hidden">
      <div style="background:#0a0a0a;color:#fff;padding:20px 28px;font-weight:800;font-size:16px">Nieuwe lead — Healthfactor</div>
      <div style="padding:24px 28px">
        <table style="width:100%;border-collapse:collapse">${trs}</table>
        ${telLink}
        <p style="color:#a8a8ae;font-size:12px;margin-top:22px">Automatisch verstuurd via de website. Antwoord op deze mail om rechtstreeks de lead te bereiken.</p>
      </div>
    </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: LEAD_NOTIFY_FROM,
        to: LEAD_NOTIFY_TO,
        subject: `Nieuwe lead: ${naam} — ${data.type || 'onbekend'}`,
        html,
        ...(data.email ? { reply_to: data.email } : {}),
      }),
    });
    if (r.ok) console.log('[resend] notificatie verstuurd naar', LEAD_NOTIFY_TO);
    else console.error('[resend] notificatie mislukt:', r.status, await r.text());
  } catch (e) {
    console.error('[resend] notificatie fout:', e.message);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function csvField(v) {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
  return '"' + s.replace(/"/g, '""') + '"';
}

function saveLead(data) {
  const row = [
    new Date().toISOString(),
    data.type || 'onbekend',
    data.voornaam || '',
    data.naam || '',
    data.email || '',
    data.telefoon || '',
    data.doel || '',
  ].map(csvField).join(';') + '\n';
  if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, CSV_HEADER);
  fs.appendFileSync(LEADS_FILE, row);
}

const server = http.createServer((req, res) => {
  // Lead endpoint
  if (req.method === 'POST' && req.url === '/api/lead') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.email && !data.telefoon) throw new Error('email of telefoon vereist');
        saveLead(data);
        console.log(`[lead] ${data.type}: ${data.voornaam || ''} ${data.naam || ''} <${data.email || data.telefoon}>`);
        syncToResend(data); // contact + signup-event naar Resend (fire-and-forget)
        sendLeadNotification(data); // notificatie-mail naar de gym (fire-and-forget)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // Static files
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT) || filePath === LEADS_FILE || filePath.endsWith('server.js')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Healthfactor draait op poort ${PORT} — leads in ${LEADS_FILE}`));
