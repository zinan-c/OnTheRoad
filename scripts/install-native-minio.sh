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
minio_github_base="https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z"
mc_github_base="https://github.com/minio/mc/releases/download/RELEASE.2025-08-13T08-35-41Z"

download() {
  local destination="$1"
  shift
  local url temporary="${destination}.part"
  for url in "$@"; do
    rm -f "${temporary}"
    if curl --fail --location --retry 5 --retry-all-errors --retry-delay 5 \
      --connect-timeout 15 --max-time 300 --silent --show-error \
      --output "${temporary}" "${url}"; then
      mv "${temporary}" "${destination}"
      return
    fi
    echo "Download failed; trying the next official source: ${url}" >&2
  done
  rm -f "${temporary}"
  echo "All official download sources failed for $(basename -- "${destination}")." >&2
  return 1
}

verify_checksum() {
  local binary="$1"
  local checksum_file="$2"
  local expected
  expected="$(awk 'NR == 1 { print $1 }' "${checksum_file}")"
  if [[ ! "${expected}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "Invalid SHA256 file for $(basename -- "${binary}")." >&2
    return 1
  fi
  printf '%s  %s\n' "${expected}" "${binary}" | sha256sum --check -
}

mkdir -p "${install_dir}"
download "${install_dir}/${minio_release}" \
  "${minio_base}/${minio_release}" \
  "${minio_github_base}/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z"
download "${install_dir}/${minio_release}.sha256sum" \
  "${minio_base}/${minio_release}.sha256sum" \
  "${minio_github_base}/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z.sha256sum"
download "${install_dir}/${mc_release}" \
  "${mc_base}/${mc_release}" \
  "${mc_github_base}/mc.linux-amd64.RELEASE.2025-08-13T08-35-41Z"
download "${install_dir}/${mc_release}.sha256sum" \
  "${mc_base}/${mc_release}.sha256sum" \
  "${mc_github_base}/mc.linux-amd64.RELEASE.2025-08-13T08-35-41Z.sha256sum"

verify_checksum \
  "${install_dir}/${minio_release}" \
  "${install_dir}/${minio_release}.sha256sum"
verify_checksum \
  "${install_dir}/${mc_release}" \
  "${install_dir}/${mc_release}.sha256sum"

mv "${install_dir}/${minio_release}" "${install_dir}/minio"
mv "${install_dir}/${mc_release}" "${install_dir}/mc"
chmod 0755 "${install_dir}/minio" "${install_dir}/mc"

"${install_dir}/minio" --version
"${install_dir}/mc" --version
