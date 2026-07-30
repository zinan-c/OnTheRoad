# Vendored SheetJS

This directory contains the minimal runtime files extracted without modification from the official `xlsx-0.20.3.tgz` approved for Task A10.

- Tarball: `/private/tmp/xlsx-0.20.3.tgz` at acquisition time
- Tarball SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- Version: `0.20.3`
- Upstream license: Apache-2.0 (`xlsx/LICENSE`)

Vendored runtime file hashes:

| File | SHA-256 |
|---|---|
| `xlsx/xlsx.mjs` | `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db` |
| `xlsx/dist/cpexcel.full.mjs` | `7a7bba23b6b6f23b5c69fbb631f78d1d455f74b57e4aa54e9a2f81a8ab844964` |
| `xlsx/LICENSE` | `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64` |
| `xlsx/package.json` | `bb9458277a69b41a304a89e45f19173ac0d23f2fc296091db49dba3c8b61c546` |

The Spike imports these files by relative path and does not modify the root workspace or require network access.
