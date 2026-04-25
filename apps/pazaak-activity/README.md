# pazaak-activity

Discord Embedded App Activity for the Pazaak Bot. Runs inside a Discord Activity iframe using the
[@discord/embedded-app-sdk](https://github.com/discord/embedded-app-sdk), and talks to the
embedded HTTP/WebSocket server that runs inside the `pazaak-bot` process.

## Stack

- Vite 8 + React 19 + TypeScript
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- `@discord/embedded-app-sdk` for OAuth2 and Activity lifecycle

## Development

```bash
# From repo root — starts the Vite dev server on http://localhost:5173
pnpm dev:pazaak-activity
```

The dev server proxies `/api` and `/ws` to `http://localhost:4001`, which is the embedded API
server inside the running `pazaak-bot` process. Start the bot first:

```bash
pnpm --filter @openkotor/pazaak-bot dev
```

## Environment

Create `.env` (copy `.env.example`) and fill in:

```env
VITE_DISCORD_CLIENT_ID=<your Discord application ID>
```

## Build

```bash
pnpm --filter pazaak-activity build
```

Deploy `dist/` to any static host. In production the Activity URL must be registered in the
Discord Developer Portal (Activities → URL Mappings) and the bot's `PAZAAK_ACTIVITY_URL` env var
must point to the public URL.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
