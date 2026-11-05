import {
  guenstigsteAktion,
  pickProductCampaign,
  resolveSubmitCampaign,
  type ActiveProductCampaign,
} from '../productCampaignPick';

const a: ActiveProductCampaign = { campaignId: 'a', rewardCents: 12, title: 'Aktion A' };
const b: ActiveProductCampaign = { campaignId: 'b', rewardCents: 16, title: 'Aktion B' };

describe('pickProductCampaign', () => {
  it('nimmt die gewählte Aktion, solange sie läuft', () => {
    expect(pickProductCampaign([a, b], 'b')).toBe(b);
  });

  it('fällt auf die GÜNSTIGSTE zurück, wenn die Wahl nicht mehr läuft', () => {
    expect(pickProductCampaign([a, b], 'weg')).toBe(a);
  });

  it('nimmt ohne Wahl die günstigste — auch wenn die teure vorne steht', () => {
    // Genau der Fall aus der App: „Milchprodukte 0,16 €" steht vor
    // „Produkt-Fotos 0,12 €", weil ihre Frist früher endet. Vorher gewann die
    // Reihenfolge, jetzt gewinnt der Betrag.
    expect(pickProductCampaign([b, a], null)).toBe(a);
    expect(pickProductCampaign([b, a], undefined)).toBe(a);
  });

  it('ohne laufende Aktion gibt es keine', () => {
    expect(pickProductCampaign([], 'a')).toBeNull();
  });
});

describe('guenstigsteAktion', () => {
  it('nimmt den kleinsten Betrag, unabhängig von der Reihenfolge', () => {
    expect(guenstigsteAktion([b, a])).toBe(a);
    expect(guenstigsteAktion([a, b])).toBe(a);
  });

  it('eine Aktion ohne Betrag ist keine günstige, sondern gar keine', () => {
    // Sonst sammelte jemand ungefragt umsonst, während nebenan eine zahlende
    // Aktion läuft. Der Server filtert 0-Aktionen ebenfalls heraus.
    const ohne: ActiveProductCampaign = { campaignId: 'null', rewardCents: 0, title: 'Ohne Betrag' };
    expect(guenstigsteAktion([ohne, a, b])).toBe(a);
  });

  it('zahlt keine einzige, bleibt die 0-Aktion übrig', () => {
    const ohne: ActiveProductCampaign = { campaignId: 'null', rewardCents: 0, title: 'Ohne Betrag' };
    expect(guenstigsteAktion([ohne])).toBe(ohne);
  });

  it('bei gleichem Betrag gewinnt die zuerst gelistete — nicht der Zufall', () => {
    const x: ActiveProductCampaign = { campaignId: 'x', rewardCents: 12, title: 'X' };
    expect(guenstigsteAktion([a, x])).toBe(a);
    expect(guenstigsteAktion([x, a])).toBe(x);
  });

  it('lässt die Eingabeliste unangetastet', () => {
    // Der Aufrufer zeigt sie in seiner eigenen Reihenfolge an.
    const liste = [b, a];
    guenstigsteAktion(liste);
    expect(liste).toEqual([b, a]);
  });

  it('ohne Aktionen gibt es keine', () => {
    expect(guenstigsteAktion([])).toBeNull();
  });
});

describe('resolveSubmitCampaign — „konnte nicht nachsehen" ist nicht „es läuft keine"', () => {
  it('eine frisch aufgelöste Aktion gewinnt', () => {
    expect(resolveSubmitCampaign(a, b)).toEqual({ campaign: a, state: 'live' });
  });

  it('eine frische Auskunft „es läuft keine" schlägt den gemerkten Stand', () => {
    // Sonst würde für eine gerade ausgelaufene Aktion eingereicht.
    expect(resolveSubmitCampaign(null, b)).toEqual({ campaign: null, state: 'keine_aktion' });
  });

  it('konnte nicht nachgesehen werden, greift der beim Öffnen gemerkte Stand', () => {
    // Genau der Fall, der 58 Einreichungen unvergütet ließ: ein einziger
    // fehlgeschlagener Versuch beim Öffnen des Wizards wurde als „es läuft
    // keine Aktion" gelesen und in jede Einreichung der Sitzung eingefroren.
    expect(resolveSubmitCampaign(undefined, b)).toEqual({ campaign: b, state: 'gemerkt' });
  });

  it('ohne beides bleibt es offen — und das ist am Zustand ablesbar', () => {
    expect(resolveSubmitCampaign(undefined, null)).toEqual({ campaign: null, state: 'nicht_ermittelbar' });
    expect(resolveSubmitCampaign(undefined, undefined)).toEqual({ campaign: null, state: 'nicht_ermittelbar' });
  });

  it('unterscheidet „keine_aktion" von „nicht_ermittelbar" — der Server behandelt sie verschieden', () => {
    const keine = resolveSubmitCampaign(null, null);
    const unklar = resolveSubmitCampaign(undefined, null);
    expect(keine.state).not.toBe(unklar.state);
    expect(keine.campaign).toBeNull();
    expect(unklar.campaign).toBeNull();
  });
});
