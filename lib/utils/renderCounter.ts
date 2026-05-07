// Render-Zähler — aggregiert Render-Counts pro Komponente und logged
// einmal pro Sekunde via console.error (überlebt babel
// transform-remove-console exclude:['error']).
//
// Use:
//   import { tick } from '@/lib/utils/renderCounter';
//   function MyComponent() {
//     tick('MyComponent');
//     ...
//   }
//
// Im logcat (adb logcat ReactNativeJS) erscheint dann:
//   [render] {"MyComponent":62,"OtherComp":8}
// → MyComponent rendert 62×/s = problem.

const counts = new Map<string, number>();
let lastFlush = 0;
let mounted = false;

function ensureLoop() {
  if (mounted) return;
  mounted = true;
  lastFlush = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.max(1, now - lastFlush) / 1000;
    lastFlush = now;
    if (counts.size === 0) return;
    const out: Record<string, number> = {};
    for (const [k, v] of counts) {
      const perSec = Math.round(v / dt);
      if (perSec >= 2) out[k] = perSec; // nur >= 2/s loggen
    }
    counts.clear();
    if (Object.keys(out).length) {
      console.error('[render]', JSON.stringify(out));
    }
  }, 1000);
}

export function tick(name: string): void {
  ensureLoop();
  counts.set(name, (counts.get(name) || 0) + 1);
}
