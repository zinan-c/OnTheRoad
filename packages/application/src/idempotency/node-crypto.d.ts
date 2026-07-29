declare module "node:crypto" {
  type Hash = {
    update(value: string): Hash;
    digest(encoding: "hex"): string;
  };

  export function createHash(algorithm: "sha256"): Hash;
}
