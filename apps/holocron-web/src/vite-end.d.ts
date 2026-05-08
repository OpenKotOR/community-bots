/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRASK_API_BASE?: string
  readonly VITE_TRASK_API_KEY?: string
  /** When "1", use the legacy Spark + simulated multi-agent retrieval path. */
  readonly VITE_TRASK_LEGACY_SPARK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const GITHUB_RUNTIME_PERMANENT_NAME: string
declare const BASE_KV_SERVICE_URL: string

/** Opaque prompt handle produced by `llmPrompt` and consumed by `llm`. */
type SparkLlmPrompt = object

interface Window {
  spark: {
    llmPrompt(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): SparkLlmPrompt
    llm(
      prompt: SparkLlmPrompt,
      model: string,
      jsonMode?: boolean
    ): Promise<string>
  }
}