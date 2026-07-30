declare const Buffer: {
  alloc(size: number): any;
  concat(values: readonly any[]): any;
  from(value: string | Uint8Array | readonly number[], encoding?: string): any;
};
type Buffer = any;

declare module "node:child_process" {
  export const execFile: any;
}

declare module "node:crypto" {
  export const createHash: any;
  export const randomUUID: () => string;
}

declare module "node:fs/promises" {
  export const mkdtemp: any;
  export const readFile: any;
  export const rm: any;
  export const writeFile: any;
}

declare module "node:net" {
  export const createConnection: any;
}

declare module "node:os" {
  export const tmpdir: () => string;
}

declare module "node:path" {
  export const join: (...parts: string[]) => string;
}

declare module "node:util" {
  export const promisify: any;
}

declare module "node:worker_threads" {
  export const parentPort: any;
  export const workerData: any;
  export class Worker {
    constructor(filename: URL, options?: any);
    once(event: string, listener: (...arguments_: any[]) => void): this;
    terminate(): Promise<number>;
  }
}
