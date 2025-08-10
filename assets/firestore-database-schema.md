# MarkenDetektive Firestore Database Schema

## 📊 Database Overview
- **Project ID:** markendetektive-895f7
- **Analyzed At:** 10.8.2025, 14:40:58
- **Total Collections:** 34

---

## 📋 Table of Contents
- [abopreise](#abopreise)
- [aldiscrapedproducts](#aldiscrapedproducts)
- [appSettings](#appsettings)
- [argustoartikel](#argustoartikel)
- [discounter](#discounter)
- [ff_push_notifications](#ff_push_notifications)
- [handelsmarken](#handelsmarken)
- [hersteller](#hersteller)
- [hersteller_new](#hersteller_new)
- [hersteller_new_formatch](#hersteller_new_formatch)
- [kategorien](#kategorien)
- [lidlscrapedproduct_text](#lidlscrapedproduct_text)
- [lidlscrapedproducts](#lidlscrapedproducts)
- [markenProdukte](#markenprodukte)
- [markenprodukteerfassung](#markenprodukteerfassung)
- [neuesGeheimnis](#neuesgeheimnis)
- [onboardingresults](#onboardingresults)
- [onboardingspendings](#onboardingspendings)
- [onboardingwherefrom](#onboardingwherefrom)
- [packungstypen](#packungstypen)
- [paywallCounter](#paywallcounter)
- [pennyscrapedproduct_text](#pennyscrapedproduct_text)
- [pennyscrapedproducts](#pennyscrapedproducts)
- [processedRatingEvents](#processedratingevents)
- [productRatings](#productratings)
- [produkte](#produkte)
- [produkteerfassung](#produkteerfassung)
- [produkteerfassungBulgaria](#produkteerfassungbulgaria)
- [produktvorschlaege](#produktvorschlaege)
- [scraped_products](#scraped_products)
- [userFeedbacks](#userfeedbacks)
- [users](#users)
- [vetnummern](#vetnummern)
- [vetnummernat](#vetnummernat)

---

## abopreise

**📊 Statistics:**
- Documents: 1
- Fields: 3
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `monthly` | number | 2.99 |
| `yearly` | number | 19.99 |
| `yearlyformonthly` | number | 1.66 |

### TypeScript Interface

```typescript
interface Abopreise {
  monthly: number;
  yearly: number;
  yearlyformonthly: number;
}
```

---

## aldiscrapedproducts

**📊 Statistics:**
- Documents: 3
- Fields: 15
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `Handelsmarke` | string | "ASIA GREEN GARDEN", "ALMARE" |
| `Bild2` | string | "https://dm.emea.cms.aldi.cx/is/image/aldiprodeu...", "https://dm.emea.cms.aldi.cx/is/image/aldiprodeu..." |
| `Preis` | string | "2,79 €*", "2,49 €*" |
| `Größe` | string | "Je 400-g-Packung", "Je 250-g-Packung" |
| `Bild1` | string | "https://dm.emea.cms.aldi.cx/is/image/aldiprodeu...", "https://dm.emea.cms.aldi.cx/is/image/aldiprodeu..." |
| `Artikelbezeichnung` | string | "Frühlingsrolle, Vegetarisch 400 g", "Matjesfilet mit Sauce, Sauce Sylter Art 250 g" |
| `Bild3` | string | "https://dm.emea.cms.aldi.cx/is/image/aldiprodeu...", "https://dm.emea.cms.aldi.cx/is/image/aldiprodeu..." |
| `Adresse2` | string | "Johannstraße 37, 40476 Düsseldorf, DE", "Alter Kirchweg 18, 25709 Marne, DE" |
| `Adresse1` | string | "Delfinvej 3, 5800 Nyborg, DK", "Heinrich-Hamker-Straße 20, 49152 Bad Essen, DE" |
| `﻿Seite_URL` | string | "https://www.mein-aldi.de/product/asia-green-gar...", "https://www.mein-aldi.de/product/almare-almare-..." |
| `Firma1` | string | "Daloon A/S Eksport", "VOSS Feinkost und Lebensmittel GmbH" |
| `Firma2` | string | "IZICO Deutschland GmbH", "Friesenkrone Feinkost GmbH & Co. KG" |
| `ean` | string | "4061458257824", "4061458043090" |
| `updatedAt` | timestamp | "[object]", "[object]" |
| `alreadyindb` | boolean | false, true |

### TypeScript Interface

```typescript
interface Aldiscrapedproducts {
  Adresse1?: string;
  Adresse2: string;
  alreadyindb: boolean;
  Artikelbezeichnung: string;
  Bild1: string;
  Bild2: string;
  Bild3?: string;
  ean: string;
  Firma1?: string;
  Firma2: string;
  Größe: string;
  Handelsmarke: string;
  Preis: string;
  ﻿Seite_URL: string;
  updatedAt: Date | FirebaseTimestamp;
}
```

---

## appSettings

**📊 Statistics:**
- Documents: 1
- Fields: 5
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `ratePromptIntervalDays` | number | 0 |
| `minCumulativeUsageMinutes` | number | 1 |
| `freeScansPerDay` | number | 3 |
| `contactEMail` | string | "info@markendetektive.de" |
| `scansCountBeforeFeedbackPrompt` | number | 3 |

### TypeScript Interface

```typescript
interface AppSettings {
  contactEMail: string;
  freeScansPerDay: number;
  minCumulativeUsageMinutes: number;
  ratePromptIntervalDays: number;
  scansCountBeforeFeedbackPrompt: number;
}
```

---

## argustoartikel

**📊 Statistics:**
- Documents: 3
- Fields: 32
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `id` | string | "71f4e0d3-07f8-11f0-8476-960001b9aa54", "6ec3002b-07f8-11f0-8476-960001b9aa54" |
| `Name` | string | "Dip, Hot Cheese, 200 ml", "Bio Gemüse-Eintopf, 250 g" |
| `Checkdatum` | string | "08.05.2025 13:55", "12.11.2024 13:17" |
| `Hersteller` | string | "Intersnack Knabber-Gebäck GmbH & Co. KG", "InnFood GmbH" |
| `Konzern` | string | "Intersnack Knabber-Gebäck GmbH & Co. KG", "InnFood GmbH" |
| `EV` | null | null, null |
| `Leitartikel` | string | "Chio, Dip, Hot Cheese, 200 ml", "Bio Mamia, Bio Gemüse-Eintopf, 250 g" |
| `Preis` | number | 2.49, 1.15 |
| `Preis_Waehrung` | string | "€", "€" |
| `Preis_Einheit` | string | "Stück", "Stück" |
| `Gewicht` | number | 200, 250 |
| `Gewicht_Einheit` | string | "ml", "g" |
| `Aktionslager` | boolean | false, false |
| `Marke_Name` | string | "Chio", "Mamia Bio (AS)" |
| `Eigenmarke` | boolean | false, true |
| `Lager` | object | "[object]", "[object]" |
| `Lager.PLZ` | string | "41515", "93128" |
| `Lager.Ort` | string | "Grevenbroich", "Regenstauf" |
| `Lager.Latitude` | number | 51.0821211, 49.1505482 |
| `Lager.Longitude` | number | 6.603843, 12.165734 |
| `EAN` | string | "4001242108239", "4061464021303" |
| `Neu` | boolean | false, false |
| `Preisaenderung` | boolean | false, false |
| `Warengruppe` | string | "Chips & Kartoffelsnacks", "Babynahrung" |
| `Segment` | string | "Salzige & süße Snacks", "Babynahrung & -hygiene" |
| `Attributes` | string | "{"Big 5\/8 (100gr)":{"1 Brennwert\/Energie in k...", "{"Big 5\/8 (100gr)":{"1 Brennwert\/Energie in k..." |
| `Geloescht` | boolean | false, false |
| `Zutatenliste` | string | "Trinkwasser, KÄSE (9%), modifizierte Stärke, Pa...", "Magermilch 42%, Karotten' 20%, Kartoffeln 16%, ..." |
| `Aktion_Beginn` | null | null, null |
| `Aktion_Ende` | null | null, null |
| `Preisaktion` | boolean | false, false |
| `Bild_URL` | string | "http://app.argusto.de/bild/app/tmp?path=3794261...", "http://app.argusto.de/bild/app/tmp?path=3807387..." |

### TypeScript Interface

```typescript
interface Argustoartikel {
  Aktion_Beginn: null;
  Aktion_Ende: null;
  Aktionslager: boolean;
  Attributes: string;
  Bild_URL: string;
  Checkdatum: string;
  EAN: string;
  Eigenmarke: boolean;
  EV: null;
  Geloescht: boolean;
  Gewicht: number;
  Gewicht_Einheit: string;
  Hersteller: string;
  id: string;
  Konzern: string;
  Lager: object;
  Leitartikel: string;
  Marke_Name: string;
  Name: string;
  Neu: boolean;
  Preis: number;
  Preis_Einheit: string;
  Preis_Waehrung: string;
  Preisaenderung: boolean;
  Preisaktion: boolean;
  Segment: string;
  Warengruppe: string;
  Zutatenliste: string;
}
```

---

## discounter

**📊 Statistics:**
- Documents: 3
- Fields: 6
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `name` | string | "Aldi Nord", "GLOBUS" |
| `land` | string | "DE", "DE" |
| `bild` | string | "https://storage.googleapis.com/markendetektive-...", "https://storage.googleapis.com/markendetektive-..." |
| `isFree` | boolean | true, false |
| `infos` | string | "Als Aldi bekannt sind die zwei aus einem gemein...", "Die Globus-Gruppe unter Führung der Globus Hold..." |
| `color` | string | "#27327B", "#186735" |

### TypeScript Interface

```typescript
interface Discounter {
  bild: string;
  color: string;
  infos: string;
  isFree: boolean;
  land: string;
  name: string;
}
```

---

## ff_push_notifications

**📊 Statistics:**
- Documents: 3
- Fields: 10
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `parameter_data` | string | "{}", "{}" |
| `target_audience` | string | "All", "All" |
| `notification_title` | string | "test2", "Dies ist ein einfacher Test" |
| `notification_sound` | string | "default", "default" |
| `initial_page_name` | string | "ProduktlisteAlle", "Profil" |
| `notification_text` | string | "test2", "Hey test der push funktion" |
| `timestamp` | timestamp | "[object]", "[object]" |
| `num_sent` | number | 1, 1 |
| `status` | string | "succeeded", "succeeded" |
| `notification_image_url` | string | "https://storage.googleapis.com/flutterflow-io-6...", "https://storage.googleapis.com/flutterflow-io-6..." |

### TypeScript Interface

```typescript
interface FfPushNotifications {
  initial_page_name: string;
  notification_image_url?: string;
  notification_sound: string;
  notification_text: string;
  notification_title: string;
  num_sent: number;
  parameter_data: string;
  status: string;
  target_audience: string;
  timestamp: Date | FirebaseTimestamp;
}
```

---

## handelsmarken

**📊 Statistics:**
- Documents: 3
- Fields: 2
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `bild` | string | "https://markendetektive.de/images/handelsmarken/", "https://markendetektive.de/images/handelsmarken/" |
| `bezeichnung` | string | "Landfein", "REWE to go" |

### TypeScript Interface

```typescript
interface Handelsmarken {
  bezeichnung: string;
  bild: string;
}
```

---

## hersteller

**📊 Statistics:**
- Documents: 3
- Fields: 98
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `bild` | string | "https://firebasestorage.googleapis.com/v0/b/mar...", "https://firebasestorage.googleapis.com/v0/b/mar..." |
| `adresse` | string | "Senator-Mester-Str. 1", "Vinner Weg 3" |
| `land` | string | "DE", "DE" |
| `herstellername` | string | "saturn petcare GmbH", "Schne-frost Ernst Schnetkamp GmbH & Co. KG" |
| `stadt` | string | "Bremen", "Löningen" |
| `identNummer` | string | "", "" |
| `infos` | string | " ", "Continental Bakeries (Haust) B.V. ist in der Br..." |
| `plz` | string | "28197", "49624" |
| `addedby` | string | "", "Galina" |
| `createdat` | timestamp | "[object]", "[object]" |
| `name` | string | "z - NoName", "Haust" |
| `herstellerref` | object | "[object]", "[object]" |
| `herstellerref._firestore` | object | "[object]", "[object]" |
| `herstellerref._firestore._settings` | object | "[object]", "[object]" |
| `herstellerref._firestore._settings.credentials` | object | "[object]", "[object]" |
| `herstellerref._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `herstellerref._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `herstellerref._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `herstellerref._firestore._settings.preferRest` | undefined | ,  |
| `herstellerref._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `herstellerref._firestore._settings.libName` | string | "gccl", "gccl" |
| `herstellerref._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `herstellerref._firestore._settings.toJSON` | unknown | ,  |
| `herstellerref._firestore._settingsFrozen` | boolean | true, true |
| `herstellerref._firestore._serializer` | object | "[object]", "[object]" |
| `herstellerref._firestore._serializer.createReference` | unknown | ,  |
| `herstellerref._firestore._serializer.createInteger` | unknown | ,  |
| `herstellerref._firestore._serializer.allowUndefined` | boolean | false, false |
| `herstellerref._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `herstellerref._firestore._databaseId` | string | "(default)", "(default)" |
| `herstellerref._firestore.registeredListenersCount` | number | 0, 0 |
| `herstellerref._firestore.bulkWritersCount` | number | 0, 0 |
| `herstellerref._firestore._traceUtil` | object | "[object]", "[object]" |
| `herstellerref._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `herstellerref._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `herstellerref._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `herstellerref._firestore._backoffSettings` | object | "[object]", "[object]" |
| `herstellerref._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `herstellerref._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `herstellerref._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `herstellerref._firestore._clientPool` | object | "[object]", "[object]" |
| `herstellerref._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `herstellerref._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `herstellerref._firestore._clientPool.clientFactory` | unknown | ,  |
| `herstellerref._firestore._clientPool.clientDestructor` | unknown | ,  |
| `herstellerref._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `herstellerref._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `herstellerref._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `herstellerref._firestore._clientPool.terminated` | boolean | false, false |
| `herstellerref._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.GoogleAuth` | unknown | ,  |
| `herstellerref._firestore._gax.grpc` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.OngoingCall` | unknown | ,  |
| `herstellerref._firestore._gax.createApiCall` | unknown | ,  |
| `herstellerref._firestore._gax.BundleDescriptor` | unknown | ,  |
| `herstellerref._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `herstellerref._firestore._gax.PageDescriptor` | unknown | ,  |
| `herstellerref._firestore._gax.StreamDescriptor` | unknown | ,  |
| `herstellerref._firestore._gax.CallSettings` | unknown | ,  |
| `herstellerref._firestore._gax.constructSettings` | unknown | ,  |
| `herstellerref._firestore._gax.RetryOptions` | unknown | ,  |
| `herstellerref._firestore._gax.createRetryOptions` | unknown | ,  |
| `herstellerref._firestore._gax.createBundleOptions` | unknown | ,  |
| `herstellerref._firestore._gax.createBackoffSettings` | unknown | ,  |
| `herstellerref._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `herstellerref._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `herstellerref._firestore._gax.GoogleError` | unknown | ,  |
| `herstellerref._firestore._gax.ClientStub` | unknown | ,  |
| `herstellerref._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `herstellerref._firestore._gax.GrpcClient` | unknown | ,  |
| `herstellerref._firestore._gax.Operation` | unknown | ,  |
| `herstellerref._firestore._gax.operation` | unknown | ,  |
| `herstellerref._firestore._gax.PathTemplate` | unknown | ,  |
| `herstellerref._firestore._gax.Status` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.OperationsClient` | unknown | ,  |
| `herstellerref._firestore._gax.IamClient` | unknown | ,  |
| `herstellerref._firestore._gax.LocationsClient` | unknown | ,  |
| `herstellerref._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `herstellerref._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `herstellerref._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.fallback` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.makeUUID` | unknown | ,  |
| `herstellerref._firestore._gax.ChannelCredentials` | unknown | ,  |
| `herstellerref._firestore._gax.warn` | unknown | ,  |
| `herstellerref._firestore._gax.serializer` | object | "[object]", "[object]" |
| `herstellerref._firestore._gax.lro` | unknown | ,  |
| `herstellerref._path` | object | "[object]", "[object]" |
| `herstellerref._path.segments` | array | "[object]", "[object]" |
| `herstellerref._converter` | object | "[object]", "[object]" |
| `herstellerref._converter.toFirestore` | unknown | ,  |
| `herstellerref._converter.fromFirestore` | unknown | ,  |

### TypeScript Interface

```typescript
interface Hersteller {
  addedby: string;
  adresse?: string;
  bild: string;
  createdat: Date | FirebaseTimestamp;
  herstellername?: string;
  herstellerref: object;
  identNummer: string;
  infos: string;
  land?: string;
  name: string;
  plz?: string;
  stadt?: string;
}
```

---

## hersteller_new

**📊 Statistics:**
- Documents: 3
- Fields: 9
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `createdat` | timestamp | "[object]", "[object]" |
| `addedby` | string | "Ivelina", "" |
| `adresse` | string | "Beneluxweg 8", "Senator-Mester-Str. 1" |
| `land` | string | "NL", "DE" |
| `herstellername` | string | "Van Dam Bodegraven B.V.", "saturn petcare GmbH" |
| `stadt` | string | "Bodegraven", "Bremen" |
| `identNummer` | string | "", "" |
| `plz` | string | "2411 NG", "28197" |
| `bild` | string | "https://firebasestorage.googleapis.com/v0/b/mar...", "https://storage.googleapis.com/markendetektive-..." |

### TypeScript Interface

```typescript
interface HerstellerNew {
  addedby: string;
  adresse: string;
  bild?: string;
  createdat: Date | FirebaseTimestamp;
  herstellername: string;
  identNummer: string;
  land: string;
  plz: string;
  stadt: string;
}
```

---

## hersteller_new_formatch

**📊 Statistics:**
- Documents: 3
- Fields: 9
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `addedby` | string | "Ivelina", "" |
| `adresse` | string | "Beneluxweg 8", "Senator-Mester-Str. 1" |
| `createdat` | timestamp | "[object]", "[object]" |
| `herstellername` | string | "Van Dam Bodegraven B.V.", "saturn petcare GmbH" |
| `identNummer` | string | "", "" |
| `land` | string | "NL", "DE" |
| `plz` | string | "2411 NG", "28197" |
| `stadt` | string | "Bodegraven", "Bremen" |
| `bild` | string | "https://firebasestorage.googleapis.com/v0/b/mar...", "https://storage.googleapis.com/markendetektive-..." |

### TypeScript Interface

```typescript
interface HerstellerNewFormatch {
  addedby: string;
  adresse: string;
  bild?: string;
  createdat: Date | FirebaseTimestamp;
  herstellername: string;
  identNummer: string;
  land: string;
  plz: string;
  stadt: string;
}
```

---

## kategorien

**📊 Statistics:**
- Documents: 3
- Fields: 3
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `bezeichnung` | string | "Fürs Haustier", "Getränke" |
| `bild` | string | "https://storage.googleapis.com/markendetektive-...", "https://storage.googleapis.com/markendetektive-..." |
| `isFree` | boolean | false, false |

### TypeScript Interface

```typescript
interface Kategorien {
  bezeichnung: string;
  bild: string;
  isFree: boolean;
}
```

---

## lidlscrapedproduct_text

**📊 Statistics:**
- Documents: 3
- Fields: 24
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `folderName` | string | "20758776", "40896298" |
| `originalFolderName` | string | "Neuer_Ordner_mit_Objekten_38", "Neuer_Ordner_mit_Objekten_5" |
| `barcode` | string | "20758776", "40896298" |
| `barcodefound` | boolean | true, true |
| `imageLinks` | array | "[object]", "[object]" |
| `hersteller` | string | "Ernst W. Carstensen GmbH", "Brandt Schokoladen GmbH + Co. KG" |
| `herstelleradresse` | string | "Mecklenburger Str. 255, DE-23658 Lübeck", "Emperor Str. 152 ED, 58313 Hagen" |
| `produktname` | string | "Edel-Marzipan Eier Jamaica-Rum Zartbitter", "Osterhase mit Schleife" |
| `handelsmarke` | string | "Favorina", "FAVRINA" |
| `preis` | string | "1,49", "2,99" |
| `packungsgroesse` | string | "125g", "150g" |
| `zutaten` | string | "Zucker, Mandeln, Wasser, Kakaomasse, Kakaobutte...", "Zucker, Pflanzenfette (Palm, Sheabutter), Vollm..." |
| `naehrwerteje` | string | "100g", "100g" |
| `kcal` | string | "470", "539" |
| `fett` | string | "30g", "30g" |
| `davongesaettigt` | string | "6g", "19g" |
| `kohlenhydrate` | string | "41g", "59g" |
| `zucker` | string | "39g", "59g" |
| `eiweiss` | string | "5g", "5g" |
| `salz` | string | "0,05g", "0,02g" |
| `tags` | string | "Marzipan, Schokolade, Süßwaren, Ostern, Favorin...", "FAVRINA, Schokolade, Osterhase, weiße Schokolad..." |
| `timestamp` | timestamp | "[object]", "[object]" |
| `nameindb` | string | "Brandt Schokoladen GmbH & Co. KG", "Wergona Schokoladen GmbH" |
| `herstellerId` | string | "61eV0WiXLAjB9ww3otyN", "ZCh53EzPsqf2APE5oIZ2" |

### TypeScript Interface

```typescript
interface LidlscrapedproductText {
  barcode: string;
  barcodefound: boolean;
  davongesaettigt: string;
  eiweiss: string;
  fett: string;
  folderName: string;
  handelsmarke: string;
  hersteller: string;
  herstelleradresse: string;
  herstellerId?: string;
  imageLinks: any[];
  kcal: string;
  kohlenhydrate: string;
  naehrwerteje: string;
  nameindb?: string;
  originalFolderName: string;
  packungsgroesse: string;
  preis: string;
  produktname: string;
  salz: string;
  tags: string;
  timestamp: Date | FirebaseTimestamp;
  zucker: string;
  zutaten: string;
}
```

---

## lidlscrapedproducts

**📊 Statistics:**
- Documents: 3
- Fields: 22
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `barcode` | string | "20758776", "21278501" |
| `barcodefound` | boolean | true, true |
| `davongesaettigt` | string | "6g" |
| `eiweiss` | string | "5g" |
| `fett` | string | "30g" |
| `folderName` | string | "20758776" |
| `handelsmarke` | string | "Favorina" |
| `hersteller` | string | "Ernst W. Carstensen GmbH" |
| `herstelleradresse` | string | "Mecklenburger Str. 255, DE-23658 Lübeck" |
| `imageLinks` | array | "[object]" |
| `kcal` | string | "470" |
| `kohlenhydrate` | string | "41g" |
| `naehrwerteje` | string | "100g" |
| `originalFolderName` | string | "Neuer_Ordner_mit_Objekten_38", "Neuer_Ordner_mit_Objekten_8" |
| `packungsgroesse` | string | "125g" |
| `preis` | string | "1,49" |
| `produktname` | string | "Edel-Marzipan Eier Jamaica-Rum Zartbitter" |
| `salz` | string | "0,05g" |
| `tags` | string | "Marzipan, Schokolade, Süßwaren, Ostern, Favorin..." |
| `timestamp` | timestamp | "[object]", "[object]" |
| `zucker` | string | "39g" |
| `zutaten` | string | "Zucker, Mandeln, Wasser, Kakaomasse, Kakaobutte..." |

### TypeScript Interface

```typescript
interface Lidlscrapedproducts {
  barcode: string;
  barcodefound: boolean;
  davongesaettigt?: string;
  eiweiss?: string;
  fett?: string;
  folderName?: string;
  handelsmarke?: string;
  hersteller?: string;
  herstelleradresse?: string;
  imageLinks?: any[];
  kcal?: string;
  kohlenhydrate?: string;
  naehrwerteje?: string;
  originalFolderName: string;
  packungsgroesse?: string;
  preis?: string;
  produktname?: string;
  salz?: string;
  tags?: string;
  timestamp: Date | FirebaseTimestamp;
  zucker?: string;
  zutaten?: string;
}
```

---

## markenProdukte

**📊 Statistics:**
- Documents: 3
- Fields: 285
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `EANs` | array | "[object]", "[object]" |
| `addedby` | string | "Sarah", "Sarah" |
| `beschreibung` | string | "Kartoffeln, frittierte Kartoffeln", "Gebäck, Lauge, Salzbrezeln" |
| `bild` | string | "https://firebasestorage.googleapis.com/v0/b/mar...", "https://firebasestorage.googleapis.com/v0/b/mar..." |
| `created_at` | timestamp | "[object]", "[object]" |
| `hersteller` | object | "[object]", "[object]" |
| `hersteller._firestore` | object | "[object]", "[object]" |
| `hersteller._firestore._settings` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.credentials` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.preferRest` | undefined | ,  |
| `hersteller._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore._settings.libName` | string | "gccl", "gccl" |
| `hersteller._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `hersteller._firestore._settings.toJSON` | unknown | ,  |
| `hersteller._firestore._settingsFrozen` | boolean | true, true |
| `hersteller._firestore._serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._serializer.createReference` | unknown | ,  |
| `hersteller._firestore._serializer.createInteger` | unknown | ,  |
| `hersteller._firestore._serializer.allowUndefined` | boolean | false, false |
| `hersteller._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore.registeredListenersCount` | number | 0, 0 |
| `hersteller._firestore.bulkWritersCount` | number | 0, 0 |
| `hersteller._firestore._traceUtil` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `hersteller._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `hersteller._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `hersteller._firestore._clientPool` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `hersteller._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `hersteller._firestore._clientPool.clientFactory` | unknown | ,  |
| `hersteller._firestore._clientPool.clientDestructor` | unknown | ,  |
| `hersteller._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `hersteller._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.terminated` | boolean | false, false |
| `hersteller._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `hersteller._firestore._gax` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.GoogleAuth` | unknown | ,  |
| `hersteller._firestore._gax.grpc` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OngoingCall` | unknown | ,  |
| `hersteller._firestore._gax.createApiCall` | unknown | ,  |
| `hersteller._firestore._gax.BundleDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.PageDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.StreamDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.CallSettings` | unknown | ,  |
| `hersteller._firestore._gax.constructSettings` | unknown | ,  |
| `hersteller._firestore._gax.RetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createRetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBundleOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.GoogleError` | unknown | ,  |
| `hersteller._firestore._gax.ClientStub` | unknown | ,  |
| `hersteller._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `hersteller._firestore._gax.GrpcClient` | unknown | ,  |
| `hersteller._firestore._gax.Operation` | unknown | ,  |
| `hersteller._firestore._gax.operation` | unknown | ,  |
| `hersteller._firestore._gax.PathTemplate` | unknown | ,  |
| `hersteller._firestore._gax.Status` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OperationsClient` | unknown | ,  |
| `hersteller._firestore._gax.IamClient` | unknown | ,  |
| `hersteller._firestore._gax.LocationsClient` | unknown | ,  |
| `hersteller._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `hersteller._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `hersteller._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.fallback` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.makeUUID` | unknown | ,  |
| `hersteller._firestore._gax.ChannelCredentials` | unknown | ,  |
| `hersteller._firestore._gax.warn` | unknown | ,  |
| `hersteller._firestore._gax.serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.lro` | unknown | ,  |
| `hersteller._path` | object | "[object]", "[object]" |
| `hersteller._path.segments` | array | "[object]", "[object]" |
| `hersteller._converter` | object | "[object]", "[object]" |
| `hersteller._converter.toFirestore` | unknown | ,  |
| `hersteller._converter.fromFirestore` | unknown | ,  |
| `kategorie` | object | "[object]", "[object]" |
| `kategorie._firestore` | object | "[object]", "[object]" |
| `kategorie._firestore._settings` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.credentials` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.preferRest` | undefined | ,  |
| `kategorie._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore._settings.libName` | string | "gccl", "gccl" |
| `kategorie._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `kategorie._firestore._settings.toJSON` | unknown | ,  |
| `kategorie._firestore._settingsFrozen` | boolean | true, true |
| `kategorie._firestore._serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._serializer.createReference` | unknown | ,  |
| `kategorie._firestore._serializer.createInteger` | unknown | ,  |
| `kategorie._firestore._serializer.allowUndefined` | boolean | false, false |
| `kategorie._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore.registeredListenersCount` | number | 0, 0 |
| `kategorie._firestore.bulkWritersCount` | number | 0, 0 |
| `kategorie._firestore._traceUtil` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `kategorie._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `kategorie._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `kategorie._firestore._clientPool` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `kategorie._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `kategorie._firestore._clientPool.clientFactory` | unknown | ,  |
| `kategorie._firestore._clientPool.clientDestructor` | unknown | ,  |
| `kategorie._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `kategorie._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.terminated` | boolean | false, false |
| `kategorie._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `kategorie._firestore._gax` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.GoogleAuth` | unknown | ,  |
| `kategorie._firestore._gax.grpc` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OngoingCall` | unknown | ,  |
| `kategorie._firestore._gax.createApiCall` | unknown | ,  |
| `kategorie._firestore._gax.BundleDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.PageDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.StreamDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.CallSettings` | unknown | ,  |
| `kategorie._firestore._gax.constructSettings` | unknown | ,  |
| `kategorie._firestore._gax.RetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createRetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBundleOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.GoogleError` | unknown | ,  |
| `kategorie._firestore._gax.ClientStub` | unknown | ,  |
| `kategorie._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `kategorie._firestore._gax.GrpcClient` | unknown | ,  |
| `kategorie._firestore._gax.Operation` | unknown | ,  |
| `kategorie._firestore._gax.operation` | unknown | ,  |
| `kategorie._firestore._gax.PathTemplate` | unknown | ,  |
| `kategorie._firestore._gax.Status` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OperationsClient` | unknown | ,  |
| `kategorie._firestore._gax.IamClient` | unknown | ,  |
| `kategorie._firestore._gax.LocationsClient` | unknown | ,  |
| `kategorie._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `kategorie._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `kategorie._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.fallback` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.makeUUID` | unknown | ,  |
| `kategorie._firestore._gax.ChannelCredentials` | unknown | ,  |
| `kategorie._firestore._gax.warn` | unknown | ,  |
| `kategorie._firestore._gax.serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.lro` | unknown | ,  |
| `kategorie._path` | object | "[object]", "[object]" |
| `kategorie._path.segments` | array | "[object]", "[object]" |
| `kategorie._converter` | object | "[object]", "[object]" |
| `kategorie._converter.toFirestore` | unknown | ,  |
| `kategorie._converter.fromFirestore` | unknown | ,  |
| `name` | string | "Pommes Frites ", "Salzstangen" |
| `packSize` | number | 2500, 200 |
| `packTyp` | object | "[object]", "[object]" |
| `packTyp._firestore` | object | "[object]", "[object]" |
| `packTyp._firestore._settings` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.credentials` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.preferRest` | undefined | ,  |
| `packTyp._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore._settings.libName` | string | "gccl", "gccl" |
| `packTyp._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `packTyp._firestore._settings.toJSON` | unknown | ,  |
| `packTyp._firestore._settingsFrozen` | boolean | true, true |
| `packTyp._firestore._serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._serializer.createReference` | unknown | ,  |
| `packTyp._firestore._serializer.createInteger` | unknown | ,  |
| `packTyp._firestore._serializer.allowUndefined` | boolean | false, false |
| `packTyp._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore.registeredListenersCount` | number | 0, 0 |
| `packTyp._firestore.bulkWritersCount` | number | 0, 0 |
| `packTyp._firestore._traceUtil` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `packTyp._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `packTyp._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `packTyp._firestore._clientPool` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `packTyp._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `packTyp._firestore._clientPool.clientFactory` | unknown | ,  |
| `packTyp._firestore._clientPool.clientDestructor` | unknown | ,  |
| `packTyp._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `packTyp._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.terminated` | boolean | false, false |
| `packTyp._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `packTyp._firestore._gax` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.GoogleAuth` | unknown | ,  |
| `packTyp._firestore._gax.grpc` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OngoingCall` | unknown | ,  |
| `packTyp._firestore._gax.createApiCall` | unknown | ,  |
| `packTyp._firestore._gax.BundleDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.PageDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.StreamDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.CallSettings` | unknown | ,  |
| `packTyp._firestore._gax.constructSettings` | unknown | ,  |
| `packTyp._firestore._gax.RetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createRetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBundleOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.GoogleError` | unknown | ,  |
| `packTyp._firestore._gax.ClientStub` | unknown | ,  |
| `packTyp._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `packTyp._firestore._gax.GrpcClient` | unknown | ,  |
| `packTyp._firestore._gax.Operation` | unknown | ,  |
| `packTyp._firestore._gax.operation` | unknown | ,  |
| `packTyp._firestore._gax.PathTemplate` | unknown | ,  |
| `packTyp._firestore._gax.Status` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OperationsClient` | unknown | ,  |
| `packTyp._firestore._gax.IamClient` | unknown | ,  |
| `packTyp._firestore._gax.LocationsClient` | unknown | ,  |
| `packTyp._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `packTyp._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `packTyp._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.fallback` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.makeUUID` | unknown | ,  |
| `packTyp._firestore._gax.ChannelCredentials` | unknown | ,  |
| `packTyp._firestore._gax.warn` | unknown | ,  |
| `packTyp._firestore._gax.serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.lro` | unknown | ,  |
| `packTyp._path` | object | "[object]", "[object]" |
| `packTyp._path.segments` | array | "[object]", "[object]" |
| `packTyp._converter` | object | "[object]", "[object]" |
| `packTyp._converter.toFirestore` | unknown | ,  |
| `packTyp._converter.fromFirestore` | unknown | ,  |
| `preis` | number | 5.89, 1.15 |
| `preisDatum` | timestamp | "[object]", "[object]" |
| `rating` | number | 0, 0 |
| `ratingCount` | number | 0, 0 |
| `ratingCountContent` | number | 0, 0 |
| `ratingCountOverall` | number | 0, 0 |
| `ratingCountPriceValue` | number | 0, 0 |
| `ratingCountTasteFunction` | number | 0, 0 |
| `ratingSumContent` | number | 0, 0 |
| `ratingSumOverall` | number | 0, 0 |
| `ratingSumPriceValue` | number | 0, 0 |
| `ratingSumTasteFunction` | number | 0, 0 |
| `averageRatingOverall` | number | 0, 0 |
| `averageRatingContent` | number | 0, 0 |
| `averageRatingPriceValue` | number | 0, 0 |
| `averageRatingSimilarity` | number | 0, 0 |
| `averageRatingTasteFunction` | number | 0, 0 |

### TypeScript Interface

```typescript
interface MarkenProdukte {
  addedby: string;
  averageRatingContent: number;
  averageRatingOverall: number;
  averageRatingPriceValue: number;
  averageRatingSimilarity: number;
  averageRatingTasteFunction: number;
  beschreibung: string;
  bild: string;
  created_at: Date | FirebaseTimestamp;
  EANs: any[];
  hersteller: object;
  kategorie: object;
  name: string;
  packSize: number;
  packTyp: object;
  preis: number;
  preisDatum: Date | FirebaseTimestamp;
  rating: number;
  ratingCount: number;
  ratingCountContent: number;
  ratingCountOverall: number;
  ratingCountPriceValue: number;
  ratingCountTasteFunction: number;
  ratingSumContent: number;
  ratingSumOverall: number;
  ratingSumPriceValue: number;
  ratingSumTasteFunction: number;
}
```

---

## markenprodukteerfassung

**📊 Statistics:**
- Documents: 3
- Fields: 269
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `hersteller` | object | "[object]", "[object]" |
| `hersteller._firestore` | object | "[object]", "[object]" |
| `hersteller._firestore._settings` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.credentials` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.preferRest` | undefined | ,  |
| `hersteller._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore._settings.libName` | string | "gccl", "gccl" |
| `hersteller._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `hersteller._firestore._settings.toJSON` | unknown | ,  |
| `hersteller._firestore._settingsFrozen` | boolean | true, true |
| `hersteller._firestore._serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._serializer.createReference` | unknown | ,  |
| `hersteller._firestore._serializer.createInteger` | unknown | ,  |
| `hersteller._firestore._serializer.allowUndefined` | boolean | false, false |
| `hersteller._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore.registeredListenersCount` | number | 0, 0 |
| `hersteller._firestore.bulkWritersCount` | number | 0, 0 |
| `hersteller._firestore._traceUtil` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `hersteller._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `hersteller._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `hersteller._firestore._clientPool` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `hersteller._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `hersteller._firestore._clientPool.clientFactory` | unknown | ,  |
| `hersteller._firestore._clientPool.clientDestructor` | unknown | ,  |
| `hersteller._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `hersteller._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.terminated` | boolean | false, false |
| `hersteller._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `hersteller._firestore._gax` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.GoogleAuth` | unknown | ,  |
| `hersteller._firestore._gax.grpc` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OngoingCall` | unknown | ,  |
| `hersteller._firestore._gax.createApiCall` | unknown | ,  |
| `hersteller._firestore._gax.BundleDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.PageDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.StreamDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.CallSettings` | unknown | ,  |
| `hersteller._firestore._gax.constructSettings` | unknown | ,  |
| `hersteller._firestore._gax.RetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createRetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBundleOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.GoogleError` | unknown | ,  |
| `hersteller._firestore._gax.ClientStub` | unknown | ,  |
| `hersteller._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `hersteller._firestore._gax.GrpcClient` | unknown | ,  |
| `hersteller._firestore._gax.Operation` | unknown | ,  |
| `hersteller._firestore._gax.operation` | unknown | ,  |
| `hersteller._firestore._gax.PathTemplate` | unknown | ,  |
| `hersteller._firestore._gax.Status` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OperationsClient` | unknown | ,  |
| `hersteller._firestore._gax.IamClient` | unknown | ,  |
| `hersteller._firestore._gax.LocationsClient` | unknown | ,  |
| `hersteller._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `hersteller._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `hersteller._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.fallback` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.makeUUID` | unknown | ,  |
| `hersteller._firestore._gax.ChannelCredentials` | unknown | ,  |
| `hersteller._firestore._gax.warn` | unknown | ,  |
| `hersteller._firestore._gax.serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.lro` | unknown | ,  |
| `hersteller._path` | object | "[object]", "[object]" |
| `hersteller._path.segments` | array | "[object]", "[object]" |
| `hersteller._converter` | object | "[object]", "[object]" |
| `hersteller._converter.toFirestore` | unknown | ,  |
| `hersteller._converter.fromFirestore` | unknown | ,  |
| `EANs` | array | "[object]", "[object]" |
| `bild` | string | "https://markendetekive.s3-eu-central-1.ionosclo...", "https://markendetekive.s3-eu-central-1.ionosclo..." |
| `packSize` | number | 250, 250 |
| `preis` | number | 3.49, 3.19 |
| `kategorie` | object | "[object]", "[object]" |
| `kategorie._firestore` | object | "[object]", "[object]" |
| `kategorie._firestore._settings` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.credentials` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.preferRest` | undefined | ,  |
| `kategorie._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore._settings.libName` | string | "gccl", "gccl" |
| `kategorie._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `kategorie._firestore._settings.toJSON` | unknown | ,  |
| `kategorie._firestore._settingsFrozen` | boolean | true, true |
| `kategorie._firestore._serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._serializer.createReference` | unknown | ,  |
| `kategorie._firestore._serializer.createInteger` | unknown | ,  |
| `kategorie._firestore._serializer.allowUndefined` | boolean | false, false |
| `kategorie._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore.registeredListenersCount` | number | 0, 0 |
| `kategorie._firestore.bulkWritersCount` | number | 0, 0 |
| `kategorie._firestore._traceUtil` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `kategorie._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `kategorie._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `kategorie._firestore._clientPool` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `kategorie._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `kategorie._firestore._clientPool.clientFactory` | unknown | ,  |
| `kategorie._firestore._clientPool.clientDestructor` | unknown | ,  |
| `kategorie._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `kategorie._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.terminated` | boolean | false, false |
| `kategorie._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `kategorie._firestore._gax` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.GoogleAuth` | unknown | ,  |
| `kategorie._firestore._gax.grpc` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OngoingCall` | unknown | ,  |
| `kategorie._firestore._gax.createApiCall` | unknown | ,  |
| `kategorie._firestore._gax.BundleDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.PageDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.StreamDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.CallSettings` | unknown | ,  |
| `kategorie._firestore._gax.constructSettings` | unknown | ,  |
| `kategorie._firestore._gax.RetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createRetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBundleOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.GoogleError` | unknown | ,  |
| `kategorie._firestore._gax.ClientStub` | unknown | ,  |
| `kategorie._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `kategorie._firestore._gax.GrpcClient` | unknown | ,  |
| `kategorie._firestore._gax.Operation` | unknown | ,  |
| `kategorie._firestore._gax.operation` | unknown | ,  |
| `kategorie._firestore._gax.PathTemplate` | unknown | ,  |
| `kategorie._firestore._gax.Status` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OperationsClient` | unknown | ,  |
| `kategorie._firestore._gax.IamClient` | unknown | ,  |
| `kategorie._firestore._gax.LocationsClient` | unknown | ,  |
| `kategorie._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `kategorie._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `kategorie._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.fallback` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.makeUUID` | unknown | ,  |
| `kategorie._firestore._gax.ChannelCredentials` | unknown | ,  |
| `kategorie._firestore._gax.warn` | unknown | ,  |
| `kategorie._firestore._gax.serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.lro` | unknown | ,  |
| `kategorie._path` | object | "[object]", "[object]" |
| `kategorie._path.segments` | array | "[object]", "[object]" |
| `kategorie._converter` | object | "[object]", "[object]" |
| `kategorie._converter.toFirestore` | unknown | ,  |
| `kategorie._converter.fromFirestore` | unknown | ,  |
| `packTyp` | object | "[object]", "[object]" |
| `packTyp._firestore` | object | "[object]", "[object]" |
| `packTyp._firestore._settings` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.credentials` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.preferRest` | undefined | ,  |
| `packTyp._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore._settings.libName` | string | "gccl", "gccl" |
| `packTyp._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `packTyp._firestore._settings.toJSON` | unknown | ,  |
| `packTyp._firestore._settingsFrozen` | boolean | true, true |
| `packTyp._firestore._serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._serializer.createReference` | unknown | ,  |
| `packTyp._firestore._serializer.createInteger` | unknown | ,  |
| `packTyp._firestore._serializer.allowUndefined` | boolean | false, false |
| `packTyp._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore.registeredListenersCount` | number | 0, 0 |
| `packTyp._firestore.bulkWritersCount` | number | 0, 0 |
| `packTyp._firestore._traceUtil` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `packTyp._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `packTyp._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `packTyp._firestore._clientPool` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `packTyp._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `packTyp._firestore._clientPool.clientFactory` | unknown | ,  |
| `packTyp._firestore._clientPool.clientDestructor` | unknown | ,  |
| `packTyp._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `packTyp._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.terminated` | boolean | false, false |
| `packTyp._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `packTyp._firestore._gax` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.GoogleAuth` | unknown | ,  |
| `packTyp._firestore._gax.grpc` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OngoingCall` | unknown | ,  |
| `packTyp._firestore._gax.createApiCall` | unknown | ,  |
| `packTyp._firestore._gax.BundleDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.PageDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.StreamDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.CallSettings` | unknown | ,  |
| `packTyp._firestore._gax.constructSettings` | unknown | ,  |
| `packTyp._firestore._gax.RetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createRetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBundleOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.GoogleError` | unknown | ,  |
| `packTyp._firestore._gax.ClientStub` | unknown | ,  |
| `packTyp._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `packTyp._firestore._gax.GrpcClient` | unknown | ,  |
| `packTyp._firestore._gax.Operation` | unknown | ,  |
| `packTyp._firestore._gax.operation` | unknown | ,  |
| `packTyp._firestore._gax.PathTemplate` | unknown | ,  |
| `packTyp._firestore._gax.Status` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OperationsClient` | unknown | ,  |
| `packTyp._firestore._gax.IamClient` | unknown | ,  |
| `packTyp._firestore._gax.LocationsClient` | unknown | ,  |
| `packTyp._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `packTyp._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `packTyp._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.fallback` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.makeUUID` | unknown | ,  |
| `packTyp._firestore._gax.ChannelCredentials` | unknown | ,  |
| `packTyp._firestore._gax.warn` | unknown | ,  |
| `packTyp._firestore._gax.serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.lro` | unknown | ,  |
| `packTyp._path` | object | "[object]", "[object]" |
| `packTyp._path.segments` | array | "[object]", "[object]" |
| `packTyp._converter` | object | "[object]", "[object]" |
| `packTyp._converter.toFirestore` | unknown | ,  |
| `packTyp._converter.fromFirestore` | unknown | ,  |
| `name` | string | "Madeleines", "Echte Land-Bockwurst" |
| `created_at` | timestamp | "[object]", "[object]" |
| `preisDatum` | timestamp | "[object]", "[object]" |
| `beschreibung` | string | "süßigkeit", "" |

### TypeScript Interface

```typescript
interface Markenprodukteerfassung {
  beschreibung: string;
  bild: string;
  created_at: Date | FirebaseTimestamp;
  EANs: any[];
  hersteller: object;
  kategorie: object;
  name: string;
  packSize: number;
  packTyp: object;
  preis: number;
  preisDatum: Date | FirebaseTimestamp;
}
```

---

## neuesGeheimnis

**📊 Statistics:**
- Documents: 3
- Fields: 6
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `markenprodukt` | string | "", "Bügelfreies Twill Business Hemd in Regular mit ..." |
| `handelsmarke` | string | "", "Nobel League" |
| `produkt` | string | "", "Herren Businesshemd" |
| `discounter` | string | "", "Lidl" |
| `markenhersteller` | string | "", "Seidensticker" |
| `date` | timestamp | "[object]", "[object]" |

### TypeScript Interface

```typescript
interface NeuesGeheimnis {
  date: Date | FirebaseTimestamp;
  discounter: string;
  handelsmarke: string;
  markenhersteller: string;
  markenprodukt: string;
  produkt: string;
}
```

---

## onboardingresults

**📊 Statistics:**
- Documents: 3
- Fields: 6
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `phoneOS` | string | "iOS", "Android" |
| `result` | string | "skipped_top", "skipped_top" |
| `spent` | number | 250, 0 |
| `timestamp` | timestamp | "[object]", "[object]" |
| `wherefrom` | string | "instagram", "na" |
| `paywalltype` | string | "paywallOnBoardingFeaturesPage" |

### TypeScript Interface

```typescript
interface Onboardingresults {
  paywalltype?: string;
  phoneOS: string;
  result: string;
  spent: number;
  timestamp: Date | FirebaseTimestamp;
  wherefrom: string;
}
```

---

## onboardingspendings

**📊 Statistics:**
- Documents: 3
- Fields: 2
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `spent` | string | "45", "25" |
| `timestamp` | timestamp | "[object]", "[object]" |

### TypeScript Interface

```typescript
interface Onboardingspendings {
  spent: string;
  timestamp: Date | FirebaseTimestamp;
}
```

---

## onboardingwherefrom

**📊 Statistics:**
- Documents: 3
- Fields: 2
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `timestamp` | timestamp | "[object]", "[object]" |
| `where` | string | "other", "instagram" |

### TypeScript Interface

```typescript
interface Onboardingwherefrom {
  timestamp: Date | FirebaseTimestamp;
  where: string;
}
```

---

## packungstypen

**📊 Statistics:**
- Documents: 3
- Fields: 2
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `typKurz` | string | "l", "Stk." |
| `typ` | string | "Liter", "Stück" |

### TypeScript Interface

```typescript
interface Packungstypen {
  typ: string;
  typKurz: string;
}
```

---

## paywallCounter

**📊 Statistics:**
- Documents: 3
- Fields: 14
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `inappsource` | string | "onboarding", "onboarding" |
| `os` | string | "Android", "iOS" |
| `light_dark` | string | "light", "dark" |
| `adncampaignurl` | string | "na", "na" |
| `adncreativeid` | string | "na", "na" |
| `wherefrom` | string | "na", "na" |
| `placement` | string | "na", "na" |
| `adncampaignname` | string | "na", "na" |
| `age` | string | "na", "na" |
| `adncreativename` | string | "na", "na" |
| `result` | string | "skipped_top_rabatt", "skipped_top_rabatt" |
| `paywallType` | string | "rabattPage", "rabattPage" |
| `footerType` | string | "rabattPage", "rabattPage" |
| `timestamp` | timestamp | "[object]", "[object]" |

### TypeScript Interface

```typescript
interface PaywallCounter {
  adncampaignname: string;
  adncampaignurl: string;
  adncreativeid: string;
  adncreativename: string;
  age: string;
  footerType: string;
  inappsource: string;
  light_dark: string;
  os: string;
  paywallType: string;
  placement: string;
  result: string;
  timestamp: Date | FirebaseTimestamp;
  wherefrom: string;
}
```

---

## pennyscrapedproduct_text

**📊 Statistics:**
- Documents: 3
- Fields: 24
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `folderName` | string | "21278501", "21061653" |
| `originalFolderName` | string | "Neuer_Ordner_mit_Objekten_8", "Neuer_Ordner_mit_Objekten_36" |
| `barcode` | string | "21278501", "21061653" |
| `barcodefound` | boolean | true, true |
| `imageLinks` | array | "[object]", "[object]" |
| `hersteller` | string | "Heinerle-Berggold Schokoladen GmbH", "Chr. Storz GmbH & Co. KG" |
| `herstelleradresse` | string | "Raniser Str. 11, 07381 Pößneck, Deutschland", "Fördernstraße 15, 78532 Tuttlingen, Deutschland" |
| `produktname` | string | "Douceur Feine Gelee-Früchtchen", "Edel-Vollmilch-Schokolade" |
| `handelsmarke` | string | "PENNY", "Douceur" |
| `preis` | string | "0,99", "2,29" |
| `packungsgroesse` | string | "250g", "100g" |
| `zutaten` | string | "Zucker, Glukosesirup, Wasser, Feuchthaltemittel...", "Zucker, Vollmilchpulver 27 %, Kakaobutter, Kaka..." |
| `naehrwerteje` | string | "100g", "100g" |
| `kcal` | string | "311", "541" |
| `fett` | string | "0g", "34g" |
| `davongesaettigt` | string | "0g", "21g" |
| `kohlenhydrate` | string | "78,3g", "49g" |
| `zucker` | string | "65,1g", "48g" |
| `eiweiss` | string | "0g", "8,7g" |
| `salz` | string | "0,01g", "0,25g" |
| `tags` | string | "Gelee Früchte, Fruchtgummi, Süßigkeiten, Penny ...", "Schokolade, Vollmilchschokolade, Süßigkeiten, D..." |
| `timestamp` | timestamp | "[object]", "[object]" |
| `nameindb` | string | "Heinerle-Berggold Schokoladen GmbH" |
| `herstellerId` | string | "oP4leYZ7xIECSU0gu9Vu" |

### TypeScript Interface

```typescript
interface PennyscrapedproductText {
  barcode: string;
  barcodefound: boolean;
  davongesaettigt: string;
  eiweiss: string;
  fett: string;
  folderName: string;
  handelsmarke: string;
  hersteller: string;
  herstelleradresse: string;
  herstellerId?: string;
  imageLinks: any[];
  kcal: string;
  kohlenhydrate: string;
  naehrwerteje: string;
  nameindb?: string;
  originalFolderName: string;
  packungsgroesse: string;
  preis: string;
  produktname: string;
  salz: string;
  tags: string;
  timestamp: Date | FirebaseTimestamp;
  zucker: string;
  zutaten: string;
}
```

---

## pennyscrapedproducts

**📊 Statistics:**
- Documents: 3
- Fields: 24
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `barcode` | string | "21278501", "21061653" |
| `barcodefound` | boolean | true, true |
| `davongesaettigt` | string | "0g", "21g" |
| `eiweiss` | string | "0g", "8,7g" |
| `fett` | string | "0g", "34g" |
| `folderName` | string | "21278501", "21061653" |
| `handelsmarke` | string | "PENNY", "Douceur" |
| `hersteller` | string | "Heinerle-Berggold Schokoladen GmbH", "Chr. Storz GmbH & Co. KG" |
| `herstellerId` | string | "oP4leYZ7xIECSU0gu9Vu" |
| `herstelleradresse` | string | "Raniser Str. 11, 07381 Pößneck, Deutschland", "Fördernstraße 15, 78532 Tuttlingen, Deutschland" |
| `imageLinks` | array | "[object]", "[object]" |
| `kcal` | string | "311", "541" |
| `kohlenhydrate` | string | "78,3g", "49g" |
| `naehrwerteje` | string | "100g", "100g" |
| `nameindb` | string | "Heinerle-Berggold Schokoladen GmbH" |
| `originalFolderName` | string | "Neuer_Ordner_mit_Objekten_8", "Neuer_Ordner_mit_Objekten_36" |
| `packungsgroesse` | string | "250g", "100g" |
| `preis` | string | "0,99", "2,29" |
| `produktname` | string | "Douceur Feine Gelee-Früchtchen", "Edel-Vollmilch-Schokolade" |
| `salz` | string | "0,01g", "0,25g" |
| `tags` | string | "Gelee Früchte, Fruchtgummi, Süßigkeiten, Penny ...", "Schokolade, Vollmilchschokolade, Süßigkeiten, D..." |
| `timestamp` | timestamp | "[object]", "[object]" |
| `zucker` | string | "65,1g", "48g" |
| `zutaten` | string | "Zucker, Glukosesirup, Wasser, Feuchthaltemittel...", "Zucker, Vollmilchpulver 27 %, Kakaobutter, Kaka..." |

### TypeScript Interface

```typescript
interface Pennyscrapedproducts {
  barcode: string;
  barcodefound: boolean;
  davongesaettigt: string;
  eiweiss: string;
  fett: string;
  folderName: string;
  handelsmarke: string;
  hersteller: string;
  herstelleradresse: string;
  herstellerId?: string;
  imageLinks: any[];
  kcal: string;
  kohlenhydrate: string;
  naehrwerteje: string;
  nameindb?: string;
  originalFolderName: string;
  packungsgroesse: string;
  preis: string;
  produktname: string;
  salz: string;
  tags: string;
  timestamp: Date | FirebaseTimestamp;
  zucker: string;
  zutaten: string;
}
```

---

## processedRatingEvents

**📊 Statistics:**
- Documents: 3
- Fields: 3
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `ratingId` | string | "isWMbW4nilM0w1r2kvK0", "mUeUzrHEwUhM3p1ZFrhE" |
| `status` | string | "Success", "Success" |
| `processedAt` | timestamp | "[object]", "[object]" |

### TypeScript Interface

```typescript
interface ProcessedRatingEvents {
  processedAt: Date | FirebaseTimestamp;
  ratingId: string;
  status: string;
}
```

---

## productRatings

**📊 Statistics:**
- Documents: 3
- Fields: 269
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `brandProductID` | object | "[object]" |
| `brandProductID._firestore` | object | "[object]" |
| `brandProductID._firestore._settings` | object | "[object]" |
| `brandProductID._firestore._settings.credentials` | object | "[object]" |
| `brandProductID._firestore._settings.projectId` | string | "markendetektive-895f7" |
| `brandProductID._firestore._settings.firebaseVersion` | string | "13.4.0" |
| `brandProductID._firestore._settings.firebaseAdminVersion` | string | "13.4.0" |
| `brandProductID._firestore._settings.preferRest` | undefined |  |
| `brandProductID._firestore._settings.databaseId` | string | "(default)" |
| `brandProductID._firestore._settings.libName` | string | "gccl" |
| `brandProductID._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `brandProductID._firestore._settings.toJSON` | unknown |  |
| `brandProductID._firestore._settingsFrozen` | boolean | true |
| `brandProductID._firestore._serializer` | object | "[object]" |
| `brandProductID._firestore._serializer.createReference` | unknown |  |
| `brandProductID._firestore._serializer.createInteger` | unknown |  |
| `brandProductID._firestore._serializer.allowUndefined` | boolean | false |
| `brandProductID._firestore._projectId` | string | "markendetektive-895f7" |
| `brandProductID._firestore._databaseId` | string | "(default)" |
| `brandProductID._firestore.registeredListenersCount` | number | 0 |
| `brandProductID._firestore.bulkWritersCount` | number | 0 |
| `brandProductID._firestore._traceUtil` | object | "[object]" |
| `brandProductID._firestore._traceUtil.tracerProvider` | object | "[object]" |
| `brandProductID._firestore._traceUtil.tracer` | object | "[object]" |
| `brandProductID._firestore._traceUtil.settingsAttributes` | object | "[object]" |
| `brandProductID._firestore._backoffSettings` | object | "[object]" |
| `brandProductID._firestore._backoffSettings.initialDelayMs` | number | 100 |
| `brandProductID._firestore._backoffSettings.maxDelayMs` | number | 60000 |
| `brandProductID._firestore._backoffSettings.backoffFactor` | number | 1.3 |
| `brandProductID._firestore._clientPool` | object | "[object]" |
| `brandProductID._firestore._clientPool.concurrentOperationLimit` | number | 100 |
| `brandProductID._firestore._clientPool.maxIdleClients` | number | 1 |
| `brandProductID._firestore._clientPool.clientFactory` | unknown |  |
| `brandProductID._firestore._clientPool.clientDestructor` | unknown |  |
| `brandProductID._firestore._clientPool.grpcEnabled` | boolean | false |
| `brandProductID._firestore._clientPool.activeClients` | object | "[object]" |
| `brandProductID._firestore._clientPool.failedClients` | object | "[object]" |
| `brandProductID._firestore._clientPool.terminated` | boolean | false |
| `brandProductID._firestore._clientPool.terminateDeferred` | object | "[object]" |
| `brandProductID._firestore._gax` | object | "[object]" |
| `brandProductID._firestore._gax.GoogleAuth` | unknown |  |
| `brandProductID._firestore._gax.grpc` | object | "[object]" |
| `brandProductID._firestore._gax.OngoingCall` | unknown |  |
| `brandProductID._firestore._gax.createApiCall` | unknown |  |
| `brandProductID._firestore._gax.BundleDescriptor` | unknown |  |
| `brandProductID._firestore._gax.LongrunningDescriptor` | unknown |  |
| `brandProductID._firestore._gax.PageDescriptor` | unknown |  |
| `brandProductID._firestore._gax.StreamDescriptor` | unknown |  |
| `brandProductID._firestore._gax.CallSettings` | unknown |  |
| `brandProductID._firestore._gax.constructSettings` | unknown |  |
| `brandProductID._firestore._gax.RetryOptions` | unknown |  |
| `brandProductID._firestore._gax.createRetryOptions` | unknown |  |
| `brandProductID._firestore._gax.createBundleOptions` | unknown |  |
| `brandProductID._firestore._gax.createBackoffSettings` | unknown |  |
| `brandProductID._firestore._gax.createDefaultBackoffSettings` | unknown |  |
| `brandProductID._firestore._gax.createMaxRetriesBackoffSettings` | unknown |  |
| `brandProductID._firestore._gax.GoogleError` | unknown |  |
| `brandProductID._firestore._gax.ClientStub` | unknown |  |
| `brandProductID._firestore._gax.GoogleProtoFilesRoot` | unknown |  |
| `brandProductID._firestore._gax.GrpcClient` | unknown |  |
| `brandProductID._firestore._gax.Operation` | unknown |  |
| `brandProductID._firestore._gax.operation` | unknown |  |
| `brandProductID._firestore._gax.PathTemplate` | unknown |  |
| `brandProductID._firestore._gax.Status` | object | "[object]" |
| `brandProductID._firestore._gax.StreamType` | object | "[object]" |
| `brandProductID._firestore._gax.routingHeader` | object | "[object]" |
| `brandProductID._firestore._gax.operationsProtos` | object | "[object]" |
| `brandProductID._firestore._gax.IamProtos` | object | "[object]" |
| `brandProductID._firestore._gax.LocationProtos` | object | "[object]" |
| `brandProductID._firestore._gax.OperationsClient` | unknown |  |
| `brandProductID._firestore._gax.IamClient` | unknown |  |
| `brandProductID._firestore._gax.LocationsClient` | unknown |  |
| `brandProductID._firestore._gax.createByteLengthFunction` | unknown |  |
| `brandProductID._firestore._gax.version` | string | "4.6.1" |
| `brandProductID._firestore._gax.protobuf` | object | "[object]" |
| `brandProductID._firestore._gax.protobufMinimal` | object | "[object]" |
| `brandProductID._firestore._gax.fallback` | object | "[object]" |
| `brandProductID._firestore._gax.makeUUID` | unknown |  |
| `brandProductID._firestore._gax.ChannelCredentials` | unknown |  |
| `brandProductID._firestore._gax.warn` | unknown |  |
| `brandProductID._firestore._gax.serializer` | object | "[object]" |
| `brandProductID._firestore._gax.lro` | unknown |  |
| `brandProductID._path` | object | "[object]" |
| `brandProductID._path.segments` | array | "[object]" |
| `brandProductID._converter` | object | "[object]" |
| `brandProductID._converter.toFirestore` | unknown |  |
| `brandProductID._converter.fromFirestore` | unknown |  |
| `comment` | string | "tolle gurken 🙌", "tolles Produkt 🙏" |
| `ratingContent` | number | 2, 1 |
| `ratingOverall` | number | 5, 4 |
| `ratingPriceValue` | number | 3, 5 |
| `ratingTasteFunction` | number | 4, 3 |
| `userID` | object | "[object]", "[object]" |
| `userID._firestore` | object | "[object]", "[object]" |
| `userID._firestore._settings` | object | "[object]", "[object]" |
| `userID._firestore._settings.credentials` | object | "[object]", "[object]" |
| `userID._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `userID._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `userID._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `userID._firestore._settings.preferRest` | undefined | ,  |
| `userID._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `userID._firestore._settings.libName` | string | "gccl", "gccl" |
| `userID._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `userID._firestore._settings.toJSON` | unknown | ,  |
| `userID._firestore._settingsFrozen` | boolean | true, true |
| `userID._firestore._serializer` | object | "[object]", "[object]" |
| `userID._firestore._serializer.createReference` | unknown | ,  |
| `userID._firestore._serializer.createInteger` | unknown | ,  |
| `userID._firestore._serializer.allowUndefined` | boolean | false, false |
| `userID._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `userID._firestore._databaseId` | string | "(default)", "(default)" |
| `userID._firestore.registeredListenersCount` | number | 0, 0 |
| `userID._firestore.bulkWritersCount` | number | 0, 0 |
| `userID._firestore._traceUtil` | object | "[object]", "[object]" |
| `userID._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `userID._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `userID._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `userID._firestore._backoffSettings` | object | "[object]", "[object]" |
| `userID._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `userID._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `userID._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `userID._firestore._clientPool` | object | "[object]", "[object]" |
| `userID._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `userID._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `userID._firestore._clientPool.clientFactory` | unknown | ,  |
| `userID._firestore._clientPool.clientDestructor` | unknown | ,  |
| `userID._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `userID._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `userID._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `userID._firestore._clientPool.terminated` | boolean | false, false |
| `userID._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `userID._firestore._gax` | object | "[object]", "[object]" |
| `userID._firestore._gax.GoogleAuth` | unknown | ,  |
| `userID._firestore._gax.grpc` | object | "[object]", "[object]" |
| `userID._firestore._gax.OngoingCall` | unknown | ,  |
| `userID._firestore._gax.createApiCall` | unknown | ,  |
| `userID._firestore._gax.BundleDescriptor` | unknown | ,  |
| `userID._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `userID._firestore._gax.PageDescriptor` | unknown | ,  |
| `userID._firestore._gax.StreamDescriptor` | unknown | ,  |
| `userID._firestore._gax.CallSettings` | unknown | ,  |
| `userID._firestore._gax.constructSettings` | unknown | ,  |
| `userID._firestore._gax.RetryOptions` | unknown | ,  |
| `userID._firestore._gax.createRetryOptions` | unknown | ,  |
| `userID._firestore._gax.createBundleOptions` | unknown | ,  |
| `userID._firestore._gax.createBackoffSettings` | unknown | ,  |
| `userID._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `userID._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `userID._firestore._gax.GoogleError` | unknown | ,  |
| `userID._firestore._gax.ClientStub` | unknown | ,  |
| `userID._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `userID._firestore._gax.GrpcClient` | unknown | ,  |
| `userID._firestore._gax.Operation` | unknown | ,  |
| `userID._firestore._gax.operation` | unknown | ,  |
| `userID._firestore._gax.PathTemplate` | unknown | ,  |
| `userID._firestore._gax.Status` | object | "[object]", "[object]" |
| `userID._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `userID._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `userID._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `userID._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `userID._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `userID._firestore._gax.OperationsClient` | unknown | ,  |
| `userID._firestore._gax.IamClient` | unknown | ,  |
| `userID._firestore._gax.LocationsClient` | unknown | ,  |
| `userID._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `userID._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `userID._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `userID._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `userID._firestore._gax.fallback` | object | "[object]", "[object]" |
| `userID._firestore._gax.makeUUID` | unknown | ,  |
| `userID._firestore._gax.ChannelCredentials` | unknown | ,  |
| `userID._firestore._gax.warn` | unknown | ,  |
| `userID._firestore._gax.serializer` | object | "[object]", "[object]" |
| `userID._firestore._gax.lro` | unknown | ,  |
| `userID._path` | object | "[object]", "[object]" |
| `userID._path.segments` | array | "[object]", "[object]" |
| `userID._converter` | object | "[object]", "[object]" |
| `userID._converter.toFirestore` | unknown | ,  |
| `userID._converter.fromFirestore` | unknown | ,  |
| `updatedate` | timestamp | "[object]", "[object]" |
| `ratedate` | timestamp | "[object]", "[object]" |
| `productID` | object | "[object]", "[object]" |
| `productID._firestore` | object | "[object]", "[object]" |
| `productID._firestore._settings` | object | "[object]", "[object]" |
| `productID._firestore._settings.credentials` | object | "[object]", "[object]" |
| `productID._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `productID._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `productID._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `productID._firestore._settings.preferRest` | undefined | ,  |
| `productID._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `productID._firestore._settings.libName` | string | "gccl", "gccl" |
| `productID._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `productID._firestore._settings.toJSON` | unknown | ,  |
| `productID._firestore._settingsFrozen` | boolean | true, true |
| `productID._firestore._serializer` | object | "[object]", "[object]" |
| `productID._firestore._serializer.createReference` | unknown | ,  |
| `productID._firestore._serializer.createInteger` | unknown | ,  |
| `productID._firestore._serializer.allowUndefined` | boolean | false, false |
| `productID._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `productID._firestore._databaseId` | string | "(default)", "(default)" |
| `productID._firestore.registeredListenersCount` | number | 0, 0 |
| `productID._firestore.bulkWritersCount` | number | 0, 0 |
| `productID._firestore._traceUtil` | object | "[object]", "[object]" |
| `productID._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `productID._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `productID._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `productID._firestore._backoffSettings` | object | "[object]", "[object]" |
| `productID._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `productID._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `productID._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `productID._firestore._clientPool` | object | "[object]", "[object]" |
| `productID._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `productID._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `productID._firestore._clientPool.clientFactory` | unknown | ,  |
| `productID._firestore._clientPool.clientDestructor` | unknown | ,  |
| `productID._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `productID._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `productID._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `productID._firestore._clientPool.terminated` | boolean | false, false |
| `productID._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `productID._firestore._gax` | object | "[object]", "[object]" |
| `productID._firestore._gax.GoogleAuth` | unknown | ,  |
| `productID._firestore._gax.grpc` | object | "[object]", "[object]" |
| `productID._firestore._gax.OngoingCall` | unknown | ,  |
| `productID._firestore._gax.createApiCall` | unknown | ,  |
| `productID._firestore._gax.BundleDescriptor` | unknown | ,  |
| `productID._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `productID._firestore._gax.PageDescriptor` | unknown | ,  |
| `productID._firestore._gax.StreamDescriptor` | unknown | ,  |
| `productID._firestore._gax.CallSettings` | unknown | ,  |
| `productID._firestore._gax.constructSettings` | unknown | ,  |
| `productID._firestore._gax.RetryOptions` | unknown | ,  |
| `productID._firestore._gax.createRetryOptions` | unknown | ,  |
| `productID._firestore._gax.createBundleOptions` | unknown | ,  |
| `productID._firestore._gax.createBackoffSettings` | unknown | ,  |
| `productID._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `productID._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `productID._firestore._gax.GoogleError` | unknown | ,  |
| `productID._firestore._gax.ClientStub` | unknown | ,  |
| `productID._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `productID._firestore._gax.GrpcClient` | unknown | ,  |
| `productID._firestore._gax.Operation` | unknown | ,  |
| `productID._firestore._gax.operation` | unknown | ,  |
| `productID._firestore._gax.PathTemplate` | unknown | ,  |
| `productID._firestore._gax.Status` | object | "[object]", "[object]" |
| `productID._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `productID._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `productID._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `productID._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `productID._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `productID._firestore._gax.OperationsClient` | unknown | ,  |
| `productID._firestore._gax.IamClient` | unknown | ,  |
| `productID._firestore._gax.LocationsClient` | unknown | ,  |
| `productID._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `productID._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `productID._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `productID._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `productID._firestore._gax.fallback` | object | "[object]", "[object]" |
| `productID._firestore._gax.makeUUID` | unknown | ,  |
| `productID._firestore._gax.ChannelCredentials` | unknown | ,  |
| `productID._firestore._gax.warn` | unknown | ,  |
| `productID._firestore._gax.serializer` | object | "[object]", "[object]" |
| `productID._firestore._gax.lro` | unknown | ,  |
| `productID._path` | object | "[object]", "[object]" |
| `productID._path.segments` | array | "[object]", "[object]" |
| `productID._converter` | object | "[object]", "[object]" |
| `productID._converter.toFirestore` | unknown | ,  |
| `productID._converter.fromFirestore` | unknown | ,  |
| `ratingSimilarity` | number | 2, 4 |

### TypeScript Interface

```typescript
interface ProductRatings {
  brandProductID?: object;
  comment: string;
  productID?: object;
  ratedate: Date | FirebaseTimestamp;
  ratingContent: number;
  ratingOverall: number;
  ratingPriceValue: number;
  ratingSimilarity?: number;
  ratingTasteFunction: number;
  updatedate: Date | FirebaseTimestamp;
  userID: object;
}
```

---

## produkte

**📊 Statistics:**
- Documents: 3
- Fields: 638
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `EANs` | array | "[object]", "[object]" |
| `addedby` | string | "Sarah", "Galina" |
| `beschreibung` | string | "Gebäck, Haferkekse, Kekse", "sulfatfrei, alle Hauttypen" |
| `bild` | string | "https://firebasestorage.googleapis.com/v0/b/mar...", "https://firebasestorage.googleapis.com/v0/b/mar..." |
| `created_at` | timestamp | "[object]", "[object]" |
| `discounter` | object | "[object]", "[object]" |
| `discounter._firestore` | object | "[object]", "[object]" |
| `discounter._firestore._settings` | object | "[object]", "[object]" |
| `discounter._firestore._settings.credentials` | object | "[object]", "[object]" |
| `discounter._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `discounter._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `discounter._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `discounter._firestore._settings.preferRest` | undefined | ,  |
| `discounter._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `discounter._firestore._settings.libName` | string | "gccl", "gccl" |
| `discounter._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `discounter._firestore._settings.toJSON` | unknown | ,  |
| `discounter._firestore._settingsFrozen` | boolean | true, true |
| `discounter._firestore._serializer` | object | "[object]", "[object]" |
| `discounter._firestore._serializer.createReference` | unknown | ,  |
| `discounter._firestore._serializer.createInteger` | unknown | ,  |
| `discounter._firestore._serializer.allowUndefined` | boolean | false, false |
| `discounter._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `discounter._firestore._databaseId` | string | "(default)", "(default)" |
| `discounter._firestore.registeredListenersCount` | number | 0, 0 |
| `discounter._firestore.bulkWritersCount` | number | 0, 0 |
| `discounter._firestore._traceUtil` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `discounter._firestore._backoffSettings` | object | "[object]", "[object]" |
| `discounter._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `discounter._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `discounter._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `discounter._firestore._clientPool` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `discounter._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `discounter._firestore._clientPool.clientFactory` | unknown | ,  |
| `discounter._firestore._clientPool.clientDestructor` | unknown | ,  |
| `discounter._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `discounter._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.terminated` | boolean | false, false |
| `discounter._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `discounter._firestore._gax` | object | "[object]", "[object]" |
| `discounter._firestore._gax.GoogleAuth` | unknown | ,  |
| `discounter._firestore._gax.grpc` | object | "[object]", "[object]" |
| `discounter._firestore._gax.OngoingCall` | unknown | ,  |
| `discounter._firestore._gax.createApiCall` | unknown | ,  |
| `discounter._firestore._gax.BundleDescriptor` | unknown | ,  |
| `discounter._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `discounter._firestore._gax.PageDescriptor` | unknown | ,  |
| `discounter._firestore._gax.StreamDescriptor` | unknown | ,  |
| `discounter._firestore._gax.CallSettings` | unknown | ,  |
| `discounter._firestore._gax.constructSettings` | unknown | ,  |
| `discounter._firestore._gax.RetryOptions` | unknown | ,  |
| `discounter._firestore._gax.createRetryOptions` | unknown | ,  |
| `discounter._firestore._gax.createBundleOptions` | unknown | ,  |
| `discounter._firestore._gax.createBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.GoogleError` | unknown | ,  |
| `discounter._firestore._gax.ClientStub` | unknown | ,  |
| `discounter._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `discounter._firestore._gax.GrpcClient` | unknown | ,  |
| `discounter._firestore._gax.Operation` | unknown | ,  |
| `discounter._firestore._gax.operation` | unknown | ,  |
| `discounter._firestore._gax.PathTemplate` | unknown | ,  |
| `discounter._firestore._gax.Status` | object | "[object]", "[object]" |
| `discounter._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `discounter._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `discounter._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.OperationsClient` | unknown | ,  |
| `discounter._firestore._gax.IamClient` | unknown | ,  |
| `discounter._firestore._gax.LocationsClient` | unknown | ,  |
| `discounter._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `discounter._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `discounter._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `discounter._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `discounter._firestore._gax.fallback` | object | "[object]", "[object]" |
| `discounter._firestore._gax.makeUUID` | unknown | ,  |
| `discounter._firestore._gax.ChannelCredentials` | unknown | ,  |
| `discounter._firestore._gax.warn` | unknown | ,  |
| `discounter._firestore._gax.serializer` | object | "[object]", "[object]" |
| `discounter._firestore._gax.lro` | unknown | ,  |
| `discounter._path` | object | "[object]", "[object]" |
| `discounter._path.segments` | array | "[object]", "[object]" |
| `discounter._converter` | object | "[object]", "[object]" |
| `discounter._converter.toFirestore` | unknown | ,  |
| `discounter._converter.fromFirestore` | unknown | ,  |
| `editedbymanon` | boolean | true, true |
| `handelsmarke` | object | "[object]", "[object]" |
| `handelsmarke._firestore` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings.credentials` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `handelsmarke._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `handelsmarke._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `handelsmarke._firestore._settings.preferRest` | undefined | ,  |
| `handelsmarke._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `handelsmarke._firestore._settings.libName` | string | "gccl", "gccl" |
| `handelsmarke._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `handelsmarke._firestore._settings.toJSON` | unknown | ,  |
| `handelsmarke._firestore._settingsFrozen` | boolean | true, true |
| `handelsmarke._firestore._serializer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._serializer.createReference` | unknown | ,  |
| `handelsmarke._firestore._serializer.createInteger` | unknown | ,  |
| `handelsmarke._firestore._serializer.allowUndefined` | boolean | false, false |
| `handelsmarke._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `handelsmarke._firestore._databaseId` | string | "(default)", "(default)" |
| `handelsmarke._firestore.registeredListenersCount` | number | 0, 0 |
| `handelsmarke._firestore.bulkWritersCount` | number | 0, 0 |
| `handelsmarke._firestore._traceUtil` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `handelsmarke._firestore._backoffSettings` | object | "[object]", "[object]" |
| `handelsmarke._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `handelsmarke._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `handelsmarke._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `handelsmarke._firestore._clientPool` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `handelsmarke._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `handelsmarke._firestore._clientPool.clientFactory` | unknown | ,  |
| `handelsmarke._firestore._clientPool.clientDestructor` | unknown | ,  |
| `handelsmarke._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `handelsmarke._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.terminated` | boolean | false, false |
| `handelsmarke._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.GoogleAuth` | unknown | ,  |
| `handelsmarke._firestore._gax.grpc` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.OngoingCall` | unknown | ,  |
| `handelsmarke._firestore._gax.createApiCall` | unknown | ,  |
| `handelsmarke._firestore._gax.BundleDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.PageDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.StreamDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.CallSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.constructSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.RetryOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createRetryOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createBundleOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.GoogleError` | unknown | ,  |
| `handelsmarke._firestore._gax.ClientStub` | unknown | ,  |
| `handelsmarke._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `handelsmarke._firestore._gax.GrpcClient` | unknown | ,  |
| `handelsmarke._firestore._gax.Operation` | unknown | ,  |
| `handelsmarke._firestore._gax.operation` | unknown | ,  |
| `handelsmarke._firestore._gax.PathTemplate` | unknown | ,  |
| `handelsmarke._firestore._gax.Status` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.OperationsClient` | unknown | ,  |
| `handelsmarke._firestore._gax.IamClient` | unknown | ,  |
| `handelsmarke._firestore._gax.LocationsClient` | unknown | ,  |
| `handelsmarke._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `handelsmarke._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `handelsmarke._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.fallback` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.makeUUID` | unknown | ,  |
| `handelsmarke._firestore._gax.ChannelCredentials` | unknown | ,  |
| `handelsmarke._firestore._gax.warn` | unknown | ,  |
| `handelsmarke._firestore._gax.serializer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.lro` | unknown | ,  |
| `handelsmarke._path` | object | "[object]", "[object]" |
| `handelsmarke._path.segments` | array | "[object]", "[object]" |
| `handelsmarke._converter` | object | "[object]", "[object]" |
| `handelsmarke._converter.toFirestore` | unknown | ,  |
| `handelsmarke._converter.fromFirestore` | unknown | ,  |
| `hersteller` | object | "[object]", "[object]" |
| `hersteller._firestore` | object | "[object]", "[object]" |
| `hersteller._firestore._settings` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.credentials` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.preferRest` | undefined | ,  |
| `hersteller._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore._settings.libName` | string | "gccl", "gccl" |
| `hersteller._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `hersteller._firestore._settings.toJSON` | unknown | ,  |
| `hersteller._firestore._settingsFrozen` | boolean | true, true |
| `hersteller._firestore._serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._serializer.createReference` | unknown | ,  |
| `hersteller._firestore._serializer.createInteger` | unknown | ,  |
| `hersteller._firestore._serializer.allowUndefined` | boolean | false, false |
| `hersteller._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore.registeredListenersCount` | number | 0, 0 |
| `hersteller._firestore.bulkWritersCount` | number | 0, 0 |
| `hersteller._firestore._traceUtil` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `hersteller._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `hersteller._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `hersteller._firestore._clientPool` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `hersteller._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `hersteller._firestore._clientPool.clientFactory` | unknown | ,  |
| `hersteller._firestore._clientPool.clientDestructor` | unknown | ,  |
| `hersteller._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `hersteller._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.terminated` | boolean | false, false |
| `hersteller._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `hersteller._firestore._gax` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.GoogleAuth` | unknown | ,  |
| `hersteller._firestore._gax.grpc` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OngoingCall` | unknown | ,  |
| `hersteller._firestore._gax.createApiCall` | unknown | ,  |
| `hersteller._firestore._gax.BundleDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.PageDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.StreamDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.CallSettings` | unknown | ,  |
| `hersteller._firestore._gax.constructSettings` | unknown | ,  |
| `hersteller._firestore._gax.RetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createRetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBundleOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.GoogleError` | unknown | ,  |
| `hersteller._firestore._gax.ClientStub` | unknown | ,  |
| `hersteller._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `hersteller._firestore._gax.GrpcClient` | unknown | ,  |
| `hersteller._firestore._gax.Operation` | unknown | ,  |
| `hersteller._firestore._gax.operation` | unknown | ,  |
| `hersteller._firestore._gax.PathTemplate` | unknown | ,  |
| `hersteller._firestore._gax.Status` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OperationsClient` | unknown | ,  |
| `hersteller._firestore._gax.IamClient` | unknown | ,  |
| `hersteller._firestore._gax.LocationsClient` | unknown | ,  |
| `hersteller._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `hersteller._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `hersteller._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.fallback` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.makeUUID` | unknown | ,  |
| `hersteller._firestore._gax.ChannelCredentials` | unknown | ,  |
| `hersteller._firestore._gax.warn` | unknown | ,  |
| `hersteller._firestore._gax.serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.lro` | unknown | ,  |
| `hersteller._path` | object | "[object]", "[object]" |
| `hersteller._path.segments` | array | "[object]", "[object]" |
| `hersteller._converter` | object | "[object]", "[object]" |
| `hersteller._converter.toFirestore` | unknown | ,  |
| `hersteller._converter.fromFirestore` | unknown | ,  |
| `herstellerMarkenProdukt` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings.credentials` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `herstellerMarkenProdukt._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.preferRest` | undefined | ,  |
| `herstellerMarkenProdukt._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `herstellerMarkenProdukt._firestore._settings.libName` | string | "gccl", "gccl" |
| `herstellerMarkenProdukt._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.toJSON` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._settingsFrozen` | boolean | true, true |
| `herstellerMarkenProdukt._firestore._serializer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._serializer.createReference` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._serializer.createInteger` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._serializer.allowUndefined` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `herstellerMarkenProdukt._firestore._databaseId` | string | "(default)", "(default)" |
| `herstellerMarkenProdukt._firestore.registeredListenersCount` | number | 0, 0 |
| `herstellerMarkenProdukt._firestore.bulkWritersCount` | number | 0, 0 |
| `herstellerMarkenProdukt._firestore._traceUtil` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._backoffSettings` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `herstellerMarkenProdukt._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `herstellerMarkenProdukt._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `herstellerMarkenProdukt._firestore._clientPool` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `herstellerMarkenProdukt._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `herstellerMarkenProdukt._firestore._clientPool.clientFactory` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._clientPool.clientDestructor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.terminated` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.GoogleAuth` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.grpc` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.OngoingCall` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createApiCall` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.BundleDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.PageDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.StreamDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.CallSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.constructSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.RetryOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createRetryOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createBundleOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GoogleError` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.ClientStub` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GrpcClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.Operation` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.operation` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.PathTemplate` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.Status` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.OperationsClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.IamClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.LocationsClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `herstellerMarkenProdukt._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.fallback` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.makeUUID` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.ChannelCredentials` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.warn` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.serializer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.lro` | unknown | ,  |
| `herstellerMarkenProdukt._path` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._path.segments` | array | "[object]", "[object]" |
| `herstellerMarkenProdukt._converter` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._converter.toFirestore` | unknown | ,  |
| `herstellerMarkenProdukt._converter.fromFirestore` | unknown | ,  |
| `kategorie` | object | "[object]", "[object]" |
| `kategorie._firestore` | object | "[object]", "[object]" |
| `kategorie._firestore._settings` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.credentials` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.preferRest` | undefined | ,  |
| `kategorie._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore._settings.libName` | string | "gccl", "gccl" |
| `kategorie._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `kategorie._firestore._settings.toJSON` | unknown | ,  |
| `kategorie._firestore._settingsFrozen` | boolean | true, true |
| `kategorie._firestore._serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._serializer.createReference` | unknown | ,  |
| `kategorie._firestore._serializer.createInteger` | unknown | ,  |
| `kategorie._firestore._serializer.allowUndefined` | boolean | false, false |
| `kategorie._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore.registeredListenersCount` | number | 0, 0 |
| `kategorie._firestore.bulkWritersCount` | number | 0, 0 |
| `kategorie._firestore._traceUtil` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `kategorie._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `kategorie._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `kategorie._firestore._clientPool` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `kategorie._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `kategorie._firestore._clientPool.clientFactory` | unknown | ,  |
| `kategorie._firestore._clientPool.clientDestructor` | unknown | ,  |
| `kategorie._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `kategorie._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.terminated` | boolean | false, false |
| `kategorie._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `kategorie._firestore._gax` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.GoogleAuth` | unknown | ,  |
| `kategorie._firestore._gax.grpc` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OngoingCall` | unknown | ,  |
| `kategorie._firestore._gax.createApiCall` | unknown | ,  |
| `kategorie._firestore._gax.BundleDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.PageDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.StreamDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.CallSettings` | unknown | ,  |
| `kategorie._firestore._gax.constructSettings` | unknown | ,  |
| `kategorie._firestore._gax.RetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createRetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBundleOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.GoogleError` | unknown | ,  |
| `kategorie._firestore._gax.ClientStub` | unknown | ,  |
| `kategorie._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `kategorie._firestore._gax.GrpcClient` | unknown | ,  |
| `kategorie._firestore._gax.Operation` | unknown | ,  |
| `kategorie._firestore._gax.operation` | unknown | ,  |
| `kategorie._firestore._gax.PathTemplate` | unknown | ,  |
| `kategorie._firestore._gax.Status` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OperationsClient` | unknown | ,  |
| `kategorie._firestore._gax.IamClient` | unknown | ,  |
| `kategorie._firestore._gax.LocationsClient` | unknown | ,  |
| `kategorie._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `kategorie._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `kategorie._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.fallback` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.makeUUID` | unknown | ,  |
| `kategorie._firestore._gax.ChannelCredentials` | unknown | ,  |
| `kategorie._firestore._gax.warn` | unknown | ,  |
| `kategorie._firestore._gax.serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.lro` | unknown | ,  |
| `kategorie._path` | object | "[object]", "[object]" |
| `kategorie._path.segments` | array | "[object]", "[object]" |
| `kategorie._converter` | object | "[object]", "[object]" |
| `kategorie._converter.toFirestore` | unknown | ,  |
| `kategorie._converter.fromFirestore` | unknown | ,  |
| `markenProdukt` | object | "[object]", null |
| `markenProdukt._firestore` | object | "[object]" |
| `markenProdukt._firestore._settings` | object | "[object]" |
| `markenProdukt._firestore._settings.credentials` | object | "[object]" |
| `markenProdukt._firestore._settings.projectId` | string | "markendetektive-895f7" |
| `markenProdukt._firestore._settings.firebaseVersion` | string | "13.4.0" |
| `markenProdukt._firestore._settings.firebaseAdminVersion` | string | "13.4.0" |
| `markenProdukt._firestore._settings.preferRest` | undefined |  |
| `markenProdukt._firestore._settings.databaseId` | string | "(default)" |
| `markenProdukt._firestore._settings.libName` | string | "gccl" |
| `markenProdukt._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `markenProdukt._firestore._settings.toJSON` | unknown |  |
| `markenProdukt._firestore._settingsFrozen` | boolean | true |
| `markenProdukt._firestore._serializer` | object | "[object]" |
| `markenProdukt._firestore._serializer.createReference` | unknown |  |
| `markenProdukt._firestore._serializer.createInteger` | unknown |  |
| `markenProdukt._firestore._serializer.allowUndefined` | boolean | false |
| `markenProdukt._firestore._projectId` | string | "markendetektive-895f7" |
| `markenProdukt._firestore._databaseId` | string | "(default)" |
| `markenProdukt._firestore.registeredListenersCount` | number | 0 |
| `markenProdukt._firestore.bulkWritersCount` | number | 0 |
| `markenProdukt._firestore._traceUtil` | object | "[object]" |
| `markenProdukt._firestore._traceUtil.tracerProvider` | object | "[object]" |
| `markenProdukt._firestore._traceUtil.tracer` | object | "[object]" |
| `markenProdukt._firestore._traceUtil.settingsAttributes` | object | "[object]" |
| `markenProdukt._firestore._backoffSettings` | object | "[object]" |
| `markenProdukt._firestore._backoffSettings.initialDelayMs` | number | 100 |
| `markenProdukt._firestore._backoffSettings.maxDelayMs` | number | 60000 |
| `markenProdukt._firestore._backoffSettings.backoffFactor` | number | 1.3 |
| `markenProdukt._firestore._clientPool` | object | "[object]" |
| `markenProdukt._firestore._clientPool.concurrentOperationLimit` | number | 100 |
| `markenProdukt._firestore._clientPool.maxIdleClients` | number | 1 |
| `markenProdukt._firestore._clientPool.clientFactory` | unknown |  |
| `markenProdukt._firestore._clientPool.clientDestructor` | unknown |  |
| `markenProdukt._firestore._clientPool.grpcEnabled` | boolean | false |
| `markenProdukt._firestore._clientPool.activeClients` | object | "[object]" |
| `markenProdukt._firestore._clientPool.failedClients` | object | "[object]" |
| `markenProdukt._firestore._clientPool.terminated` | boolean | false |
| `markenProdukt._firestore._clientPool.terminateDeferred` | object | "[object]" |
| `markenProdukt._firestore._gax` | object | "[object]" |
| `markenProdukt._firestore._gax.GoogleAuth` | unknown |  |
| `markenProdukt._firestore._gax.grpc` | object | "[object]" |
| `markenProdukt._firestore._gax.OngoingCall` | unknown |  |
| `markenProdukt._firestore._gax.createApiCall` | unknown |  |
| `markenProdukt._firestore._gax.BundleDescriptor` | unknown |  |
| `markenProdukt._firestore._gax.LongrunningDescriptor` | unknown |  |
| `markenProdukt._firestore._gax.PageDescriptor` | unknown |  |
| `markenProdukt._firestore._gax.StreamDescriptor` | unknown |  |
| `markenProdukt._firestore._gax.CallSettings` | unknown |  |
| `markenProdukt._firestore._gax.constructSettings` | unknown |  |
| `markenProdukt._firestore._gax.RetryOptions` | unknown |  |
| `markenProdukt._firestore._gax.createRetryOptions` | unknown |  |
| `markenProdukt._firestore._gax.createBundleOptions` | unknown |  |
| `markenProdukt._firestore._gax.createBackoffSettings` | unknown |  |
| `markenProdukt._firestore._gax.createDefaultBackoffSettings` | unknown |  |
| `markenProdukt._firestore._gax.createMaxRetriesBackoffSettings` | unknown |  |
| `markenProdukt._firestore._gax.GoogleError` | unknown |  |
| `markenProdukt._firestore._gax.ClientStub` | unknown |  |
| `markenProdukt._firestore._gax.GoogleProtoFilesRoot` | unknown |  |
| `markenProdukt._firestore._gax.GrpcClient` | unknown |  |
| `markenProdukt._firestore._gax.Operation` | unknown |  |
| `markenProdukt._firestore._gax.operation` | unknown |  |
| `markenProdukt._firestore._gax.PathTemplate` | unknown |  |
| `markenProdukt._firestore._gax.Status` | object | "[object]" |
| `markenProdukt._firestore._gax.StreamType` | object | "[object]" |
| `markenProdukt._firestore._gax.routingHeader` | object | "[object]" |
| `markenProdukt._firestore._gax.operationsProtos` | object | "[object]" |
| `markenProdukt._firestore._gax.IamProtos` | object | "[object]" |
| `markenProdukt._firestore._gax.LocationProtos` | object | "[object]" |
| `markenProdukt._firestore._gax.OperationsClient` | unknown |  |
| `markenProdukt._firestore._gax.IamClient` | unknown |  |
| `markenProdukt._firestore._gax.LocationsClient` | unknown |  |
| `markenProdukt._firestore._gax.createByteLengthFunction` | unknown |  |
| `markenProdukt._firestore._gax.version` | string | "4.6.1" |
| `markenProdukt._firestore._gax.protobuf` | object | "[object]" |
| `markenProdukt._firestore._gax.protobufMinimal` | object | "[object]" |
| `markenProdukt._firestore._gax.fallback` | object | "[object]" |
| `markenProdukt._firestore._gax.makeUUID` | unknown |  |
| `markenProdukt._firestore._gax.ChannelCredentials` | unknown |  |
| `markenProdukt._firestore._gax.warn` | unknown |  |
| `markenProdukt._firestore._gax.serializer` | object | "[object]" |
| `markenProdukt._firestore._gax.lro` | unknown |  |
| `markenProdukt._path` | object | "[object]" |
| `markenProdukt._path.segments` | array | "[object]" |
| `markenProdukt._converter` | object | "[object]" |
| `markenProdukt._converter.toFirestore` | unknown |  |
| `markenProdukt._converter.fromFirestore` | unknown |  |
| `name` | string | "Bio Hafertaler Pur", "Family Duschgel Tropic" |
| `packSize` | number | 150, 750 |
| `packTyp` | object | "[object]", "[object]" |
| `packTyp._firestore` | object | "[object]", "[object]" |
| `packTyp._firestore._settings` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.credentials` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.preferRest` | undefined | ,  |
| `packTyp._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore._settings.libName` | string | "gccl", "gccl" |
| `packTyp._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `packTyp._firestore._settings.toJSON` | unknown | ,  |
| `packTyp._firestore._settingsFrozen` | boolean | true, true |
| `packTyp._firestore._serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._serializer.createReference` | unknown | ,  |
| `packTyp._firestore._serializer.createInteger` | unknown | ,  |
| `packTyp._firestore._serializer.allowUndefined` | boolean | false, false |
| `packTyp._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore.registeredListenersCount` | number | 0, 0 |
| `packTyp._firestore.bulkWritersCount` | number | 0, 0 |
| `packTyp._firestore._traceUtil` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `packTyp._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `packTyp._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `packTyp._firestore._clientPool` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `packTyp._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `packTyp._firestore._clientPool.clientFactory` | unknown | ,  |
| `packTyp._firestore._clientPool.clientDestructor` | unknown | ,  |
| `packTyp._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `packTyp._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.terminated` | boolean | false, false |
| `packTyp._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `packTyp._firestore._gax` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.GoogleAuth` | unknown | ,  |
| `packTyp._firestore._gax.grpc` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OngoingCall` | unknown | ,  |
| `packTyp._firestore._gax.createApiCall` | unknown | ,  |
| `packTyp._firestore._gax.BundleDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.PageDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.StreamDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.CallSettings` | unknown | ,  |
| `packTyp._firestore._gax.constructSettings` | unknown | ,  |
| `packTyp._firestore._gax.RetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createRetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBundleOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.GoogleError` | unknown | ,  |
| `packTyp._firestore._gax.ClientStub` | unknown | ,  |
| `packTyp._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `packTyp._firestore._gax.GrpcClient` | unknown | ,  |
| `packTyp._firestore._gax.Operation` | unknown | ,  |
| `packTyp._firestore._gax.operation` | unknown | ,  |
| `packTyp._firestore._gax.PathTemplate` | unknown | ,  |
| `packTyp._firestore._gax.Status` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OperationsClient` | unknown | ,  |
| `packTyp._firestore._gax.IamClient` | unknown | ,  |
| `packTyp._firestore._gax.LocationsClient` | unknown | ,  |
| `packTyp._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `packTyp._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `packTyp._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.fallback` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.makeUUID` | unknown | ,  |
| `packTyp._firestore._gax.ChannelCredentials` | unknown | ,  |
| `packTyp._firestore._gax.warn` | unknown | ,  |
| `packTyp._firestore._gax.serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.lro` | unknown | ,  |
| `packTyp._path` | object | "[object]", "[object]" |
| `packTyp._path.segments` | array | "[object]", "[object]" |
| `packTyp._converter` | object | "[object]", "[object]" |
| `packTyp._converter.toFirestore` | unknown | ,  |
| `packTyp._converter.fromFirestore` | unknown | ,  |
| `preis` | number | 1.39, 1.19 |
| `preisDatum` | timestamp | "[object]", "[object]" |
| `same` | boolean | false, false |
| `stufe` | string | "4", "2" |
| `ratingCount` | number | 0, 0 |
| `ratingCountContent` | number | 0, 0 |
| `ratingCountOverall` | number | 0, 0 |
| `ratingCountPriceValue` | number | 0, 0 |
| `ratingCountSimilarity` | number | 0, 0 |
| `ratingCountTasteFunction` | number | 0, 0 |
| `ratingSumOverall` | number | 0, 0 |
| `ratingSumContent` | number | 0, 0 |
| `ratingSumPriceValue` | number | 0, 0 |
| `ratingSumSimilarity` | number | 0, 0 |
| `ratingSumTasteFunction` | number | 0, 0 |
| `averageRatingContent` | number | 0, 0 |
| `averageRatingOverall` | number | 0, 0 |
| `averageRatingPriceValue` | number | 0, 0 |
| `averageRatingSimilarity` | number | 0, 0 |
| `averageRatingTasteFunction` | number | 0, 0 |
| `rating` | number | 0, 0 |

### TypeScript Interface

```typescript
interface Produkte {
  addedby: string;
  averageRatingContent: number;
  averageRatingOverall: number;
  averageRatingPriceValue: number;
  averageRatingSimilarity: number;
  averageRatingTasteFunction: number;
  beschreibung: string;
  bild: string;
  created_at: Date | FirebaseTimestamp;
  discounter: object;
  EANs: any[];
  editedbymanon: boolean;
  handelsmarke: object;
  hersteller: object;
  herstellerMarkenProdukt: object;
  kategorie: object;
  markenProdukt: object;
  name: string;
  packSize: number;
  packTyp: object;
  preis: number;
  preisDatum: Date | FirebaseTimestamp;
  rating: number;
  ratingCount: number;
  ratingCountContent: number;
  ratingCountOverall: number;
  ratingCountPriceValue: number;
  ratingCountSimilarity: number;
  ratingCountTasteFunction: number;
  ratingSumContent: number;
  ratingSumOverall: number;
  ratingSumPriceValue: number;
  ratingSumSimilarity: number;
  ratingSumTasteFunction: number;
  same: boolean;
  stufe: string;
}
```

---

## produkteerfassung

**📊 Statistics:**
- Documents: 3
- Fields: 620
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `handelsmarke` | object | "[object]", "[object]" |
| `handelsmarke._firestore` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings.credentials` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `handelsmarke._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `handelsmarke._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `handelsmarke._firestore._settings.preferRest` | undefined | ,  |
| `handelsmarke._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `handelsmarke._firestore._settings.libName` | string | "gccl", "gccl" |
| `handelsmarke._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `handelsmarke._firestore._settings.toJSON` | unknown | ,  |
| `handelsmarke._firestore._settingsFrozen` | boolean | true, true |
| `handelsmarke._firestore._serializer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._serializer.createReference` | unknown | ,  |
| `handelsmarke._firestore._serializer.createInteger` | unknown | ,  |
| `handelsmarke._firestore._serializer.allowUndefined` | boolean | false, false |
| `handelsmarke._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `handelsmarke._firestore._databaseId` | string | "(default)", "(default)" |
| `handelsmarke._firestore.registeredListenersCount` | number | 0, 0 |
| `handelsmarke._firestore.bulkWritersCount` | number | 0, 0 |
| `handelsmarke._firestore._traceUtil` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `handelsmarke._firestore._backoffSettings` | object | "[object]", "[object]" |
| `handelsmarke._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `handelsmarke._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `handelsmarke._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `handelsmarke._firestore._clientPool` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `handelsmarke._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `handelsmarke._firestore._clientPool.clientFactory` | unknown | ,  |
| `handelsmarke._firestore._clientPool.clientDestructor` | unknown | ,  |
| `handelsmarke._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `handelsmarke._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.terminated` | boolean | false, false |
| `handelsmarke._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.GoogleAuth` | unknown | ,  |
| `handelsmarke._firestore._gax.grpc` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.OngoingCall` | unknown | ,  |
| `handelsmarke._firestore._gax.createApiCall` | unknown | ,  |
| `handelsmarke._firestore._gax.BundleDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.PageDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.StreamDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.CallSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.constructSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.RetryOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createRetryOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createBundleOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.GoogleError` | unknown | ,  |
| `handelsmarke._firestore._gax.ClientStub` | unknown | ,  |
| `handelsmarke._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `handelsmarke._firestore._gax.GrpcClient` | unknown | ,  |
| `handelsmarke._firestore._gax.Operation` | unknown | ,  |
| `handelsmarke._firestore._gax.operation` | unknown | ,  |
| `handelsmarke._firestore._gax.PathTemplate` | unknown | ,  |
| `handelsmarke._firestore._gax.Status` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.OperationsClient` | unknown | ,  |
| `handelsmarke._firestore._gax.IamClient` | unknown | ,  |
| `handelsmarke._firestore._gax.LocationsClient` | unknown | ,  |
| `handelsmarke._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `handelsmarke._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `handelsmarke._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.fallback` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.makeUUID` | unknown | ,  |
| `handelsmarke._firestore._gax.ChannelCredentials` | unknown | ,  |
| `handelsmarke._firestore._gax.warn` | unknown | ,  |
| `handelsmarke._firestore._gax.serializer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.lro` | unknown | ,  |
| `handelsmarke._path` | object | "[object]", "[object]" |
| `handelsmarke._path.segments` | array | "[object]", "[object]" |
| `handelsmarke._converter` | object | "[object]", "[object]" |
| `handelsmarke._converter.toFirestore` | unknown | ,  |
| `handelsmarke._converter.fromFirestore` | unknown | ,  |
| `addedby` | string | "Sarah", "Sarah" |
| `stufe` | string | "4", "2" |
| `packTyp` | object | "[object]", "[object]" |
| `packTyp._firestore` | object | "[object]", "[object]" |
| `packTyp._firestore._settings` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.credentials` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.preferRest` | undefined | ,  |
| `packTyp._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore._settings.libName` | string | "gccl", "gccl" |
| `packTyp._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `packTyp._firestore._settings.toJSON` | unknown | ,  |
| `packTyp._firestore._settingsFrozen` | boolean | true, true |
| `packTyp._firestore._serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._serializer.createReference` | unknown | ,  |
| `packTyp._firestore._serializer.createInteger` | unknown | ,  |
| `packTyp._firestore._serializer.allowUndefined` | boolean | false, false |
| `packTyp._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore.registeredListenersCount` | number | 0, 0 |
| `packTyp._firestore.bulkWritersCount` | number | 0, 0 |
| `packTyp._firestore._traceUtil` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `packTyp._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `packTyp._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `packTyp._firestore._clientPool` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `packTyp._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `packTyp._firestore._clientPool.clientFactory` | unknown | ,  |
| `packTyp._firestore._clientPool.clientDestructor` | unknown | ,  |
| `packTyp._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `packTyp._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.terminated` | boolean | false, false |
| `packTyp._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `packTyp._firestore._gax` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.GoogleAuth` | unknown | ,  |
| `packTyp._firestore._gax.grpc` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OngoingCall` | unknown | ,  |
| `packTyp._firestore._gax.createApiCall` | unknown | ,  |
| `packTyp._firestore._gax.BundleDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.PageDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.StreamDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.CallSettings` | unknown | ,  |
| `packTyp._firestore._gax.constructSettings` | unknown | ,  |
| `packTyp._firestore._gax.RetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createRetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBundleOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.GoogleError` | unknown | ,  |
| `packTyp._firestore._gax.ClientStub` | unknown | ,  |
| `packTyp._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `packTyp._firestore._gax.GrpcClient` | unknown | ,  |
| `packTyp._firestore._gax.Operation` | unknown | ,  |
| `packTyp._firestore._gax.operation` | unknown | ,  |
| `packTyp._firestore._gax.PathTemplate` | unknown | ,  |
| `packTyp._firestore._gax.Status` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OperationsClient` | unknown | ,  |
| `packTyp._firestore._gax.IamClient` | unknown | ,  |
| `packTyp._firestore._gax.LocationsClient` | unknown | ,  |
| `packTyp._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `packTyp._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `packTyp._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.fallback` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.makeUUID` | unknown | ,  |
| `packTyp._firestore._gax.ChannelCredentials` | unknown | ,  |
| `packTyp._firestore._gax.warn` | unknown | ,  |
| `packTyp._firestore._gax.serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.lro` | unknown | ,  |
| `packTyp._path` | object | "[object]", "[object]" |
| `packTyp._path.segments` | array | "[object]", "[object]" |
| `packTyp._converter` | object | "[object]", "[object]" |
| `packTyp._converter.toFirestore` | unknown | ,  |
| `packTyp._converter.fromFirestore` | unknown | ,  |
| `preis` | number | 0.85, 0.65 |
| `markenProdukt` | object | "[object]", null |
| `markenProdukt._firestore` | object | "[object]" |
| `markenProdukt._firestore._settings` | object | "[object]" |
| `markenProdukt._firestore._settings.credentials` | object | "[object]" |
| `markenProdukt._firestore._settings.projectId` | string | "markendetektive-895f7" |
| `markenProdukt._firestore._settings.firebaseVersion` | string | "13.4.0" |
| `markenProdukt._firestore._settings.firebaseAdminVersion` | string | "13.4.0" |
| `markenProdukt._firestore._settings.preferRest` | undefined |  |
| `markenProdukt._firestore._settings.databaseId` | string | "(default)" |
| `markenProdukt._firestore._settings.libName` | string | "gccl" |
| `markenProdukt._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `markenProdukt._firestore._settings.toJSON` | unknown |  |
| `markenProdukt._firestore._settingsFrozen` | boolean | true |
| `markenProdukt._firestore._serializer` | object | "[object]" |
| `markenProdukt._firestore._serializer.createReference` | unknown |  |
| `markenProdukt._firestore._serializer.createInteger` | unknown |  |
| `markenProdukt._firestore._serializer.allowUndefined` | boolean | false |
| `markenProdukt._firestore._projectId` | string | "markendetektive-895f7" |
| `markenProdukt._firestore._databaseId` | string | "(default)" |
| `markenProdukt._firestore.registeredListenersCount` | number | 0 |
| `markenProdukt._firestore.bulkWritersCount` | number | 0 |
| `markenProdukt._firestore._traceUtil` | object | "[object]" |
| `markenProdukt._firestore._traceUtil.tracerProvider` | object | "[object]" |
| `markenProdukt._firestore._traceUtil.tracer` | object | "[object]" |
| `markenProdukt._firestore._traceUtil.settingsAttributes` | object | "[object]" |
| `markenProdukt._firestore._backoffSettings` | object | "[object]" |
| `markenProdukt._firestore._backoffSettings.initialDelayMs` | number | 100 |
| `markenProdukt._firestore._backoffSettings.maxDelayMs` | number | 60000 |
| `markenProdukt._firestore._backoffSettings.backoffFactor` | number | 1.3 |
| `markenProdukt._firestore._clientPool` | object | "[object]" |
| `markenProdukt._firestore._clientPool.concurrentOperationLimit` | number | 100 |
| `markenProdukt._firestore._clientPool.maxIdleClients` | number | 1 |
| `markenProdukt._firestore._clientPool.clientFactory` | unknown |  |
| `markenProdukt._firestore._clientPool.clientDestructor` | unknown |  |
| `markenProdukt._firestore._clientPool.grpcEnabled` | boolean | false |
| `markenProdukt._firestore._clientPool.activeClients` | object | "[object]" |
| `markenProdukt._firestore._clientPool.failedClients` | object | "[object]" |
| `markenProdukt._firestore._clientPool.terminated` | boolean | false |
| `markenProdukt._firestore._clientPool.terminateDeferred` | object | "[object]" |
| `markenProdukt._firestore._gax` | object | "[object]" |
| `markenProdukt._firestore._gax.GoogleAuth` | unknown |  |
| `markenProdukt._firestore._gax.grpc` | object | "[object]" |
| `markenProdukt._firestore._gax.OngoingCall` | unknown |  |
| `markenProdukt._firestore._gax.createApiCall` | unknown |  |
| `markenProdukt._firestore._gax.BundleDescriptor` | unknown |  |
| `markenProdukt._firestore._gax.LongrunningDescriptor` | unknown |  |
| `markenProdukt._firestore._gax.PageDescriptor` | unknown |  |
| `markenProdukt._firestore._gax.StreamDescriptor` | unknown |  |
| `markenProdukt._firestore._gax.CallSettings` | unknown |  |
| `markenProdukt._firestore._gax.constructSettings` | unknown |  |
| `markenProdukt._firestore._gax.RetryOptions` | unknown |  |
| `markenProdukt._firestore._gax.createRetryOptions` | unknown |  |
| `markenProdukt._firestore._gax.createBundleOptions` | unknown |  |
| `markenProdukt._firestore._gax.createBackoffSettings` | unknown |  |
| `markenProdukt._firestore._gax.createDefaultBackoffSettings` | unknown |  |
| `markenProdukt._firestore._gax.createMaxRetriesBackoffSettings` | unknown |  |
| `markenProdukt._firestore._gax.GoogleError` | unknown |  |
| `markenProdukt._firestore._gax.ClientStub` | unknown |  |
| `markenProdukt._firestore._gax.GoogleProtoFilesRoot` | unknown |  |
| `markenProdukt._firestore._gax.GrpcClient` | unknown |  |
| `markenProdukt._firestore._gax.Operation` | unknown |  |
| `markenProdukt._firestore._gax.operation` | unknown |  |
| `markenProdukt._firestore._gax.PathTemplate` | unknown |  |
| `markenProdukt._firestore._gax.Status` | object | "[object]" |
| `markenProdukt._firestore._gax.StreamType` | object | "[object]" |
| `markenProdukt._firestore._gax.routingHeader` | object | "[object]" |
| `markenProdukt._firestore._gax.operationsProtos` | object | "[object]" |
| `markenProdukt._firestore._gax.IamProtos` | object | "[object]" |
| `markenProdukt._firestore._gax.LocationProtos` | object | "[object]" |
| `markenProdukt._firestore._gax.OperationsClient` | unknown |  |
| `markenProdukt._firestore._gax.IamClient` | unknown |  |
| `markenProdukt._firestore._gax.LocationsClient` | unknown |  |
| `markenProdukt._firestore._gax.createByteLengthFunction` | unknown |  |
| `markenProdukt._firestore._gax.version` | string | "4.6.1" |
| `markenProdukt._firestore._gax.protobuf` | object | "[object]" |
| `markenProdukt._firestore._gax.protobufMinimal` | object | "[object]" |
| `markenProdukt._firestore._gax.fallback` | object | "[object]" |
| `markenProdukt._firestore._gax.makeUUID` | unknown |  |
| `markenProdukt._firestore._gax.ChannelCredentials` | unknown |  |
| `markenProdukt._firestore._gax.warn` | unknown |  |
| `markenProdukt._firestore._gax.serializer` | object | "[object]" |
| `markenProdukt._firestore._gax.lro` | unknown |  |
| `markenProdukt._path` | object | "[object]" |
| `markenProdukt._path.segments` | array | "[object]" |
| `markenProdukt._converter` | object | "[object]" |
| `markenProdukt._converter.toFirestore` | unknown |  |
| `markenProdukt._converter.fromFirestore` | unknown |  |
| `preisDatum` | timestamp | "[object]", "[object]" |
| `hersteller` | object | "[object]", "[object]" |
| `hersteller._firestore` | object | "[object]", "[object]" |
| `hersteller._firestore._settings` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.credentials` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.preferRest` | undefined | ,  |
| `hersteller._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore._settings.libName` | string | "gccl", "gccl" |
| `hersteller._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `hersteller._firestore._settings.toJSON` | unknown | ,  |
| `hersteller._firestore._settingsFrozen` | boolean | true, true |
| `hersteller._firestore._serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._serializer.createReference` | unknown | ,  |
| `hersteller._firestore._serializer.createInteger` | unknown | ,  |
| `hersteller._firestore._serializer.allowUndefined` | boolean | false, false |
| `hersteller._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore.registeredListenersCount` | number | 0, 0 |
| `hersteller._firestore.bulkWritersCount` | number | 0, 0 |
| `hersteller._firestore._traceUtil` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `hersteller._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `hersteller._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `hersteller._firestore._clientPool` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `hersteller._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `hersteller._firestore._clientPool.clientFactory` | unknown | ,  |
| `hersteller._firestore._clientPool.clientDestructor` | unknown | ,  |
| `hersteller._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `hersteller._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.terminated` | boolean | false, false |
| `hersteller._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `hersteller._firestore._gax` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.GoogleAuth` | unknown | ,  |
| `hersteller._firestore._gax.grpc` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OngoingCall` | unknown | ,  |
| `hersteller._firestore._gax.createApiCall` | unknown | ,  |
| `hersteller._firestore._gax.BundleDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.PageDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.StreamDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.CallSettings` | unknown | ,  |
| `hersteller._firestore._gax.constructSettings` | unknown | ,  |
| `hersteller._firestore._gax.RetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createRetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBundleOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.GoogleError` | unknown | ,  |
| `hersteller._firestore._gax.ClientStub` | unknown | ,  |
| `hersteller._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `hersteller._firestore._gax.GrpcClient` | unknown | ,  |
| `hersteller._firestore._gax.Operation` | unknown | ,  |
| `hersteller._firestore._gax.operation` | unknown | ,  |
| `hersteller._firestore._gax.PathTemplate` | unknown | ,  |
| `hersteller._firestore._gax.Status` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OperationsClient` | unknown | ,  |
| `hersteller._firestore._gax.IamClient` | unknown | ,  |
| `hersteller._firestore._gax.LocationsClient` | unknown | ,  |
| `hersteller._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `hersteller._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `hersteller._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.fallback` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.makeUUID` | unknown | ,  |
| `hersteller._firestore._gax.ChannelCredentials` | unknown | ,  |
| `hersteller._firestore._gax.warn` | unknown | ,  |
| `hersteller._firestore._gax.serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.lro` | unknown | ,  |
| `hersteller._path` | object | "[object]", "[object]" |
| `hersteller._path.segments` | array | "[object]", "[object]" |
| `hersteller._converter` | object | "[object]", "[object]" |
| `hersteller._converter.toFirestore` | unknown | ,  |
| `hersteller._converter.fromFirestore` | unknown | ,  |
| `created_at` | timestamp | "[object]", "[object]" |
| `bild` | string | "https://firebasestorage.googleapis.com/v0/b/mar...", "https://firebasestorage.googleapis.com/v0/b/mar..." |
| `EANs` | array | "[object]", "[object]" |
| `same` | boolean | false, false |
| `beschreibung` | string | "Maissnack", "Fruchtmus, Quetschie" |
| `herstellerMarkenProdukt` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings.credentials` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `herstellerMarkenProdukt._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.preferRest` | undefined | ,  |
| `herstellerMarkenProdukt._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `herstellerMarkenProdukt._firestore._settings.libName` | string | "gccl", "gccl" |
| `herstellerMarkenProdukt._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.toJSON` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._settingsFrozen` | boolean | true, true |
| `herstellerMarkenProdukt._firestore._serializer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._serializer.createReference` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._serializer.createInteger` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._serializer.allowUndefined` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `herstellerMarkenProdukt._firestore._databaseId` | string | "(default)", "(default)" |
| `herstellerMarkenProdukt._firestore.registeredListenersCount` | number | 0, 0 |
| `herstellerMarkenProdukt._firestore.bulkWritersCount` | number | 0, 0 |
| `herstellerMarkenProdukt._firestore._traceUtil` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._backoffSettings` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `herstellerMarkenProdukt._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `herstellerMarkenProdukt._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `herstellerMarkenProdukt._firestore._clientPool` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `herstellerMarkenProdukt._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `herstellerMarkenProdukt._firestore._clientPool.clientFactory` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._clientPool.clientDestructor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.terminated` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.GoogleAuth` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.grpc` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.OngoingCall` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createApiCall` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.BundleDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.PageDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.StreamDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.CallSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.constructSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.RetryOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createRetryOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createBundleOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GoogleError` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.ClientStub` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GrpcClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.Operation` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.operation` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.PathTemplate` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.Status` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.OperationsClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.IamClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.LocationsClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `herstellerMarkenProdukt._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.fallback` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.makeUUID` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.ChannelCredentials` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.warn` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.serializer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.lro` | unknown | ,  |
| `herstellerMarkenProdukt._path` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._path.segments` | array | "[object]", "[object]" |
| `herstellerMarkenProdukt._converter` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._converter.toFirestore` | unknown | ,  |
| `herstellerMarkenProdukt._converter.fromFirestore` | unknown | ,  |
| `discounter` | object | "[object]", "[object]" |
| `discounter._firestore` | object | "[object]", "[object]" |
| `discounter._firestore._settings` | object | "[object]", "[object]" |
| `discounter._firestore._settings.credentials` | object | "[object]", "[object]" |
| `discounter._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `discounter._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `discounter._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `discounter._firestore._settings.preferRest` | undefined | ,  |
| `discounter._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `discounter._firestore._settings.libName` | string | "gccl", "gccl" |
| `discounter._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `discounter._firestore._settings.toJSON` | unknown | ,  |
| `discounter._firestore._settingsFrozen` | boolean | true, true |
| `discounter._firestore._serializer` | object | "[object]", "[object]" |
| `discounter._firestore._serializer.createReference` | unknown | ,  |
| `discounter._firestore._serializer.createInteger` | unknown | ,  |
| `discounter._firestore._serializer.allowUndefined` | boolean | false, false |
| `discounter._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `discounter._firestore._databaseId` | string | "(default)", "(default)" |
| `discounter._firestore.registeredListenersCount` | number | 0, 0 |
| `discounter._firestore.bulkWritersCount` | number | 0, 0 |
| `discounter._firestore._traceUtil` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `discounter._firestore._backoffSettings` | object | "[object]", "[object]" |
| `discounter._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `discounter._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `discounter._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `discounter._firestore._clientPool` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `discounter._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `discounter._firestore._clientPool.clientFactory` | unknown | ,  |
| `discounter._firestore._clientPool.clientDestructor` | unknown | ,  |
| `discounter._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `discounter._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.terminated` | boolean | false, false |
| `discounter._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `discounter._firestore._gax` | object | "[object]", "[object]" |
| `discounter._firestore._gax.GoogleAuth` | unknown | ,  |
| `discounter._firestore._gax.grpc` | object | "[object]", "[object]" |
| `discounter._firestore._gax.OngoingCall` | unknown | ,  |
| `discounter._firestore._gax.createApiCall` | unknown | ,  |
| `discounter._firestore._gax.BundleDescriptor` | unknown | ,  |
| `discounter._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `discounter._firestore._gax.PageDescriptor` | unknown | ,  |
| `discounter._firestore._gax.StreamDescriptor` | unknown | ,  |
| `discounter._firestore._gax.CallSettings` | unknown | ,  |
| `discounter._firestore._gax.constructSettings` | unknown | ,  |
| `discounter._firestore._gax.RetryOptions` | unknown | ,  |
| `discounter._firestore._gax.createRetryOptions` | unknown | ,  |
| `discounter._firestore._gax.createBundleOptions` | unknown | ,  |
| `discounter._firestore._gax.createBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.GoogleError` | unknown | ,  |
| `discounter._firestore._gax.ClientStub` | unknown | ,  |
| `discounter._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `discounter._firestore._gax.GrpcClient` | unknown | ,  |
| `discounter._firestore._gax.Operation` | unknown | ,  |
| `discounter._firestore._gax.operation` | unknown | ,  |
| `discounter._firestore._gax.PathTemplate` | unknown | ,  |
| `discounter._firestore._gax.Status` | object | "[object]", "[object]" |
| `discounter._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `discounter._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `discounter._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.OperationsClient` | unknown | ,  |
| `discounter._firestore._gax.IamClient` | unknown | ,  |
| `discounter._firestore._gax.LocationsClient` | unknown | ,  |
| `discounter._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `discounter._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `discounter._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `discounter._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `discounter._firestore._gax.fallback` | object | "[object]", "[object]" |
| `discounter._firestore._gax.makeUUID` | unknown | ,  |
| `discounter._firestore._gax.ChannelCredentials` | unknown | ,  |
| `discounter._firestore._gax.warn` | unknown | ,  |
| `discounter._firestore._gax.serializer` | object | "[object]", "[object]" |
| `discounter._firestore._gax.lro` | unknown | ,  |
| `discounter._path` | object | "[object]", "[object]" |
| `discounter._path.segments` | array | "[object]", "[object]" |
| `discounter._converter` | object | "[object]", "[object]" |
| `discounter._converter.toFirestore` | unknown | ,  |
| `discounter._converter.fromFirestore` | unknown | ,  |
| `name` | string | "Bio Maisstangen", "Bio Banane-Ananas in Apfel mit Kokosmilch" |
| `packSize` | number | 50, 100 |
| `kategorie` | object | "[object]", "[object]" |
| `kategorie._firestore` | object | "[object]", "[object]" |
| `kategorie._firestore._settings` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.credentials` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.preferRest` | undefined | ,  |
| `kategorie._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore._settings.libName` | string | "gccl", "gccl" |
| `kategorie._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `kategorie._firestore._settings.toJSON` | unknown | ,  |
| `kategorie._firestore._settingsFrozen` | boolean | true, true |
| `kategorie._firestore._serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._serializer.createReference` | unknown | ,  |
| `kategorie._firestore._serializer.createInteger` | unknown | ,  |
| `kategorie._firestore._serializer.allowUndefined` | boolean | false, false |
| `kategorie._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore.registeredListenersCount` | number | 0, 0 |
| `kategorie._firestore.bulkWritersCount` | number | 0, 0 |
| `kategorie._firestore._traceUtil` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `kategorie._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `kategorie._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `kategorie._firestore._clientPool` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `kategorie._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `kategorie._firestore._clientPool.clientFactory` | unknown | ,  |
| `kategorie._firestore._clientPool.clientDestructor` | unknown | ,  |
| `kategorie._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `kategorie._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.terminated` | boolean | false, false |
| `kategorie._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `kategorie._firestore._gax` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.GoogleAuth` | unknown | ,  |
| `kategorie._firestore._gax.grpc` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OngoingCall` | unknown | ,  |
| `kategorie._firestore._gax.createApiCall` | unknown | ,  |
| `kategorie._firestore._gax.BundleDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.PageDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.StreamDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.CallSettings` | unknown | ,  |
| `kategorie._firestore._gax.constructSettings` | unknown | ,  |
| `kategorie._firestore._gax.RetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createRetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBundleOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.GoogleError` | unknown | ,  |
| `kategorie._firestore._gax.ClientStub` | unknown | ,  |
| `kategorie._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `kategorie._firestore._gax.GrpcClient` | unknown | ,  |
| `kategorie._firestore._gax.Operation` | unknown | ,  |
| `kategorie._firestore._gax.operation` | unknown | ,  |
| `kategorie._firestore._gax.PathTemplate` | unknown | ,  |
| `kategorie._firestore._gax.Status` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OperationsClient` | unknown | ,  |
| `kategorie._firestore._gax.IamClient` | unknown | ,  |
| `kategorie._firestore._gax.LocationsClient` | unknown | ,  |
| `kategorie._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `kategorie._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `kategorie._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.fallback` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.makeUUID` | unknown | ,  |
| `kategorie._firestore._gax.ChannelCredentials` | unknown | ,  |
| `kategorie._firestore._gax.warn` | unknown | ,  |
| `kategorie._firestore._gax.serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.lro` | unknown | ,  |
| `kategorie._path` | object | "[object]", "[object]" |
| `kategorie._path.segments` | array | "[object]", "[object]" |
| `kategorie._converter` | object | "[object]", "[object]" |
| `kategorie._converter.toFirestore` | unknown | ,  |
| `kategorie._converter.fromFirestore` | unknown | ,  |

### TypeScript Interface

```typescript
interface Produkteerfassung {
  addedby: string;
  beschreibung: string;
  bild: string;
  created_at: Date | FirebaseTimestamp;
  discounter: object;
  EANs: any[];
  handelsmarke: object;
  hersteller: object;
  herstellerMarkenProdukt: object;
  kategorie: object;
  markenProdukt: object;
  name: string;
  packSize: number;
  packTyp: object;
  preis: number;
  preisDatum: Date | FirebaseTimestamp;
  same: boolean;
  stufe: string;
}
```

---

## produkteerfassungBulgaria

**📊 Statistics:**
- Documents: 3
- Fields: 535
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `EANs` | array | "[object]", "[object]" |
| `addedby` | string | "Stefani", "Ivelina" |
| `beschreibung` | string | "Lyoner, Wurstwaren", "Nussmischung, Nusskerne, Sultaninen" |
| `bild` | string | "https://firebasestorage.googleapis.com/v0/b/mar...", "https://firebasestorage.googleapis.com/v0/b/mar..." |
| `created_at` | timestamp | "[object]", "[object]" |
| `discounter` | object | "[object]", "[object]" |
| `discounter._firestore` | object | "[object]", "[object]" |
| `discounter._firestore._settings` | object | "[object]", "[object]" |
| `discounter._firestore._settings.credentials` | object | "[object]", "[object]" |
| `discounter._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `discounter._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `discounter._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `discounter._firestore._settings.preferRest` | undefined | ,  |
| `discounter._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `discounter._firestore._settings.libName` | string | "gccl", "gccl" |
| `discounter._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `discounter._firestore._settings.toJSON` | unknown | ,  |
| `discounter._firestore._settingsFrozen` | boolean | true, true |
| `discounter._firestore._serializer` | object | "[object]", "[object]" |
| `discounter._firestore._serializer.createReference` | unknown | ,  |
| `discounter._firestore._serializer.createInteger` | unknown | ,  |
| `discounter._firestore._serializer.allowUndefined` | boolean | false, false |
| `discounter._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `discounter._firestore._databaseId` | string | "(default)", "(default)" |
| `discounter._firestore.registeredListenersCount` | number | 0, 0 |
| `discounter._firestore.bulkWritersCount` | number | 0, 0 |
| `discounter._firestore._traceUtil` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `discounter._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `discounter._firestore._backoffSettings` | object | "[object]", "[object]" |
| `discounter._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `discounter._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `discounter._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `discounter._firestore._clientPool` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `discounter._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `discounter._firestore._clientPool.clientFactory` | unknown | ,  |
| `discounter._firestore._clientPool.clientDestructor` | unknown | ,  |
| `discounter._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `discounter._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `discounter._firestore._clientPool.terminated` | boolean | false, false |
| `discounter._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `discounter._firestore._gax` | object | "[object]", "[object]" |
| `discounter._firestore._gax.GoogleAuth` | unknown | ,  |
| `discounter._firestore._gax.grpc` | object | "[object]", "[object]" |
| `discounter._firestore._gax.OngoingCall` | unknown | ,  |
| `discounter._firestore._gax.createApiCall` | unknown | ,  |
| `discounter._firestore._gax.BundleDescriptor` | unknown | ,  |
| `discounter._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `discounter._firestore._gax.PageDescriptor` | unknown | ,  |
| `discounter._firestore._gax.StreamDescriptor` | unknown | ,  |
| `discounter._firestore._gax.CallSettings` | unknown | ,  |
| `discounter._firestore._gax.constructSettings` | unknown | ,  |
| `discounter._firestore._gax.RetryOptions` | unknown | ,  |
| `discounter._firestore._gax.createRetryOptions` | unknown | ,  |
| `discounter._firestore._gax.createBundleOptions` | unknown | ,  |
| `discounter._firestore._gax.createBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `discounter._firestore._gax.GoogleError` | unknown | ,  |
| `discounter._firestore._gax.ClientStub` | unknown | ,  |
| `discounter._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `discounter._firestore._gax.GrpcClient` | unknown | ,  |
| `discounter._firestore._gax.Operation` | unknown | ,  |
| `discounter._firestore._gax.operation` | unknown | ,  |
| `discounter._firestore._gax.PathTemplate` | unknown | ,  |
| `discounter._firestore._gax.Status` | object | "[object]", "[object]" |
| `discounter._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `discounter._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `discounter._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `discounter._firestore._gax.OperationsClient` | unknown | ,  |
| `discounter._firestore._gax.IamClient` | unknown | ,  |
| `discounter._firestore._gax.LocationsClient` | unknown | ,  |
| `discounter._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `discounter._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `discounter._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `discounter._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `discounter._firestore._gax.fallback` | object | "[object]", "[object]" |
| `discounter._firestore._gax.makeUUID` | unknown | ,  |
| `discounter._firestore._gax.ChannelCredentials` | unknown | ,  |
| `discounter._firestore._gax.warn` | unknown | ,  |
| `discounter._firestore._gax.serializer` | object | "[object]", "[object]" |
| `discounter._firestore._gax.lro` | unknown | ,  |
| `discounter._path` | object | "[object]", "[object]" |
| `discounter._path.segments` | array | "[object]", "[object]" |
| `discounter._converter` | object | "[object]", "[object]" |
| `discounter._converter.toFirestore` | unknown | ,  |
| `discounter._converter.fromFirestore` | unknown | ,  |
| `handelsmarke` | object | "[object]", "[object]" |
| `handelsmarke._firestore` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings.credentials` | object | "[object]", "[object]" |
| `handelsmarke._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `handelsmarke._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `handelsmarke._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `handelsmarke._firestore._settings.preferRest` | undefined | ,  |
| `handelsmarke._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `handelsmarke._firestore._settings.libName` | string | "gccl", "gccl" |
| `handelsmarke._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `handelsmarke._firestore._settings.toJSON` | unknown | ,  |
| `handelsmarke._firestore._settingsFrozen` | boolean | true, true |
| `handelsmarke._firestore._serializer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._serializer.createReference` | unknown | ,  |
| `handelsmarke._firestore._serializer.createInteger` | unknown | ,  |
| `handelsmarke._firestore._serializer.allowUndefined` | boolean | false, false |
| `handelsmarke._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `handelsmarke._firestore._databaseId` | string | "(default)", "(default)" |
| `handelsmarke._firestore.registeredListenersCount` | number | 0, 0 |
| `handelsmarke._firestore.bulkWritersCount` | number | 0, 0 |
| `handelsmarke._firestore._traceUtil` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `handelsmarke._firestore._backoffSettings` | object | "[object]", "[object]" |
| `handelsmarke._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `handelsmarke._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `handelsmarke._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `handelsmarke._firestore._clientPool` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `handelsmarke._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `handelsmarke._firestore._clientPool.clientFactory` | unknown | ,  |
| `handelsmarke._firestore._clientPool.clientDestructor` | unknown | ,  |
| `handelsmarke._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `handelsmarke._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `handelsmarke._firestore._clientPool.terminated` | boolean | false, false |
| `handelsmarke._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.GoogleAuth` | unknown | ,  |
| `handelsmarke._firestore._gax.grpc` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.OngoingCall` | unknown | ,  |
| `handelsmarke._firestore._gax.createApiCall` | unknown | ,  |
| `handelsmarke._firestore._gax.BundleDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.PageDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.StreamDescriptor` | unknown | ,  |
| `handelsmarke._firestore._gax.CallSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.constructSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.RetryOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createRetryOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createBundleOptions` | unknown | ,  |
| `handelsmarke._firestore._gax.createBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `handelsmarke._firestore._gax.GoogleError` | unknown | ,  |
| `handelsmarke._firestore._gax.ClientStub` | unknown | ,  |
| `handelsmarke._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `handelsmarke._firestore._gax.GrpcClient` | unknown | ,  |
| `handelsmarke._firestore._gax.Operation` | unknown | ,  |
| `handelsmarke._firestore._gax.operation` | unknown | ,  |
| `handelsmarke._firestore._gax.PathTemplate` | unknown | ,  |
| `handelsmarke._firestore._gax.Status` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.OperationsClient` | unknown | ,  |
| `handelsmarke._firestore._gax.IamClient` | unknown | ,  |
| `handelsmarke._firestore._gax.LocationsClient` | unknown | ,  |
| `handelsmarke._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `handelsmarke._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `handelsmarke._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.fallback` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.makeUUID` | unknown | ,  |
| `handelsmarke._firestore._gax.ChannelCredentials` | unknown | ,  |
| `handelsmarke._firestore._gax.warn` | unknown | ,  |
| `handelsmarke._firestore._gax.serializer` | object | "[object]", "[object]" |
| `handelsmarke._firestore._gax.lro` | unknown | ,  |
| `handelsmarke._path` | object | "[object]", "[object]" |
| `handelsmarke._path.segments` | array | "[object]", "[object]" |
| `handelsmarke._converter` | object | "[object]", "[object]" |
| `handelsmarke._converter.toFirestore` | unknown | ,  |
| `handelsmarke._converter.fromFirestore` | unknown | ,  |
| `hersteller` | object | "[object]", "[object]" |
| `hersteller._firestore` | object | "[object]", "[object]" |
| `hersteller._firestore._settings` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.credentials` | object | "[object]", "[object]" |
| `hersteller._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `hersteller._firestore._settings.preferRest` | undefined | ,  |
| `hersteller._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore._settings.libName` | string | "gccl", "gccl" |
| `hersteller._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `hersteller._firestore._settings.toJSON` | unknown | ,  |
| `hersteller._firestore._settingsFrozen` | boolean | true, true |
| `hersteller._firestore._serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._serializer.createReference` | unknown | ,  |
| `hersteller._firestore._serializer.createInteger` | unknown | ,  |
| `hersteller._firestore._serializer.allowUndefined` | boolean | false, false |
| `hersteller._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `hersteller._firestore._databaseId` | string | "(default)", "(default)" |
| `hersteller._firestore.registeredListenersCount` | number | 0, 0 |
| `hersteller._firestore.bulkWritersCount` | number | 0, 0 |
| `hersteller._firestore._traceUtil` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `hersteller._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings` | object | "[object]", "[object]" |
| `hersteller._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `hersteller._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `hersteller._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `hersteller._firestore._clientPool` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `hersteller._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `hersteller._firestore._clientPool.clientFactory` | unknown | ,  |
| `hersteller._firestore._clientPool.clientDestructor` | unknown | ,  |
| `hersteller._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `hersteller._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `hersteller._firestore._clientPool.terminated` | boolean | false, false |
| `hersteller._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `hersteller._firestore._gax` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.GoogleAuth` | unknown | ,  |
| `hersteller._firestore._gax.grpc` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OngoingCall` | unknown | ,  |
| `hersteller._firestore._gax.createApiCall` | unknown | ,  |
| `hersteller._firestore._gax.BundleDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.PageDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.StreamDescriptor` | unknown | ,  |
| `hersteller._firestore._gax.CallSettings` | unknown | ,  |
| `hersteller._firestore._gax.constructSettings` | unknown | ,  |
| `hersteller._firestore._gax.RetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createRetryOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBundleOptions` | unknown | ,  |
| `hersteller._firestore._gax.createBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `hersteller._firestore._gax.GoogleError` | unknown | ,  |
| `hersteller._firestore._gax.ClientStub` | unknown | ,  |
| `hersteller._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `hersteller._firestore._gax.GrpcClient` | unknown | ,  |
| `hersteller._firestore._gax.Operation` | unknown | ,  |
| `hersteller._firestore._gax.operation` | unknown | ,  |
| `hersteller._firestore._gax.PathTemplate` | unknown | ,  |
| `hersteller._firestore._gax.Status` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.OperationsClient` | unknown | ,  |
| `hersteller._firestore._gax.IamClient` | unknown | ,  |
| `hersteller._firestore._gax.LocationsClient` | unknown | ,  |
| `hersteller._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `hersteller._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `hersteller._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.fallback` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.makeUUID` | unknown | ,  |
| `hersteller._firestore._gax.ChannelCredentials` | unknown | ,  |
| `hersteller._firestore._gax.warn` | unknown | ,  |
| `hersteller._firestore._gax.serializer` | object | "[object]", "[object]" |
| `hersteller._firestore._gax.lro` | unknown | ,  |
| `hersteller._path` | object | "[object]", "[object]" |
| `hersteller._path.segments` | array | "[object]", "[object]" |
| `hersteller._converter` | object | "[object]", "[object]" |
| `hersteller._converter.toFirestore` | unknown | ,  |
| `hersteller._converter.fromFirestore` | unknown | ,  |
| `herstellerMarkenProdukt` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings.credentials` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `herstellerMarkenProdukt._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.preferRest` | undefined | ,  |
| `herstellerMarkenProdukt._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `herstellerMarkenProdukt._firestore._settings.libName` | string | "gccl", "gccl" |
| `herstellerMarkenProdukt._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `herstellerMarkenProdukt._firestore._settings.toJSON` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._settingsFrozen` | boolean | true, true |
| `herstellerMarkenProdukt._firestore._serializer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._serializer.createReference` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._serializer.createInteger` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._serializer.allowUndefined` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `herstellerMarkenProdukt._firestore._databaseId` | string | "(default)", "(default)" |
| `herstellerMarkenProdukt._firestore.registeredListenersCount` | number | 0, 0 |
| `herstellerMarkenProdukt._firestore.bulkWritersCount` | number | 0, 0 |
| `herstellerMarkenProdukt._firestore._traceUtil` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._backoffSettings` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `herstellerMarkenProdukt._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `herstellerMarkenProdukt._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `herstellerMarkenProdukt._firestore._clientPool` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `herstellerMarkenProdukt._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `herstellerMarkenProdukt._firestore._clientPool.clientFactory` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._clientPool.clientDestructor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._clientPool.terminated` | boolean | false, false |
| `herstellerMarkenProdukt._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.GoogleAuth` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.grpc` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.OngoingCall` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createApiCall` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.BundleDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.PageDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.StreamDescriptor` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.CallSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.constructSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.RetryOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createRetryOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createBundleOptions` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GoogleError` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.ClientStub` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.GrpcClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.Operation` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.operation` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.PathTemplate` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.Status` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.OperationsClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.IamClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.LocationsClient` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `herstellerMarkenProdukt._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.fallback` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.makeUUID` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.ChannelCredentials` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.warn` | unknown | ,  |
| `herstellerMarkenProdukt._firestore._gax.serializer` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._firestore._gax.lro` | unknown | ,  |
| `herstellerMarkenProdukt._path` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._path.segments` | array | "[object]", "[object]" |
| `herstellerMarkenProdukt._converter` | object | "[object]", "[object]" |
| `herstellerMarkenProdukt._converter.toFirestore` | unknown | ,  |
| `herstellerMarkenProdukt._converter.fromFirestore` | unknown | ,  |
| `kategorie` | object | "[object]", "[object]" |
| `kategorie._firestore` | object | "[object]", "[object]" |
| `kategorie._firestore._settings` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.credentials` | object | "[object]", "[object]" |
| `kategorie._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `kategorie._firestore._settings.preferRest` | undefined | ,  |
| `kategorie._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore._settings.libName` | string | "gccl", "gccl" |
| `kategorie._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `kategorie._firestore._settings.toJSON` | unknown | ,  |
| `kategorie._firestore._settingsFrozen` | boolean | true, true |
| `kategorie._firestore._serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._serializer.createReference` | unknown | ,  |
| `kategorie._firestore._serializer.createInteger` | unknown | ,  |
| `kategorie._firestore._serializer.allowUndefined` | boolean | false, false |
| `kategorie._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `kategorie._firestore._databaseId` | string | "(default)", "(default)" |
| `kategorie._firestore.registeredListenersCount` | number | 0, 0 |
| `kategorie._firestore.bulkWritersCount` | number | 0, 0 |
| `kategorie._firestore._traceUtil` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `kategorie._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings` | object | "[object]", "[object]" |
| `kategorie._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `kategorie._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `kategorie._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `kategorie._firestore._clientPool` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `kategorie._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `kategorie._firestore._clientPool.clientFactory` | unknown | ,  |
| `kategorie._firestore._clientPool.clientDestructor` | unknown | ,  |
| `kategorie._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `kategorie._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `kategorie._firestore._clientPool.terminated` | boolean | false, false |
| `kategorie._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `kategorie._firestore._gax` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.GoogleAuth` | unknown | ,  |
| `kategorie._firestore._gax.grpc` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OngoingCall` | unknown | ,  |
| `kategorie._firestore._gax.createApiCall` | unknown | ,  |
| `kategorie._firestore._gax.BundleDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.PageDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.StreamDescriptor` | unknown | ,  |
| `kategorie._firestore._gax.CallSettings` | unknown | ,  |
| `kategorie._firestore._gax.constructSettings` | unknown | ,  |
| `kategorie._firestore._gax.RetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createRetryOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBundleOptions` | unknown | ,  |
| `kategorie._firestore._gax.createBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `kategorie._firestore._gax.GoogleError` | unknown | ,  |
| `kategorie._firestore._gax.ClientStub` | unknown | ,  |
| `kategorie._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `kategorie._firestore._gax.GrpcClient` | unknown | ,  |
| `kategorie._firestore._gax.Operation` | unknown | ,  |
| `kategorie._firestore._gax.operation` | unknown | ,  |
| `kategorie._firestore._gax.PathTemplate` | unknown | ,  |
| `kategorie._firestore._gax.Status` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.OperationsClient` | unknown | ,  |
| `kategorie._firestore._gax.IamClient` | unknown | ,  |
| `kategorie._firestore._gax.LocationsClient` | unknown | ,  |
| `kategorie._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `kategorie._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `kategorie._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.fallback` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.makeUUID` | unknown | ,  |
| `kategorie._firestore._gax.ChannelCredentials` | unknown | ,  |
| `kategorie._firestore._gax.warn` | unknown | ,  |
| `kategorie._firestore._gax.serializer` | object | "[object]", "[object]" |
| `kategorie._firestore._gax.lro` | unknown | ,  |
| `kategorie._path` | object | "[object]", "[object]" |
| `kategorie._path.segments` | array | "[object]", "[object]" |
| `kategorie._converter` | object | "[object]", "[object]" |
| `kategorie._converter.toFirestore` | unknown | ,  |
| `kategorie._converter.fromFirestore` | unknown | ,  |
| `markenProdukt` | null | null, null |
| `name` | string | "Delikatess Lyoner", "Nussfruchtmischung" |
| `packSize` | number | 200, 200 |
| `packTyp` | object | "[object]", "[object]" |
| `packTyp._firestore` | object | "[object]", "[object]" |
| `packTyp._firestore._settings` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.credentials` | object | "[object]", "[object]" |
| `packTyp._firestore._settings.projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._settings.firebaseVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.firebaseAdminVersion` | string | "13.4.0", "13.4.0" |
| `packTyp._firestore._settings.preferRest` | undefined | ,  |
| `packTyp._firestore._settings.databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore._settings.libName` | string | "gccl", "gccl" |
| `packTyp._firestore._settings.libVersion` | string | "7.11.3 fire/13.4.0 fire-admin/13.4.0", "7.11.3 fire/13.4.0 fire-admin/13.4.0" |
| `packTyp._firestore._settings.toJSON` | unknown | ,  |
| `packTyp._firestore._settingsFrozen` | boolean | true, true |
| `packTyp._firestore._serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._serializer.createReference` | unknown | ,  |
| `packTyp._firestore._serializer.createInteger` | unknown | ,  |
| `packTyp._firestore._serializer.allowUndefined` | boolean | false, false |
| `packTyp._firestore._projectId` | string | "markendetektive-895f7", "markendetektive-895f7" |
| `packTyp._firestore._databaseId` | string | "(default)", "(default)" |
| `packTyp._firestore.registeredListenersCount` | number | 0, 0 |
| `packTyp._firestore.bulkWritersCount` | number | 0, 0 |
| `packTyp._firestore._traceUtil` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracerProvider` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.tracer` | object | "[object]", "[object]" |
| `packTyp._firestore._traceUtil.settingsAttributes` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings` | object | "[object]", "[object]" |
| `packTyp._firestore._backoffSettings.initialDelayMs` | number | 100, 100 |
| `packTyp._firestore._backoffSettings.maxDelayMs` | number | 60000, 60000 |
| `packTyp._firestore._backoffSettings.backoffFactor` | number | 1.3, 1.3 |
| `packTyp._firestore._clientPool` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.concurrentOperationLimit` | number | 100, 100 |
| `packTyp._firestore._clientPool.maxIdleClients` | number | 1, 1 |
| `packTyp._firestore._clientPool.clientFactory` | unknown | ,  |
| `packTyp._firestore._clientPool.clientDestructor` | unknown | ,  |
| `packTyp._firestore._clientPool.grpcEnabled` | boolean | false, false |
| `packTyp._firestore._clientPool.activeClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.failedClients` | object | "[object]", "[object]" |
| `packTyp._firestore._clientPool.terminated` | boolean | false, false |
| `packTyp._firestore._clientPool.terminateDeferred` | object | "[object]", "[object]" |
| `packTyp._firestore._gax` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.GoogleAuth` | unknown | ,  |
| `packTyp._firestore._gax.grpc` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OngoingCall` | unknown | ,  |
| `packTyp._firestore._gax.createApiCall` | unknown | ,  |
| `packTyp._firestore._gax.BundleDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.LongrunningDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.PageDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.StreamDescriptor` | unknown | ,  |
| `packTyp._firestore._gax.CallSettings` | unknown | ,  |
| `packTyp._firestore._gax.constructSettings` | unknown | ,  |
| `packTyp._firestore._gax.RetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createRetryOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBundleOptions` | unknown | ,  |
| `packTyp._firestore._gax.createBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createDefaultBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.createMaxRetriesBackoffSettings` | unknown | ,  |
| `packTyp._firestore._gax.GoogleError` | unknown | ,  |
| `packTyp._firestore._gax.ClientStub` | unknown | ,  |
| `packTyp._firestore._gax.GoogleProtoFilesRoot` | unknown | ,  |
| `packTyp._firestore._gax.GrpcClient` | unknown | ,  |
| `packTyp._firestore._gax.Operation` | unknown | ,  |
| `packTyp._firestore._gax.operation` | unknown | ,  |
| `packTyp._firestore._gax.PathTemplate` | unknown | ,  |
| `packTyp._firestore._gax.Status` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.StreamType` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.routingHeader` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.operationsProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.IamProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.LocationProtos` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.OperationsClient` | unknown | ,  |
| `packTyp._firestore._gax.IamClient` | unknown | ,  |
| `packTyp._firestore._gax.LocationsClient` | unknown | ,  |
| `packTyp._firestore._gax.createByteLengthFunction` | unknown | ,  |
| `packTyp._firestore._gax.version` | string | "4.6.1", "4.6.1" |
| `packTyp._firestore._gax.protobuf` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.protobufMinimal` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.fallback` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.makeUUID` | unknown | ,  |
| `packTyp._firestore._gax.ChannelCredentials` | unknown | ,  |
| `packTyp._firestore._gax.warn` | unknown | ,  |
| `packTyp._firestore._gax.serializer` | object | "[object]", "[object]" |
| `packTyp._firestore._gax.lro` | unknown | ,  |
| `packTyp._path` | object | "[object]", "[object]" |
| `packTyp._path.segments` | array | "[object]", "[object]" |
| `packTyp._converter` | object | "[object]", "[object]" |
| `packTyp._converter.toFirestore` | unknown | ,  |
| `packTyp._converter.fromFirestore` | unknown | ,  |
| `preis` | number | 0.99, 1.69 |
| `preisDatum` | timestamp | "[object]", "[object]" |
| `same` | boolean | false, false |
| `stufe` | string | "2", "1" |
| `editedbymanon` | boolean | false |

### TypeScript Interface

```typescript
interface ProdukteerfassungBulgaria {
  addedby: string;
  beschreibung: string;
  bild: string;
  created_at: Date | FirebaseTimestamp;
  discounter: object;
  EANs: any[];
  editedbymanon?: boolean;
  handelsmarke: object;
  hersteller: object;
  herstellerMarkenProdukt: object;
  kategorie: object;
  markenProdukt: null;
  name: string;
  packSize: number;
  packTyp: object;
  preis: number;
  preisDatum: Date | FirebaseTimestamp;
  same: boolean;
  stufe: string;
}
```

---

## produktvorschlaege

**📊 Statistics:**
- Documents: 3
- Fields: 7
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `hersteller` | string | "Bergader", "ja" |
| `date` | timestamp | "[object]", "[object]" |
| `gescannteEAN` | string | "4006402071538", "4337256352338" |
| `nameGescannt` | string | "Almzeit Weichkäse (cremig-würzig)", "Brötchen" |
| `name` | string | "Almzeit ", "Ja Weizen Brötchen " |
| `wogekauft` | string | "Aldi Nord ", "Rewe" |
| `user` | string | "mgTIuZ7vNxPzq6C5N2VdqXUtuLr2", "Fth9YGsIzyRxD10kcV2IW9ko1QN2" |

### TypeScript Interface

```typescript
interface Produktvorschlaege {
  date: Date | FirebaseTimestamp;
  gescannteEAN: string;
  hersteller: string;
  name: string;
  nameGescannt: string;
  user: string;
  wogekauft: string;
}
```

---

## scraped_products

**📊 Statistics:**
- Documents: 3
- Fields: 53
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `allergens_celery` | boolean | false, true |
| `allergens_crustaceans` | boolean | false, false |
| `allergens_egg` | boolean | false, true |
| `allergens_fish` | boolean | false, false |
| `allergens_gluten` | boolean | false, true |
| `allergens_lupins` | boolean | false, false |
| `allergens_milk` | boolean | false, true |
| `allergens_mollusks` | boolean | false, false |
| `allergens_mustard` | boolean | false, true |
| `allergens_nuts` | boolean | false, false |
| `allergens_peanuts` | boolean | false, false |
| `allergens_sesame` | boolean | false, false |
| `allergens_soy` | boolean | false, true |
| `allergens_sulfites` | boolean | false, false |
| `articleNumber` | string | "4501126284", "4502070217" |
| `brandName` | string | "Guhl", "Knorr" |
| `cleanProductName` | string | "Blond Faszination Farbglanz Spülung", "Feinschmecker Curry Sauce" |
| `gtin` | string | "4072600282298", "8711200384150" |
| `image_urls` | array | "[object]", "[object]" |
| `images` | array | "[object]", "[object]" |
| `ingredients` | string | "", "Palmöl, Stärke, WEIZENMEHL, MAGERMILCHPULVER, M..." |
| `isGlutenFree` | boolean | false, false |
| `isLactoseFree` | boolean | false, false |
| `isOwnBrand` | boolean | false, false |
| `isVegan` | boolean | false, false |
| `isVegetarian` | boolean | false, true |
| `itemSize` | string | "200 ml", "47 g" |
| `marketId` | string | "", "" |
| `nutrition_caloriesKcal` | null | null, "86 kcal" |
| `nutrition_protein` | null | null, "1,6 g" |
| `nutrition_salt` | null | null, "0,99 g" |
| `nutrition_saturatedFat` | null | null, "2,5 g" |
| `nutrition_servingSize` | null | null, "je 100 g" |
| `nutrition_sugar` | null | null, "2,9 g" |
| `nutrition_totalCarbohydrates` | null | null, "10,0 g" |
| `nutrition_totalFat` | null | null, "4,2 g" |
| `other` | string | "{"Art": "Sp\u00fclung", "Verpackungsart": "Tube...", "{"Serie": "Knorr Feinschmecker Sauce", "Verpack..." |
| `price` | number | 4.55, 1.49 |
| `producer` | string | "Guhl Ikebana GmbH, Pfungstädter Straße 98, 6429...", "Unilever Deutschland GmbH, Postfach 570 550, 22..." |
| `productCategory` | string | "Drogerie & Reinigen > Körperpflege & Kosmetik >...", "Speisekammer > Fertiggerichte & Konserven > Fix..." |
| `productDescription` | string | "Die Formulierung mit pflegender Kamille und stä...", "Eine feine Currynote, Ananas, Paprika, Bambussp..." |
| `productName` | string | "Guhl Blond Faszination Farbglanz Spülung", "Knorr Feinschmecker Curry Sauce" |
| `source` | string | "mytime.de", "mytime.de" |
| `thumbnails` | array | "[object]", "[object]" |
| `url` | string | "https://www.mytime.de/guhl_blond_faszination_fa...", "https://www.mytime.de/knorr_feinschmecker_curry..." |
| `priceDate` | string | "2025-03-13T15:30:51.182190", "2025-03-13T14:22:12.821929" |
| `lastcrawl` | timestamp | "[object]", "[object]" |
| `gtin_scan_status` | string | "NOT_SCANNED_YET", "NOT_SCANNED_YET" |
| `nameindb` | string | "Unilever Deutschland GmbH" |
| `herstellerId` | string | "1WdBWiuVIkh0pixlDOtX" |
| `matchScore` | number | 1 |
| `matchType` | string | "strict" |
| `updatedAt` | timestamp | "[object]", "[object]" |

### TypeScript Interface

```typescript
interface ScrapedProducts {
  allergens_celery: boolean;
  allergens_crustaceans: boolean;
  allergens_egg: boolean;
  allergens_fish: boolean;
  allergens_gluten: boolean;
  allergens_lupins: boolean;
  allergens_milk: boolean;
  allergens_mollusks: boolean;
  allergens_mustard: boolean;
  allergens_nuts: boolean;
  allergens_peanuts: boolean;
  allergens_sesame: boolean;
  allergens_soy: boolean;
  allergens_sulfites: boolean;
  articleNumber: string;
  brandName: string;
  cleanProductName: string;
  gtin: string;
  gtin_scan_status: string;
  herstellerId?: string;
  image_urls: any[];
  images: any[];
  ingredients: string;
  isGlutenFree: boolean;
  isLactoseFree: boolean;
  isOwnBrand: boolean;
  isVegan: boolean;
  isVegetarian: boolean;
  itemSize: string;
  lastcrawl: Date | FirebaseTimestamp;
  marketId: string;
  matchScore?: number;
  matchType?: string;
  nameindb?: string;
  nutrition_caloriesKcal: null;
  nutrition_protein: null;
  nutrition_salt: null;
  nutrition_saturatedFat: null;
  nutrition_servingSize: null;
  nutrition_sugar: null;
  nutrition_totalCarbohydrates: null;
  nutrition_totalFat: null;
  other: string;
  price: number;
  priceDate: string;
  producer: string;
  productCategory: string;
  productDescription: string;
  productName: string;
  source: string;
  thumbnails: any[];
  updatedAt?: Date | FirebaseTimestamp;
  url: string;
}
```

---

## userFeedbacks

**📊 Statistics:**
- Documents: 3
- Fields: 4
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `feedback` | string | "", "" |
| `rate` | number | 0, 1 |
| `email` | string | "" |
| `timestamp` | timestamp | "[object]" |

### TypeScript Interface

```typescript
interface UserFeedbacks {
  email?: string;
  feedback: string;
  rate: number;
  timestamp?: Date | FirebaseTimestamp;
}
```

---

## users

**📊 Statistics:**
- Documents: 3
- Fields: 6
- Subcollections: 1

**📁 Subcollections:**
- `searchHistory`

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `uid` | string | "02BbbWaJDVOCXECyi7WsY1tHQUR2", "02X5enlCQtV8hIaLq6qvbx6dkUW2" |
| `created_time` | timestamp | "[object]", "[object]" |
| `photo_url` | string | "https://lh3.googleusercontent.com/a/ACg8ocL8IEb..." |
| `display_name` | string | "Michael R. (der alte dicke Mann)", "Bianca Gruber" |
| `email` | string | "schwabemichael4@googlemail.com", "gh7m5848h4@privaterelay.appleid.com" |
| `totalSavings` | number | 0 |

### TypeScript Interface

```typescript
interface Users {
  created_time: Date | FirebaseTimestamp;
  display_name: string;
  email: string;
  photo_url?: string;
  totalSavings?: number;
  uid: string;
}
```

---

## vetnummern

**📊 Statistics:**
- Documents: 3
- Fields: 6
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `ort` | string | "79286 Glottertal", "69253 Heiligkreuzsteinach" |
| `bemerkungen` | string | "", "" |
| `strasse` | string | "Hartererweg 6", "Markplatz 5" |
| `bundesland` | string | "BW", "BW" |
| `name` | string | "Petra und Josef Birkle", "Metzgerei Beisel" |
| `nummer` | string | "BW 493", "BW 36012" |

### TypeScript Interface

```typescript
interface Vetnummern {
  bemerkungen: string;
  bundesland: string;
  name: string;
  nummer: string;
  ort: string;
  strasse: string;
}
```

---

## vetnummernat

**📊 Statistics:**
- Documents: 3
- Fields: 5
- Subcollections: 0

### Field Schema

| Field | Type | Examples |
|-------|------|----------|
| `ort` | string | "6923 Lauterach", "6934 Sulzberg" |
| `bemerkungen` | string | "", "" |
| `strasse` | string | "Alte Landstraße 10 Haus 2 Verwaltungsgebäude 2", "Dorf 2" |
| `name` | string | "Hermann Pfanner Getränke GmbH", "Sulzberger Käserebellen" |
| `nummer` | string | "AT 80451 EG", "AT 80148 EG" |

### TypeScript Interface

```typescript
interface Vetnummernat {
  bemerkungen: string;
  name: string;
  nummer: string;
  ort: string;
  strasse: string;
}
```

---

## 🔗 Database Relationships

```mermaid
graph TD
    abopreise[abopreise]
    aldiscrapedproducts[aldiscrapedproducts]
    appSettings[appSettings]
    argustoartikel[argustoartikel]
    discounter[discounter]
    ff_push_notifications[ff_push_notifications]
    handelsmarken[handelsmarken]
    hersteller[hersteller]
    hersteller_new[hersteller_new]
    hersteller_new_formatch[hersteller_new_formatch]
    kategorien[kategorien]
    lidlscrapedproduct_text[lidlscrapedproduct_text]
    lidlscrapedproducts[lidlscrapedproducts]
    markenProdukte[markenProdukte]
    markenprodukteerfassung[markenprodukteerfassung]
    neuesGeheimnis[neuesGeheimnis]
    onboardingresults[onboardingresults]
    onboardingspendings[onboardingspendings]
    onboardingwherefrom[onboardingwherefrom]
    packungstypen[packungstypen]
    paywallCounter[paywallCounter]
    pennyscrapedproduct_text[pennyscrapedproduct_text]
    pennyscrapedproducts[pennyscrapedproducts]
    processedRatingEvents[processedRatingEvents]
    productRatings[productRatings]
    produkte[produkte]
    produkteerfassung[produkteerfassung]
    produkteerfassungBulgaria[produkteerfassungBulgaria]
    produktvorschlaege[produktvorschlaege]
    scraped_products[scraped_products]
    userFeedbacks[userFeedbacks]
    users[users]
    users --> searchHistory[searchHistory]
    vetnummern[vetnummern]
    vetnummernat[vetnummernat]
```

## 💡 Usage Examples

### Reading Data
```typescript
import { collection, getDocs } from 'firebase/firestore';

// Get all abopreise
const abopreiseSnapshot = await getDocs(collection(db, 'abopreise'));
const abopreiseData = abopreiseSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

// Get all aldiscrapedproducts
const aldiscrapedproductsSnapshot = await getDocs(collection(db, 'aldiscrapedproducts'));
const aldiscrapedproductsData = aldiscrapedproductsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

// Get all appSettings
const appSettingsSnapshot = await getDocs(collection(db, 'appSettings'));
const appSettingsData = appSettingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

```

### Writing Data
```typescript
import { doc, setDoc, addDoc } from 'firebase/firestore';

// Add new document
const docRef = await addDoc(collection(db, 'abopreise'), {
  // Your data here
});

```

---

*Generated by MarkenDetektive Database Schema Analyzer*
*Last updated: 10.8.2025, 14:41:03*

