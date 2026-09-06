// Kontrolle: liest den Hofer-Bon 2× mit dem ALTEN Prompt v1.3 (HEAD) — verliert
// auch v1.3 heute die Artikelnummern (Modell-Drift) oder ist es der v1.4-Prompt?
'use strict';
const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const { GoogleGenAI } = require('@google/genai');
const old = require('/private/tmp/claude-501/-Users-patricksieber-Documents-src-markendetektivern/e8474794-8a9e-498b-a7be-03c052afb1fc/scratchpad/prompt_v13.js');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const storage = new Storage({ projectId: 'markendetektive-895f7' });
(async () => {
  const q = await db.collection('receipts').where('status','==','approved').where('merchant.id','==','hofer').limit(1).get();
  const x = q.docs[0].data();
  const [bytes] = await storage.bucket(x.storage.bucket).file(x.storage.path).download();
  const client = new GoogleGenAI({ vertexai: true, project: 'markendetektive-895f7', location: 'global' });
  for (let k = 0; k < 2; k++) {
    const res = await client.models.generateContent({ model: 'gemini-3.5-flash', contents: [{ role: 'user', parts: [{ inlineData: { data: bytes.toString('base64'), mimeType: x.storage.contentType || 'image/jpeg' } }, { text: old.USER_PROMPT }] }], config: { systemInstruction: old.SYSTEM_PROMPT, temperature: 0.1, responseMimeType: 'application/json', responseSchema: old.RESPONSE_SCHEMA, maxOutputTokens: 32768 } });
    const p = JSON.parse(res.text);
    console.log('v1.3 read', k + 1, 'total', p.totalCents, 'first items:', p.items.slice(0, 3).map(i => i.name).join(' | '));
  }
  console.log('cached (v1.3 consensus):', x.ocr.parsed.items.slice(0, 3).map(i => i.name).join(' | '), 'promptVersion', x.ocr.promptVersion, 'model', x.ocr.model);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
