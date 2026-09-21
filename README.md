# Kulkuri

A live map of Helsinki's public transport, built to show off frontend and data-viz skills. Work in progress.

## Idea

HSL's buses, trams and trains moving on the map in real time, with smooth animation instead of a static timetable view. Click a vehicle to see its line, destination and next stops.

## Stack

- Vue 3 + TypeScript + Vite
- [MapLibre GL JS](https://maplibre.org/) for the map (open source, no API key)
- [OpenFreeMap](https://openfreemap.org/) for map tiles (free, no API key)
- [HSL High-Frequency Positioning (HFP)](https://digitransit.fi/en/developers/apis/5-realtime-api/vehicle-positions/high-frequency-positioning/) over MQTT for live vehicle positions (free, no API key)
- [Digitransit](https://digitransit.fi/en/developers/) HSL routing API for line/stop details (needs a free subscription key, see `.env.example`)

## Status

- [x] Project scaffold
- [x] Map centered on Helsinki
- [x] Live vehicle positions
- [ ] Vehicle detail on click
- [ ] Route animation

## Install the dependencies

```bash
npm install
```

Copy `.env.example` to `.env` and add your own Digitransit subscription key (only needed for the vehicle-detail feature, not for the live map itself).

### Start the app in development mode

```bash
npm run dev
```

### Build for production

```bash
npm run build
```
