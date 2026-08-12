declare const process: {
  env: Record<string, string | undefined>;
};

declare const Buffer: {
  alloc(size: number): any;
  from(value: string | Uint8Array, encoding?: string): any;
  concat(values: readonly any[]): any;
};
type Buffer = any;

declare namespace NodeJS {
  type ProcessEnv = Record<string, string | undefined>;
}

declare module "node:child_process" {
  export type ChildProcess = any;
  export const spawn: any;
  export const spawnSync: any;
}

declare module "node:crypto" {
  export const createHash: any;
  export const createHmac: any;
  export const randomUUID: () => string;
  export const timingSafeEqual: any;
}

declare module "node:dns/promises" {
  export const lookup: any;
}

declare module "node:fs/promises" {
  export const mkdir: any;
  export const mkdtemp: any;
  export const rm: any;
}

declare module "node:net" {
  export const createServer: any;
}

declare module "node:os" {
  export const tmpdir: () => string;
}

declare module "node:path" {
  export const join: (...parts: string[]) => string;
}
