export const MOVILIDAD_LAYERS = ['trolebus', 'cablebus', 'tren_ligero'];

function normalizeMobilityKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function matchesMobilityToken(candidate, token) {
  if (!candidate) return false;
  const compactCandidate = candidate.replace(/_/g, '');
  const compactToken = token.replace(/_/g, '');
  return candidate.includes(token) || compactCandidate.includes(compactToken);
}

function collectLayerCandidates(layerOrValue, extraValues = []) {
  const candidates = [];

  if (typeof layerOrValue === 'string') {
    candidates.push(layerOrValue);
  } else if (layerOrValue && typeof layerOrValue === 'object') {
    candidates.push(
      layerOrValue.id,
      layerOrValue.name,
      layerOrValue.databaseTable,
      layerOrValue.databaseDisplayName,
      layerOrValue.databaseMetadata?.table_name
    );
  }

  candidates.push(...extraValues);

  return candidates
    .map(normalizeMobilityKey)
    .filter(Boolean);
}

export function isPointGeometryType(geometryType) {
  return geometryType === 'Point' || geometryType === 'MultiPoint';
}

export function isMovilidadLayer(layerOrValue, ...extraValues) {
  const normalizedCandidates = collectLayerCandidates(layerOrValue, extraValues);

  return normalizedCandidates.some((candidate) =>
    MOVILIDAD_LAYERS.some((token) => matchesMobilityToken(candidate, token))
  );
}

export function resolveMovilidadLayerId(layerOrValue, ...extraValues) {
  const normalizedCandidates = collectLayerCandidates(layerOrValue, extraValues);
  for (const candidate of normalizedCandidates) {
    for (const token of MOVILIDAD_LAYERS) {
      if (matchesMobilityToken(candidate, token)) {
        return token;
      }
    }
  }
  return null;
}

export function shouldCountFeature(feature, layerOrValue, ...extraValues) {
  const isMovilidad = isMovilidadLayer(layerOrValue, ...extraValues);
  const isPoint = isPointGeometryType(feature?.geometry?.type);

  if (isMovilidad && isPoint) {
    return false;
  }

  return true;
}

export function resolveFeatureVisualType(feature) {
  return isPointGeometryType(feature?.geometry?.type) ? 'estacion' : 'linea';
}
