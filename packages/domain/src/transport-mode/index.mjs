// @ts-nocheck
export const TRANSPORT_MODE_LINE_STYLES = Object.freeze([
  "solid",
  "dashed",
  "dotted",
  "arc",
]);

export class TransportModeDomainError extends Error {
  constructor(code, message, status = 400, field) {
    super(message);
    this.name = "TransportModeDomainError";
    this.code = code;
    this.status = status;
    if (field) this.field = field;
  }
}

function invalid(field, message) {
  throw new TransportModeDomainError(
    "TRANSPORT_MODE_INVALID",
    message,
    400,
    field,
  );
}

export function normalizeTransportModeCode(value) {
  if (typeof value !== "string") invalid("code", "code must be a string");
  const code = value.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(code)) {
    invalid("code", "code must contain 2-64 uppercase letters, digits or underscores");
  }
  return code;
}

function requiredText(value, field, maximum) {
  if (typeof value !== "string") invalid(field, `${field} must be a string`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximum) {
    invalid(field, `${field} must contain 1-${maximum} characters`);
  }
  return normalized;
}

function normalizeIcon(value) {
  const icon = requiredText(value, "icon", 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(icon)) {
    invalid("icon", "icon must be a registered kebab-case icon key");
  }
  return icon;
}

function normalizeColor(value) {
  if (typeof value !== "string") invalid("color", "color must be a string");
  const color = value.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/u.test(color)) {
    invalid("color", "color must be #RRGGBB or #RRGGBBAA");
  }
  return color;
}

function normalizeLineStyle(value) {
  if (!TRANSPORT_MODE_LINE_STYLES.includes(value)) {
    invalid("lineStyle", "lineStyle must be solid, dashed, dotted or arc");
  }
  return value;
}

export function normalizeTransportModeCreate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("input", "transport mode input must be an object");
  }
  return Object.freeze({
    code: normalizeTransportModeCode(input.code),
    label: requiredText(input.label, "label", 80),
    icon: normalizeIcon(input.icon),
    color: normalizeColor(input.color),
    lineStyle: normalizeLineStyle(input.lineStyle),
  });
}

export function normalizeTransportModePatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("input", "transport mode patch must be an object");
  }
  if ("code" in input) {
    throw new TransportModeDomainError(
      "TRANSPORT_MODE_CODE_IMMUTABLE",
      "Transport mode code cannot change after creation.",
      409,
      "code",
    );
  }
  const patch = {};
  if ("label" in input) patch.label = requiredText(input.label, "label", 80);
  if ("icon" in input) patch.icon = normalizeIcon(input.icon);
  if ("color" in input) patch.color = normalizeColor(input.color);
  if ("lineStyle" in input) {
    patch.lineStyle = normalizeLineStyle(input.lineStyle);
  }
  if (Object.keys(patch).length === 0) {
    invalid("input", "transport mode patch has no editable fields");
  }
  return Object.freeze(patch);
}

export function assertTransportModeVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    invalid("expectedVersion", "expectedVersion must be a positive integer");
  }
  return value;
}

export function systemTransportModeDto(mode, referenced = false) {
  return Object.freeze({
    id: `system:${mode.code}`,
    tripId: null,
    ownerId: null,
    code: mode.code,
    label: mode.label,
    icon: mode.icon,
    color: mode.color,
    lineStyle: mode.lineStyle,
    isSystem: true,
    enabled: true,
    referenced,
    version: 1,
  });
}
