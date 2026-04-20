// RatingsSheet.jsx — bottom sheet to view & submit product ratings
// Categories: Overall, Geschmack/Wirkung, Preis/Leistung, Inhaltsstoffe,
// + Ähnlichkeit zur Marke (only when product is a NoName WITH a linked brand)

const RS_F = window.F;
const RS_C = window.COLORS;

// Mock review pool — keyed by product id (or noName id). Falls back to generic.
const REVIEWS_POOL = {
  _generic: [
    { id: 'r1', name: 'Sandra K.',   initials: 'SK', date: 'vor 3 Tagen',  overall: 5, scores: { taste: 5, value: 5, ingredients: 4, similarity: 5 }, comment: 'Schmeckt für mich genauso wie das Original — bei dem Preis ein Top-Deal!' },
    { id: 'r2', name: 'Markus B.',   initials: 'MB', date: 'vor 1 Woche',  overall: 4, scores: { taste: 4, value: 5, ingredients: 4, similarity: 4 }, comment: 'Solide Alternative. Konsistenz ist minimal anders, aber der Preisunterschied ist es absolut wert.' },
    { id: 'r3', name: 'Lisa H.',     initials: 'LH', date: 'vor 2 Wochen', overall: 5, scores: { taste: 5, value: 5, ingredients: 5, similarity: 5 }, comment: 'Kaufe ich seit Monaten regelmäßig. Familie merkt keinen Unterschied!' },
    { id: 'r4', name: 'Tom W.',      initials: 'TW', date: 'vor 3 Wochen', overall: 3, scores: { taste: 3, value: 5, ingredients: 3, similarity: 2 }, comment: 'Geht in Ordnung, aber Geschmack ist schon spürbar simpler. Für den Alltag okay.' },
    { id: 'r5', name: 'Anna P.',     initials: 'AP', date: 'vor 1 Monat',  overall: 4, scores: { taste: 4, value: 4, ingredients: 5, similarity: 4 }, comment: 'Inhaltsstoffe gefallen mir sogar besser als beim Markenprodukt — weniger Zusatzstoffe.' },
  ],
};

function getReviews(key) {
  return REVIEWS_POOL[key] || REVIEWS_POOL._generic;
}

// Star row — interactive or read-only
function StarRow({ value, onChange, size = 22, color }) {
  const c = color || '#f5b301';
  return (
    <div style={{ display: 'inline-flex', gap: 2 }}>
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={onChange ? () => onChange(n) : undefined} style={{
          background: 'transparent', border: 0, padding: 0,
          cursor: onChange ? 'pointer' : 'default',
          display: 'inline-flex', alignItems: 'center',
        }}>
          <window.MdI name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? c : 'rgba(25,28,29,.22)'}/>
        </button>
      ))}
    </div>
  );
}

// Compact bar — 5 segments, label on left, score on right
function ScoreRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <span style={{ flex: 1, font: `500 13px ${RS_F}`, color: RS_C.text }}>{label}</span>
      <div style={{ display: 'flex', gap: 3 }}>
        {[1,2,3,4,5].map(n => (
          <span key={n} style={{
            width: 14, height: 5, borderRadius: 2,
            background: n <= value ? RS_C.primary : 'var(--th-border-md)',
          }}/>
        ))}
      </div>
      <span style={{ font: `700 12px ${RS_F}`, color: RS_C.muted, minWidth: 18, textAlign: 'right' }}>{value.toFixed(1)}</span>
    </div>
  );
}

// Single review card
function ReviewCard({ r, showSimilarity }) {
  const COLOR_AVATARS = ['#0d8575', '#cc6610', '#7b53b8', '#1b6fc7', '#a83753'];
  const colorIdx = (r.id || '').charCodeAt(0) % COLOR_AVATARS.length;
  return (
    <div style={{
      background: 'var(--th-card)', borderRadius: 14, padding: 14, marginBottom: 10,
      border: '1px solid var(--th-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 18, background: COLOR_AVATARS[colorIdx],
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          font: `800 13px ${RS_F}`,
        }}>{r.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `700 14px ${RS_F}`, color: RS_C.text }}>{r.name}</div>
          <div style={{ font: `500 11px ${RS_F}`, color: RS_C.muted }}>{r.date}</div>
        </div>
        <StarRow value={r.overall} size={16}/>
      </div>
      <div style={{ font: `400 13px/1.45 ${RS_F}`, color: RS_C.textVar, marginBottom: 12 }}>
        {r.comment}
      </div>
      <div style={{ paddingTop: 8, borderTop: '1px solid var(--th-border)' }}>
        <ScoreRow label="Geschmack / Wirkung" value={r.scores.taste}/>
        <ScoreRow label="Preis / Leistung"    value={r.scores.value}/>
        <ScoreRow label="Inhaltsstoffe"       value={r.scores.ingredients}/>
        {showSimilarity && r.scores.similarity != null && (
          <ScoreRow label="Ähnlichkeit zur Marke" value={r.scores.similarity}/>
        )}
      </div>
    </div>
  );
}

// Main sheet
function RatingsSheet({ open, onClose, contextLabel, ratingsKey, showSimilarity = false }) {
  const [view, setView] = React.useState('list'); // 'list' | 'submit'
  const [overall, setOverall] = React.useState(0);
  const [taste, setTaste] = React.useState(0);
  const [value, setValue] = React.useState(0);
  const [ingredients, setIngredients] = React.useState(0);
  const [similarity, setSimilarity] = React.useState(0);
  const [comment, setComment] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  const reviews = getReviews(ratingsKey);
  const avg = (arr, k) => (arr.reduce((s, r) => s + (k ? r.scores[k] : r.overall), 0) / arr.length);
  const avgOverall = avg(reviews);
  const distribution = [5,4,3,2,1].map(n => ({
    n, count: reviews.filter(r => r.overall === n).length,
  }));
  const total = reviews.length;

  if (!open) return null;
  const host = document.getElementById('__sheet_host');

  const reset = () => {
    setOverall(0); setTaste(0); setValue(0); setIngredients(0); setSimilarity(0); setComment(''); setSubmitted(false);
  };
  const handleClose = () => { reset(); setView('list'); onClose(); };
  const handleSubmit = () => {
    setSubmitted(true);
    setTimeout(() => { reset(); setView('list'); }, 1400);
  };

  const node = (
    <div onClick={handleClose} style={{
      position: 'absolute', inset: 0,
      background: 'rgba(25,28,29,.45)', display: 'flex', alignItems: 'flex-end',
      pointerEvents: 'auto',
      animation: 'rs-fade .2s ease',
    }}>
      <style>{`@keyframes rs-fade{from{opacity:0}to{opacity:1}}@keyframes rs-slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      <div onClick={(e)=>e.stopPropagation()} style={{
        width: '100%', background: RS_C.surface, borderRadius: '22px 22px 0 0',
        padding: '10px 0 0', maxHeight: '88%', display: 'flex', flexDirection: 'column',
        animation: 'rs-slideup .26s cubic-bezier(.2,.9,.2,1)',
        boxShadow: '0 -12px 40px rgba(0,0,0,.18)',
      }}>
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#d6d8da', margin: '4px auto 12px' }}/>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 10px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: `600 11px ${RS_F}`, color: RS_C.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Bewertungen
            </div>
            <div style={{ font: `800 18px ${RS_F}`, color: RS_C.text, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {contextLabel}
            </div>
          </div>
          <button onClick={handleClose} style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 4, display: 'flex' }}>
            <window.MdI name="close" size={22} color={RS_C.muted}/>
          </button>
        </div>

        {/* Body — switches by view */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '0 20px 20px' }}>
          {view === 'list' ? (
            <>
              {/* Summary */}
              <div style={{
                background: 'var(--th-card)', borderRadius: 16, padding: 16, marginBottom: 14,
                border: '1px solid var(--th-border)',
                display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, alignItems: 'center',
              }}>
                <div style={{ textAlign: 'center', borderRight: '1px solid var(--th-border-md)', paddingRight: 16 }}>
                  <div style={{ font: `800 36px/1 ${RS_F}`, color: RS_C.text, letterSpacing: '-.02em' }}>
                    {avgOverall.toFixed(1)}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <StarRow value={Math.round(avgOverall)} size={14}/>
                  </div>
                  <div style={{ font: `500 11px ${RS_F}`, color: RS_C.muted, marginTop: 4 }}>{total} Bew.</div>
                </div>
                <div>
                  {distribution.map(({ n, count }) => {
                    const pct = total ? (count / total) * 100 : 0;
                    return (
                      <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                        <span style={{ font: `700 11px ${RS_F}`, color: RS_C.muted, width: 10 }}>{n}</span>
                        <window.MdI name="star" size={11} color="#f5b301"/>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--th-border-md)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: '#f5b301' }}/>
                        </div>
                        <span style={{ font: `500 11px ${RS_F}`, color: RS_C.muted, width: 16, textAlign: 'right' }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Category averages */}
              <div style={{
                background: 'var(--th-card)', borderRadius: 14, padding: '8px 14px', marginBottom: 14,
                border: '1px solid var(--th-border)',
              }}>
                <ScoreRow label="Geschmack / Wirkung" value={avg(reviews, 'taste')}/>
                <ScoreRow label="Preis / Leistung"    value={avg(reviews, 'value')}/>
                <ScoreRow label="Inhaltsstoffe"       value={avg(reviews, 'ingredients')}/>
                {showSimilarity && (
                  <ScoreRow label="Ähnlichkeit zur Marke" value={avg(reviews, 'similarity')}/>
                )}
              </div>

              {/* Reviews list */}
              {reviews.map(r => (
                <ReviewCard key={r.id} r={r} showSimilarity={showSimilarity}/>
              ))}
            </>
          ) : (
            // SUBMIT VIEW
            submitted ? (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 32, background: RS_C.primary,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
                }}>
                  <window.MdI name="check" size={36} color="#fff"/>
                </div>
                <div style={{ font: `800 18px ${RS_F}`, color: RS_C.text, marginBottom: 4 }}>Danke!</div>
                <div style={{ font: `500 14px ${RS_F}`, color: RS_C.muted }}>Deine Bewertung wurde gespeichert.</div>
              </div>
            ) : (
              <>
                {/* Overall — large stars */}
                <div style={{
                  background: 'var(--th-card)', borderRadius: 16, padding: '18px 16px',
                  marginBottom: 12, border: '1px solid var(--th-border)',
                  textAlign: 'center',
                }}>
                  <div style={{ font: `700 13px ${RS_F}`, color: RS_C.text, marginBottom: 10 }}>
                    Gesamtbewertung
                  </div>
                  <StarRow value={overall} onChange={setOverall} size={36}/>
                  <div style={{ font: `500 11px ${RS_F}`, color: RS_C.muted, marginTop: 8 }}>
                    {overall === 0 ? 'Tippe einen Stern' :
                     overall === 5 ? 'Hervorragend' :
                     overall === 4 ? 'Gut' :
                     overall === 3 ? 'Okay' :
                     overall === 2 ? 'Mittelmäßig' : 'Schlecht'}
                  </div>
                </div>

                {/* Per-category sliders */}
                <div style={{
                  background: 'var(--th-card)', borderRadius: 16, padding: '4px 16px',
                  marginBottom: 12, border: '1px solid var(--th-border)',
                }}>
                  <SubmitRow label="Geschmack / Wirkung" value={taste}       onChange={setTaste}/>
                  <SubmitRow label="Preis / Leistung"    value={value}       onChange={setValue}/>
                  <SubmitRow label="Inhaltsstoffe"       value={ingredients} onChange={setIngredients}/>
                  {showSimilarity && (
                    <SubmitRow label="Ähnlichkeit zur Marke" value={similarity} onChange={setSimilarity} last/>
                  )}
                </div>

                {/* Comment */}
                <div style={{
                  background: 'var(--th-card)', borderRadius: 16, padding: 14,
                  marginBottom: 16, border: '1px solid var(--th-border)',
                }}>
                  <div style={{ font: `700 13px ${RS_F}`, color: RS_C.text, marginBottom: 8 }}>
                    Kommentar <span style={{ font: `500 11px ${RS_F}`, color: RS_C.muted }}>(optional)</span>
                  </div>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Wie war dein Eindruck?"
                    rows={4}
                    style={{
                      width: '100%', resize: 'vertical', minHeight: 80,
                      border: '1px solid var(--th-border-strong)', borderRadius: 10,
                      padding: '10px 12px', font: `400 13px/1.4 ${RS_F}`, color: RS_C.text,
                      background: 'var(--th-bg)', outline: 'none', boxSizing: 'border-box',
                    }}/>
                </div>
              </>
            )
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px 20px',
          borderTop: '1px solid var(--th-border-md)',
          background: 'var(--th-card)',
          display: 'flex', gap: 10,
        }}>
          {view === 'list' ? (
            <button onClick={() => setView('submit')} style={{
              flex: 1, height: 50, borderRadius: 14, border: 0, cursor: 'pointer',
              background: RS_C.primary, color: '#fff',
              font: `700 15px ${RS_F}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 4px 12px rgba(13,133,117,.3)',
            }}>
              <window.MdI name="star-plus-outline" size={20} color="#fff"/>
              Bewertung abgeben
            </button>
          ) : !submitted ? (
            <>
              <button onClick={() => { reset(); setView('list'); }} style={{
                flex: '0 0 auto', padding: '0 20px', height: 50, borderRadius: 14,
                background: 'var(--th-card)', color: RS_C.text,
                border: '1px solid var(--th-border-strong)', cursor: 'pointer',
                font: `700 14px ${RS_F}`,
              }}>Abbrechen</button>
              <button onClick={handleSubmit} disabled={overall === 0} style={{
                flex: 1, height: 50, borderRadius: 14, border: 0,
                cursor: overall === 0 ? 'not-allowed' : 'pointer',
                background: overall === 0 ? 'rgba(25,28,29,.14)' : RS_C.primary,
                color: overall === 0 ? RS_C.muted : '#fff',
                font: `700 15px ${RS_F}`,
                boxShadow: overall === 0 ? 'none' : '0 4px 12px rgba(13,133,117,.3)',
              }}>Senden</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  return host ? ReactDOM.createPortal(node, host) : node;
}

// Per-category submit row (label + interactive star row)
function SubmitRow({ label, value, onChange, last }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0',
      borderBottom: last ? 'none' : '1px solid var(--th-border)',
    }}>
      <span style={{ font: `500 13px ${RS_F}`, color: RS_C.text }}>{label}</span>
      <StarRow value={value} onChange={onChange} size={22}/>
    </div>
  );
}

window.RatingsSheet = RatingsSheet;
