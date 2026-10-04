# Testseiten für `seitenDaten.js`

Gekürzte Ausschnitte **echter** Shopseiten, abgerufen am 04.10.2026 mit dem
User-Agent des Scrapers (`src/fetcher.js`). Behalten wurden nur Originalteile:
`<title>`, die Meta-Tags `og:title/og:image/og:type`, `product:price:*`,
`description`/`keywords`, ausgewählte JSON-LD-Blöcke unverändert (auch der
kaputte von morgenmarkt mit Steuerzeichen) und die Textstellen rund um die
EAN. Nichts ist erfunden oder umgeschrieben.

| Datei | Seite | Gesuchte EAN | Warum im Test |
|---|---|---|---|
| globus-3600524137564 | produkte.globus.de/…/3600524137564/elvital-shampoo-color-glanz | 3600524137564 | EAN nur als sku/mpn und in Bildpfaden, zwei JSON-LD-Blöcke desselben Produkts, og:image ist ein Hash |
| morgenmarkt-4311501099278 | morgenmarkt.de/gut-gunstig-nuss-nougat-creme-…-p-4311501099278 | 4311501099278 | JSON-LD mit Steuerzeichen, sku = EAN, Name mit Shop-Suffix |
| shopapotheke-4069365317310 | shop-apotheke.com/drogerie/19782442/silodent-sonic-… | 4069365317310 | gtin13 eines ANDEREN Produkts (Widerspruch) — so in nutritionscrape gelandet |
| codecheck-suche-4316268640695 | codecheck.info/search?q=4316268640695 | 4316268640695 | Suchseite: EAN nur hinter „Ergebnisse für“ und als searchText |
| atundo-4311501421840 | atundo.com/shop/GutGuenstig-Erdnuss-Flips-… | 4311501421840 | kein JSON-LD, Microdata mainEntity + isRelatedTo, fremde EAN in keywords |
| olial-4311501051825 | olial.de/produkt/gut-guenstig-spuelmittel-balsam-500ml/ | 4311501051825 | Yoast-@graph mit Product.gtin |
| openfoodfacts-7610807015843 | de.openfoodfacts.org/produkt/7610807015843/pinienkerne-coop | gesucht war 4335619254077 | falsche Seite in nutritionscrape, gesuchte EAN fehlt |
| budni-6832973006 | budni.de/sortiment/produkte/6832973006 | gesucht war 4335619113657 | og:image zeigt auf localhost |
| ehgoo-4070308098821 | ehgoo.de/produkt/ja-mini-riegel-5-sorten-500g-bt-4070308098821/ | 4070308098821 | gtin passt, Angebotspreis „0“ |
| freshstore-4305615633428 | fresh-store.eu/de/shampoo/145181-isana-calming-barrier-serum-…-4305615633428.html | 4305615633428 | kein JSON-LD, og:type product, EAN sichtbar unter „EAN:“ |
| violey-35278 | violey.com/de/dennree-knusper-mix-dinkel_p_35278.html | gesucht war 4056489845881 | Seite eines anderen Produkts, Titel „… bei Violey“ |
