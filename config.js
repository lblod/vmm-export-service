/**
 * Reads a positive integer from the environment, falling back to a default.
 *
 * @param {string} name the environment variable name
 * @param {number} fallback the value to use when unset
 * @returns {number}
 * @throws {Error} if the variable is set but is not a positive integer
 */
function positiveIntFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `Invalid value for environment variable ${name}: '${raw}'. Expected a positive integer.`
    );
  }

  return value;
}

/** Number of annotations per page when the client does not specify a size. */
export const DEFAULT_PAGE_SIZE = positiveIntFromEnv('PAGE_SIZE', 1000);

/** Upper bound on the page size a client may request. */
export const MAX_PAGE_SIZE = positiveIntFromEnv(
  'MAX_PAGE_SIZE',
  Math.max(DEFAULT_PAGE_SIZE, 5000)
);
