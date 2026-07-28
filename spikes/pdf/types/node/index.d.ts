declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: { write(value: string): void };
};

declare namespace NodeJS {
  type Timeout = ReturnType<typeof setTimeout>;
}

declare module "node:child_process" {
  export function execFile(
    file: string,
    args: readonly string[],
    callback: (...args: any[]) => void,
  ): void;
}

declare module "node:crypto" {
  export function createHash(algorithm: string): any;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
}

declare module "node:module" {
  export function createRequire(url: string): (specifier: string) => any;
}

declare module "node:fs/promises" {
  export const access: any;
  export const mkdir: any;
  export const readFile: any;
  export const rm: any;
  export const writeFile: any;
}

declare module "node:path" {
  const path: any;
  export default path;
}

declare module "node:util" {
  export function promisify<T extends (...args: any[]) => any>(value: T): any;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}
