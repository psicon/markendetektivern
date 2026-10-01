// Liest Algolia-Keys NUR in den Prozess-Speicher. Gibt sie nie aus.
//  - searchKey(): der oeffentliche Such-Key der App (lib/services/algolia.ts)
//  - extKey(secret[, version]): der Key einer Extension-Instanz aus dem Secret Manager
//  - secretAusInstanz(): Secret-Name + gepinnte Version aus der Instanz-Konfiguration
// Alle Aufrufe hier sind LESEND (Algolia GET/Search/Browse, Secret Manager access).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const APP = 'Y0KKZHT49Q';
const PROJEKT = 'markendetektive-895f7';
const REPO = path.resolve(__dirname, '..', '..', '..');

function searchKey() {
  const src = fs.readFileSync(path.join(REPO, 'lib', 'services', 'algolia.ts'), 'utf8');
  const m = src.match(/ALGOLIA_SEARCH_API_KEY\s*=\s*'([^']+)'/);
  if (!m) throw new Error('search key not found');
  return m[1];
}
function extKey(secretName, version = 'latest') {
  return execFileSync('gcloud', ['secrets', 'versions', 'access', String(version), `--secret=${secretName}`, `--project=${PROJEKT}`], { encoding: 'utf8' }).trim();
}
// "projects/<nr>/secrets/<name>/versions/<v>" -> { name, version }
function secretAusReferenz(ref) {
  const m = /^projects\/\d+\/secrets\/([^/]+)\/versions\/(\d+)$/.exec(ref || '');
  if (!m) throw new Error(`keine Secret-Version-Referenz: ${ref}`);
  return { name: m[1], version: m[2] };
}
async function alg(key, method, p, body, host) {
  const url = `https://${host || APP + '-dsn'}.algolia.net${p}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-Algolia-Application-Id': APP, 'X-Algolia-API-Key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json; try { json = JSON.parse(txt); } catch { json = { raw: txt.slice(0, 200) }; }
  return { status: res.status, json };
}
module.exports = { APP, PROJEKT, REPO, searchKey, extKey, secretAusReferenz, alg };
