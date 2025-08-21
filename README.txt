# Finance Import App — PDF-only v3 (GitHub Pages)

Optimiert für deine August-PDFs:
- **N26 (deutsch):** Zeilen „Wertstellung <Datum><Datum> ±Betrag€“ (ohne Leerzeichen zwischen den Datumswerten möglich). Das **zweite Datum** wird als Verbuchungsdatum verwendet.
- **Barclays (DE):** „Umsatzübersicht“-Zeilen mit **Betrag und Nachzeichen am Zeilenende** (z. B. `23,11-`).

## Nutzung
1) `docs/` ins Repo (Branch `main`) kopieren.
2) GitHub → Settings → Pages → Source: `main` / `/docs`.
3) Web-App öffnen und PDFs importieren.

## Regeln
- Barclays: Ignoriere „Gutschrift Manuelle Lastschrift“.
- N26: Ignoriere Positionen, deren Beschreibung „Barclays“ enthält.
- Händlernamen werden normalisiert; du kannst sie in der Tabelle überschreiben.
