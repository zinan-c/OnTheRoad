import type { LocationCandidate } from "./api.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderCandidateList(
  candidates: LocationCandidate[],
  selectedCandidateId: string | null,
): string {
  if (candidates.length === 0) return "";
  const options = candidates.map((candidate) => {
    const context = [
      candidate.city,
      candidate.district,
      candidate.countryCode,
    ].filter(Boolean).join(" · ");
    return `<label><input type="radio" name="location-candidate" value="${escapeHtml(candidate.candidateId)}"${candidate.candidateId === selectedCandidateId ? " checked" : ""}><strong>${escapeHtml(candidate.label)}</strong><span>${escapeHtml(candidate.formattedAddress)}</span><span>${escapeHtml(context)}</span><small>来源：${escapeHtml(candidate.attribution)}</small></label>`;
  }).join("");
  return `<fieldset><legend>请选择地点候选</legend>${options}</fieldset>`;
}
