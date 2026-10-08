# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Tests

Vitest, configured inside `vite.config.js` (`test.include`: `src/**/*.test.js`).
Test files sit next to the code they test, as in the backend, and assert with
`node:assert/strict`, so both suites read the same way.

```bash
npm ci
npm test           # vitest run: no watch, for CI and for verifying a change
npm run test:watch # vitest, watching
npx vitest run src/utils/format.test.js   # a single file
```

Tested: `src/utils/format.js`, `src/lib/portalText.js`, `src/lib/roleEditing.js`,
`src/lib/writeFeedback.js`, `src/lib/plate.js`, `buildPermissions`
(`src/lib/useCan.js`), `buildRails` (`src/lib/useRoster.js`), the URL helpers of
`src/lib/useSurface.js`, and `safeLoginUrl` / `startDiscordLogin` in `src/api.js`.

Pure helpers only: the environment is `node`, with no jsdom and no component
rendering — nothing in `src/components/` is tested, and hooks are covered only
through the pure functions they call. Vitest globals stay off, so each test
imports `test` from `vitest`; that keeps `eslint.config.js` unchanged.
