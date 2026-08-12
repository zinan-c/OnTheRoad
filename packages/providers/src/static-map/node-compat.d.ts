declare module "node:crypto" {
  type Hash = {
    update(value: Uint8Array): Hash;
    digest(encoding: "hex"): string;
  };

  export function createHash(algorithm: "sha256"): Hash;
}

declare module "node:zlib" {
  export function deflateSync(value: Uint8Array): Uint8Array;
}
