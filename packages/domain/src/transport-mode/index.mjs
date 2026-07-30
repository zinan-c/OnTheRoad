export const TRANSPORT_MODE_LINE_STYLES = Object.freeze([
  "solid",
  "dashed",
  "dotted",
  "arc",
]);

export class TransportModeDomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   * @param {string} [field]
   */
  constructor(code, message, status = 400, field) {
    super(message);
    this.name = "TransportModeDomainError";
    this.code = code;
    this.status = status;
    if (field) this.field = field;
  }
}

/** @param {string} field @param {string} message @returns {never} */
function invalid(field, message) {
  throw new TransportModeDomainError(
    "TRANSPORT_MODE_INVALID",
    message,
    400,
    field,
  );
}

/** @param {unknown} value */
export function normalizeTransportModeCode(value) {
  if (typeof value !== "string") invalid("code", "code must be a string");
  const code = value.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(code)) {
    invalid("code", "code must contain 2-64 uppercase letters, digits or underscores");
  }
  return code;
}

/** @param {unknown} value @param {string} field @param {number} maximum */
function requiredText(value, field, maximum) {
  if (typeof value !== "string") invalid(field, `${field} must be a string`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximum) {
    invalid(field, `${field} must contain 1-${maximum} characters`);
  }
  return normalized;
}

/** @param {unknown} value */
function normalizeIcon(value) {
  const icon = requiredText(value, "icon", 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(icon)) {
    invalid("icon", "icon must be a registered kebab-case icon key");
  }
  return icon;
}

/** @param {unknown} value */
function normalizeColor(value) {
  if (typeof value !== "string") invalid("color", "color must be a string");
  const color = value.trim().toUpperCase();
  if (!/^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/u.test(color)) {
    invalid("color", "color must be #RRGGBB or #RRGGBBAA");
  }
  return color;
}

/** @param {unknown} value */
function normalizeLineStyle(value) {
  if (typeof value !== "string") {
    invalid("lineStyle", "lineStyle must be a string");
  }
  if (!TRANSPORT_MODE_LINE_STYLES.includes(value)) {
    invalid("lineStyle", "lineStyle must be solid, dashed, dotted or arc");
  }
  return value;
}

/** @param {unknown} input */
export function normalizeTransportModeCreate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("input", "transport mode input must be an object");
  }
  const candidate = /** @type {Record<string, unknown>} */ (input);
  return Object.freeze({
    code: normalizeTransportModeCode(candidate.code),
    label: requiredText(candidate.label, "label", 80),
    icon: normalizeIcon(candidate.icon),
    color: normalizeColor(candidate.color),
    lineStyle: normalizeLineStyle(candidate.lineStyle),
  });
}

/** @param {unknown} input */
export function normalizeTransportModePatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("input", "transport mode patch must be an object");
  }
  const candidate = /** @type {Record<string, unknown>} */ (input);
  if ("code" in candidate) {
    throw new TransportModeDomainError(
      "TRANSPORT_MODE_CODE_IMMUTABLE",
      "Transport mode code cannot change after creation.",
      409,
      "code",
    );
  }
  /** @type {Record<string, string>} */
  const patch = {};
  if ("label" in candidate) patch.label = requiredText(candidate.label, "label", 80);
  if ("icon" in candidate) patch.icon = normalizeIcon(candidate.icon);
  if ("color" in candidate) patch.color = normalizeColor(candidate.color);
  if ("lineStyle" in candidate) {
    patch.lineStyle = normalizeLineStyle(candidate.lineStyle);
  }
  if (Object.keys(patch).length === 0) {
    invalid("input", "transport mode patch has no editable fields");
  }
  return Object.freeze(patch);
}

/** @param {unknown} value */
export function assertTransportModeVersion(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalid("expectedVersion", "expectedVersion must be a positive integer");
  }
  return value;
}

/**
 * @param {{code: string, label: string, icon: string, color: string, lineStyle: string}} mode
 * @param {boolean} [referenced]
 */
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
