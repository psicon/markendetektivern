Erstelle eine Smartphone-App für iOS und Android mit dem Namen „MarkenDetektive“ – eine smarte Einkaufshelfer-App, die Markenprodukte mit ihren günstigeren Handelsmarken-Zwillingen vom gleichen Hersteller vergleicht und das Sparpotenzial anzeigt. Sie sollen die Hersteller dahinter finden und die Produkte direkt mit ihren Marken-Äquivalenten vergleichen können (Zutaten, Nährwerte, Preis), um clever Geld zu sparen. Die App enthält Gamification, Produktbewertungen, Einkaufslisten, Barcode-Scan, prozentuale Inhaltsstoffvergleiche und ein Belohnungssystem. Das UI ist klar, modern und nutzt visuelle Icons. Die Gestaltung soll sich an gängigen Food-Einkaufs-Apps orientieren, damit sich Nutzer schnell wohlfühlen.

🎯 Kernfunktionen der App

1. Produktsuche & Barcode-Scanner
    * Nutzer können Produkte per Barcode scannen oder über eine Suchleiste suchen
    * Treffer zeigt: Produktname, Bild, Hersteller, Preis, Zutaten, Nährwerte
    * Detaillierte Filter nach Markt, Zusammensetzung, Preis, Region, Kategorie uvm.
2. Marken vs. NoName-Vergleich
    * Darstellung von Markenprodukt oben und NoName-Produkte darunter
    * Prozentuale Übereinstimmung bei Zutaten und Nährwerten
    * Preisunterschiede und Ersparnis direkt ersichtlich
    * Auswahl der einzelnen Produkte um zu vergleichen (Tabellenvergleich am Ende der Seite)
    * Farbcodierte Stufenanzeige für Ähnlichkeit (Stufe 1–5)
3. Produktdetail-Ansicht (Bottom Sheet)
    * Herstellerinformationen (Name, Ort, Marke)
    * Zutaten, Nährwerte, Packungsgröße, Scores (Nutri, Eco, Nova)
    * Bewertungen anderer Nutzer
    * Button „Produkt umwandeln“ → fügt NoName zur Einkaufsliste hinzu
4. Einkaufszettel mit Umwandlungsfunktion
    * Zwei Tabs: „Markenprodukte“ und „NoNames“
    * Button „Produkte umwandeln“ schlägt automatisch passende NoNames vor
    * Anzeige des Sparpotenzials in Euro
    * Möglichkeit, Produkte als „gekauft“ zu markieren
5. Gamification & Level-System
    * Nutzer erhalten Punkte für:
        * Umwandlung in NoNames
        * Produktbewertungen
        * App-Aktivität (z. B. tägliche Nutzung)
    * Levelsystem mit Fortschrittsbalken & Belohnungen:
        * Level 1 = Sparanfänger
        * Level 5 = MarkenDetektiv (alle Kategorien freigeschaltet)
6. Bewertungssystem
    * Nutzer können Produkte bewerten (1–5 Sterne)
    * Bewertung nach Geschmack, Preis-Leistung, Inhaltsstoffen und eine Overallbewertung (einzige Pflichtbewertung)
    * Freitext-Kommentarfeld
7. Markt- & Kategorieseiten
    * Übersicht aller Märkte (Aldi, Lidl, Rewe, etc.) mit Produkttotalen
    * Kategorieübersicht (Backwaren, Getränke, Drogerie, etc.)
8. Design-Anforderungen
    * Navigation per Bottom Tab Bar: Home – Stöbern – Mehr
    * Bottom Sheets für Produktdetails
    * Farbschema: Grün/Weiß/Grau mit Icons für Kategorien
    * Icons & Bilder wie in den Screenshots verwendet

    * Firebase Auth (Login mit Apple, Google)
    * RevenueCat integriert mit Paywalls
        * -> In-App-Käufe (Abo-Modell)
    * Cloud Functions (z. B. für Ähnlichkeitsberechnungen)
    * Firestore CRUD für die Daten
    * Algolia für Suche (Kostenersparnis)

*Farbpalette: Integriere die Markenfarben harmonisch:
*Primär: 0d8575
*Sekundär: 42a968
*Verwende im lite mode helle Hintergründe für gute Lesbarkeit. Es muss ebenfalls einen ansprechenden Dark mode geben.
*Icons: Erstelle moderne und vor allem eindeutig verständlicher Icons für alle Funktionen
*Typografie: Wähle eine gut lesbare, moderne Sans-Serif-Schrift.
Kernfeatures, für die ein UI benötigt wird:
*Startseite mit prominenter Suche
*Suchergebnisseite (vergleichend)
*Barcode-Scanner-Ansicht
*Produktdetail-/Vergleichsseite
*Smarter Einkaufszettel (mit einfacher Umwandlung Marke/NoName und dynamischer Spar-Anzeige)
*Kategorien-/Märkte-Browser
Ansprechendes Design, das die Informationsfindung erleichtert und zum Sparen mit Gamification motiviert.
