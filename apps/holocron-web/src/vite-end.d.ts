/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRASK_API_BASE?: string
  readonly VITE_TRASK_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const GITHUB_RUNTIME_PERMANENT_NAME: string
declare const BASE_KV_SERVICE_URL: string
