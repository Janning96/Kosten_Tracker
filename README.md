
# Kosten-Kalkulation (PWA, offline)
**Änderungen in dieser Version**
- N26-Import: Transaktionen werden ignoriert, wenn die Beschreibung **„Barclays“** enthält.
- Barclays-Import: Transaktionen mit **„Gutschrift Manuelle Lastschrift“** werden ignoriert.

**Features**
- PDF-Import für **Barclays** & **N26** (ganze PDF, alle Seiten), Auto-Erkennung, Dubletten-Vermeidung
- Cent-genaue Beträge (Integer), kein Float-Fehler (25,50 + 25,50 = 51,00 €)
- Manuelle Einträge (Dialog „Eintrag“), Bearbeiten/Löschen
- Kategorien-Management (alphabetisch, „Undefiniert“ fix; Löschen setzt Einträge auf Undefiniert)
- Filter (Monat, Zeitraum, Quelle, Kategorie)
- Charts: Trend (gestapelt), Balken, Kuchen, Linie je Kategorie
- Excel: eine Master-Datei (Monatsblätter + Zusammenfassung), Zeitraum-Export
- Excel-Import: Zeitraum wählbar (Datumsspalte), Duplikate werden übersprungen
- Analyse-Export als PDF
- Offline-PWA, Daten in IndexedDB (bleiben erhalten)

**Hinweis**
- Scans (Bild-PDF) benötigen OCR – hier nicht aktiv. Bei Bedarf Tesseract.js ergänzen.
