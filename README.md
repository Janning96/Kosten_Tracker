
# Kosten-Kalkulation (PWA, offline)
**Diese Version enthält:**
- Verbesserte **Auto-Erkennung** (N26 vs. Barclays) mit harten N26-Treffern + Scoring.
- **N26-Parser** als Tabellen/State-Machine: scannt die komplette PDF, verarbeitet Hauptkonto + alle Spaces.
- **Ignore-Regeln**: N26-Beschreibung enthält „Barclays“ ⇒ ignorieren. Barclays „Gutschrift Manuelle Lastschrift“ ⇒ ignorieren.
- Excel-/PDF-Exporte, Dedupe, Kategorien, Charts, Offline (IndexedDB).

> Hinweis: Scans (Bild-PDF) benötigen OCR (z. B. Tesseract.js). Diese Version erwartet Text-PDF.
