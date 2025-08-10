
# Kosten-Tracker (PWA)
Private PWA, die lokal auf dem iPhone/Browser läuft. Offline-fähig, Daten in IndexedDB.

## Features
- Monatsansicht mit Summe je Kategorie
- Gestapeltes Balkendiagramm (Kategorien über Monate)
- Kategorien verwalten
- Euro-Format (de-DE), Eingabe per Komma
- Export/Import (JSON)
- PWA: Installierbar auf iPhone (Safari → Teilen → Zum Home-Bildschirm)

## Dev
- Statische Seite: kein Backend nötig
- Einfach mit GitHub Pages, Vercel oder Netlify deployen

## Lokale Entwicklung
- Beliebigen Static Server starten (z. B. VS Code Live Server). 
  Service Worker greift nur über HTTP(S), nicht über file://.
