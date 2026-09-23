# Kulkuri

A live map of Helsinki's public transport, built to show off frontend and data-viz skills.

**Live at [kulkuri.kekola.fi](https://kulkuri.kekola.fi).**

## Idea

HSL's buses, trams, metros, trains and ferries moving on the map in real time, with smooth
animation instead of a static timetable view. Click a vehicle for its line, destination and
speed; click a stop for its next departures. Vehicles wake onto the map one at a time on load
("Herääminen") instead of all popping in at once - the same effect replays on a theme switch.

## Features

- Live vehicle positions over HSL's HFP feed, interpolated between updates so they glide
  instead of snapping between fixes
- Click a vehicle or stop for a map-anchored detail card that tracks it as it moves or the
  map pans/zooms
- Search and browse lines - including ones with no vehicle running right now
- Favorite lines and stops in an "Omat" tab; nearby stop markers with upcoming departures
- Dark and light themes, each with its own retinted basemap
- Mobile layout: the sidebar becomes a bottom sheet
- Coupled train/metro units (two physical vehicles sharing one scheduled trip) collapse into
  a single marker instead of showing as two overlapping dots

## Stack

- Vue 3 + TypeScript + Vite
- [MapLibre GL JS](https://maplibre.org/) for the map (open source, no API key)
- [OpenFreeMap](https://openfreemap.org/) for map tiles (free, no API key)
- [HSL High-Frequency Positioning (HFP)](https://digitransit.fi/en/developers/apis/5-realtime-api/vehicle-positions/high-frequency-positioning/) over MQTT for live vehicle positions (free, no API key)
- [Digitransit](https://digitransit.fi/en/developers/) HSL routing API for line/stop details and route shapes (needs a free subscription key, see `.env.example`)
- [Overpass](https://fonts.google.com/specimen/Overpass), [Schibsted Grotesk](https://fonts.google.com/specimen/Schibsted+Grotesk) and [Martian Mono](https://fonts.google.com/specimen/Martian+Mono) via Fontsource

## Install the dependencies

```bash
npm install
```

Copy `.env.example` to `.env` and add your own Digitransit subscription key (only needed for
line/stop details and route shapes, not for the live map itself).

### Start the app in development mode

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

## Credits

Stop icons (bus, tram, metro, train, ferry) are built from [Font Awesome Free](https://fontawesome.com/) solid icons, licensed under [CC BY 4.0](https://fontawesome.com/license/free).
