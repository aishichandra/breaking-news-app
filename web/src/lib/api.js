// In development Vite serves the app on :5173 while Express runs on :3000, so
// requests need the absolute origin. In production Express serves the built
// app itself, so both share an origin and relative paths work — which is also
// why the deployed app needs no CORS and no API-URL environment variable.
export const API = import.meta.env.DEV ? 'http://localhost:3000' : ''
