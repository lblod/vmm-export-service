/**
 * Maps queried annotations onto the export format.
 *
 * @param {Array<object>} annotations annotations as returned by getAnnotations
 * @returns {Array<object>} the export entries
 */
export function toExportEntries(annotations) {
  return annotations.map(toExportEntry);
}

/**
 * Maps a single annotation onto one entry of the export.
 *
 *
 * @param {object} annotation an annotation as returned by getAnnotations
 * @returns {object} the export entry
 */
function toExportEntry(annotation) {
  return {
    vap: {
      actiepunt: toConcept(annotation.annotationBody),
      score: toNumber(annotation.score),
      reviews: toReviews(annotation.reviews),
      created: formatDateTime(annotation.created),
      uri: annotation.uri,
    },
    actie: toActie(annotation.actie),
    actieplan: toComplexWork(annotation.actieplan),
    beleidsdoelstelling: toComplexWork(annotation.beleidsdoelstelling),
    strategischeDoelstelling: toComplexWork(annotation.strategischeDoelstelling),
    bestuur: toBesturen(annotation.bestuur),
    aanlevering: toAanlevering(annotation.aanlevering),
  };
}

/**
 * Maps the organisations that passed the actie onto the export format. An
 * actie can be passed by several, typically the gemeente and the OCMW.
 *
 * NOTE: `inwonersaantal` is in the target format but is not sourced yet.
 */
function toBesturen(besturen = []) {
  return besturen.map((bestuur) => ({
    id: bestuur.id,
    type: bestuur.typeLabel,
    grondgebied: bestuur.grondgebied,
  }));
}

/**
 * Maps the aanlevering the actie is part of onto the export format.
 */
function toAanlevering(aanlevering) {
  if (!aanlevering) {
    return undefined;
  }

  return {
    id: aanlevering.id,
    rapportjaar: toYear(aanlevering.datePublished),
  };
}

/**
 * Maps the annotated eli:Work and its expression onto the export format.
 */
function toActie(actie) {
  if (!actie) {
    return undefined;
  }

  return {
    id: actie.id,
    code: actie.code ?? '',
    externerapporteringscode: actie.externeRapporteringscode ?? '',
    korteOmschrijving: actie.korteOmschrijving,
    langeOmschrijving: actie.langeOmschrijving,
    commentaar: actie.commentaar ?? '',
    evaluatie: actie.evaluatie ?? '',
  };
}

/**
 * Maps one of the eli:ComplexWork levels above the actie onto the export
 * format: actieplan, beleidsdoelstelling and strategischeDoelstelling all
 * share this shape.
 */
function toComplexWork(work) {
  if (!work) {
    return undefined;
  }

  return {
    id: work.id,
    code: work.code ?? '',
    korteOmschrijving: work.korteOmschrijving,
    langeOmschrijving: work.langeOmschrijving,
    commentaar: work.commentaar ?? '',
    evaluatie: work.evaluatie ?? '',
  };
}

/**
 * Maps the reviews of an annotation onto the export format.
 */
function toReviews(reviews) {
  return {
    rejected: reviews?.rejected ?? 0,
    approved: reviews?.approved ?? 0,
    corrections: (reviews?.corrections ?? []).map(toCorrection),
  };
}

/**
 * Maps a correction annotation onto the export format
 */
function toCorrection(correction) {
  return {
    actiepunt: toConcept(correction.annotationBody),
    score: toNumber(correction.score),
    created: formatDateTime(correction.created),
    uri: correction.uri,
  };
}

/**
 * Maps a queried skos:Concept onto the export format.
 *
 * @param {object|undefined} concept the concept as returned by getAnnotations
 * @returns {object|undefined} the mapped concept, or undefined if absent
 */
function toConcept(concept) {
  if (!concept) {
    return undefined;
  }

  return {
    uri: concept.uri,
    id: concept.id,
    naam: [concept.notation, concept.label].filter(Boolean).join(' '),
  };
}

/**
 * Converts a numeric literal to a JSON number. Returns the raw value if it
 * does not parse, rather than emitting null.
 */
function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

/**
 * Reduces a date literal to its year, as the export format wants a bare year
 * string. Accepts a plain year as well as a full date or datetime.
 */
function toYear(value) {
  if (!value) {
    return undefined;
  }

  const year = String(value).match(/^\s*(-?\d{4})/);
  if (year) {
    return year[1];
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : String(date.getUTCFullYear());
}

/**
 * Normalises a datetime from the triplestore to an ISO 8601 string, so the
 * export does not leak Virtuoso's serialisation of xsd:dateTime literals.
 */
function formatDateTime(value) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    // Don't silently drop a value we failed to understand.
    return value;
  }

  return date.toISOString();
}
