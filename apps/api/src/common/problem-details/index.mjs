const DEFAULT_TYPE_BASE = "https://ontheroad.app/problems";

/**
 * @typedef {{ field: string, message: string }} FieldError
 * @typedef {{
 *   status: number,
 *   code: string,
 *   title: string,
 *   detail?: string,
 *   errors?: FieldError[],
 *   type?: string,
 *   instance?: string
 * }} ProblemDetailsErrorOptions
 */

export class ProblemDetailsError extends Error {
  /** @param {ProblemDetailsErrorOptions} options */
  constructor({ status, code, title, detail, errors = [], type, instance }) {
    super(title);
    this.name = "ProblemDetailsError";
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail;
    this.errors = errors;
    this.type = type;
    this.instance = instance;
  }
}

/** @param {string} code */
function problemType(code) {
  return `${DEFAULT_TYPE_BASE}/${code.toLowerCase().replaceAll("_", "-")}`;
}

/**
 * @param {unknown} error
 * @param {string} traceId
 */
export function toProblemDetails(error, traceId) {
  if (error instanceof ProblemDetailsError) {
    return {
      type: error.type ?? problemType(error.code),
      title: error.title,
      status: error.status,
      code: error.code,
      ...(error.detail ? { detail: error.detail } : {}),
      ...(error.instance ? { instance: error.instance } : {}),
      traceId,
      errors: error.errors,
    };
  }

  return {
    type: problemType("INTERNAL_ERROR"),
    title: "Internal server error",
    status: 500,
    code: "INTERNAL_ERROR",
    detail: "An unexpected error occurred.",
    traceId,
    errors: [],
  };
}
