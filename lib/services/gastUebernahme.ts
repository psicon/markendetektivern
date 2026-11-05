import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { auth } from '@/lib/firebase';
import { FUNCTIONS_BASE, fetchWithTimeout } from '@/lib/services/cashbackUpload';
import { showInfoToast } from '@/lib/services/ui/toast';
import { isEffectivelyAnonymous } from '@/lib/utils/authIdentity';

/**
 * Übernahme von Gast-Einreichungen in ein BESTEHENDES Konto
 * (Entscheidung 25.09.2026, Bauanleitung Schritt 25).
 *
 * ═══ Warum ein Ticket ═══
 *
 * Legt ein Gast ein NEUES Konto an, wird verknüpft (linkWithCredential) —
 * die uid bleibt, nichts zieht um. Meldet er sich aber bei einem schon
 * bestehenden Konto an, entsteht eine andere uid, und der Server muss
 * beweisen können, dass der Aufrufer das Gastkonto wirklich besaß.
 * RNFirebase gibt kein Refresh-Token heraus; nach dem Wechsel ist der Gast
 * nicht mehr belegbar. Deshalb erzeugt die App VOR dem Wechsel ein
 * Geheimnis, speichert es sicher (SecureStore) und schickt dem Server nur
 * dessen Hash — mit dem ID-Token des noch angemeldeten Gastes. Nach dem
 * Wechsel löst das Zielkonto das Geheimnis ein. Der Server sieht das
 * Geheimnis erst beim Einlösen, und nur mit einem Token des Zielkontos.
 *
 * ═══ Regeln ═══
 *
 * - Einziger Schreiber des SecureStore-Schlüssels `gast_uebernahme_v1`.
 * - Das Geheimnis wird GESPEICHERT, bevor der Server es kennt, und bis zum
 *   Einlösen wiederverwendet — kein Wettlauf, der das Ticket entwertet.
 * - Eingelöst wird NUR für das gemerkte Zielkonto und nur, wenn es
 *   registriert ist — nie für eine andere Person am selben Gerät.
 * - Solange der Server die Übernahme noch nicht ausführt (`pausiert`),
 *   bleibt der Eintrag und wird bei jedem Start/Vordergrund erneut versucht.
 */

const KEY = 'gast_uebernahme_v1';
/** Erledigte Einträge (ohne Geheimnis) werden ab hier verdrängt — offene NIE. */
const MAX_EINTRAEGE = 10;

/** Ergebnis der Vorbereitung — der Aufrufer braucht den GRUND (Prüfrunde 1). */
export type VorbereitenErgebnis = 'ok' | 'offline' | 'zu_viele' | 'fehler';

export type UebernahmeStatus =
  | 'vorbereitet'
  | 'laeuft'
  | 'nachlauf'
  | 'abgeschlossen'
  | 'pruefung'
  | 'pausiert';

export interface UebernahmeSumme {
  bonsUmgebucht?: number;
  bonsUmgezogen?: number;
  fotosUmgebucht?: number;
  fotosUmgezogen?: number;
  wartet?: number;
  uebernommenCents?: number;
  gedeckeltCents?: number;
}

interface Eintrag {
  geheimnis: string | null;
  erstelltAm: number;
  zielUid: string | null;
  /** Vom Server bestätigte Zuordnung vonUid → zielUid (Bindung besteht). */
  bestaetigtNach: string | null;
  stand: { status: UebernahmeStatus; summe?: UebernahmeSumme } | null;
  /** Signatur des zuletzt angezeigten Hinweises — genau EIN Toast je Stand. */
  angezeigt: string | null;
}

type Speicher = Record<string, Eintrag>;

let spiegel: Speicher = {};
let geladen: Promise<void> | null = null;
/** Lesen scheiterte → nie schreiben, sonst überschriebe ein leerer Stand echte Tickets. */
let ladeFehler = false;
let vorbereitenLaeuft: Promise<VorbereitenErgebnis> | null = null;
let einloesenLaeuft: Promise<void> | null = null;
const hoerer = new Set<() => void>();

async function speichern(): Promise<void> {
  if (ladeFehler) throw new Error('gast_uebernahme_speicher_unlesbar');
  // Überlauf: nur ERLEDIGTE Einträge (ohne Geheimnis) verdrängen, älteste
  // zuerst. Ein offenes Ticket ist der einzige Weg zu Guthaben und
  // Einreichungen des Gastes — es darf nie verdrängt werden.
  const erledigte = Object.entries(spiegel)
    .filter(([, e]) => !e.geheimnis)
    .sort((a, b) => a[1].erstelltAm - b[1].erstelltAm);
  let zuViel = Object.keys(spiegel).length - MAX_EINTRAEGE;
  for (const [uid] of erledigte) {
    if (zuViel <= 0) break;
    delete spiegel[uid];
    zuViel -= 1;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(spiegel));
}

function melden() {
  hoerer.forEach((fn) => {
    try {
      fn();
    } catch {
      // Hörer dürfen den Dienst nicht stören.
    }
  });
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return globalThis
    .btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256Hex(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hinweisText(stand: NonNullable<Eintrag['stand']>): string | null {
  const s = stand.summe || {};
  // Ein Satz je Stand — der Hinweis zeigt höchstens zwei Zeilen (Prüfrunde 2).
  if (stand.status === 'pausiert' || stand.status === 'vorbereitet') {
    return 'Deine Gast-Einreichungen sind gesichert – wir übertragen sie in dein Konto und sagen dir Bescheid.';
  }
  if (stand.status === 'pruefung') {
    return 'Wir schauen uns die Übernahme kurz an – deine Einreichungen sind sicher.';
  }
  const bons = (s.bonsUmgebucht || 0) + (s.bonsUmgezogen || 0);
  const fotos = (s.fotosUmgebucht || 0) + (s.fotosUmgezogen || 0);
  const teile: string[] = [];
  if (bons > 0) teile.push(bons === 1 ? '1 Bon' : `${bons} Bons`);
  if (fotos > 0) teile.push(fotos === 1 ? '1 Produktfoto' : `${fotos} Produktfotos`);
  if ((s.uebernommenCents || 0) > 0) {
    teile.push(`${((s.uebernommenCents || 0) / 100).toFixed(2).replace('.', ',')} €`);
  }
  const rest = (s.wartet || 0) > 0;
  if (teile.length > 0) {
    const liste = teile.length > 1 ? `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}` : teile[0];
    const einzeln = teile.length === 1 && bons + fotos === 1;
    return `${liste} ${einzeln ? 'ist' : 'sind'} jetzt in deinem Konto${rest ? ' – der Rest folgt gleich' : ''}.`;
  }
  return rest ? 'Deine Gast-Einreichungen kommen gleich in dein Konto.' : null;
}

export const GastUebernahme = {
  /** Beim App-Start einmal aufrufen; weitere Aufrufe teilen dasselbe Promise. */
  laden(): Promise<void> {
    if (!geladen) {
      geladen = (async () => {
        try {
          const raw = await SecureStore.getItemAsync(KEY);
          const obj = raw ? JSON.parse(raw) : {};
          spiegel = obj && typeof obj === 'object' ? obj : {};
          ladeFehler = false;
        } catch {
          spiegel = {};
          ladeFehler = true;
          // Beim nächsten Aufruf erneut lesen statt den Fehler festzuhalten.
          geladen = null;
        }
        melden();
      })();
    }
    return geladen;
  },

  /** Wird bei jeder Änderung einer Zuordnung aufgerufen (Warteschlangen anstoßen). */
  beiAenderung(fn: () => void): () => void {
    hoerer.add(fn);
    return () => hoerer.delete(fn);
  },

  /**
   * Synchron: vom Server bestätigtes Zielkonto einer Gast-uid, sonst null.
   * Nur darauf dürfen die Warteschlangen Aufträge umschreiben.
   */
  zielVon(uid: string | null | undefined): string | null {
    if (!uid) return null;
    return spiegel[uid]?.bestaetigtNach ?? null;
  },

  /**
   * Besitznachweis für den AKTUELL angemeldeten Gast sichern — VOR dem
   * Kontowechsel aufrufen. 'ok', wenn der Server den Hash kennt; sonst der
   * Grund, damit der Nutzer die richtige Meldung bekommt.
   */
  vorbereiten(vonUid: string): Promise<VorbereitenErgebnis> {
    if (vorbereitenLaeuft) return vorbereitenLaeuft;
    vorbereitenLaeuft = (async (): Promise<VorbereitenErgebnis> => {
      try {
        await GastUebernahme.laden();
        if (ladeFehler) return 'fehler';
        const user = auth.currentUser;
        if (!user || user.uid !== vonUid || !isEffectivelyAnonymous(user)) return 'fehler';

        let eintrag = spiegel[vonUid];
        if (!eintrag || !eintrag.geheimnis || eintrag.zielUid) {
          const bytes = await Crypto.getRandomBytesAsync(32);
          eintrag = {
            geheimnis: base64url(bytes),
            erstelltAm: Date.now(),
            zielUid: null,
            bestaetigtNach: null,
            stand: null,
            angezeigt: null,
          };
          const vorher = spiegel[vonUid];
          spiegel[vonUid] = eintrag;
          // ZUERST speichern — erst dann darf der Server den Hash kennen.
          try {
            await speichern();
          } catch {
            // Nicht gespeichert → nicht im Spiegel lassen, sonst meldete der
            // nächste Versuch 'ok' für ein Geheimnis, das den Neustart nicht
            // überlebt (Prüfrunde 2).
            if (vorher) spiegel[vonUid] = vorher;
            else delete spiegel[vonUid];
            return 'fehler';
          }
        }
        const ticketHash = await sha256Hex(eintrag.geheimnis as string);

        let letzterGrund: VorbereitenErgebnis = 'offline';
        for (let versuch = 0; versuch < 3; versuch++) {
          if (versuch > 0) await warte(versuch === 1 ? 1000 : 3000);
          try {
            const token = await user.getIdToken(true);
            const res = await fetchWithTimeout(
              `${FUNCTIONS_BASE}/gastUebernahmeVorbereiten`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ ticketHash }),
              },
              10_000,
            );
            if (res.ok) return 'ok';
            if (res.status === 429) return 'zu_viele';
            // Übrige 4xx sind endgültig (kein Gast, schon gebunden).
            if (res.status >= 400 && res.status < 500) return 'fehler';
            letzterGrund = 'fehler'; // 5xx → erneut versuchen
          } catch {
            letzterGrund = 'offline'; // Netz/Timeout → nächster Versuch
          }
        }
        return letzterGrund;
      } catch {
        return 'fehler';
      } finally {
        vorbereitenLaeuft = null;
      }
    })();
    return vorbereitenLaeuft;
  },

  /** Nach erfolgreichem Wechsel: welches Konto die Einreichungen bekommen soll. */
  async zielMerken(vonUid: string, zielUid: string): Promise<void> {
    await GastUebernahme.laden();
    const e = spiegel[vonUid];
    if (!e || !e.geheimnis || vonUid === zielUid) return;
    e.zielUid = zielUid;
    await speichern();
  },

  /**
   * Löst alle offenen Tickets für das AKTUELL angemeldete, registrierte
   * Konto ein. Sicher mehrfach aufrufbar (Start, Vordergrund, Anmeldung).
   */
  einloesenAlle(): Promise<void> {
    if (einloesenLaeuft) return einloesenLaeuft;
    einloesenLaeuft = (async () => {
      try {
        await GastUebernahme.laden();
        const user = auth.currentUser;
        if (!user || isEffectivelyAnonymous(user)) return;
        const offen = Object.entries(spiegel).filter(([, e]) => e.geheimnis && e.zielUid === user.uid);
        let geaendert = false;
        for (const [vonUid, e] of offen) {
          let res: Response;
          try {
            const token = await user.getIdToken();
            res = await fetchWithTimeout(
              `${FUNCTIONS_BASE}/gastUebernahmeEinloesen`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ vonUid, geheimnis: e.geheimnis }),
              },
              30_000,
            );
          } catch {
            continue; // offline → beim nächsten Anlass
          }
          let body: { status?: UebernahmeStatus; summe?: UebernahmeSumme; code?: string } = {};
          try {
            body = await res.json();
          } catch {
            // leerer Body
          }
          if (res.ok && body.status) {
            e.stand = { status: body.status, summe: body.summe };
            if (body.status === 'laeuft' || body.status === 'nachlauf' || body.status === 'abgeschlossen') {
              e.bestaetigtNach = user.uid;
            }
            if (body.status === 'abgeschlossen') e.geheimnis = null; // Zuordnung bleibt
            geaendert = true;
          } else if (
            [403, 404, 409, 410].includes(res.status) &&
            body.code !== 'konto_erforderlich' &&
            typeof body.code === 'string' &&
            // Solange zuletzt „pausiert" galt, nie verwerfen — das Ticket ist
            // der einzige Weg zum Gast-Guthaben (Prüfrunde 1).
            e.stand?.status !== 'pausiert'
          ) {
            // Ticket endgültig ungültig/verbraucht/verfallen.
            delete spiegel[vonUid];
            geaendert = true;
            continue;
          } else {
            continue; // 429/5xx/konto_erforderlich → später erneut
          }

          const text = hinweisText(e.stand!);
          const signatur = `${e.stand!.status}|${JSON.stringify(e.stand!.summe || {})}`;
          if (text && e.angezeigt !== signatur) {
            e.angezeigt = signatur;
            showInfoToast(text, 'info');
          }
        }
        if (geaendert) {
          await speichern();
          melden();
        }
      } catch {
        // nie werfen — wird beim nächsten Anlass erneut versucht
      } finally {
        einloesenLaeuft = null;
      }
    })();
    return einloesenLaeuft;
  },
};
