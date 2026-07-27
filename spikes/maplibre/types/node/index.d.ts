declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: { write(value: string): void };
};

declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:fs/promises" {
  export const mkdir: any;
  export const readFile: any;
  export const writeFile: any;
}

declare module "node:http" {
  export const createServer: any;
}

declare module "node:module" {
  type Require = {
    (specifier: string): any;
    resolve(specifier: string): string;
  };
  export function createRequire(url: string): Require;
}

declare module "node:net" {
  export type AddressInfo = {
    address: string;
    family: string;
    port: number;
  };
}

declare module "node:path" {
  const path: any;
  export default path;
}

declare module "node:test" {
  const test: any;
  export default test;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
