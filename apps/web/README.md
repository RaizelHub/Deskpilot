# DeskPilot web

React/TypeScript SPA. From the repository root: `npm ci`, then `npm start`. The Laravel API must run on port 8000; Vite proxies `/api` to it. Both should use the same browser origin through the proxy. `API_PROXY_TARGET` can override the API's internal address.

`npm run build`, `npm run typecheck`, `npm run lint`, and `npm test` run from the root. Authentication state lives in TanStack Query; cookies stay with the browser. Zustand persists only the theme preference. Local UI primitives in `src/components/ui` follow the shadcn/Radix pattern and are configured in `components.json`.

Pages are split by feature and protected by the current permission set. Backend checks remain authoritative. See the root README for setup, screenshots and feature status.
