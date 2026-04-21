import L from 'leaflet';
import * as turf from '@turf/turf';
import { API_BASE_URL } from '../../services/gisApi';

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parseNumberLike(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRuntimeConfigValue(key) {
  if (typeof window === 'undefined') return undefined;
  return window.__GIS_CONFIG__?.[key];
}

const POPULATION_NUMERIC_FIELDS = [
  'POBTOT',
  'POBFEM',
  'POBMAS',
  'POB0_14',
  'POB15_64',
  'POB65_MAS',
  'POB60_MAS_F',
  'POB60_MAS_M',
  'POB18_MEN_F',
  'POB18_MEN_M',
  'PSINDER',
  'TOTHOG',
  'HOGJEF_F',
];

const POPULATION_TOTAL_FIELD_CANDIDATES = [
  'POBTOT',
  'pob_total',
  'POB_TOTAL',
  'pobtot',
];

const POPULATION_FEMALE_FIELD_CANDIDATES = ['POBFEM', 'pob_fem', 'POB_FEM'];
const POPULATION_MALE_FIELD_CANDIDATES = ['POBMAS', 'pob_mas', 'POB_MAS'];
const POPULATION_SENIOR_TOTAL_FIELD_CANDIDATES = [
  'POB65_MAS',
  'P_60YMAS',
  'POB60_MAS',
  'POB60YMAS',
];
const POPULATION_SENIOR_FEMALE_FIELD_CANDIDATES = [
  'POB60_MAS_F',
  'POB60YMAS_F',
  'P_60YMAS_F',
  'P60YMAS_F',
  'POB65_MAS_F',
];
const POPULATION_SENIOR_MALE_FIELD_CANDIDATES = [
  'POB60_MAS_M',
  'POB60YMAS_M',
  'P_60YMAS_M',
  'P60YMAS_M',
  'POB65_MAS_M',
];
const POPULATION_MINOR_TOTAL_FIELD_CANDIDATES = [
  'POB18_MEN',
  'POB18MEN',
  'POB0_17',
  'P_0A17',
  'P_18YMEN',
  'POB_MENOR18',
];
const POPULATION_MINOR_FEMALE_FIELD_CANDIDATES = [
  'POB18_MEN_F',
  'POB18MEN_F',
  'POB0_17_F',
  'P_0A17_F',
  'P_18YMEN_F',
  'POB_MENOR18_F',
];
const POPULATION_MINOR_MALE_FIELD_CANDIDATES = [
  'POB18_MEN_M',
  'POB18MEN_M',
  'POB0_17_M',
  'P_0A17_M',
  'P_18YMEN_M',
  'POB_MENOR18_M',
];
const POPULATION_GRID_CELL_SIZE_DEGREES = 0.01;
const POPULATION_INDEX_BUILD_YIELD_EVERY = 350;
const POPULATION_QUERY_YIELD_EVERY = 120;
const REPRESENTATIVE_POINT_CACHE = new WeakMap();
const POPULATION_STRICT_BACKEND = parseBooleanLike(
  getRuntimeConfigValue('POPULATION_STRICT_BACKEND') ??
    process.env.REACT_APP_POPULATION_STRICT_BACKEND,
  false
);
const MAX_POPULATION_RENDER_FEATURES = Math.max(
  0,
  parseNumberLike(
    getRuntimeConfigValue('POPULATION_RENDER_LIMIT') ??
      process.env.REACT_APP_POPULATION_RENDER_LIMIT,
    0
  )
);
const POPULATION_REMOTE_TIMEOUT_MS = Math.max(
  3000,
  parseNumberLike(
    getRuntimeConfigValue('POPULATION_REMOTE_TIMEOUT_MS') ??
      process.env.REACT_APP_POPULATION_REMOTE_TIMEOUT_MS,
    5000
  )
);
const HOTSPOT_ALCALDIA_FIELD_CANDIDATES = [
  'ALCALDIA',
  'alcaldia',
  'ALCALDÍA',
  'alcaldía',
  'DEMARCACION',
  'demarcacion',
  'DEMARCACIÓN',
  'demarcación',
  'MUNICIPIO',
  'municipio',
];
const HOTSPOT_SPEND_FIELD_CANDIDATES = [
  'INDICE_GASTO',
  'indice_gasto',
  'INDICE DE GASTO',
  'indice de gasto',
  'GASTO',
  'gasto',
  'PRESUPUESTO',
  'presupuesto',
  'MONTO',
  'monto',
  'IMPORTE',
  'importe',
  'INVERSION',
  'inversion',
  'INVERSIÓN',
];

function flattenCoordinates(input, bucket = []) {
  if (!Array.isArray(input)) return bucket;

  if (
    input.length >= 2 &&
    typeof input[0] === 'number' &&
    typeof input[1] === 'number'
  ) {
    bucket.push(input);
    return bucket;
  }

  input.forEach((entry) => flattenCoordinates(entry, bucket));
  return bucket;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getPropertyByCandidates(properties, candidates) {
  for (const key of candidates) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;

    const numeric = toNumber(properties[key]);
    if (numeric !== 0 || properties[key] === 0 || properties[key] === '0') {
      return numeric;
    }
  }

  return 0;
}

function getPropertyByCandidatesMeta(properties, candidates) {
  for (const key of candidates) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    return { found: true, value: toNumber(properties[key]) };
  }
  return { found: false, value: 0 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundPopulation(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizePopulationFeature(feature) {
  if (!feature?.geometry) return null;

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: feature.properties || {},
  };
}

function createZeroPopulationTotals() {
  const totals = {};
  POPULATION_NUMERIC_FIELDS.forEach((field) => {
    totals[field] = 0;
  });
  return totals;
}

function computePopulationMetrics(properties = {}) {
  const metrics = createZeroPopulationTotals();
  metrics.POBTOT = getPropertyByCandidates(
    properties,
    POPULATION_TOTAL_FIELD_CANDIDATES
  );
  metrics.POBFEM = getPropertyByCandidates(
    properties,
    POPULATION_FEMALE_FIELD_CANDIDATES
  );
  metrics.POBMAS = getPropertyByCandidates(
    properties,
    POPULATION_MALE_FIELD_CANDIDATES
  );
  metrics.POB0_14 = toNumber(properties.POB0_14);
  metrics.POB15_64 = toNumber(properties.POB15_64);
  metrics.POB65_MAS = toNumber(properties.POB65_MAS);
  metrics.PSINDER = toNumber(properties.PSINDER);
  metrics.TOTHOG = toNumber(properties.TOTHOG);
  metrics.HOGJEF_F = toNumber(properties.HOGJEF_F);

  const safeTotal = metrics.POBTOT > 0 ? metrics.POBTOT : 0;
  const femaleRatio =
    safeTotal > 0 ? clamp(metrics.POBFEM / safeTotal, 0, 1) : 0.5;
  const maleRatio = 1 - femaleRatio;

  const seniorTotalMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_SENIOR_TOTAL_FIELD_CANDIDATES
  );
  const seniorTotal = Math.max(
    0,
    seniorTotalMeta.found ? seniorTotalMeta.value : metrics.POB65_MAS || 0
  );
  const seniorFemaleMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_SENIOR_FEMALE_FIELD_CANDIDATES
  );
  const seniorMaleMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_SENIOR_MALE_FIELD_CANDIDATES
  );

  let seniorFemale = seniorFemaleMeta.value;
  let seniorMale = seniorMaleMeta.value;

  if (!seniorFemaleMeta.found && !seniorMaleMeta.found) {
    seniorFemale = seniorTotal * femaleRatio;
    seniorMale = seniorTotal * maleRatio;
  } else if (!seniorFemaleMeta.found) {
    seniorFemale = Math.max(0, seniorTotal - seniorMale);
  } else if (!seniorMaleMeta.found) {
    seniorMale = Math.max(0, seniorTotal - seniorFemale);
  }

  const minorTotalMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_MINOR_TOTAL_FIELD_CANDIDATES
  );
  const minorTotalEstimated =
    metrics.POB0_14 + metrics.POB15_64 * (3 / 50);
  const minorTotal = clamp(
    minorTotalMeta.found ? minorTotalMeta.value : minorTotalEstimated,
    0,
    safeTotal > 0 ? safeTotal : minorTotalEstimated
  );
  const minorFemaleMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_MINOR_FEMALE_FIELD_CANDIDATES
  );
  const minorMaleMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_MINOR_MALE_FIELD_CANDIDATES
  );

  let minorFemale = minorFemaleMeta.value;
  let minorMale = minorMaleMeta.value;

  if (!minorFemaleMeta.found && !minorMaleMeta.found) {
    minorFemale = minorTotal * femaleRatio;
    minorMale = minorTotal * maleRatio;
  } else if (!minorFemaleMeta.found) {
    minorFemale = Math.max(0, minorTotal - minorMale);
  } else if (!minorMaleMeta.found) {
    minorMale = Math.max(0, minorTotal - minorFemale);
  }

  metrics.POB60_MAS_F = roundPopulation(seniorFemale);
  metrics.POB60_MAS_M = roundPopulation(seniorMale);
  metrics.POB18_MEN_F = roundPopulation(minorFemale);
  metrics.POB18_MEN_M = roundPopulation(minorMale);

  return metrics;
}

function bboxIntersects(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const [leftMinX, leftMinY, leftMaxX, leftMaxY] = left;
  const [rightMinX, rightMinY, rightMaxX, rightMaxY] = right;

  return !(
    leftMaxX < rightMinX ||
    leftMinX > rightMaxX ||
    leftMaxY < rightMinY ||
    leftMinY > rightMaxY
  );
}

function computeGeometryBBox(geometry) {
  if (!geometry) return null;

  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates || [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat, lng, lat];
  }

  const coordinates = flattenCoordinates(geometry.coordinates);
  if (!coordinates.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  coordinates.forEach(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    minX = Math.min(minX, lng);
    minY = Math.min(minY, lat);
    maxX = Math.max(maxX, lng);
    maxY = Math.max(maxY, lat);
  });

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  return [minX, minY, maxX, maxY];
}

function yieldToMainThread() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function requestPopulationFromBackend({
  latlng,
  radiusKm,
  maxRenderFeatures = MAX_POPULATION_RENDER_FEATURES,
}) {
  if (!API_BASE_URL) {
    const error = new Error('API_BASE_URL no disponible.');
    error.permanent = true;
    throw error;
  }

  const params = new URLSearchParams({
    lat: String(latlng.lat),
    lng: String(latlng.lng),
    radiusKm: String(radiusKm),
    maxRenderFeatures: String(maxRenderFeatures),
  });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POPULATION_REMOTE_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${API_BASE_URL}/population/query?${params.toString()}`,
        {
          cache: 'no-store',
          signal: controller.signal,
        }
      );
      const rawBody = await response.text();

      let payload = null;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        const error = new Error(
          `Respuesta no JSON desde backend. Inicio: ${String(rawBody || '')
            .trim()
            .slice(0, 60)}`
        );
        error.permanent = true;
        throw error;
      }

      if (!response.ok || payload?.ok === false) {
        const error = new Error(
          payload?.error || `Error backend (${response.status})`
        );
        error.permanent = response.status === 404 || response.status === 400;
        throw error;
      }

      const result = payload?.result || payload;
      if (!result || typeof result !== 'object') {
        const error = new Error('Respuesta inválida de /population/query');
        error.permanent = true;
        throw error;
      }

      if (!Array.isArray(result?.collection?.features)) {
        result.collection = { type: 'FeatureCollection', features: [] };
      }

      return result;
    } catch (error) {
      const isAbort =
        error?.name === 'AbortError' ||
        String(error?.message || '')
          .toLowerCase()
          .includes('aborted');

      if (isAbort) {
        const timeoutError = new Error(
          `Tiempo de espera agotado (${POPULATION_REMOTE_TIMEOUT_MS} ms) al consultar población en backend.`
        );
        timeoutError.permanent = false;
        throw timeoutError;
      }

      if (attempt < 2) continue;

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export function resolveFeatureLabel(feature, fallbackLabel = 'Elemento') {
  const properties = feature?.properties || {};

  return (
    properties.OBRA ||
    properties.NOMBRE ||
    properties.NOMBRE_OBRA ||
    properties.FRENTE ||
    properties.PROGRAMA ||
    properties.NOM_MZA ||
    properties.NOMBRE_COL ||
    feature?.id ||
    fallbackLabel
  );
}

export function isPointGeometry(geometryType) {
  return geometryType === 'Point' || geometryType === 'MultiPoint';
}

export function isPointLayer(layer) {
  if (isPointGeometry(layer?.geometryType)) return true;
  const firstGeometryType = layer?.data?.features?.[0]?.geometry?.type;
  return isPointGeometry(firstGeometryType);
}

export function getFeatureRepresentativeLatLng(feature) {
  if (!feature || typeof feature !== 'object') return null;

  const cached = REPRESENTATIVE_POINT_CACHE.get(feature);
  if (cached) return cached;

  const geometry = feature?.geometry;
  if (!geometry) return null;

  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates || [];
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const point = L.latLng(lat, lng);
      REPRESENTATIVE_POINT_CACHE.set(feature, point);
      return point;
    }
    return null;
  }

  if (geometry.type === 'MultiPoint') {
    const coords = geometry.coordinates || [];
    if (!coords.length) return null;
    const totals = coords.reduce(
      (accumulator, [lng, lat]) => ({
        lat: accumulator.lat + lat,
        lng: accumulator.lng + lng,
        count: accumulator.count + 1,
      }),
      { lat: 0, lng: 0, count: 0 }
    );

    if (!totals.count) return null;
    const point = L.latLng(totals.lat / totals.count, totals.lng / totals.count);
    REPRESENTATIVE_POINT_CACHE.set(feature, point);
    return point;
  }

  const coordinates = flattenCoordinates(geometry.coordinates);
  if (!coordinates.length) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  coordinates.forEach(([lng, lat]) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  });

  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  const point = L.latLng((minLat + maxLat) / 2, (minLng + maxLng) / 2);
  REPRESENTATIVE_POINT_CACHE.set(feature, point);
  return point;
}

export function getNearestFeatures({
  layer,
  latlng,
  limit = 5,
  maxDistanceMeters = Infinity,
}) {
  const features = layer?.data?.features || [];

  return features
    .map((feature) => {
      const point = getFeatureRepresentativeLatLng(feature);
      if (!point) return null;

      const distanceMeters = latlng.distanceTo(point);
      if (distanceMeters > maxDistanceMeters) return null;

      return {
        distanceMeters,
        feature,
        label: resolveFeatureLabel(feature, layer?.name),
        point,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, limit);
}

export function resolveLayerForProximity(layers, selectedLayerId) {
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  if (selectedLayer?.visible && selectedLayer?.data?.features?.length) {
    return selectedLayer;
  }

  return (
    layers.find((layer) => layer.visible && layer?.data?.features?.length) ||
    null
  );
}

export function resolveLayerForHotspot(layers, selectedLayerId) {
  const candidates = resolveLayersForHotspot(layers, selectedLayerId);
  return candidates[0] || null;
}

export function resolveLayersForHotspot(layers, selectedLayerId) {
  const visibleCandidates = (layers || []).filter(
    (layer) =>
      layer?.visible &&
      !layer?.referenceLayer &&
      !layer?.isBaseMap &&
      !layer?.hideInLayersPanel &&
      (layer?.data?.features?.length || 0) > 0
  );

  if (!visibleCandidates.length) return [];

  const selectedIndex = visibleCandidates.findIndex(
    (layer) => layer.id === selectedLayerId
  );

  if (selectedIndex <= 0) return visibleCandidates;

  const selectedLayer = visibleCandidates[selectedIndex];
  const ordered = [...visibleCandidates];
  ordered.splice(selectedIndex, 1);
  ordered.unshift(selectedLayer);
  return ordered;
}

function parseHotspotNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;

  const raw = value.trim();
  if (!raw) return 0;

  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;

  if (hasComma && hasDot) {
    normalized =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    const decimalLength = cleaned.split(',').pop()?.length || 0;
    normalized =
      decimalLength > 0 && decimalLength <= 2
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readFirstStringProperty(properties = {}, keys = []) {
  for (const key of keys) {
    const raw = properties?.[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return null;
}

function resolveHotspotFeatureWeight(feature, mode) {
  if (mode !== 'spend') return 1;
  const properties = feature?.properties || {};
  for (const key of HOTSPOT_SPEND_FIELD_CANDIDATES) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    const parsed = parseHotspotNumericValue(properties[key]);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function resolveHotspotFeatureAlcaldia(feature) {
  return (
    readFirstStringProperty(
      feature?.properties || {},
      HOTSPOT_ALCALDIA_FIELD_CANDIDATES
    ) || 'Sin alcaldía'
  );
}

export function buildHotspotBins({
  cellSizePx = 64,
  layer,
  layers,
  map,
  mode = 'count',
  bufferCenter = null,
  bufferRadiusKm = 0,
}) {
  if (!map) {
    return {
      bins: [],
      summary: {
        mode: mode === 'spend' ? 'spend' : 'count',
        totalFeatures: 0,
        totalWeight: 0,
        topAlcaldias: [],
      },
    };
  }
  const sourceLayers =
    Array.isArray(layers) && layers.length
      ? layers
      : layer
      ? [layer]
      : [];
  if (!sourceLayers.length) {
    return {
      bins: [],
      summary: {
        mode: mode === 'spend' ? 'spend' : 'count',
        totalFeatures: 0,
        totalWeight: 0,
        topAlcaldias: [],
      },
    };
  }

  const hotspotMode = mode === 'spend' ? 'spend' : 'count';
  const effectiveBufferRadiusKm = Math.max(0, Number(bufferRadiusKm || 0));
  const bufferRadiusMeters = effectiveBufferRadiusKm * 1000;
  const effectiveBufferCenter =
    bufferCenter && Number.isFinite(bufferRadiusMeters) && bufferRadiusMeters > 0
      ? L.latLng(bufferCenter)
      : null;
  const zoom = map.getZoom();
  const bounds = map.getBounds().pad(0.25);
  const buckets = new Map();
  const alcaldiaCounter = new Map();
  let totalFeatures = 0;
  let totalWeight = 0;

  sourceLayers.forEach((candidateLayer) => {
    const features = candidateLayer?.data?.features || [];
    if (!features.length) return;

    features.forEach((feature) => {
      const point = getFeatureRepresentativeLatLng(feature);
      if (!point || !bounds.contains(point)) return;
      if (
        effectiveBufferCenter &&
        effectiveBufferCenter.distanceTo(point) > bufferRadiusMeters
      ) {
        return;
      }

      const weight = resolveHotspotFeatureWeight(feature, hotspotMode);
      if (hotspotMode === 'spend' && weight <= 0) return;

      const projected = map.project(point, zoom);
      const bucketX = Math.floor(projected.x / cellSizePx);
      const bucketY = Math.floor(projected.y / cellSizePx);
      const bucketKey = `${bucketX}:${bucketY}`;

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          count: 0,
          weight: 0,
          latTotal: 0,
          lngTotal: 0,
        });
      }

      const bucket = buckets.get(bucketKey);
      bucket.count += 1;
      bucket.weight += weight;
      bucket.latTotal += point.lat;
      bucket.lngTotal += point.lng;

      const alcaldia = resolveHotspotFeatureAlcaldia(feature);
      if (!alcaldiaCounter.has(alcaldia)) {
        alcaldiaCounter.set(alcaldia, { count: 0, weight: 0 });
      }
      const alcaldiaState = alcaldiaCounter.get(alcaldia);
      alcaldiaState.count += 1;
      alcaldiaState.weight += weight;

      totalFeatures += 1;
      totalWeight += weight;
    });
  });

  const bins = Array.from(buckets.values())
    .map((bucket) => ({
      center: L.latLng(
        bucket.latTotal / bucket.count,
        bucket.lngTotal / bucket.count
      ),
      count: bucket.count,
      weight: bucket.weight,
      metric: hotspotMode === 'spend' ? bucket.weight : bucket.count,
    }))
    .sort((left, right) => right.metric - left.metric);

  const topAlcaldias = Array.from(alcaldiaCounter.entries())
    .map(([name, values]) => ({
      name,
      count: Number(values.count || 0),
      weight: Number(values.weight || 0),
      metric: hotspotMode === 'spend' ? Number(values.weight || 0) : Number(values.count || 0),
    }))
    .sort((left, right) => right.metric - left.metric)
    .slice(0, 6);

  return {
    bins,
    summary: {
      mode: hotspotMode,
      totalFeatures,
      totalWeight,
      sourceLayerCount: sourceLayers.length,
      topAlcaldias,
      bufferApplied: Boolean(effectiveBufferCenter && bufferRadiusMeters > 0),
      bufferRadiusKm: effectiveBufferRadiusKm,
    },
  };
}

export function getHotspotColor(count, maxCount) {
  const ratio = maxCount > 0 ? count / maxCount : 0;

  if (ratio >= 0.85) return '#450a0a';
  if (ratio >= 0.65) return '#7f1d1d';
  if (ratio >= 0.45) return '#b91c1c';
  if (ratio >= 0.25) return '#dc2626';
  if (ratio >= 0.12) return '#ea580c';
  return '#c2410c';
}

export class PopulationEngine {
  constructor(url) {
    this.urls = Array.isArray(url) ? url.filter(Boolean) : [url].filter(Boolean);
    this.data = null;
    this.memoizedFeatures = null;
    this.featureRecords = null;
    this.gridIndex = null;
    this.gridCellSize = POPULATION_GRID_CELL_SIZE_DEGREES;
    this.loadingPromise = null;
    this.lastQuery = null;
    this.lastResult = null;
    this.remoteEnabled = true;
    this.remoteDisabledReason = null;
  }

  async buildSpatialIndex(features) {
    const records = [];
    const gridIndex = new Map();

    for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
      if (
        featureIndex > 0 &&
        featureIndex % POPULATION_INDEX_BUILD_YIELD_EVERY === 0
      ) {
        await yieldToMainThread();
      }

      const feature = features[featureIndex];
      const bbox = computeGeometryBBox(feature?.geometry);
      if (!Array.isArray(bbox) || bbox.some((value) => !Number.isFinite(value))) {
        continue;
      }

      const record = {
        feature,
        bbox,
        metrics: computePopulationMetrics(feature?.properties || {}),
      };
      const recordIndex = records.length;
      records.push(record);

      const [minX, minY, maxX, maxY] = bbox;
      const cellXStart = Math.floor(minX / this.gridCellSize);
      const cellYStart = Math.floor(minY / this.gridCellSize);
      const cellXEnd = Math.floor(maxX / this.gridCellSize);
      const cellYEnd = Math.floor(maxY / this.gridCellSize);

      for (let x = cellXStart; x <= cellXEnd; x += 1) {
        for (let y = cellYStart; y <= cellYEnd; y += 1) {
          const cellKey = `${x}:${y}`;
          if (!gridIndex.has(cellKey)) gridIndex.set(cellKey, []);
          gridIndex.get(cellKey).push(recordIndex);
        }
      }
    }

    this.featureRecords = records;
    this.gridIndex = gridIndex;
  }

  collectCandidateRecords(queryBbox) {
    const records = this.featureRecords || [];
    if (!records.length || !Array.isArray(queryBbox)) return [];
    if (!this.gridIndex || !this.gridIndex.size) return records;

    const [minX, minY, maxX, maxY] = queryBbox;
    const cellXStart = Math.floor(minX / this.gridCellSize);
    const cellYStart = Math.floor(minY / this.gridCellSize);
    const cellXEnd = Math.floor(maxX / this.gridCellSize);
    const cellYEnd = Math.floor(maxY / this.gridCellSize);
    const candidateIndexes = new Set();

    for (let x = cellXStart; x <= cellXEnd; x += 1) {
      for (let y = cellYStart; y <= cellYEnd; y += 1) {
        const cellKey = `${x}:${y}`;
        const bucket = this.gridIndex.get(cellKey);
        if (!bucket) continue;
        bucket.forEach((index) => candidateIndexes.add(index));
      }
    }

    if (!candidateIndexes.size) return [];

    return Array.from(candidateIndexes)
      .map((index) => records[index])
      .filter((record) => bboxIntersects(record.bbox, queryBbox));
  }

  async ensureLoaded() {
    if (this.data) return this.data;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      let lastError = null;

      for (const candidateUrl of this.urls) {
        try {
          const response = await fetch(candidateUrl, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(
              `No se encontró el archivo poblacional en ${candidateUrl}`
            );
          }

          const rawBody = await response.text();
          let payload = null;

          try {
            payload = JSON.parse(rawBody);
          } catch {
            const snippet = String(rawBody || '').trim().slice(0, 60);
            throw new Error(
              `La respuesta en ${candidateUrl} no es JSON válido. Inicio: ${snippet}`
            );
          }

          if (!Array.isArray(payload?.features)) {
            throw new Error(`El GeoJSON de población no es válido en ${candidateUrl}.`);
          }

          this.data = payload;
          this.memoizedFeatures = payload.features
            .map(normalizePopulationFeature)
            .filter(Boolean);
          await this.buildSpatialIndex(this.memoizedFeatures);
          return payload;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error('No se pudo cargar la capa de población.');
    })().finally(() => {
      this.loadingPromise = null;
    });

    return this.loadingPromise;
  }

  async queryRadius(latlng, radiusKm) {
    if (POPULATION_STRICT_BACKEND && !this.remoteEnabled) {
      throw new Error(
        this.remoteDisabledReason ||
          'Motor de población backend no disponible. Se desactivó el fallback local para evitar bloqueos.'
      );
    }

    if (this.remoteEnabled) {
      try {
        const remoteResult = await requestPopulationFromBackend({
          latlng,
          radiusKm,
          maxRenderFeatures: MAX_POPULATION_RENDER_FEATURES,
        });

        this.lastQuery = `${latlng.lat.toFixed(6)}:${latlng.lng.toFixed(6)}:${Number(
          radiusKm
        ).toFixed(6)}`;
        this.lastResult = remoteResult;
        return remoteResult;
      } catch (error) {
        const reason = `Motor de población backend no disponible: ${
          error?.message || 'error de conexión'
        }`;
        const shouldDisableRemote = Boolean(error?.permanent);

        if (POPULATION_STRICT_BACKEND) {
          if (shouldDisableRemote) {
            this.remoteEnabled = false;
            this.remoteDisabledReason = reason;
          }
          throw new Error(reason);
        }

        if (shouldDisableRemote) {
          this.remoteEnabled = false;
          this.remoteDisabledReason = reason;
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[PopulationEngine] Backend no disponible, usando fallback local:', error.message);
          }
        } else if (process.env.NODE_ENV !== 'production') {
          console.warn('[PopulationEngine] Error remoto temporal:', error.message);
        }
      }
    }

    if (POPULATION_STRICT_BACKEND) {
      throw new Error(
        'Motor de población backend no disponible. Se desactivó el fallback local para evitar bloqueos.'
      );
    }

    const collection = await this.ensureLoaded();
    const queryKey = `${latlng.lat.toFixed(6)}:${latlng.lng.toFixed(6)}:${Number(
      radiusKm
    ).toFixed(6)}`;

    if (this.lastQuery === queryKey && this.lastResult) {
      return this.lastResult;
    }

    const features = this.memoizedFeatures || collection.features || [];
    const centerPoint = turf.point([latlng.lng, latlng.lat]);
    const buffer = turf.buffer(centerPoint, radiusKm, { units: 'kilometers' });
    const bufferBbox = turf.bbox(buffer);
    const candidateRecords = this.collectCandidateRecords(bufferBbox);
    const hasSpatialIndex = Boolean(
      this.featureRecords?.length && this.gridIndex?.size
    );
    const recordsToEvaluate =
      hasSpatialIndex
        ? candidateRecords
        : features.length > 0
          ? features.map((feature) => ({
              feature,
              metrics: computePopulationMetrics(feature?.properties || {}),
            }))
          : [];

    const totals = {
      center: latlng,
      featureCount: 0,
      featuresCount: 0,
      radiusKm,
      sampledAreaKm2: Math.PI * radiusKm * radiusKm,
      ...createZeroPopulationTotals(),
    };
    const matchedFeatures = [];

    for (
      let recordIndex = 0;
      recordIndex < recordsToEvaluate.length;
      recordIndex += 1
    ) {
      if (
        recordIndex > 0 &&
        recordIndex % POPULATION_QUERY_YIELD_EVERY === 0
      ) {
        await yieldToMainThread();
      }

      const record = recordsToEvaluate[recordIndex];
      let intersects = false;

      try {
        intersects = turf.booleanIntersects(record.feature, buffer);
      } catch {
        intersects = false;
      }

      if (!intersects) continue;

      totals.featureCount += 1;
      totals.featuresCount += 1;

      if (matchedFeatures.length < MAX_POPULATION_RENDER_FEATURES) {
        matchedFeatures.push(record.feature);
      }

      const metrics = record.metrics || {};
      POPULATION_NUMERIC_FIELDS.forEach((field) => {
        totals[field] += toNumber(metrics[field]);
      });
    }

    totals.collection = {
      type: 'FeatureCollection',
      features: matchedFeatures,
    };
    totals.renderFeatureCount = matchedFeatures.length;
    totals.renderTruncated = totals.featureCount > matchedFeatures.length;

    totals.total = totals.POBTOT;
    totals.elementos = totals.featureCount;

    this.lastQuery = queryKey;
    this.lastResult = totals;

    return totals;
  }
}
