#!/usr/bin/env bash
set -euo pipefail

install_dir="${1:?Usage: install-native-minio.sh INSTALL_DIRECTORY}"
if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "Pinned CI MinIO tools only support Linux x86_64." >&2
  exit 2
fi

minio_release="minio.RELEASE.2025-09-07T16-13-09Z"
mc_release="mc.RELEASE.2025-08-13T08-35-41Z"
minio_base="https://dl.min.io/server/minio/release/linux-amd64/archive"
mc_base="https://dl.min.io/client/mc/release/linux-amd64/archive"

mkdir -p "${install_dir}"
curl --fail --location --retry 3 --silent --show-error \
  --output "${install_dir}/${minio_release}" \
  "${minio_base}/${minio_release}"
curl --fail --location --retry 3 --silent --show-error \
  --output "${install_dir}/${minio_release}.sha256sum" \
  "${minio_base}/${minio_release}.sha256sum"
curl --fail --location --retry 3 --silent --show-error \
  --output "${install_dir}/${mc_release}" \
  "${mc_base}/${mc_release}"
curl --fail --location --retry 3 --silent --show-error \
  --output "${install_dir}/${mc_release}.sha256sum" \
  "${mc_base}/${mc_release}.sha256sum"

(
  cd "${install_dir}"
  sha256sum --check "${minio_release}.sha256sum"
  sha256sum --check "${mc_release}.sha256sum"
)

mv "${install_dir}/${minio_release}" "${install_dir}/minio"
mv "${install_dir}/${mc_release}" "${install_dir}/mc"
chmod 0755 "${install_dir}/minio" "${install_dir}/mc"

"${install_dir}/minio" --version
"${install_dir}/mc" --version
