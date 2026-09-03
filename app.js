import { app, errorHandler } from 'mu';
import { countAnnotations, getAnnotations } from './lib/annotation.js';
import { toExportEntries } from './lib/export.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './config.js';

/**
 * Export codelist mapping annotations and their reviews.
 *
 * Query parameters:
 *   since (optional)          - ISO 8601 datetime. Only annotations created or
 *                               modified at or after this moment are included
 *                               in the export. When omitted, everything is.
 *   minApproved (optional)    - only annotations with at least this many
 *                               approving reviews. Defaults to 0.
 *   minRejected (optional)    - only annotations with at least this many
 *                               rejecting reviews. Defaults to 0.
 *   minCorrections (optional) - only annotations with at least this many
 *                               corrections. Defaults to 0.
 *   page (optional)           - zero-based page number. Defaults to 0.
 *   size (optional)           - number of annotations per page. Defaults to
 *                               the PAGE_SIZE environment variable, capped at
 *                               MAX_PAGE_SIZE.
 *
 */
app.get('/export', async function (req, res, next) {
  try {
    const filters = {
      since: parseSince(req.query.since), // null means: export everything
      minApproved: parseMinimum('minApproved', req.query.minApproved),
      minRejected: parseMinimum('minRejected', req.query.minRejected),
      minCorrections: parseMinimum('minCorrections', req.query.minCorrections),
    };
    const page = parsePage(req.query.page);
    const size = parseSize(req.query.size);

    const [annotations, total] = await Promise.all([
      getAnnotations(filters, { page, size }),
      countAnnotations(filters),
    ]);

    res.status(200).json({
      data: toExportEntries(annotations),
      meta: {
        count: annotations.length,
        total,
        page,
        size,
        pages: Math.ceil(total / size),
      },
      links: buildPageLinks(req, { page, size, total }),
    });
  } catch (e) {
    if (e instanceof InvalidParameterError) {
      res.status(400).json({
        errors: [{ status: '400', title: e.message }]
      });
    } else {
      next(e);
    }
  }
});

class InvalidParameterError extends Error {}

/**
 * Validates and parses the optional `since` query parameter.
 *
 * @param {string|string[]|undefined} value the raw query parameter
 * @returns {Date|null} the parsed datetime, or null if it was not provided
 * @throws {InvalidParameterError} if the parameter is present but unparseable
 */
function parseSince(value) {
  if (value === undefined || value === '') {
    return null;
  }

  if (Array.isArray(value)) {
    throw new InvalidParameterError(
      "Query parameter 'since' may only be provided once."
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidParameterError(
      `Invalid value for query parameter 'since': '${value}'. Expected an ISO 8601 datetime, e.g. 2026-06-30T15:15:00.000Z`
    );
  }

  return date;
}

/**
 * Validates and parses the optional `page` query parameter.
 *
 * @param {string|string[]|undefined} value the raw query parameter
 * @returns {number} the zero-based page number, 0 if it was not provided
 * @throws {InvalidParameterError} if the parameter is not a non-negative integer
 */
function parsePage(value) {
  if (value === undefined || value === '') {
    return 0;
  }

  const page = parseIntegerParameter('page', value);
  if (page < 0) {
    throw new InvalidParameterError(
      `Invalid value for query parameter 'page': '${value}'. Expected a non-negative integer.`
    );
  }

  return page;
}

/**
 * Validates and parses the optional `size` query parameter.
 *
 * @param {string|string[]|undefined} value the raw query parameter
 * @returns {number} the page size, defaulting to PAGE_SIZE
 * @throws {InvalidParameterError} if the parameter is not an integer between 1
 *                                 and MAX_PAGE_SIZE
 */
function parseSize(value) {
  if (value === undefined || value === '') {
    return DEFAULT_PAGE_SIZE;
  }

  const size = parseIntegerParameter('size', value);
  if (size < 1 || size > MAX_PAGE_SIZE) {
    throw new InvalidParameterError(
      `Invalid value for query parameter 'size': '${value}'. Expected an integer between 1 and ${MAX_PAGE_SIZE}.`
    );
  }

  return size;
}

/**
 * Validates and parses one of the optional review minimums.
 *
 * @param {string} name the parameter name
 * @param {string|string[]|undefined} value the raw query parameter
 * @returns {number} the minimum, 0 if it was not provided
 * @throws {InvalidParameterError} if the value is not a non-negative integer
 */
function parseMinimum(name, value) {
  if (value === undefined || value === '') {
    return 0;
  }

  const minimum = parseIntegerParameter(name, value);
  if (minimum < 0) {
    throw new InvalidParameterError(
      `Invalid value for query parameter '${name}': '${value}'. Expected a non-negative integer.`
    );
  }

  return minimum;
}

/**
 * Parses a query parameter that must hold a single integer.
 *
 * @param {string} name the parameter name, used in the error message
 * @param {string|string[]} value the raw query parameter
 * @returns {number}
 * @throws {InvalidParameterError} if the value is repeated or not an integer
 */
function parseIntegerParameter(name, value) {
  if (Array.isArray(value)) {
    throw new InvalidParameterError(
      `Query parameter '${name}' may only be provided once.`
    );
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidParameterError(
      `Invalid value for query parameter '${name}': '${value}'. Expected an integer.`
    );
  }

  return parsed;
}

/**
 * Builds the self/next/prev links for a page of results.
 *
 * @param {object} req the incoming request, used for the base path and params
 * @param {{page: number, size: number, total: number}} paging
 * @returns {{self: string, next: string|null, prev: string|null}}
 */
const FILTER_PARAMETERS = [
  'since',
  'minApproved',
  'minRejected',
  'minCorrections',
];

function buildPageLinks(req, { page, size, total }) {
  const linkTo = (targetPage) => {
    const params = new URLSearchParams();
    for (const name of FILTER_PARAMETERS) {
      if (req.query[name]) {
        params.set(name, req.query[name]);
      }
    }
    params.set('page', targetPage);
    params.set('size', size);
    return `${req.path}?${params}`;
  };

  const hasNext = (page + 1) * size < total;

  return {
    self: linkTo(page),
    next: hasNext ? linkTo(page + 1) : null,
    prev: page > 0 ? linkTo(page - 1) : null,
  };
}

app.use(errorHandler);
