// The Vite variables the web app reads (dot access, so Vite replaces them statically).
interface ImportMetaEnv {
  readonly VITE_PSEUDO_LOCALES?: string;
  readonly VITE_BUILD_NUMBER: string;
}
