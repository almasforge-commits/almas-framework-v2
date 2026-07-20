/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALMAS_API_URL?: string;
  readonly VITE_ALMAS_API_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?raw" {
  const content: string;
  export default content;
}
