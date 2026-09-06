import { pickProductCampaign, type ActiveProductCampaign } from '../productCampaignPick';

const a: ActiveProductCampaign = { campaignId: 'produkt-fotos-september-2026', rewardCents: 15, title: 'Produktfotos September' };
const b: ActiveProductCampaign = { campaignId: 'milchprodukt-fotos-september-2026', rewardCents: 25, title: 'Milchprodukte' };

describe('pickProductCampaign', () => {
  test('ohne Wahl gewinnt die erste Aktion (wie bisher)', () => {
    expect(pickProductCampaign([a, b], null)).toBe(a);
    expect(pickProductCampaign([a, b], undefined)).toBe(a);
  });
  test('die gewählte Aktion gewinnt, wenn sie noch läuft', () => {
    expect(pickProductCampaign([a, b], b.campaignId)).toBe(b);
  });
  test('eine abgelaufene Wahl wird ignoriert', () => {
    expect(pickProductCampaign([a], b.campaignId)).toBe(a);
  });
  test('keine Aktion → null', () => {
    expect(pickProductCampaign([], 'x')).toBeNull();
  });
});
