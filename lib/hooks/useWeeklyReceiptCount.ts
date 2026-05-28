/**
 * useWeeklyReceiptCount — Anzahl der diese Woche eingereichten Bons.
 *
 * Subscribed auf `users/{uid}/cashback_status` und filtert client-seitig
 * nach `createdAt >= Wochenstart (Europe/Berlin Montag 00:00:00)`.
 * Receipts mit `status === 'superseded'` (Dedup-Verlierer) zählen NICHT
 * mit — die wurden vom Backend explizit als „doppelt" markiert.
 *
 * Server-Authoritative ist der weekly-Cap natürlich im Cloud-Function
 * Code; diese Hook ist NUR für die UI-Statusanzeige
 * („3/6 Woche" auf der Belohnungen-Seite).
 *
 * Returns 0 wenn kein User eingeloggt oder noch keine History.
 */

import { useEffect, useState } from 'react';

import { subscribeUserCashbackHistory } from '@/lib/services/cashbackUpload';

function getMondayMidnightBerlinMs(): number {
  // Berlin's „heute" via toLocaleDateString, dann Montag berechnen.
  // Wir bauen ein Datum aus Berlin's YYYY-MM-DD String → ergibt UTC-
  // Mitternacht des Berlin-Datums. Das ist nahe genug am Berlin-Mid-
  // night (Differenz max. ±1h) — sicher genug für Wochenstart-Cutoff.
  const berlinDateStr = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Europe/Berlin',
  }); // e.g. "2026-05-28"
  const todayMidnight = new Date(`${berlinDateStr}T00:00:00`);
  const dayOfWeek = todayMidnight.getDay(); // 0=Sonntag, 1=Montag, ...
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(todayMidnight);
  monday.setDate(monday.getDate() - daysFromMonday);
  return monday.getTime();
}

export function useWeeklyReceiptCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const mondayMs = getMondayMidnightBerlinMs();
    const unsub = subscribeUserCashbackHistory((entries) => {
      const weekCount = entries.reduce((acc, e) => {
        const created = e.createdAt?.toMillis?.() ?? 0;
        if (created < mondayMs) return acc;
        if (e.status === 'superseded') return acc;
        return acc + 1;
      }, 0);
      setCount(weekCount);
    });
    return unsub;
  }, []);

  return count;
}
