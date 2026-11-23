/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom" />

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}
