# plz.json — Postleitzahl → Koordinate (DE + AT)

Abgeleitet aus den GeoNames-Postleitzahlen-Dateien
(`https://download.geonames.org/export/zip/DE.zip` und `AT.zip`, CC BY 4.0),
Stand 07.09.2026. 13.314 Einträge.

Aufbau: `"<LAND>:<PLZ>": [lat, lon, ortsname, bundesland]`. Bei Postleitzahlen
mit mehreren Einträgen (Großkunden-Postfächer tragen dort Firmennamen statt
Ortsnamen) ist die Koordinate der Mittelwert und der Ortsname der häufigste.

**Gemessene Güte an den eigenen Daten** (120 Einreichungen, bei denen sowohl
ein präziser GPS-Fix als auch eine Bon-Adresse vorlag): der Abstand zwischen
Zentroid und echtem Aufnahmeort liegt im Median bei 2,0 km, im 90. Perzentil
bei 7,8 km, maximal bei 19,2 km. Abdeckung der real vorkommenden Bon-
Postleitzahlen: 5.383 von 5.419 (99,3 %).

Neu erzeugen: die beiden Dateien laden, entpacken und je Postleitzahl
mitteln — das Skript steht in der Commit-Nachricht, die diese Datei einführt.
