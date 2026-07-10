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

server.listen(PORT, () => console.log(`Healthfactor draait op http://localhost:${PORT} — leads in ${LEADS_FILE}`));
