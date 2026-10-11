const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FORMS = {
  starterspakket: 'Fitness · starterspakket',
  nieuwsbrief: 'Fitness · nieuwsbrief',
  'boxing-lidmaatschap': 'Boksen · lidmaatschap',
  'boxing-nieuwsbrief': 'Boksen · nieuwsbrief',
};

function normalizeLead(input) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(FORMS, input.type)) {
    throw new Error('Onbekend formulier');
  }
  const data = { type: input.type };
  for (const [key, max] of Object.entries({ voornaam: 100, naam: 100, email: 200, telefoon: 60, doel: 3000 })) {
    if (input[key] != null && typeof input[key] !== 'string') throw new Error(`Ongeldig veld: ${key}`);
    data[key] = (input[key] || '').trim();
    if (data[key].length > max) throw new Error(`Veld te lang: ${key}`);
  }
  data.email = data.email.toLowerCase();
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('Ongeldig e-mailadres');
  if (!data.email && !data.telefoon) throw new Error('E-mail of telefoon vereist');
  if (!data.email && !data.telefoon.replace(/[^+\d]/g, '').match(/\d/)) throw new Error('Ongeldig telefoonnummer');
  return data;
}

function crmPayload(data, submissionId, receivedAt) {
  const name = `${data.voornaam} ${data.naam}`.trim().slice(0, 200);
  const phone = data.telefoon.replace(/[^+\d]/g, '');
  if (!data.email && !phone) throw new Error('Ongeldig telefoonnummer');
  return {
    company: name || data.email || phone,
    contactName: name || undefined,
    email: data.email || undefined,
    phone: phone || undefined,
    contactType: 'person',
    submissionId,
    campaign: `Healthfactor · ${FORMS[data.type]}`,
    notes: [
      `Healthfactor website · ${FORMS[data.type]}`,
      `Ontvangen: ${receivedAt}`,
      `Pagina: https://promo.healthfactor.be/${data.type.startsWith('boxing-') ? 'boxing.html' : ''}`,
      data.doel ? `Doel: ${data.doel}` : '',
    ].filter(Boolean).join('\n'),
  };
}

function createCrmOutbox({ directory, token, endpoint, fetchImpl = fetch, now = Date.now, log = console }) {
  const enabled = Boolean(token && endpoint);
  if (Boolean(token) !== Boolean(endpoint)) throw new Error('Configure both CRM_INBOUND_URL and CRM_INBOUND_TOKEN');
  if (enabled) {
    const url = new URL(endpoint);
    if (url.origin !== 'https://crm.verkoop.studio' || url.pathname !== '/api/public/inbound-lead' || url.search || url.hash || url.username || url.password) {
      throw new Error('CRM_INBOUND_URL must be the Sales CRM intake endpoint');
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  let running;
  function write(filename, job) {
    const temporary = `${filename}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(job), { mode: 0o600 });
    fs.renameSync(temporary, filename);
  }
  function enqueue(data) {
    if (!enabled) return null;
    const id = randomUUID();
    const payload = crmPayload(data, id, new Date(now()).toISOString());
    write(path.join(directory, `${id}.json`), { id, payload, attempts: 0, nextAttempt: 0 });
    return id;
  }
  async function drain() {
    const files = fs.readdirSync(directory).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name)).sort();
    let processed = 0;
    for (const filename of files) {
      const fullPath = path.join(directory, filename);
      let job;
      try { job = JSON.parse(fs.readFileSync(fullPath, 'utf8')); }
      catch { log.error('[crm] unreadable queued submission:', filename); continue; }
      if (job.failed || job.nextAttempt > now()) continue;
      if (++processed > 100) break;
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'x-inbound-token': token },
          body: JSON.stringify(job.payload),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.permanent = [400, 404, 422].includes(response.status);
          throw error;
        }
        const result = await response.json();
        if (!result.leadId || !['created', 'matched'].includes(result.status)) throw new Error('Unexpected CRM response');
        fs.unlinkSync(fullPath);
        log.info('[crm] submission delivered:', job.id);
      } catch (error) {
        job.attempts += 1;
        job.nextAttempt = now() + Math.min(30000 * 2 ** Math.min(job.attempts - 1, 7), 3600000);
        job.failed = Boolean(error.permanent);
        write(fullPath, job);
        // Do not log visitor details, credentials, or the upstream response body.
        log.error(`[crm] submission ${job.id} ${job.failed ? 'needs attention' : 'queued for retry'}`);
      }
    }
  }
  function flush() {
    if (!enabled) return Promise.resolve();
    if (!running) running = drain().finally(() => { running = undefined; });
    return running;
  }
  return { enabled, enqueue, flush };
}

module.exports = { normalizeLead, crmPayload, createCrmOutbox };
