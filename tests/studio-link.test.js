const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('homepage has one visible branded studio link in the static footer', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const footer = html.match(/<footer>[\s\S]*?<\/footer>/)[0];
  assert.match(footer, /<a class="studio-link" href="https:\/\/verkoop\.studio\/">Ontdek verkoop\.studio<\/a>/);
  assert.equal((html.match(/href="https:\/\/verkoop\.studio\/"/g) || []).length, 1);
  assert.match(html, /\.foot \.studio-link \{ color: inherit; text-decoration: underline; text-underline-offset: 3px; \}/);
});
