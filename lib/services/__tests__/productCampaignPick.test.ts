import {
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

  it('fällt auf die erste zurück, wenn die Wahl nicht mehr läuft', () => {
    expect(pickProductCampaign([a, b], 'weg')).toBe(a);
  });

  it('ohne laufende Aktion gibt es keine', () => {
    expect(pickProductCampaign([], 'a')).toBeNull();
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
