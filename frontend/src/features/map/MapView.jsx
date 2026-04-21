import React from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';
import { fetchKpiSummary } from '../../services/gisApi';
import MobileFeatureCard from '../mobile/MobileFeatureCard';
import {
  buildPopulationQuerySnapshot,
  buildPopulationSelection,
  ensurePopulationLayer,
  isSamePopulationQuery,
  POPULATION_BUFFER_STYLE,
  removePopulationLayer,
} from '../analysis/PopulationAnalysis';
import {
  buildHotspotBins,
  getHotspotColor,
  getFeatureRepresentativeLatLng,
  PopulationEngine,
  resolveFeatureLabel,
  resolveLayersForHotspot,
  resolveLayerForProximity,
} from './advancedTools';
import {
  buildStatusIconHtml,
  createGeoJsonLayer,
  getFeatureStatusColor,
  getVisualState,
} from './GeoJsonLayer';
import { fitVisibleLayers } from './FitVisibleLayers';
import { getLayerStatus } from '../layers/layerStatus';
import { isMovilidadLayer, shouldCountFeature } from './movilidadLayerUtils';

const DEFAULT_CENTER = [19.4326, -99.1332];
const DEFAULT_ZOOM = 11;
const METERS_PER_KILOMETER = 1000;
const EARTH_RADIUS = 6378137;
const PROXIMITY_TRAVEL_SPEED_KMH = 4.5;
const PROXIMITY_QUERY_YIELD_EVERY = 260;
const PROXIMITY_BAND_MINUTES = [5, 15, 20];
const BUFFER_QUERY_YIELD_EVERY = 80;
const BUFFER_MAX_SOURCE_FEATURES = 360;
const POPULATION_RADIUS_MAX_KM = 10;
const HOTSPOT_BUFFER_MAX_KM = 25;
const POPULATION_GEOJSON_FILENAME = 'inegi_poblacion_cdmx.geojson';
const ADVANCED_TOP_MENUS = ['layers', 'panel', 'tools', 'more'];
const TOOLS_OPERATION_SET = new Set([
  'draw',
  'measure',
  'population',
  'analysis',
  'buffer',
  'proximity',
  'hotspot',
]);
const BUFFER_RING_COLORS = [
  '#6366f1',
  '#7c3aed',
  '#0ea5e9',
  '#0891b2',
  '#14b8a6',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
];
const FIFTEEN_MINUTE_NEEDS = [
  {
    id: 'abastecimiento',
    label: 'Abastecimiento',
    keywords: [
      'mercado',
      'abasto',
      'supermercado',
      'tienda',
      'comercio',
      'tianguis',
      'abarrotes',
    ],
  },
  {
    id: 'educacion',
    label: 'Educación',
    keywords: [
      'escuela',
      'plantel',
      'universidad',
      'preparatoria',
      'secundaria',
      'primaria',
      'kinder',
      'biblioteca',
      'colegio',
    ],
  },
  {
    id: 'salud',
    label: 'Salud',
    keywords: [
      'salud',
      'hospital',
      'clinica',
      'farmacia',
      'medico',
      'imss',
      'issste',
      'centro de salud',
    ],
  },
  {
    id: 'trabajo',
    label: 'Trabajo',
    keywords: [
      'empleo',
      'oficina',
      'industria',
      'parque industrial',
      'comercial',
      'centro de trabajo',
      'negocio',
    ],
  },
  {
    id: 'ocio',
    label: 'Ocio',
    keywords: [
      'parque',
      'deportivo',
      'recre',
      'museo',
      'teatro',
      'cultura',
      'cine',
      'utopia',
      'plaza',
      'caf',
      'galeria',
    ],
  },
  {
    id: 'vivienda',
    label: 'Vivienda',
    keywords: [
      'vivienda',
      'habitacional',
      'hogar',
      'residencial',
      'casa',
      'departamento',
    ],
  },
];
const KPI_STATUS_KEYS = [
  'F_ESTATUS',
  'ESTATUS',
  'estatus',
  'ESTADO',
  'estado',
  'STATUS',
  'status',
];
const KPI_WORK_ID_KEYS = [
  'ID_OBRA',
  'id_obra',
  'ID OBRA',
  'id obra',
  'CVE_OBRA',
  'cve_obra',
  'OBRA_ID',
  'obra_id',
  'IDOBRA',
  'idobra',
];
const FEATURE_ALCALDIA_KEYS = [
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
const STATUS_PRIORITY = {
  entregado: 4,
  terminado: 3,
  proceso: 2,
  'sin iniciar': 1,
};
const USE_STATIC_EXECUTIVE_KPIS =
  String(process.env.REACT_APP_USE_STATIC_EXECUTIVE_KPIS || '').toLowerCase() ===
  'true';
const STATIC_EXECUTIVE_KPIS = {
  totalObras: 1514,
  entregadas: 138,
  terminadas: 618,
  enProceso: 580,
  sinIniciar: 177,
};
const ENABLE_GIS_DEBUG_LOGS =
  String(process.env.REACT_APP_GIS_DEBUG_LOGS || '').toLowerCase() === 'true';
const USE_CANVAS_RENDERER =
  String(process.env.REACT_APP_GIS_PREFER_CANVAS || '').toLowerCase() === 'true';
const CURRENCY_FORMATTER = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

function buildStaticKpiSummaryPayload() {
  return {
    generated_at: new Date().toISOString(),
    cache_ttl_ms: 0,
    totals: {
      total_obras: STATIC_EXECUTIVE_KPIS.totalObras,
      entregadas: STATIC_EXECUTIVE_KPIS.entregadas,
      terminadas: STATIC_EXECUTIVE_KPIS.terminadas,
      en_proceso: STATIC_EXECUTIVE_KPIS.enProceso,
      sin_iniciar: STATIC_EXECUTIVE_KPIS.sinIniciar,
      otro: 0,
    },
    by_table: [],
    source: 'static-fallback',
  };
}

function parseKpiCount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9.-]+/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatusValue(rawValue) {
  if (!rawValue) return null;
  const value = String(rawValue)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (value.includes('entregad')) return 'entregado';
  if (
    value.includes('terminad') ||
    value.includes('concluid') ||
    value.includes('finaliz')
  ) {
    return 'terminado';
  }
  if (
    value.includes('sin iniciar') ||
    value.includes('no inici')
  ) {
    return 'sin iniciar';
  }
  if (
    value.includes('proceso') ||
    value.includes('ejecuci') ||
    value.includes('avance')
  ) {
    return 'proceso';
  }
  return null;
}

function resolveFeatureStatus(properties = {}) {
  for (const key of KPI_STATUS_KEYS) {
    const raw = properties?.[key];
    if (raw == null || raw === '') continue;
    const normalized = normalizeStatusValue(raw);
    if (normalized) return normalized;
  }
  return null;
}

function resolveFeatureWorkId(properties = {}) {
  for (const key of KPI_WORK_ID_KEYS) {
    const raw = properties?.[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    return value;
  }
  return null;
}

function buildFeatureWorkKey(feature) {
  const workId = resolveFeatureWorkId(feature?.properties || {});
  if (!workId) return null;
  return workId.toUpperCase();
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

function resolveFeatureAlcaldia(properties = {}) {
  return readFirstStringProperty(properties, FEATURE_ALCALDIA_KEYS) || 'Sin alcaldía';
}

function resolveGeometryBucket(geometryType) {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') return 'point';
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'line';
  if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') return 'polygon';
  return 'other';
}

function isPointLikeGeometry(geometryType) {
  return geometryType === 'Point' || geometryType === 'MultiPoint';
}

function isOperationalWorkLayer(layer) {
  if (!layer) return false;
  if (layer.referenceLayer || layer.isBaseMap || layer.hideInLayersPanel) {
    return false;
  }
  return true;
}

function filterLayersByStatus(layers = [], statusFilter = null) {
  if (!statusFilter) return layers;

  return layers.map((layer) => {
    const sourceFeatures = layer?.data?.features || [];
    if (!sourceFeatures.length) {
      return {
        ...layer,
        visible: false,
      };
    }

    const filteredFeatures = sourceFeatures.filter((feature) => {
      const geometryType = feature?.geometry?.type;
      if (isMovilidadLayer(layer)) {
        if (!shouldCountFeature(feature, layer)) return false;
      } else if (!isPointLikeGeometry(geometryType)) {
        return false;
      }
      return resolveFeatureStatus(feature?.properties || {}) === statusFilter;
    });

    if (!filteredFeatures.length) {
      return {
        ...layer,
        visible: false,
        data: {
          ...(layer?.data || {}),
          features: [],
        },
      };
    }

    return {
      ...layer,
      visible: true,
      data: {
        ...(layer?.data || {}),
        features: filteredFeatures,
      },
    };
  });
}

function resolvePopulationDataUrls() {
  const publicUrl = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const urls = [
    `./data/${POPULATION_GEOJSON_FILENAME}`,
    `data/${POPULATION_GEOJSON_FILENAME}`,
    `./${POPULATION_GEOJSON_FILENAME}`,
    POPULATION_GEOJSON_FILENAME,
    `${publicUrl}/data/${POPULATION_GEOJSON_FILENAME}`,
    `${publicUrl}/${POPULATION_GEOJSON_FILENAME}`,
    '/data/inegi_poblacion_cdmx.geojson',
    '/inegi_poblacion_cdmx.geojson',
    '/layer/inegi_poblacion',
    '/api/layer/inegi_poblacion',
  ];

  if (typeof window !== 'undefined') {
    const { origin, pathname } = window.location;
    const basePath = pathname.endsWith('/')
      ? pathname
      : pathname.slice(0, pathname.lastIndexOf('/') + 1);
    urls.push(
      `${origin}${basePath}data/${POPULATION_GEOJSON_FILENAME}`,
      `${origin}${basePath}${POPULATION_GEOJSON_FILENAME}`
    );
  }

  return Array.from(
    new Set(
      urls
        .map((url) => String(url || '').trim())
        .filter(Boolean)
    )
  );
}
const TOOL_ICON_BASE = `${process.env.PUBLIC_URL || ''}/icons/map-tools`;
const EMPTY_DRAW_DRAFT = {
  type: null,
  points: [],
};

function formatDistance(meters) {
  if (meters >= METERS_PER_KILOMETER) {
    return `${(meters / METERS_PER_KILOMETER).toFixed(2)} km`;
  }

  return `${meters.toFixed(0)} m`;
}

function formatArea(squareMeters) {
  if (squareMeters >= 1000000) {
    return `${(squareMeters / 1000000).toFixed(2)} km²`;
  }

  if (squareMeters >= 10000) {
    return `${(squareMeters / 10000).toFixed(2)} ha`;
  }

  return `${squareMeters.toFixed(0)} m²`;
}

function computeDistance(points) {
  if (points.length < 2) return 0;

  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return total + previous.distanceTo(point);
  }, 0);
}

function computeGeodesicArea(points) {
  if (points.length < 3) return 0;

  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area +=
      ((next.lng - current.lng) * Math.PI) /
      180 *
      (2 +
        Math.sin((current.lat * Math.PI) / 180) +
        Math.sin((next.lat * Math.PI) / 180));
  }

  return Math.abs((area * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

function buildMeasurementSummary(type, points) {
  if (type === 'measure-distance') {
    return points.length >= 2 ? formatDistance(computeDistance(points)) : null;
  }

  if (type === 'measure-area') {
    return points.length >= 3 ? formatArea(computeGeodesicArea(points)) : null;
  }

  return null;
}

function buildDrawSummary(type, points) {
  if (type === 'draw-line') {
    return points.length >= 2 ? formatDistance(computeDistance(points)) : null;
  }

  if (type === 'draw-polygon') {
    return points.length >= 3 ? formatArea(computeGeodesicArea(points)) : null;
  }

  return type === 'draw-point' ? 'Punto' : null;
}

function refreshMapLayout(map) {
  if (!map) return;

  try {
    map.invalidateSize({ pan: false });
  } catch (e) {
    console.warn('[MapView] invalidateSize error', e);
  }
}

function safeInvalidate(mapRef, delay = 250) {
  setTimeout(() => {
    if (!mapRef.current) return;
    if (!mapRef.current._loaded) return;

    try {
      mapRef.current.invalidateSize({ pan: false });
      requestAnimationFrame(() => {
        if (!mapRef.current || !mapRef.current._loaded) return;
        try {
          mapRef.current.invalidateSize({ pan: false });
        } catch (e) {
          console.warn('[MapView] rAF invalidateSize error', e);
        }
      });
    } catch (e) {
      console.warn('[MapView] invalidateSize error', e);
    }
  }, delay);
}

// Firma estable de las capas visibles — usada como dep de Effect 1.
// Captura los campos que realmente requieren re-crear el layer Leaflet:
//   id, conteo de features, visibilidad, y todos los campos de estilo que
//   createVectorStyle / createPointStyle leen del objeto layer.
// PROPÓSITO: si el sync periódico de BD (cada 90 s) crea nuevos objetos JS
//   pero los datos no cambiaron, la firma es la misma → Effect 1 NO se dispara
//   → cero rebuilds innecesarios → cero parpadeos en el mapa.
function buildVisibleSignature(layers) {
  return layers
    .filter((layer) => layer.visible)
    .map((layer) => {
      const s = layer.style || {};
      return [
        layer.id,
        layer.data?.features?.length || 0,
        s.color || layer.color,
        s.weight || 2,
        s.opacity || 0.94,
        s.fillOpacity || 0.18,
        s.pointRadius || 6,
        s.markerKind || 'solid',
        s.dashStyle || 'solid',
      ].join(':');
    })
    .join('|');
}

function buildDrawItem(type, points) {
  return {
    id: `${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    type,
    points,
    summary: buildDrawSummary(type, points),
  };
}

function isMeasureMode(mode) {
  return mode === 'measure-distance' || mode === 'measure-area';
}

function isDrawMode(mode) {
  return (
    mode === 'draw-point' ||
    mode === 'draw-line' ||
    mode === 'draw-polygon'
  );
}

function formatPopulationValue(value) {
  return Number(value || 0).toLocaleString('es-MX');
}

function formatCurrencyValue(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return CURRENCY_FORMATTER.format(0);
  return CURRENCY_FORMATTER.format(parsed);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toBufferKilometers(distanceValue, unit = 'km') {
  const parsed = Number(distanceValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return unit === 'm' ? parsed / METERS_PER_KILOMETER : parsed;
}

function parseRingDistancesInput(inputValue, unit, fallbackDistanceKm) {
  const parts = String(inputValue || '')
    .split(/[,\s;|]+/)
    .map((item) => Number(String(item).trim()))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((distance) => toBufferKilometers(distance, unit))
    .filter((distance) => distance > 0);

  const uniqueSorted = Array.from(
    new Set(parts.map((value) => Number(value.toFixed(4))))
  ).sort((left, right) => left - right);

  if (uniqueSorted.length) return uniqueSorted;
  return [Number(fallbackDistanceKm.toFixed(4))];
}

function featureGeometryType(feature) {
  return feature?.geometry?.type || '';
}

function isLineGeometryType(type) {
  return type === 'LineString' || type === 'MultiLineString';
}

function isPolygonGeometryType(type) {
  return type === 'Polygon' || type === 'MultiPolygon';
}

function getBufferRingColor(ringIndex) {
  const safeIndex = Math.max(0, Number(ringIndex || 1) - 1);
  return BUFFER_RING_COLORS[safeIndex % BUFFER_RING_COLORS.length];
}

function parseNumericProperty(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/,/g, '');
    if (cleaned === '') return null;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function collectNumericFieldCandidates(layer) {
  const features = layer?.data?.features || [];
  if (!features.length) return [];

  const maxFeatures = Math.min(140, features.length);
  const hitMap = new Map();

  for (let index = 0; index < maxFeatures; index += 1) {
    const props = features[index]?.properties || {};
    Object.entries(props).forEach(([key, value]) => {
      if (!key || key.startsWith('_')) return;
      const parsed = parseNumericProperty(value);
      if (parsed == null) return;
      hitMap.set(key, (hitMap.get(key) || 0) + 1);
    });
  }

  return Array.from(hitMap.entries())
    .filter(([, hits]) => hits >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 28)
    .map(([fieldName]) => fieldName);
}

function bufferFeatureWithRules(feature, distanceKm, rules = {}) {
  if (!feature?.geometry) return null;
  const geometryType = featureGeometryType(feature);
  if (!geometryType) return null;

  let signedDistance = Math.abs(Number(distanceKm) || 0);
  if (!signedDistance) return null;

  const options = { units: 'kilometers', steps: 64 };
  const side = rules.lineSide || 'both';
  const polygonDirection = rules.polygonDirection || 'outside';

  if (isLineGeometryType(geometryType) && side !== 'both') {
    options.singleSided = true;
    signedDistance = side === 'right' ? -signedDistance : signedDistance;
  }

  if (isPolygonGeometryType(geometryType) && polygonDirection === 'inside') {
    signedDistance = -signedDistance;
  }

  try {
    const buffered = turf.buffer(feature, signedDistance, options);
    if (!buffered?.geometry) return null;
    return buffered;
  } catch {
    return null;
  }
}

function buildBufferBandsForFeature(feature, distancesKm, rules = {}) {
  if (!feature?.geometry || !Array.isArray(distancesKm) || !distancesKm.length) {
    return [];
  }

  const sortedDistances = [...distancesKm]
    .map((distance) => Number(distance))
    .filter((distance) => Number.isFinite(distance) && distance > 0)
    .sort((left, right) => left - right);
  if (!sortedDistances.length) return [];

  const geometryType = featureGeometryType(feature);
  const insidePolygon =
    isPolygonGeometryType(geometryType) &&
    (rules.polygonDirection || 'outside') === 'inside';

  const bands = [];
  let previousOuter = null;

  sortedDistances.forEach((distanceKm, index) => {
    const outer = bufferFeatureWithRules(feature, distanceKm, rules);
    if (!outer) return;

    let band = outer;

    try {
      if (insidePolygon) {
        if (previousOuter) {
          const diff = turf.difference(previousOuter, outer);
          if (diff?.geometry) band = diff;
        } else {
          const firstDiff = turf.difference(feature, outer);
          if (firstDiff?.geometry) band = firstDiff;
        }
      } else if (previousOuter) {
        const diff = turf.difference(outer, previousOuter);
        if (diff?.geometry) band = diff;
      }
    } catch {
      // mantenemos `band = outer` como fallback robusto
    }

    band.properties = {
      ...(band.properties || {}),
      ringIndex: index + 1,
      bufferKm: Number(distanceKm.toFixed(4)),
      geometrySourceType: geometryType,
    };
    bands.push(band);
    previousOuter = outer;
  });

  return bands;
}

function mergeBufferGroup(features) {
  if (!Array.isArray(features) || features.length <= 1) return features || [];

  let merged = features[0];
  const leftovers = [];

  for (let index = 1; index < features.length; index += 1) {
    const current = features[index];
    try {
      const unioned = turf.union(merged, current);
      if (unioned?.geometry) {
        merged = unioned;
      } else {
        leftovers.push(current);
      }
    } catch {
      leftovers.push(current);
    }
  }

  return [merged, ...leftovers];
}

function dissolveBufferFeatures(bufferFeatures) {
  if (!Array.isArray(bufferFeatures) || !bufferFeatures.length) return [];

  const groups = new Map();
  bufferFeatures.forEach((feature) => {
    const key = String(feature?.properties?.ringIndex || 1);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  });

  const dissolved = [];
  groups.forEach((featuresInRing, key) => {
    const merged = mergeBufferGroup(featuresInRing);
    merged.forEach((feature) => {
      feature.properties = {
        ...(feature.properties || {}),
        ringIndex: Number(key) || 1,
        dissolved: true,
      };
      dissolved.push(feature);
    });
  });

  return dissolved;
}

function normalizeNeedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function resolveNeedCategoryFromLayerName(layerName) {
  const normalized = normalizeNeedText(layerName);
  if (!normalized) return null;

  for (const need of FIFTEEN_MINUTE_NEEDS) {
    if (need.keywords.some((keyword) => normalized.includes(keyword))) {
      return need.id;
    }
  }

  return null;
}

function buildNeedsSummary(needCountsById = new Map()) {
  const coverage = FIFTEEN_MINUTE_NEEDS.map((need) => {
    const count = Number(needCountsById.get(need.id) || 0);
    return {
      id: need.id,
      label: need.label,
      count,
      covered: count > 0,
    };
  });

  const coveredCount = coverage.filter((item) => item.covered).length;
  const totalCount = coverage.length;
  const scorePercent =
    totalCount > 0 ? Math.round((coveredCount / totalCount) * 100) : 0;
  const missingNeeds = coverage
    .filter((item) => !item.covered)
    .map((item) => item.label);

  return {
    needsCoverage: coverage,
    needsCoveredCount: coveredCount,
    needsTotalCount: totalCount,
    needsScorePercent: scorePercent,
    missingNeeds,
  };
}

function resolveActiveAnalysisMode(activeTool, analysisMode) {
  if (activeTool === 'buffer' || activeTool === 'proximity') {
    return activeTool;
  }

  if (activeTool === 'analysis') {
    return analysisMode;
  }

  return 'idle';
}

async function collectProximityByLayer({
  centerLatLng,
  layers,
  bandRadiiKm,
}) {
  const normalizedBandRadii = Array.isArray(bandRadiiKm)
    ? bandRadiiKm
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((left, right) => left - right)
    : [];
  const maxRadiusKm =
    normalizedBandRadii[normalizedBandRadii.length - 1] || 0;

  if (!centerLatLng || !Array.isArray(layers) || layers.length === 0) {
    return {
      groupedResults: [],
      nearestItems: [],
      bandTotals: normalizedBandRadii.map(() => 0),
      bandRadiiKm: normalizedBandRadii,
      ...buildNeedsSummary(),
    };
  }

  const centerLat = Number(centerLatLng.lat);
  const centerLng = Number(centerLatLng.lng);
  const needsBandIndex =
    normalizedBandRadii.length > 1
      ? 1
      : Math.max(0, normalizedBandRadii.length - 1);
  const groupedCounts = new Map();
  const needCounts = new Map();
  const nearbyItems = [];
  const bandTotals = normalizedBandRadii.map(() => 0);
  let processedFeatures = 0;

  for (const layer of layers) {
    const features = layer?.data?.features || [];
    if (!features.length) continue;
    const layerName = layer?.name || 'Sin capa';
    const needCategoryId = resolveNeedCategoryFromLayerName(layerName);

    for (const feature of features) {
      processedFeatures += 1;
      if (processedFeatures % PROXIMITY_QUERY_YIELD_EVERY === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const repPointLatLng = getFeatureRepresentativeLatLng(feature);
      if (!repPointLatLng) continue;
      const distanceKm = haversineDistanceKm(
        centerLat,
        centerLng,
        Number(repPointLatLng.lat),
        Number(repPointLatLng.lng)
      );
      if (!Number.isFinite(distanceKm) || distanceKm > maxRadiusKm) continue;

      const layerCounts =
        groupedCounts.get(layerName) || normalizedBandRadii.map(() => 0);

      normalizedBandRadii.forEach((bandRadiusKm, bandIndex) => {
        if (distanceKm <= bandRadiusKm) {
          layerCounts[bandIndex] += 1;
          bandTotals[bandIndex] += 1;
        }
      });

      groupedCounts.set(layerName, layerCounts);

      if (
        needCategoryId &&
        normalizedBandRadii.length &&
        distanceKm <= normalizedBandRadii[needsBandIndex]
      ) {
        needCounts.set(needCategoryId, (needCounts.get(needCategoryId) || 0) + 1);
      }
      nearbyItems.push({
        label: resolveFeatureLabel(feature, layerName),
        distanceMeters: distanceKm * METERS_PER_KILOMETER,
        layerName,
        point: repPointLatLng,
      });
    }
  }

  const groupedResults = Array.from(groupedCounts.entries())
    .map(([label, counts]) => ({
      label,
      counts,
      total: counts[counts.length - 1] || 0,
    }))
    .sort((left, right) => right.total - left.total);

  const nearestItems = nearbyItems
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, 40);

  return {
    groupedResults,
    nearestItems,
    bandTotals,
    bandRadiiKm: normalizedBandRadii,
    ...buildNeedsSummary(needCounts),
  };
}

function minutesToKilometers(minutes, speedKmH = PROXIMITY_TRAVEL_SPEED_KMH) {
  const safeMinutes = Number(minutes);
  if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return 0;
  return (safeMinutes / 60) * speedKmH;
}

function haversineDistanceKm(latA, lngA, latB, lngB) {
  const toRad = Math.PI / 180;
  const deltaLat = (latB - latA) * toRad;
  const deltaLng = (lngB - lngA) * toRad;
  const originLat = latA * toRad;
  const targetLat = latB * toRad;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(targetLat) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}


// ── Tarjeta de resultado de análisis ─────────────────────────────────────────
// Reemplaza el antiguo L.popup HTML string. Se renderiza como overlay React
// sobre el mapa, con estilo glassmorphism tipo ArcGIS/Apple Maps.

function AnalysisMetric({ label, value, accent }) {
  return (
    <div className={`acrd-metric${accent ? ' acrd-metric--accent' : ''}`}>
      <span className="acrd-metric__label">{label}</span>
      <strong className="acrd-metric__value">{value}</strong>
    </div>
  );
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return '0.0%';
  return `${Number(value).toFixed(1)}%`;
}

function AnalysisBarRow({ label, value, percent = 0, tone = 'default' }) {
  const safePercent = clampNumber(Number(percent) || 0, 0, 100);
  return (
    <div className={`acrd-bar acrd-bar--${tone}`}>
      <div className="acrd-bar__head">
        <span className="acrd-bar__label">{label}</span>
        <strong className="acrd-bar__value">
          {value} · {formatPercent(safePercent)}
        </strong>
      </div>
      <div className="acrd-bar__track">
        <span className="acrd-bar__fill" style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
}

function AnalysisCard({ result, onClose }) {
  if (!result) return null;
  const { type, data } = result;

  let header = null;
  let body = null;
  let accentColor = '#691C32';

  if (type === 'buffer') {
    const ringDistances = Array.isArray(data.ringDistancesKm)
      ? data.ringDistancesKm
      : [Number(data.radiusKm || 0)];
    const sourceModeLabel =
      data.sourceMode === 'selected-layer'
        ? 'Capa activa'
        : data.sourceMode === 'selected-feature'
          ? 'Elemento seleccionado'
          : 'Punto en mapa';
    const fallbackAreaKm2 = Math.PI * (Number(data.radiusKm || 0) ** 2);
    const areaKm2 = Number.isFinite(Number(data.totalAreaKm2))
      ? Number(data.totalAreaKm2)
      : fallbackAreaKm2;
    accentColor = '#691C32';
    header = (
      <>
        <span className="acrd-badge acrd-badge--buffer">Buffer</span>
        <span className="acrd-header__title">Área de influencia</span>
      </>
    );
    if (data.error) {
      body = (
        <>
          <p className="acrd-error">{data.error}</p>
          {data.notice ? <p className="acrd-error">{data.notice}</p> : null}
        </>
      );
    } else {
      body = (
        <>
          <AnalysisMetric label="Fuente" value={sourceModeLabel} accent />
          {data.sourceLayerName ? (
            <AnalysisMetric label="Capa" value={data.sourceLayerName} />
          ) : null}
          <AnalysisMetric
            label="Distancias"
            value={ringDistances.map((distance) => `${distance} km`).join(' · ')}
          />
          <AnalysisMetric
            label="Anillos"
            value={String(Math.max(1, Number(data.ringsCount || ringDistances.length || 1)))}
          />
          <AnalysisMetric
            label="Buffers generados"
            value={`${Number(data.outputFeatureCount || 0).toLocaleString('es-MX')}`}
          />
          <AnalysisMetric
            label="Área total"
            value={`${areaKm2.toLocaleString('es-MX', { maximumFractionDigits: 3 })} km²`}
          />
          <div className="acrd-divider" />
          <AnalysisMetric
            label="Disolver bordes"
            value={data.dissolve ? 'Sí' : 'No'}
          />
          {data.variableField ? (
            <AnalysisMetric
              label="Distancia variable"
              value={`Atributo: ${data.variableField}`}
            />
          ) : null}
          {data.lineSide && data.lineSide !== 'both' ? (
            <AnalysisMetric
              label="Buffer en líneas"
              value={data.lineSide === 'left' ? 'Solo izquierda' : 'Solo derecha'}
            />
          ) : null}
          {data.polygonDirection === 'inside' ? (
            <AnalysisMetric
              label="Buffer en polígonos"
              value="Hacia el interior"
            />
          ) : null}
          {data.notice ? <p className="acrd-error">{data.notice}</p> : null}
        </>
      );
    }
  }

  if (type === 'population') {
    accentColor = '#1d4ed8';
    if (data.error) {
      header = <span className="acrd-badge acrd-badge--population">Población</span>;
      body = <p className="acrd-error">{data.error}</p>;
    } else {
      const total = Number(data.POBTOT || 0);
      const women = Number(data.POBFEM || 0);
      const men = Number(data.POBMAS || 0);
      const age0_14 = Number(data.POB0_14 || 0);
      const age15_64 = Number(data.POB15_64 || 0);
      const age65 = Number(data.POB65_MAS || 0);
      const seniorsWomen = Number(data.POB60_MAS_F || 0);
      const seniorsMen = Number(data.POB60_MAS_M || 0);
      const minorsWomen = Number(data.POB18_MEN_F || 0);
      const minorsMen = Number(data.POB18_MEN_M || 0);
      const noHealth = Number(data.PSINDER || 0);
      const homes = Number(data.TOTHOG || 0);
      const blocks = Number(data.featureCount || 0);

      const womenPct = total > 0 ? (women / total) * 100 : 0;
      const menPct = total > 0 ? (men / total) * 100 : 0;
      const age0_14Pct = total > 0 ? (age0_14 / total) * 100 : 0;
      const age15_64Pct = total > 0 ? (age15_64 / total) * 100 : 0;
      const age65Pct = total > 0 ? (age65 / total) * 100 : 0;
      const noHealthPct = total > 0 ? (noHealth / total) * 100 : 0;

      header = (
        <>
          <span className="acrd-badge acrd-badge--population">Población</span>
          <span className="acrd-header__title">Radio {data.radiusKm} km</span>
        </>
      );
      body = (
        <>
          <div className="acrd-hero acrd-hero--population">
            <span className="acrd-hero__eyebrow">Población total</span>
            <strong className="acrd-hero__value">
              {formatPopulationValue(total)}
            </strong>
            <span className="acrd-hero__caption">Habitantes dentro del radio</span>
          </div>

          <div className="acrd-kpi-grid">
            <div className="acrd-kpi acrd-kpi--women">
              <span>Mujeres</span>
              <strong>{formatPopulationValue(women)}</strong>
              <small>{formatPercent(womenPct)}</small>
            </div>
            <div className="acrd-kpi acrd-kpi--men">
              <span>Hombres</span>
              <strong>{formatPopulationValue(men)}</strong>
              <small>{formatPercent(menPct)}</small>
            </div>
          </div>

          <div className="acrd-divider" />
          <div className="acrd-subtitle">Estructura por edad</div>
          <AnalysisBarRow
            label="0 - 14 años"
            percent={age0_14Pct}
            tone="youth"
            value={formatPopulationValue(age0_14)}
          />
          <AnalysisBarRow
            label="15 - 64 años"
            percent={age15_64Pct}
            tone="adult"
            value={formatPopulationValue(age15_64)}
          />
          <AnalysisBarRow
            label="65+ años"
            percent={age65Pct}
            tone="senior"
            value={formatPopulationValue(age65)}
          />

          <div className="acrd-divider" />
          <div className="acrd-subtitle">Apartados solicitados</div>
          <div className="acrd-chip-grid">
            <div className="acrd-chip">
              <span>60+ Mujeres</span>
              <strong>{formatPopulationValue(seniorsWomen)}</strong>
            </div>
            <div className="acrd-chip">
              <span>60+ Hombres</span>
              <strong>{formatPopulationValue(seniorsMen)}</strong>
            </div>
            <div className="acrd-chip">
              <span>Menores 18 Mujeres</span>
              <strong>{formatPopulationValue(minorsWomen)}</strong>
            </div>
            <div className="acrd-chip">
              <span>Menores 18 Hombres</span>
              <strong>{formatPopulationValue(minorsMen)}</strong>
            </div>
          </div>

          <div className="acrd-divider" />
          <div className="acrd-subtitle">Condición social</div>
          <AnalysisBarRow
            label="Sin derechohabiencia"
            percent={noHealthPct}
            tone="risk"
            value={formatPopulationValue(noHealth)}
          />
          <AnalysisMetric label="Hogares" value={formatPopulationValue(homes)} />
          <div className="acrd-divider" />
          <AnalysisMetric label="Manzanas" value={formatPopulationValue(blocks)} />
        </>
      );
    }
  }

  if (type === 'proximity') {
    accentColor = '#ea580c';
    header = (
      <>
        <span className="acrd-badge acrd-badge--proximity">Proximidad</span>
        <span className="acrd-header__title">{data.layerName}</span>
      </>
    );
    const rows = data.groupedResults || data.results || [];
    const needsCoverage = Array.isArray(data.needsCoverage)
      ? data.needsCoverage
      : [];
    const needsCoveredCount = Number(data.needsCoveredCount || 0);
    const needsTotalCount = Number(
      data.needsTotalCount || needsCoverage.length || 0
    );
    const needsScorePercent = Number(data.needsScorePercent || 0);
    const missingNeeds = Array.isArray(data.missingNeeds)
      ? data.missingNeeds
      : [];

    const coverRatio =
      needsTotalCount > 0
        ? `${needsCoveredCount}/${needsTotalCount}`
        : '0/0';
    body = (
      <>
        <div className="acrd-hero acrd-hero--proximity">
          <span className="acrd-hero__eyebrow">Cobertura esencial</span>
          <strong className="acrd-hero__value">{needsScorePercent}%</strong>
          <span className="acrd-hero__caption">Ciudad 15 min: {coverRatio}</span>
        </div>

        <div className="acrd-prox-summary">
          <div className="acrd-prox-score">{coverRatio}</div>
          <div className="acrd-prox-summary-copy">
            <strong>Ciudad de 15 minutos</strong>
            <span>
              Necesidades cubiertas por proximidad peatonal
            </span>
          </div>
        </div>

        <div className="acrd-need-list">
          {needsCoverage.map((need) => (
            <div className="acrd-need-row" key={need.id}>
              <span className={`acrd-need-dot${need.covered ? ' is-covered' : ''}`} />
              <span className="acrd-need-label">{need.label}</span>
              <strong className="acrd-need-count">
                {Number(need.count || 0).toLocaleString('es-MX')}
              </strong>
            </div>
          ))}
        </div>

        {missingNeeds.length ? (
          <p className="acrd-prox-missing">
            Faltan servicios de: {missingNeeds.join(', ')}.
          </p>
        ) : (
          <p className="acrd-prox-missing is-good">
            Cobertura completa de servicios esenciales.
          </p>
        )}

        <div className="acrd-divider" />

        {rows.length === 0 ? (
          <p className="acrd-error">No se encontraron elementos cercanos.</p>
        ) : (
          rows.slice(0, 8).map((item, i) => (
            <div className="acrd-prox-row" key={item.label + i}>
              <span className="acrd-prox-rank">{i + 1}</span>
              <span className="acrd-prox-label">{item.label}</span>
              <strong className="acrd-prox-dist">
                {Number.isFinite(item.distanceMeters)
                  ? formatDistance(item.distanceMeters)
                  : `${Number(item.count || 0).toLocaleString('es-MX')} elem.`}
              </strong>
            </div>
          ))
        )}
      </>
    );
  }

  return (
    <div className="acrd" style={{ '--acrd-accent': accentColor }}>
      <div className="acrd__header">
        <div className="acrd__header-left">{header}</div>
        <button
          aria-label="Cerrar resultado"
          className="acrd__close"
          onClick={onClose}
          type="button"
        >
          ✕
        </button>
      </div>
      <div className="acrd__body">{body}</div>
    </div>
  );
}

function PopulationInsightsPanel({
  loading,
  onClose,
  onRadiusChange,
  radiusKm,
  result,
}) {
  const total = Number(result?.POBTOT || 0);
  const women = Number(result?.POBFEM || 0);
  const men = Number(result?.POBMAS || 0);
  const age0_14 = Number(result?.POB0_14 || 0);
  const age15_64 = Number(result?.POB15_64 || 0);
  const age65 = Number(result?.POB65_MAS || 0);
  const noHealth = Number(result?.PSINDER || 0);
  const homes = Number(result?.TOTHOG || 0);
  const homesWomenHead = Number(result?.HOGJEF_F || 0);
  const areaKm2 = Number(result?.areaKm2 || 0);
  const density = areaKm2 > 0 ? total / areaKm2 : 0;

  const womenPct = total > 0 ? (women / total) * 100 : 0;
  const menPct = total > 0 ? (men / total) * 100 : 0;
  const age0_14Pct = total > 0 ? (age0_14 / total) * 100 : 0;
  const age15_64Pct = total > 0 ? (age15_64 / total) * 100 : 0;
  const age65Pct = total > 0 ? (age65 / total) * 100 : 0;
  const noHealthPct = total > 0 ? (noHealth / total) * 100 : 0;
  const homesWomenPct = homes > 0 ? (homesWomenHead / homes) * 100 : 0;
  const hasResult = Boolean(result && !result.error);

  const summaryLines = hasResult
    ? [
        `En este radio viven ${formatPopulationValue(total)} personas.`,
        `La población está compuesta por ${formatPercent(
          womenPct
        )} mujeres y ${formatPercent(menPct)} hombres.`,
        `${formatPercent(age0_14Pct)} son niñas, niños y adolescentes (0–14 años) y ${formatPercent(
          age65Pct
        )} son personas de 65 años o más.`,
        `${formatPopulationValue(
          noHealth
        )} personas no cuentan con afiliación a servicios de salud (${formatPercent(
          noHealthPct
        )}).`,
        `${formatPercent(homesWomenPct)} de los hogares tienen jefa mujer.`,
        `La densidad promedio es de ${formatPopulationValue(
          Math.round(density)
        )} habitantes por km².`,
      ]
    : [];

  const donutStyle = {
    background: `conic-gradient(#f97316 0deg ${Math.round(
      womenPct * 3.6
    )}deg, #0ea5e9 ${Math.round(womenPct * 3.6)}deg 360deg)`,
  };

  return (
    <div className="pop-panel-wrap">
      <section className="pop-panel">
        <header className="pop-panel__header">
          <h3>Análisis poblacional (INEGI 2020)</h3>
          <button
            aria-label="Cerrar análisis poblacional"
            className="pop-panel__close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="pop-panel__body">
          <div className="pop-panel__intro">
            <p>
              Haz clic en cualquier punto del mapa para calcular la población que
              vive dentro de un radio fijo alrededor (Censo 2020 por manzana).
            </p>
            <span className="pop-panel__badge">INEGI · 2020</span>
          </div>

          <div className="pop-panel__radius">
            <div className="pop-panel__radius-head">
              <strong>RADIO DE ANÁLISIS (KM)</strong>
              <span>{Number(radiusKm).toFixed(1)} km</span>
            </div>
            <div className="pop-panel__radius-controls">
              <input
                max={10}
                min={0.5}
                onChange={(event) => onRadiusChange(event.target.value)}
                step={0.1}
                type="range"
                value={radiusKm}
              />
              <input
                max={10}
                min={0.5}
                onChange={(event) => onRadiusChange(event.target.value)}
                step={0.1}
                type="number"
                value={radiusKm}
              />
            </div>
          </div>

          {loading ? <p className="pop-panel__note">Calculando población...</p> : null}
          {result?.error ? <p className="pop-panel__error">{result.error}</p> : null}

          {hasResult ? (
            <>
              <div className="pop-panel__summary">
                <h4>Resumen ejecutivo</h4>
                <ul>
                  {summaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>

              <h4 className="pop-panel__section-title">Indicadores principales</h4>
              <div className="pop-panel__kpis">
                <article className="pop-kpi pop-kpi--primary">
                  <span>Población total en el área</span>
                  <strong>{formatPopulationValue(total)}</strong>
                  <small>Radio de {Number(radiusKm).toFixed(1)} km</small>
                </article>
                <article className="pop-kpi">
                  <span>Distribución por sexo</span>
                  <strong>
                    {formatPercent(womenPct)} mujeres / {formatPercent(menPct)} hombres
                  </strong>
                  <small>
                    {formatPopulationValue(women)} mujeres · {formatPopulationValue(men)} hombres
                  </small>
                </article>
                <article className="pop-kpi">
                  <span>Estructura por edad</span>
                  <strong>
                    0–14: {formatPercent(age0_14Pct)} · 15–64: {formatPercent(age15_64Pct)} ·
                    65+: {formatPercent(age65Pct)}
                  </strong>
                  <small>
                    {formatPopulationValue(age0_14)} · {formatPopulationValue(age15_64)} ·{' '}
                    {formatPopulationValue(age65)} personas
                  </small>
                </article>
                <article className="pop-kpi">
                  <span>Sin afiliación a servicios de salud</span>
                  <strong>{formatPopulationValue(noHealth)}</strong>
                  <small>{formatPercent(noHealthPct)} de la población</small>
                </article>
                <article className="pop-kpi">
                  <span>Total de hogares censales</span>
                  <strong>{formatPopulationValue(homes)}</strong>
                  <small>
                    Hogares con jefa mujer: {formatPopulationValue(homesWomenHead)} (
                    {formatPercent(homesWomenPct)})
                  </small>
                </article>
                <article className="pop-kpi">
                  <span>Densidad de población</span>
                  <strong>{formatPopulationValue(Math.round(density))} hab/km²</strong>
                  <small>Área: {areaKm2.toFixed(2)} km²</small>
                </article>
              </div>

              <div className="pop-panel__charts">
                <article className="pop-chart pop-chart--sex">
                  <h5>Distribución por sexo</h5>
                  <div className="pop-donut" style={donutStyle}>
                    <div className="pop-donut__hole" />
                  </div>
                  <div className="pop-donut__legend">
                    <span>
                      <i className="is-women" />
                      Mujeres
                    </span>
                    <span>
                      <i className="is-men" />
                      Hombres
                    </span>
                  </div>
                </article>
                <article className="pop-chart pop-chart--age">
                  <h5>Estructura por edad</h5>
                  <div className="pop-bars">
                    <div className="pop-bars__group">
                      <div className="pop-bars__track">
                        <span style={{ height: `${clampNumber(age0_14Pct, 0, 100)}%` }} />
                      </div>
                      <strong>0–14</strong>
                    </div>
                    <div className="pop-bars__group">
                      <div className="pop-bars__track">
                        <span style={{ height: `${clampNumber(age15_64Pct, 0, 100)}%` }} />
                      </div>
                      <strong>15–64</strong>
                    </div>
                    <div className="pop-bars__group">
                      <div className="pop-bars__track">
                        <span style={{ height: `${clampNumber(age65Pct, 0, 100)}%` }} />
                      </div>
                      <strong>65+</strong>
                    </div>
                  </div>
                </article>
              </div>
            </>
          ) : (
            <p className="pop-panel__note">
              Selecciona la herramienta y haz clic en el mapa para obtener los indicadores.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function ToolIcon({ alt, src }) {
  return <img alt={alt} className="map-view__tool-img" src={src} />;
}

function PopulationToolIcon() {
  return <ToolIcon alt="Poblacion" src={`${TOOL_ICON_BASE}/poblacion.svg`} />;
}

function AnalysisToolIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.6V7.2M20.4 12h-3.6M12 16.8v3.6M7.2 12H3.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CommunityToolIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6 20v-1.1c0-2.4 2.7-4.1 6-4.1s6 1.7 6 4.1V20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M4.8 9.7a2.2 2.2 0 1 1 0-4.4M19.2 9.7a2.2 2.2 0 1 0 0-4.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function PanelGridIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4.2" y="4.2" width="6.3" height="6.3" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="4.2" width="6.3" height="6.3" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4.2" y="13.5" width="6.3" height="6.3" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="6.3" height="6.3" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function WrenchMenuIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14.7 5.2a4 4 0 0 0 4.1 5.1l-8 8a2.2 2.2 0 0 1-3.1-3.1l8-8a4 4 0 0 0-1-2z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M13 5.5 18.5 11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function MoreDotsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="5.5" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="12" cy="18.5" r="1.9" />
    </svg>
  );
}

function LayersMenuIcon() {
  return (
    <span className="map-topnav__layers-icon" aria-hidden="true">
      <svg
        fill="none"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 4.6 20 8.8 12 13 4 8.8 12 4.6Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
        <path
          d="M5.7 12 12 15.4 18.3 12"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
        <path
          d="M5.7 15.5 12 18.9 18.3 15.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
      </svg>
    </span>
  );
}

function PointGeomIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" fill="currentColor" r="5" />
    </svg>
  );
}

function LineGeomIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 17 9.4 11.6 13.1 14.8 20 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function PolygonGeomIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.2 8.4 11.6 4.8 18.7 8.5 17 16.8 8.2 18.8 4.4 12.7Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function geomSymbol(geometryType) {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') return '●';
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') return '—';
  return '▭';
}

function LayerToggle({ checked, label, onClick }) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className={`lp-toggle${checked ? ' is-on' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="lp-toggle__box" aria-hidden="true">
        {checked ? (
          <svg
            fill="none"
            height="12"
            viewBox="0 0 12 12"
            width="12"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 6.2 4.55 8.75 10 3.25"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        ) : null}
      </span>
      <span className="lp-toggle__label">{checked ? 'ON' : 'OFF'}</span>
    </button>
  );
}

function AdvancedToolChip({ active, children, onClick }) {
  return (
    <button
      className={`map-view__tool-chip${active ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function TopMenuButton({ active, icon, label, onClick }) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`map-topnav__btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="map-topnav__icon">{icon}</span>
      <span className="map-topnav__label">{label}</span>
    </button>
  );
}

function MenuToolCard({ active, className = '', desc, icon, onClick, title }) {
  return (
    <button
      className={`map-tool-card${className ? ` ${className}` : ''}${
        active ? ' is-active' : ''
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="map-tool-card__icon">{icon}</span>
      <span className="map-tool-card__title">{title}</span>
      <span className="map-tool-card__desc">{desc}</span>
    </button>
  );
}

function getBasemapDisplayName(baseMap) {
  if (baseMap.id === 'topographic') return 'Topográfico';
  if (baseMap.id === 'satellite') return 'Satelital';
  if (baseMap.id === 'dark') return 'Dark';
  if (baseMap.id === 'cartographic') return 'OSM';
  return baseMap.name;
}

function MapView({ mode = 'desktop' }) {
  const {
    actions,
    activeBaseMap,
    baseMaps,
    clearSignal,
    drawDraft,
    drawItems,
    filteredFeatureCount,
    filteredLayers,
    focusedLayerId,
    hoveredLayerId,
    isCompactViewport,
    isFullstackModeForced,
    interactionMode,
    layerMetricsById,
    layers,
    mapViewportBounds,
    measurement,
    mobileModeManual,
    mobileSheet,
    selectedFeature,
    selectedLayer,
    selectedLayerId,
    visibleLayerCount,
  } = useGISWorkspace();
  const mapNodeRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const baseLayerRef = React.useRef(null);
  const overlayGroupRef = React.useRef(null);
  const measurementGroupRef = React.useRef(null);
  const drawingGroupRef = React.useRef(null);
  const advancedGroupRef = React.useRef(null);
  const hotspotGroupRef = React.useRef(null);
  const populationLayerRef = React.useRef(null);
  const lastPopulationQueryRef = React.useRef(null);
  const populationQueryBusyRef = React.useRef(false);
  const populationQuerySeqRef = React.useRef(0);
  const populationEngineRef = React.useRef(
    new PopulationEngine(resolvePopulationDataUrls())
  );
  const filteredLayersRef = React.useRef(filteredLayers);
  const allLayersRef = React.useRef(layers);
  const actionsRef = React.useRef(actions);

  // Tracks all active GeoJSON overlay layers (layerId → { geoJsonLayer, layer })
  const overlayLayersRef = React.useRef(new Map());

  // Always-current volatile state read by GeoJsonLayer style functions.
  // Initialized with nulls — updated synchronously on every render below,
  // after activeFocusLayerId is declared, so Leaflet callbacks always see
  // the latest values without causing extra re-renders.
  const layerStateRef = React.useRef({
    focusedLayerId: null,
    hoveredLayerId: null,
    selectedFeatureKey: null,
  });

  const [mapReadyVersion, setMapReadyVersion] = React.useState(0);
  React.useEffect(() => {
    if (!mapRef.current) return;

    // Forzar recalculo varias veces (clave para evitar glitch)
    const timers = [100, 300, 600].map((delay) =>
      setTimeout(() => {
        safeInvalidate(mapRef, 0);
      }, delay)
    );

    return () => timers.forEach(clearTimeout);
  }, [mapReadyVersion]);


  const [mapMeta, setMapMeta] = React.useState({
    zoom: DEFAULT_ZOOM,
    center: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
  });
  const [isFullscreenActive, setIsFullscreenActive] = React.useState(false);
  const [activeTool, setActiveTool] = React.useState(null);
  const [activeMenu, setActiveMenu] = React.useState(null);
  const [selectedKpiStatus, setSelectedKpiStatus] = React.useState(null);
  const [globalKpiSummary, setGlobalKpiSummary] = React.useState(null);
  const [globalKpiLoading, setGlobalKpiLoading] = React.useState(false);
  const [globalKpiError, setGlobalKpiError] = React.useState('');
  const globalKpiSummaryRef = React.useRef(null);
  const [isOffline, setIsOffline] = React.useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [quickSearchText, setQuickSearchText] = React.useState('');
  const [drawToolMode, setDrawToolMode] = React.useState('draw-point');
  const [measureToolMode, setMeasureToolMode] = React.useState(
    'measure-distance'
  );
  const [analysisMode, setAnalysisMode] = React.useState('population');
  const [hotspotMode, setHotspotMode] = React.useState('count');
  const [hotspotBufferKm, setHotspotBufferKm] = React.useState(0);
  const [hotspotAnalysisSummary, setHotspotAnalysisSummary] = React.useState(null);
  const [bufferRadiusKm, setBufferRadiusKm] = React.useState(1);
  const [bufferSourceMode, setBufferSourceMode] = React.useState('click-point');
  const [bufferDistanceUnit, setBufferDistanceUnit] = React.useState('km');
  const [bufferUseMultipleRings, setBufferUseMultipleRings] = React.useState(false);
  const [bufferRingInput, setBufferRingInput] = React.useState('1,3,5');
  const [bufferDissolve, setBufferDissolve] = React.useState(false);
  const [bufferLineSide, setBufferLineSide] = React.useState('both');
  const [bufferPolygonDirection, setBufferPolygonDirection] = React.useState('outside');
  const [bufferUseVariableDistance, setBufferUseVariableDistance] = React.useState(false);
  const [bufferDistanceField, setBufferDistanceField] = React.useState('');
  const [proximityScale, setProximityScale] = React.useState(1);
  const [populationRadiusKm, setPopulationRadiusKm] = React.useState(1);
  const [populationLoading, setPopulationLoading] = React.useState(false);
  const [populationResult, setPopulationResult] = React.useState(null);
  const [populationCircle, setPopulationCircle] = React.useState(null);
  // Resultado del último análisis — renderizado como tarjeta React (no popup Leaflet)
  const [analysisResult, setAnalysisResult] = React.useState(null);
  const [expandedDGs, setExpandedDGs] = React.useState({});

  const mapLayersForRender = React.useMemo(
    () => filterLayersByStatus(filteredLayers, selectedKpiStatus),
    [filteredLayers, selectedKpiStatus]
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  React.useEffect(() => {
    if (!mapRef.current) return;

    const handleFullscreenFix = () => {
      setTimeout(() => {
        if (!mapRef.current || !mapRef.current._loaded) return;
        try {
          mapRef.current.invalidateSize({ pan: false });
        } catch (e) {
          console.warn('[MapView] fullscreen invalidateSize error', e);
        }
      }, 200);
      safeInvalidate(mapRef, 300);
    };

    document.addEventListener('fullscreenchange', handleFullscreenFix);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenFix);
    };
  }, []);

  const isFullstackRouteMode = React.useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const fullstack = String(params.get('fullstack') || '').toLowerCase();
    const modeParam = String(params.get('mode') || '').toLowerCase();
    return fullstack === '1' || fullstack === 'true' || modeParam === 'fullstack';
  }, []);

  const isMobile = mode === 'mobile';
  const proximityBandRadiiKm = React.useMemo(
    () =>
      PROXIMITY_BAND_MINUTES.map((minutes) =>
        Number((minutesToKilometers(minutes) * proximityScale).toFixed(2))
      ),
    [proximityScale]
  );
  const proximityRadiusKm = React.useMemo(
    () => proximityBandRadiiKm[proximityBandRadiiKm.length - 1] || 0,
    [proximityBandRadiiKm]
  );
  const bufferSourceLayer = React.useMemo(() => {
    if (selectedLayer?.data?.features?.length) return selectedLayer;
    return (
      filteredLayers.find((layer) => layer.visible && layer?.data?.features?.length) ||
      null
    );
  }, [selectedLayer, filteredLayers]);
  const bufferNumericFields = React.useMemo(
    () => collectNumericFieldCandidates(bufferSourceLayer),
    [bufferSourceLayer]
  );
  React.useEffect(() => {
    if (!bufferNumericFields.length) {
      if (bufferDistanceField) setBufferDistanceField('');
      return;
    }

    if (bufferDistanceField && bufferNumericFields.includes(bufferDistanceField)) {
      return;
    }

    setBufferDistanceField(bufferNumericFields[0]);
  }, [bufferDistanceField, bufferNumericFields]);
  const adjustPopulationRadius = React.useCallback((delta) => {
    setPopulationRadiusKm((current) =>
      Number(clampNumber(current + delta, 0.5, POPULATION_RADIUS_MAX_KM).toFixed(1))
    );
  }, []);
  const handlePopulationRadiusInput = React.useCallback((value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setPopulationRadiusKm(
      Number(clampNumber(parsed, 0.5, POPULATION_RADIUS_MAX_KM).toFixed(1))
    );
  }, []);
  const adjustProximityScale = React.useCallback((delta) => {
    setProximityScale((current) =>
      Number(clampNumber(current + delta, 1, 12).toFixed(1))
    );
  }, []);
  const clearProximityPreview = React.useCallback(() => {
    advancedGroupRef.current?.clearLayers();
    setAnalysisResult((current) =>
      current?.type === 'proximity' ? null : current
    );
  }, []);
  const adjustBufferRadius = React.useCallback((delta) => {
    setBufferRadiusKm((current) =>
      Number(clampNumber(current + delta, 0.5, 30).toFixed(1))
    );
  }, []);
  const adjustHotspotBuffer = React.useCallback((delta) => {
    setHotspotBufferKm((current) =>
      Number(clampNumber(current + delta, 0, HOTSPOT_BUFFER_MAX_KM).toFixed(1))
    );
  }, []);
  const activeAnalysisMode = React.useMemo(
    () => resolveActiveAnalysisMode(activeTool, analysisMode),
    [activeTool, analysisMode]
  );
  const visibleSignature = React.useMemo(
    () => buildVisibleSignature(mapLayersForRender),
    [mapLayersForRender]
  );
  const activeFocusLayerId = selectedFeature?.layerId || focusedLayerId || null;
  const isFocusMode = Boolean(activeFocusLayerId || hoveredLayerId);

  // Keep layerStateRef in sync with current render values.
  // Placed after activeFocusLayerId is declared so it reads the correct value.
  // Runs on every render before any effect, so Leaflet callbacks always see
  // fresh state without triggering extra re-renders.
  layerStateRef.current = {
    focusedLayerId: activeFocusLayerId,
    hoveredLayerId,
    selectedFeatureKey: selectedFeature?.properties?.__featureKey || null,
  };
  const showAdvancedTools =
    mapReadyVersion > 0 &&
    (isFullscreenActive || isFullstackRouteMode || isFullstackModeForced);
  const [isTouchLikeViewport, setIsTouchLikeViewport] = React.useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(hover: none), (pointer: coarse)').matches;
  });
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(hover: none), (pointer: coarse)');
    const handleChange = (event) => {
      setIsTouchLikeViewport(Boolean(event?.matches));
    };

    setIsTouchLikeViewport(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const isMobileLikeLayout =
    isMobile || isCompactViewport || mobileModeManual || isTouchLikeViewport;
  const showToolsTopMenuButton = !isMobileLikeLayout;
  React.useEffect(() => {
    if (!showAdvancedTools) {
      setActiveMenu(null);
    }
  }, [showAdvancedTools]);
  React.useEffect(() => {
    if (!isMobileLikeLayout) return;
    if (activeMenu !== 'tools') return;
    setActiveMenu(null);
  }, [activeMenu, isMobileLikeLayout]);
  const proximityLayer = React.useMemo(
    () => resolveLayerForProximity(filteredLayers, selectedLayerId),
    [filteredLayers, selectedLayerId]
  );
  const hotspotLayers = React.useMemo(
    () => resolveLayersForHotspot(filteredLayers, selectedLayerId),
    [filteredLayers, selectedLayerId]
  );
  const hotspotLayer = hotspotLayers[0] || null;
  const orderedBaseMaps = React.useMemo(() => {
    const priority = {
      topographic: 0,
      satellite: 1,
      dark: 2,
      cartographic: 3,
    };

    return [...baseMaps].sort((left, right) => {
      const leftPriority = priority[left.id] ?? 99;
      const rightPriority = priority[right.id] ?? 99;
      return leftPriority - rightPriority;
    });
  }, [baseMaps]);
  const layersByDG = React.useMemo(() => {
    const groups = new Map();

    layers
      .filter(
        (layer) =>
          !layer.referenceLayer && !layer.isBaseMap && !layer.hideInLayersPanel
      )
      .forEach((layer) => {
      const dg = layer.dg || 'Sin DG';
      if (!groups.has(dg)) groups.set(dg, []);
      groups.get(dg).push(layer);
      });

    return Array.from(groups.entries()).sort(([left], [right]) =>
      left.localeCompare(right, 'es')
    );
  }, [layers]);
  const manageableLayerCount = React.useMemo(
    () => layersByDG.reduce((total, [, dgLayers]) => total + dgLayers.length, 0),
    [layersByDG]
  );

  React.useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  React.useEffect(() => {
    filteredLayersRef.current = mapLayersForRender;
  }, [mapLayersForRender]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const timerId = window.setTimeout(() => {
      populationEngineRef.current
        ?.ensureLoaded?.()
        .catch(() => {});
    }, 800);

    return () => {
      window.clearTimeout(timerId);
    };
  }, []);

  React.useEffect(() => {
    allLayersRef.current = layers;
  }, [layers]);

  React.useEffect(() => {
    globalKpiSummaryRef.current = globalKpiSummary;
  }, [globalKpiSummary]);

  const requestGlobalKpiSummary = React.useCallback(
    (options = {}) => {
      const { force = false, silent = false } = options;
      const hasSummary = Boolean(globalKpiSummaryRef.current);
      if (USE_STATIC_EXECUTIVE_KPIS) {
        setGlobalKpiSummary(buildStaticKpiSummaryPayload());
        setGlobalKpiLoading(false);
        setGlobalKpiError('');
        return Promise.resolve();
      }

      let cancelled = false;
      if (!silent) {
        setGlobalKpiLoading(true);
      }
      if (!silent || !hasSummary) {
        setGlobalKpiError('');
      }

      const requestPromise = fetchKpiSummary({ force })
        .then((payload) => {
          if (cancelled) return;
          setGlobalKpiSummary(payload || null);
          setGlobalKpiError('');
        })
        .catch((error) => {
          if (cancelled) return;
          const errorMessage = String(error?.message || '');
          const isMissingKpiRoute =
            error?.status === 404 ||
            errorMessage.toLowerCase().includes('ruta no encontrada');
          if (isMissingKpiRoute) {
            setGlobalKpiSummary(buildStaticKpiSummaryPayload());
            setGlobalKpiError('');
            return;
          }

          // Si falla la red/API y aún no tenemos resumen, usamos fallback canónico
          // para evitar que el panel se quede con subtotales parciales de capas cargadas.
          if (!hasSummary) {
            setGlobalKpiSummary(buildStaticKpiSummaryPayload());
          }
          setGlobalKpiError(
            'No se pudieron actualizar los KPIs globales en este momento.'
          );
        })
        .finally(() => {
          if (cancelled) return;
          if (!silent) {
            setGlobalKpiLoading(false);
          }
        });

      requestPromise.cancel = () => {
        cancelled = true;
      };

      return requestPromise;
    },
    []
  );

  React.useEffect(() => {
    const request = requestGlobalKpiSummary({ force: true, silent: false });
    const intervalId = window.setInterval(() => {
      requestGlobalKpiSummary({ force: false, silent: true });
    }, 120000);

    return () => {
      request?.cancel?.();
      window.clearInterval(intervalId);
    };
  }, [requestGlobalKpiSummary]);

  React.useEffect(() => {
    if (activeMenu !== 'panel') return;
    const request = requestGlobalKpiSummary({ force: true, silent: false });
    return () => {
      request?.cancel?.();
    };
  }, [activeMenu, requestGlobalKpiSummary]);

  const clearAdvancedOverlays = React.useCallback(() => {
    advancedGroupRef.current?.clearLayers();
    hotspotGroupRef.current?.clearLayers();
    mapRef.current?.closePopup();
    setAnalysisResult(null);
    setPopulationCircle(null);
    setPopulationResult(null);
    setHotspotAnalysisSummary(null);
  }, []);

  const activateOperationalTool = React.useCallback(
    (toolId, options = {}) => {
      const { drawMode, measureMode, nextAnalysisMode } = options;

      clearAdvancedOverlays();

      if (drawMode) setDrawToolMode(drawMode);
      if (measureMode) setMeasureToolMode(measureMode);
      if (nextAnalysisMode) setAnalysisMode(nextAnalysisMode);

      if (toolId === 'layers') {
        // Todas las cajas de DG inician cerradas. El usuario decide cuáles abrir.
        setExpandedDGs({});
      }

      if (toolId === 'population') {
        setActiveMenu(null);
      }

      setActiveTool(toolId || null);

      if (toolId === 'draw') {
        actions.setInteractionMode(drawMode || drawToolMode);
        return;
      }
      if (toolId === 'measure') {
        actions.setInteractionMode(measureMode || measureToolMode);
        return;
      }
      actions.setInteractionMode('select');
    },
    [actions, clearAdvancedOverlays, drawToolMode, measureToolMode]
  );

  const activateSelectMode = React.useCallback(() => {
    clearAdvancedOverlays();
    setActiveTool(null);
    actions.setInteractionMode('select');
  }, [actions, clearAdvancedOverlays]);

  const handleTopMenuToggle = React.useCallback(
    (menuId) => {
      if (!ADVANCED_TOP_MENUS.includes(menuId)) return;
      if (!showToolsTopMenuButton && menuId === 'tools') return;

      const nextMenu = activeMenu === menuId ? null : menuId;
      setActiveMenu(nextMenu);
      if (!nextMenu) return;

      if (menuId === 'layers') {
        activateOperationalTool('layers');
        return;
      }
      if (menuId === 'more') {
        activateOperationalTool('basemap');
        return;
      }
      if (menuId === 'tools') {
        if (!TOOLS_OPERATION_SET.has(activeTool)) {
          setActiveTool(null);
        }
        actions.setInteractionMode('select');
        return;
      }

      // panel
      clearAdvancedOverlays();
      actions.setInteractionMode('select');
      if (!TOOLS_OPERATION_SET.has(activeTool)) {
        setActiveTool(null);
      }
    },
    [
      activeMenu,
      activeTool,
      actions,
      activateOperationalTool,
      clearAdvancedOverlays,
      showToolsTopMenuButton,
    ]
  );

  React.useEffect(() => {
    if (activeTool !== 'draw') return;
    actions.setInteractionMode(drawToolMode);
  }, [actions, activeTool, drawToolMode]);

  React.useEffect(() => {
    if (activeTool !== 'measure') return;
    actions.setInteractionMode(measureToolMode);
  }, [actions, activeTool, measureToolMode]);

  React.useEffect(() => {
    if (
      activeTool !== 'analysis' &&
      activeTool !== 'population' &&
      activeTool !== 'buffer' &&
      activeTool !== 'proximity'
    ) {
      return;
    }

    actions.setInteractionMode('select');
  }, [actions, activeTool, analysisMode]);

  React.useEffect(() => {
    if (activeTool === 'population') return;

    lastPopulationQueryRef.current = null;
    setPopulationLoading(false);
    setPopulationResult(null);
    setPopulationCircle(null);
    removePopulationLayer({
      layerRef: populationLayerRef,
      map: mapRef.current,
    });

    if (selectedFeature?.properties?.tipo === 'POBLACION') {
      actions.setSelectedFeature(null);
    }
  }, [activeTool, actions, selectedFeature]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const syncFullscreenState = () => {
      const mapContainer = mapRef.current?.getContainer()?.closest('.map-view');
      const fullscreenElement = document.fullscreenElement;
      const nextIsFullscreen = Boolean(
        fullscreenElement &&
          mapContainer &&
          (fullscreenElement === mapContainer ||
            fullscreenElement.contains(mapContainer))
      );

      setIsFullscreenActive(nextIsFullscreen);
      if (nextIsFullscreen) {
        safeInvalidate(mapRef, 250);
      }


      if (!nextIsFullscreen) {
        clearAdvancedOverlays();
        setActiveTool(null);
        setActiveMenu(null);
        actions.setInteractionMode('select');
      }
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, [actions, clearAdvancedOverlays]);

  React.useEffect(() => {
    if (mapRef.current) return undefined;

    let isCancelled = false;
    let retryTimerId = 0;
    let resizeDebounceId = 0;
    let handleWindowResize = null;
    const refreshTimerIds = [];
    let overlayLayersStore = overlayLayersRef.current;
    let overlayGroupInstance = null;
    let measurementGroupInstance = null;
    let drawingGroupInstance = null;
    let advancedGroupInstance = null;
    let hotspotGroupInstance = null;
    let mapInstance = null;

    const clearRefreshTimers = () => {
      refreshTimerIds.forEach((timerId) => window.clearTimeout(timerId));
      refreshTimerIds.length = 0;
    };

    const scheduleRefresh = () => {
      clearRefreshTimers();
      [0, 220].forEach((delay) => {
        const timerId = window.setTimeout(() => {
          if (isCancelled || !mapRef.current) return;
          if (!mapRef.current._loaded) return;
          refreshMapLayout(mapRef.current);
        }, delay);
        refreshTimerIds.push(timerId);
      });
    };

    const initializeMap = () => {
      if (isCancelled || !mapNodeRef.current || mapRef.current) return;

      const rect = mapNodeRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        retryTimerId = window.setTimeout(initializeMap, 120);
        return;
      }

      const container = mapNodeRef.current;
      if (container._leaflet_id) {
        delete container._leaflet_id;
      }

      let map;
      try {
        map = L.map(container, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          zoomControl: false,
          doubleClickZoom: true,
          preferCanvas: USE_CANVAS_RENDERER,
        });
      } catch (error) {
        console.error('[MapView] map init failed', error);
        retryTimerId = window.setTimeout(initializeMap, 300);
        return;
      }

      const overlayGroup = L.layerGroup().addTo(map);
      const measurementGroup = L.layerGroup().addTo(map);
      const drawingGroup = L.layerGroup().addTo(map);
      const advancedGroup = L.layerGroup().addTo(map);
      const hotspotGroup = L.layerGroup().addTo(map);
      overlayGroupInstance = overlayGroup;
      measurementGroupInstance = measurementGroup;
      drawingGroupInstance = drawingGroup;
      advancedGroupInstance = advancedGroup;
      hotspotGroupInstance = hotspotGroup;
      mapInstance = map;
      if (mode !== 'mobile' && !isCompactViewport) {
        L.control.zoom({ position: 'bottomleft' }).addTo(map);
      }
      map.whenReady(() => {
        scheduleRefresh();
      });

      let syncDebounceId = null;
      const syncMapMeta = () => {
        const center = map.getCenter();
        const bounds = map.getBounds();
        setMapMeta({
          zoom: map.getZoom(),
          center: { lat: center.lat, lng: center.lng },
        });
        // Debounce el update de viewport bounds para no disparar carga de capas
        // en cada frame del pan — espera 300ms tras el último evento.
        window.clearTimeout(syncDebounceId);
        syncDebounceId = window.setTimeout(() => {
          actionsRef.current.setMapViewportBounds({
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth(),
          });
        }, 300);
      };

      syncMapMeta();
      map.on('moveend zoomend', syncMapMeta);

      mapRef.current = map;
      overlayGroupRef.current = overlayGroup;
      measurementGroupRef.current = measurementGroup;
      drawingGroupRef.current = drawingGroup;
      advancedGroupRef.current = advancedGroup;
      hotspotGroupRef.current = hotspotGroup;
      setMapReadyVersion((value) => value + 1);

      handleWindowResize = () => {
        window.clearTimeout(resizeDebounceId);
        resizeDebounceId = window.setTimeout(() => {
          if (!mapRef.current) return;
          scheduleRefresh();
        }, 90);
      };

      window.addEventListener('resize', handleWindowResize);

      actionsRef.current.setMapApi({
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        resetView: () => {
          if (!map._loaded) return;
          const hasFeatures = filteredLayersRef.current.some(
            (l) => l.visible && l.data?.features?.length > 0
          );
          try {
            if (hasFeatures) {
              fitVisibleLayers(map, filteredLayersRef.current);
            }
          } catch (e) {
            console.warn('[MapView] resetView fitBounds error', e);
          }
        },
        zoomToLayer: (layerId) => {
          const layer = allLayersRef.current.find((item) => item.id === layerId);
          if (!layer?.data?.features?.length) return;

          const bounds = L.geoJSON(layer.data).getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds.pad(0.18), { maxZoom: 15 });
          }
        },
        zoomToFeatureBounds: (feature) => {
          try {
            const bounds = L.geoJSON(feature).getBounds();
            if (bounds.isValid()) {
              map.fitBounds(bounds.pad(0.5), { maxZoom: 17, animate: true });
              return;
            }
          } catch {
            // fall through to coordinate fallback
          }
          const coords = feature?.geometry?.coordinates;
          if (!coords) return;
          const [lng, lat] = Array.isArray(coords[0]) ? coords[0] : coords;
          map.setView([lat, lng], 16, { animate: true });
        },
        toggleFullscreen: () => {
          const container = map.getContainer().closest('.map-view');
          if (!container) return;

          if (!document.fullscreenElement) {
            container.requestFullscreen?.();
          } else {
            document.exitFullscreen?.();
          }
        },
        invalidateSize: () => scheduleRefresh(),
      });

      scheduleRefresh();

      initializeMap.cleanup = () => {
        map.off('moveend zoomend', syncMapMeta);
        window.clearTimeout(syncDebounceId);
      };
    };

    initializeMap();

    return () => {
      isCancelled = true;
      window.clearTimeout(retryTimerId);
      window.clearTimeout(resizeDebounceId);
      clearRefreshTimers();
      if (handleWindowResize) {
        window.removeEventListener('resize', handleWindowResize);
      }
      initializeMap.cleanup?.();
      overlayLayersStore?.clear();
      overlayGroupInstance?.clearLayers();
      measurementGroupInstance?.clearLayers();
      drawingGroupInstance?.clearLayers();
      advancedGroupInstance?.clearLayers();
      hotspotGroupInstance?.clearLayers();
      mapInstance?.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      overlayGroupRef.current = null;
      measurementGroupRef.current = null;
      drawingGroupRef.current = null;
      advancedGroupRef.current = null;
      hotspotGroupRef.current = null;
      actionsRef.current.setMapApi(null);
      actionsRef.current.setMapViewportBounds(null);
    };
  }, [isCompactViewport, mode]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const baseLayer = L.tileLayer(activeBaseMap.url, {
      attribution: activeBaseMap.attribution,
      keepBuffer: 4,           // pre-carga más tiles alrededor — panning más suave
      updateWhenIdle: true,    // actualiza tiles solo cuando el mapa está quieto
      updateWhenZooming: false, // NO cargar tiles durante animación de zoom
    });
    const refresh = () => refreshMapLayout(map);
    const handleLoad = () => {
      refresh();
    };
    const handleTileError = () => {
      if (ENABLE_GIS_DEBUG_LOGS) {
        console.warn('[MapView] tile error', activeBaseMap.id);
      }
    };

    baseLayer.on('load', handleLoad);
    baseLayer.on('tileerror', handleTileError);
    baseLayer.addTo(map);
    baseLayerRef.current = baseLayer;
    refresh();

    return () => {
      baseLayer.off('load', handleLoad);
      baseLayer.off('tileerror', handleTileError);
      baseLayer.remove();
      if (baseLayerRef.current === baseLayer) {
        baseLayerRef.current = null;
      }
    };
  }, [activeBaseMap, mapReadyVersion]);

  // ── Effect 1: Layer CREATION ─────────────────────────────────────────────
  // Dep: visibleSignature (firma estable de capas visibles) en vez de
  //   filteredLayers directamente.
  //
  // MOTIVACIÓN: filteredLayers puede cambiar de referencia sin que los datos
  //   reales cambien (ej. sync periódico de BD crea nuevos objetos JS pero
  //   mismos datos). Si usáramos filteredLayers como dep, Effect 1 re-crearía
  //   TODAS las capas Leaflet cada 90 s — causa parpadeo visible.
  //
  // Con visibleSignature: solo se dispara si cambia visibilidad, datos, o estilo.
  //   El cuerpo usa filteredLayersRef.current (actualizado por el efecto anterior
  //   en orden de declaración) para leer los datos frescos sin cerrar sobre ellos.
  React.useEffect(() => {
    const overlayGroup = overlayGroupRef.current;
    if (!overlayGroup) return;

    // Lee los datos frescos desde el ref (siempre actualizado antes de este effect)
    const currentFilteredLayers = filteredLayersRef.current;

    overlayGroup.clearLayers();
    overlayLayersRef.current.clear();

    if (ENABLE_GIS_DEBUG_LOGS) {
      console.log('FILTER DEBUG:', currentFilteredLayers.map((l) => ({
        name: l.name,
        visible: l.visible,
        features: l.features?.length ?? 0,
        dataFeatures: l.data?.features?.length ?? 0,
      })));

      const visibleWithData = currentFilteredLayers.filter((l) =>
        l.visible &&
        ((l.features?.length ?? 0) > 0 || (l.data?.features?.length ?? 0) > 0)
      );
      const visibleNoData = currentFilteredLayers.filter((l) =>
        l.visible &&
        !((l.features?.length ?? 0) > 0 || (l.data?.features?.length ?? 0) > 0)
      );

      console.log(
        `[MapView] Effect 1 — total filteredLayers: ${currentFilteredLayers.length}`,
        `| renderizando: ${visibleWithData.length}`,
        `| visible sin datos: ${visibleNoData.length}`,
      );
      visibleWithData.forEach((l) =>
        console.log(`  ✅ ${l.name}: ${l.features?.length ?? l.data?.features?.length ?? 0} features, color: ${l.style?.color ?? l.color ?? '?'}`),
      );
      visibleNoData.forEach((l) =>
        console.log(`  ⚠️  ${l.name}: visible=true pero 0 features — ¿no cargó aún?`),
      );
    }

    currentFilteredLayers
      .filter((layer) => {
        const hasFeatures =
          (layer.features?.length ?? 0) > 0 ||
          (layer.data?.features?.length ?? 0) > 0;

        return layer.visible !== false && hasFeatures;
      })
      .forEach((layer) => {
        if (isMovilidadLayer(layer)) {
          const data = layer?.data || {};
          const geometryTypes = Array.isArray(data.features)
            ? data.features.map((f) => f?.geometry?.type)
            : [];
          console.log("FEATURES:", geometryTypes);
        }

        const geoJsonLayer = createGeoJsonLayer({
          // Popup Leaflet deshabilitado: dejamos únicamente la tarjeta lateral.
          enablePopup: false,
          // layerStateRef is already up-to-date (updated synchronously during
          // render, before this effect runs).
          stateRef: layerStateRef,
          interactive:
            interactionMode === 'select' &&
            !(
              activeTool === 'population' ||
              activeAnalysisMode !== 'idle'
            ),
          layer,
          onSelectFeature: (payload) => {
            actionsRef.current.focusLayer(payload.layerId);
            actionsRef.current.setSelectedFeature(payload);
          },
        });

        geoJsonLayer.addTo(overlayGroup);
        overlayLayersRef.current.set(layer.id, { geoJsonLayer, layer });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    visibleSignature,  // firma estable — no cambia por sync de BD sin datos nuevos
    interactionMode,
    mapReadyVersion,
    activeTool,
    activeAnalysisMode,
  ]);

  // ── Effect 2: Style-only UPDATE ──────────────────────────────────────────
  // Runs when hover / focus / selection changes.
  // Updates existing Leaflet layers via setStyle() — zero layer recreation,
  // zero gray-map flicker.
  React.useEffect(() => {
    const { focusedLayerId, hoveredLayerId: hovered, selectedFeatureKey } =
      layerStateRef.current;

    overlayLayersRef.current.forEach(({ geoJsonLayer, layer }) => {
      geoJsonLayer.eachLayer((sublayer) => {
        // ── Path layers (líneas, polígonos, CircleMarker) ──────────────────
        // resetStyle re-invoca options.style(feature) que lee layerStateRef.current.
        // GUARD: L.Marker (divIcon) no tiene setStyle — llamar resetStyle sobre él
        // lanzaría un error, por eso verificamos instanceof L.Path primero.
        if (sublayer instanceof L.Path) {
          if (geoJsonLayer?._map && sublayer?._map) {
            try {
              geoJsonLayer.resetStyle(sublayer);
            } catch {
              // Race condition normal durante clear/repaint masivo de capas.
            }
          }
        }

        // CircleMarker: el radio no es una propiedad CSS, debe actualizarse explícitamente.
        if (sublayer instanceof L.CircleMarker) {
          const featureKey =
            sublayer.feature?.properties?.__featureKey || null;
          const visualState = getVisualState({
            focusedLayerId,
            hoveredLayerId: hovered,
            isLayerVisible: layer.visible,
            layerId: layer.id,
            selectedFeatureKey,
            featureKey,
          });
          const isSelected = visualState === 'selected';
          const isHighlighted = visualState === 'highlighted';
          const baseRadius = layer.style?.pointRadius || 6;
          sublayer.setRadius(
            baseRadius + (isSelected ? 2 : isHighlighted ? 1 : 0)
          );
        }

        // ── L.Marker con divIcon (iconos personalizados PNG o status) ────────
        if (sublayer instanceof L.Marker) {
          const featureKey =
            sublayer.feature?.properties?.__featureKey || null;
          const visualState = getVisualState({
            focusedLayerId,
            hoveredLayerId: hovered,
            isLayerVisible: layer.visible,
            layerId: layer.id,
            selectedFeatureKey,
            featureKey,
          });
          const element = sublayer.getElement?.();

          // Icono PNG: actualiza data-vs → CSS aplica filtros de brillo/opacidad
          const iconWrap = element?.querySelector('.lmap-icon-wrap');
          if (iconWrap) {
            iconWrap.dataset.vs = visualState;
          }

          // Icono de status (círculo blanco + borde de color):
          // Reconstruye el icon con el nuevo visual state para cambiar tamaño y sombra.
          const statusWrap = element?.querySelector('.lmap-status-wrap');
          if (statusWrap) {
            const props = sublayer.feature?.properties || {};
            const baseStatusColor = getFeatureStatusColor(props);
            if (baseStatusColor) {
              const effectiveColor = visualState === 'selected'
                ? '#691C32'
                : visualState === 'highlighted'
                  ? '#C5A572'
                  : baseStatusColor;
              const iconSize = visualState === 'selected' ? 34 : visualState === 'highlighted' ? 30 : 28;
              sublayer.setIcon(
                L.divIcon({
                  className: 'status-marker',
                  html: buildStatusIconHtml(effectiveColor, visualState),
                  iconSize: [iconSize, iconSize],
                  iconAnchor: [iconSize / 2, iconSize / 2],
                  popupAnchor: [0, -(iconSize / 2) - 2],
                })
              );
            }
          }
        }
      });
    });
  }, [hoveredLayerId, activeFocusLayerId, selectedFeature]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !map._loaded) return undefined;

    const currentFilteredLayers = filteredLayersRef.current;
    const hasFeatures = currentFilteredLayers.some(
      (l) => l.visible && l.data?.features?.length > 0
    );

    if (hasFeatures) {
      try {
        fitVisibleLayers(map, currentFilteredLayers);
      } catch (e) {
        console.warn('[MapView] fitBounds error', e);
      }
    }

    const timerIds = [220, 300].map((delay) =>
      window.setTimeout(() => {
        refreshMapLayout(map);
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [mapReadyVersion, visibleSignature]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMobile) return undefined;

    const timerIds = [220].map((delay) =>
      window.setTimeout(() => {
        refreshMapLayout(map);
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [isCompactViewport, isMobile, mapReadyVersion, mobileSheet]);

  React.useEffect(() => {
    const map = mapRef.current;
    const isMobileViewport = isMobile || isCompactViewport;
    if (!map || !isMobileViewport) return undefined;

    const timerIds = [200, 300].map((delay) =>
      window.setTimeout(() => {
        if (!mapRef.current || !mapRef.current._loaded) return;

        try {
          mapRef.current.invalidateSize({ pan: false });
        } catch (e) {
          console.warn('[MapView] mobile invalidateSize error', e);
        }

        const currentFilteredLayers = filteredLayersRef.current;
        const hasFeatures = currentFilteredLayers.some(
          (l) => l.visible && l.data?.features?.length > 0
        );

        if (hasFeatures) {
          try {
            fitVisibleLayers(mapRef.current, currentFilteredLayers);
          } catch (e) {
            console.warn('[MapView] mobile fitBounds error', e);
          }
        }
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [isCompactViewport, isMobile, visibleSignature]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const container = map.getContainer();
    const isMapEditing = isMeasureMode(interactionMode) || isDrawMode(interactionMode);

    container.style.cursor = isMapEditing ? 'crosshair' : '';
    if (isMapEditing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();

    return () => {
      container.style.cursor = '';
      map.doubleClickZoom.enable();
    };
  }, [interactionMode, mapReadyVersion]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMeasureMode(interactionMode)) return undefined;

    const handleClick = (event) => {
      actions.setMeasurement((current) => {
        const nextPoints = current.finished
          ? [event.latlng]
          : [...current.points, event.latlng];

        return {
          type: interactionMode,
          points: nextPoints,
          summary: buildMeasurementSummary(interactionMode, nextPoints),
          finished: false,
        };
      });
    };

    const handleDoubleClick = () => {
      actions.setMeasurement((current) => {
        const minimumPoints =
          current.type === 'measure-distance' ? 2 : 3;

        if (current.points.length < minimumPoints) return current;

        return {
          ...current,
          finished: true,
          summary: buildMeasurementSummary(current.type, current.points),
        };
      });
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDoubleClick);

    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDoubleClick);
    };
  }, [actions, interactionMode, mapReadyVersion]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !isDrawMode(interactionMode)) return undefined;

    const handleClick = (event) => {
      if (interactionMode === 'draw-point') {
        actions.addDrawItem(buildDrawItem('draw-point', [event.latlng]));
        return;
      }

      actions.setDrawDraft((current) => {
        const currentPoints =
          current.type === interactionMode ? current.points : [];
        return {
          type: interactionMode,
          points: [...currentPoints, event.latlng],
        };
      });
    };

    const handleDoubleClick = () => {
      actions.setDrawDraft((current) => {
        const minimumPoints =
          current.type === 'draw-line' ? 2 : 3;

        if (current.points.length < minimumPoints) return current;

        actions.addDrawItem(buildDrawItem(current.type, current.points));
        return EMPTY_DRAW_DRAFT;
      });
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDoubleClick);

    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDoubleClick);
    };
  }, [actions, interactionMode, mapReadyVersion]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || activeTool !== 'population') return undefined;

    const handleClick = async (event) => {
      map.closePopup();
      if (populationQueryBusyRef.current) return;

      const nextQuery = buildPopulationQuerySnapshot(
        event.latlng,
        populationRadiusKm
      );
      if (isSamePopulationQuery(lastPopulationQueryRef.current, nextQuery)) {
        return;
      }

      populationQueryBusyRef.current = true;
      setPopulationLoading(true);
      const querySeq = populationQuerySeqRef.current + 1;
      populationQuerySeqRef.current = querySeq;
      lastPopulationQueryRef.current = nextQuery;

      try {
        const result = await populationEngineRef.current.queryRadius(
          event.latlng,
          populationRadiusKm
        );
        if (!result) return;

        ensurePopulationLayer({
          data: result.collection,
          layerRef: populationLayerRef,
          map,
        });

        setPopulationResult(result);
        setPopulationCircle({
          center: event.latlng,
          radius: populationRadiusKm * METERS_PER_KILOMETER,
        });
        actions.setSelectedFeature(buildPopulationSelection(result));
      } catch (error) {
        const errorResult = {
          error: error.message,
          center: event.latlng,
          radiusKm: populationRadiusKm,
          featureCount: 0,
          POBTOT: 0,
          POBFEM: 0,
          POBMAS: 0,
        };
        setPopulationResult(errorResult);
        setPopulationCircle({
          center: event.latlng,
          radius: populationRadiusKm * METERS_PER_KILOMETER,
        });
        actions.setSelectedFeature(buildPopulationSelection(errorResult));
      } finally {
        if (populationQuerySeqRef.current === querySeq) {
          populationQueryBusyRef.current = false;
          setPopulationLoading(false);
        }
      }
    };

    map.on('click', handleClick);

    return () => {
      map.off('click', handleClick);
    };
  }, [actions, activeTool, populationRadiusKm]);

  // Recalcula población automáticamente cuando cambia el radio
  // usando el último punto consultado, sin pedir nuevo clic.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (!(activeTool === 'population' || activeAnalysisMode === 'population')) {
      return undefined;
    }

    const lastQuery = lastPopulationQueryRef.current;
    if (!lastQuery || !Number.isFinite(lastQuery.lat) || !Number.isFinite(lastQuery.lng)) {
      return undefined;
    }

    const center = L.latLng(lastQuery.lat, lastQuery.lng);
    const nextQuery = buildPopulationQuerySnapshot(center, populationRadiusKm);
    if (isSamePopulationQuery(lastPopulationQueryRef.current, nextQuery)) {
      return undefined;
    }

    const timerId = window.setTimeout(async () => {
      const querySeq = populationQuerySeqRef.current + 1;
      populationQuerySeqRef.current = querySeq;
      lastPopulationQueryRef.current = nextQuery;
      setPopulationLoading(true);

      try {
        const result = await populationEngineRef.current.queryRadius(
          center,
          populationRadiusKm
        );
        if (!result || populationQuerySeqRef.current !== querySeq) return;

        ensurePopulationLayer({
          data: result.collection,
          layerRef: populationLayerRef,
          map,
        });

        if (activeTool === 'population') {
          setPopulationResult(result);
          setPopulationCircle({
            center,
            radius: populationRadiusKm * METERS_PER_KILOMETER,
          });
          actions.setSelectedFeature(buildPopulationSelection(result));
        }

        if (activeAnalysisMode === 'population') {
          const advancedGroup = advancedGroupRef.current;
          if (advancedGroup) {
            advancedGroup.clearLayers();
            L.circle(center, {
              radius: populationRadiusKm * METERS_PER_KILOMETER,
              color: '#1d4ed8',
              weight: 2,
              fillColor: '#60a5fa',
              fillOpacity: 0.16,
            }).addTo(advancedGroup);

            L.circleMarker(center, {
              radius: 5,
              color: '#1d4ed8',
              weight: 2,
              fillColor: '#ffffff',
              fillOpacity: 1,
            }).addTo(advancedGroup);
          }
          setAnalysisResult({ type: 'population', data: result });
        }
      } catch (error) {
        if (populationQuerySeqRef.current !== querySeq) return;

        if (activeTool === 'population') {
          const errorResult = {
            error: error.message,
            center,
            radiusKm: populationRadiusKm,
            featureCount: 0,
            POBTOT: 0,
            POBFEM: 0,
            POBMAS: 0,
          };
          setPopulationResult(errorResult);
          setPopulationCircle({
            center,
            radius: populationRadiusKm * METERS_PER_KILOMETER,
          });
          actions.setSelectedFeature(buildPopulationSelection(errorResult));
        }

        if (activeAnalysisMode === 'population') {
          setAnalysisResult({ type: 'population', data: { error: error.message } });
        }
      } finally {
        if (populationQuerySeqRef.current === querySeq) {
          setPopulationLoading(false);
        }
      }
    }, 180);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [actions, activeAnalysisMode, activeTool, populationRadiusKm]);

  React.useEffect(() => {
    const advancedGroup = advancedGroupRef.current;
    if (!advancedGroup) return;

    if (!populationCircle) {
      if (activeTool === 'population') {
        advancedGroup.clearLayers();
      }
      return;
    }

    advancedGroup.clearLayers();
    L.circle(populationCircle.center, {
      radius: populationCircle.radius,
      ...POPULATION_BUFFER_STYLE,
    }).addTo(advancedGroup);
  }, [activeTool, populationCircle]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !selectedFeature ||
      activeTool === 'population' ||
      isMeasureMode(interactionMode) ||
      isDrawMode(interactionMode)
    ) {
      return undefined;
    }

    const handleDetailDismiss = (event) => {
      const target = event?.originalEvent?.target;

      if (
        target instanceof Element &&
        (target.closest('.leaflet-interactive') ||
          target.closest('.leaflet-control'))
      ) {
        return;
      }

      window.dispatchEvent(new CustomEvent('gis-detail-panel-dismiss'));
    };

    map.on('click', handleDetailDismiss);

    return () => {
      map.off('click', handleDetailDismiss);
    };
  }, [activeTool, interactionMode, mapReadyVersion, selectedFeature]);

  React.useEffect(() => {
    const measurementGroup = measurementGroupRef.current;
    if (!measurementGroup) return;

    measurementGroup.clearLayers();

    const points = measurement.points || [];
    if (!points.length) return;

    points.forEach((point) => {
      L.circleMarker(point, {
        radius: 5,
        color: '#691C32',
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).addTo(measurementGroup);
    });

    if (measurement.type === 'measure-distance' && points.length >= 2) {
      const line = L.polyline(points, {
        color: '#691C32',
        weight: 3,
        dashArray: '10 6',
      }).addTo(measurementGroup);

      const summary =
        measurement.summary || formatDistance(computeDistance(points));
      line.bindTooltip(summary, {
        permanent: true,
        direction: 'top',
        className: 'measure-label',
      });
    }

    if (measurement.type === 'measure-area' && points.length >= 2) {
      if (measurement.finished && points.length >= 3) {
        const polygon = L.polygon(points, {
          color: '#691C32',
          weight: 2,
          fillColor: '#C5A572',
          fillOpacity: 0.22,
        }).addTo(measurementGroup);

        const summary =
          measurement.summary || formatArea(computeGeodesicArea(points));
        polygon.bindTooltip(summary, {
          permanent: true,
          direction: 'center',
          className: 'measure-label measure-label--area',
        });
      } else {
        L.polyline(points, {
          color: '#691C32',
          weight: 3,
          dashArray: '8 6',
        }).addTo(measurementGroup);
      }
    }
  }, [mapReadyVersion, measurement]);

  React.useEffect(() => {
    const drawingGroup = drawingGroupRef.current;
    if (!drawingGroup) return;

    drawingGroup.clearLayers();

    drawItems.forEach((item) => {
      if (item.type === 'draw-point' && item.points[0]) {
        const marker = L.circleMarker(item.points[0], {
          radius: 6,
          color: '#006341',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(drawingGroup);

        marker.bindTooltip('Punto', {
          permanent: true,
          direction: 'top',
          className: 'measure-label',
        });
      }

      if (item.type === 'draw-line' && item.points.length >= 2) {
        const line = L.polyline(item.points, {
          color: '#006341',
          weight: 3,
        }).addTo(drawingGroup);

        if (item.summary) {
          line.bindTooltip(item.summary, {
            permanent: true,
            direction: 'top',
            className: 'measure-label measure-label--draw',
          });
        }
      }

      if (item.type === 'draw-polygon' && item.points.length >= 3) {
        const polygon = L.polygon(item.points, {
          color: '#006341',
          weight: 2,
          fillColor: '#006341',
          fillOpacity: 0.16,
        }).addTo(drawingGroup);

        if (item.summary) {
          polygon.bindTooltip(item.summary, {
            permanent: true,
            direction: 'center',
            className: 'measure-label measure-label--draw',
          });
        }
      }
    });

    if (drawDraft.points.length) {
      if (drawDraft.type === 'draw-line') {
        L.polyline(drawDraft.points, {
          color: '#006341',
          weight: 3,
          dashArray: '8 6',
        }).addTo(drawingGroup);
      }

      if (drawDraft.type === 'draw-polygon') {
        L.polyline(drawDraft.points, {
          color: '#006341',
          weight: 3,
          dashArray: '8 6',
        }).addTo(drawingGroup);
      }

      drawDraft.points.forEach((point) => {
        L.circleMarker(point, {
          radius: 4,
          color: '#006341',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(drawingGroup);
      });
    }
  }, [drawDraft, drawItems, mapReadyVersion]);

  React.useEffect(() => {
    const map = mapRef.current;
    const advancedGroup = advancedGroupRef.current;
    if (!map || !advancedGroup) return undefined;
    if (activeAnalysisMode === 'idle') return undefined;

    const handleClick = async (event) => {
      advancedGroup.clearLayers();
      map.closePopup();
      setAnalysisResult(null);

      if (activeAnalysisMode === 'buffer') {
        const clickedPointFeature = turf.point([event.latlng.lng, event.latlng.lat]);
        const baseDistanceKm = Number(bufferRadiusKm);
        const defaultRingDistancesKm =
          bufferUseMultipleRings && !bufferUseVariableDistance
            ? parseRingDistancesInput(
                bufferRingInput,
                bufferDistanceUnit,
                baseDistanceKm
              )
            : [baseDistanceKm];

        let sourceModeUsed = bufferSourceMode;
        let sourceLayerName = null;
        let sourceNotice = null;
        let sourceFeatures = [clickedPointFeature];

        if (
          bufferSourceMode === 'selected-feature' &&
          selectedFeature?.feature?.geometry
        ) {
          sourceFeatures = [selectedFeature.feature];
          sourceLayerName = selectedFeature.layerName || null;
        } else if (
          bufferSourceMode === 'selected-layer' &&
          bufferSourceLayer?.data?.features?.length
        ) {
          const sourcePool = bufferSourceLayer.data.features.filter(
            (feature) => Boolean(feature?.geometry)
          );
          const truncatedCount = Math.max(
            0,
            sourcePool.length - BUFFER_MAX_SOURCE_FEATURES
          );
          sourceFeatures = sourcePool.slice(0, BUFFER_MAX_SOURCE_FEATURES);
          sourceLayerName = bufferSourceLayer.name || null;
          if (truncatedCount > 0) {
            sourceNotice = `Se procesaron ${BUFFER_MAX_SOURCE_FEATURES} de ${sourcePool.length} elementos para mantener rendimiento.`;
          }
        } else if (bufferSourceMode !== 'click-point') {
          sourceModeUsed = 'click-point';
          sourceNotice = 'No se encontró la fuente seleccionada, se aplicó buffer al punto de clic.';
        }

        const bufferBands = [];
        const sourceGeometryTypes = new Set();

        for (let featureIndex = 0; featureIndex < sourceFeatures.length; featureIndex += 1) {
          const sourceFeature = sourceFeatures[featureIndex];
          if (!sourceFeature?.geometry) continue;

          if (featureIndex > 0 && featureIndex % BUFFER_QUERY_YIELD_EVERY === 0) {
            // Cede el hilo para evitar congelamientos al procesar capas grandes.
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 0));
          }

          const geometryType = featureGeometryType(sourceFeature);
          sourceGeometryTypes.add(geometryType);

          let ringDistancesKm = defaultRingDistancesKm;
          if (bufferUseVariableDistance && bufferDistanceField) {
            const rawDistance = sourceFeature?.properties?.[bufferDistanceField];
            const parsedDistance = parseNumericProperty(rawDistance);
            const variableDistanceKm = toBufferKilometers(
              parsedDistance,
              bufferDistanceUnit
            );
            ringDistancesKm = [
              variableDistanceKm > 0 ? variableDistanceKm : baseDistanceKm,
            ];
          }

          const featureBands = buildBufferBandsForFeature(sourceFeature, ringDistancesKm, {
            lineSide: bufferLineSide,
            polygonDirection: bufferPolygonDirection,
          });

          featureBands.forEach((band) => {
            band.properties = {
              ...(band.properties || {}),
              sourceIndex: featureIndex + 1,
            };
            bufferBands.push(band);
          });
        }

        if (!bufferBands.length) {
          setAnalysisResult({
            type: 'buffer',
            data: {
              radiusKm: Number(baseDistanceKm.toFixed(3)),
              ringDistancesKm: defaultRingDistancesKm,
              sourceMode: sourceModeUsed,
              sourceLayerName,
              outputFeatureCount: 0,
              ringsCount: 0,
              dissolve: bufferDissolve,
              variableField:
                bufferUseVariableDistance && bufferDistanceField
                  ? bufferDistanceField
                  : null,
              lineSide: bufferLineSide,
              polygonDirection: bufferPolygonDirection,
              totalAreaKm2: 0,
              error:
                'No fue posible generar buffer con los parámetros actuales.',
              notice: sourceNotice,
            },
          });
          return;
        }

        const renderedBufferBands = bufferDissolve
          ? dissolveBufferFeatures(bufferBands)
          : bufferBands;

        const ringCount = renderedBufferBands.reduce(
          (maxValue, feature) =>
            Math.max(maxValue, Number(feature?.properties?.ringIndex || 1)),
          1
        );

        const bufferCollection = {
          type: 'FeatureCollection',
          features: renderedBufferBands,
        };

        L.geoJSON(bufferCollection, {
          style: (feature) => {
            const ringIndex = Number(feature?.properties?.ringIndex || 1);
            const color = getBufferRingColor(ringIndex);
            return {
              color,
              weight: 2,
              fillColor: color,
              fillOpacity: ringCount > 1 ? 0.14 : 0.1,
              dashArray: bufferDissolve ? null : '4 4',
            };
          },
        }).addTo(advancedGroup);

        L.circleMarker(event.latlng, {
          radius: 5,
          color: '#6366f1',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(advancedGroup);

        const totalAreaKm2 = renderedBufferBands.reduce((accumulator, feature) => {
          try {
            return accumulator + turf.area(feature) / 1000000;
          } catch {
            return accumulator;
          }
        }, 0);

        setAnalysisResult({
          type: 'buffer',
          data: {
            radiusKm: Number(baseDistanceKm.toFixed(3)),
            ringDistancesKm: defaultRingDistancesKm.map((distance) =>
              Number(distance.toFixed(3))
            ),
            sourceMode: sourceModeUsed,
            sourceLayerName,
            sourceFeatureCount: sourceFeatures.length,
            outputFeatureCount: renderedBufferBands.length,
            ringsCount: ringCount,
            dissolve: bufferDissolve,
            variableField:
              bufferUseVariableDistance && bufferDistanceField
                ? bufferDistanceField
                : null,
            lineSide: bufferLineSide,
            polygonDirection: bufferPolygonDirection,
            geometryTypes: Array.from(sourceGeometryTypes).filter(Boolean),
            totalAreaKm2: Number(totalAreaKm2.toFixed(3)),
            notice: sourceNotice,
          },
        });
        return;
      }

      if (activeAnalysisMode === 'population') {
        if (populationQueryBusyRef.current) return;

        populationQueryBusyRef.current = true;
        const querySeq = populationQuerySeqRef.current + 1;
        populationQuerySeqRef.current = querySeq;
        lastPopulationQueryRef.current = buildPopulationQuerySnapshot(
          event.latlng,
          populationRadiusKm
        );

        try {
          const result = await populationEngineRef.current.queryRadius(
            event.latlng,
            populationRadiusKm
          );

          ensurePopulationLayer({
            data: result.collection,
            layerRef: populationLayerRef,
            map,
          });

          L.circle(event.latlng, {
            radius: populationRadiusKm * METERS_PER_KILOMETER,
            color: '#1d4ed8',
            weight: 2,
            fillColor: '#60a5fa',
            fillOpacity: 0.16,
          }).addTo(advancedGroup);

          L.circleMarker(event.latlng, {
            radius: 5,
            color: '#1d4ed8',
            weight: 2,
            fillColor: '#ffffff',
            fillOpacity: 1,
          }).addTo(advancedGroup);

          setAnalysisResult({ type: 'population', data: result });
        } catch (error) {
          setAnalysisResult({ type: 'population', data: { error: error.message } });
        } finally {
          if (populationQuerySeqRef.current === querySeq) {
            populationQueryBusyRef.current = false;
          }
        }
        return;
      }

      if (activeAnalysisMode === 'proximity') {
        const visibleLayers = filteredLayers.filter(
          (layer) => layer.visible && layer?.data?.features?.length
        );
        const essentialLayers = visibleLayers.filter((layer) =>
          Boolean(resolveNeedCategoryFromLayerName(layer?.name))
        );
        const sourceLayers = essentialLayers.length
          ? essentialLayers
          : visibleLayers;

        const proximityStats = await collectProximityByLayer({
          centerLatLng: event.latlng,
          layers: sourceLayers,
          bandRadiiKm: proximityBandRadiiKm,
        });
        const { groupedResults } = proximityStats;

        const ringStyles = [
          {
            color: '#22c55e',
            fillColor: '#dcfce7',
            fillOpacity: 0.14,
          },
          {
            color: '#f59e0b',
            fillColor: '#fef3c7',
            fillOpacity: 0.12,
          },
          {
            color: '#f97316',
            fillColor: '#ffedd5',
            fillOpacity: 0.1,
          },
        ];

        for (let bandIndex = proximityBandRadiiKm.length - 1; bandIndex >= 0; bandIndex -= 1) {
          const radiusKm = Number(proximityBandRadiiKm[bandIndex] || 0);
          if (!radiusKm || radiusKm <= 0) continue;
          const style = ringStyles[bandIndex] || ringStyles[ringStyles.length - 1];

          L.circle(event.latlng, {
            radius: radiusKm * METERS_PER_KILOMETER,
            color: style.color,
            weight: 2,
            fillColor: style.fillColor,
            fillOpacity: style.fillOpacity,
          }).addTo(advancedGroup);
        }

        L.circleMarker(event.latlng, {
          radius: 6,
          color: '#1d4ed8',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(advancedGroup);

        setAnalysisResult({
          type: 'proximity',
          data: {
            layerName: `Cobertura peatonal 5/15/20 min · ${proximityRadiusKm} km`,
            radiusKm: proximityRadiusKm,
            ringMinutes: PROXIMITY_BAND_MINUTES,
            ringRadiiKm: proximityBandRadiiKm,
            point: {
              lat: Number(event.latlng.lat),
              lng: Number(event.latlng.lng),
            },
            groupedResults,
            needsCoverage: proximityStats.needsCoverage,
            needsCoveredCount: proximityStats.needsCoveredCount,
            needsTotalCount: proximityStats.needsTotalCount,
            needsScorePercent: proximityStats.needsScorePercent,
            missingNeeds: proximityStats.missingNeeds,
            bandTotals: proximityStats.bandTotals || [],
          },
        });
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [
    activeAnalysisMode,
    bufferDissolve,
    bufferDistanceField,
    bufferDistanceUnit,
    bufferLineSide,
    bufferPolygonDirection,
    bufferRadiusKm,
    bufferRingInput,
    bufferSourceLayer,
    bufferSourceMode,
    bufferUseMultipleRings,
    bufferUseVariableDistance,
    filteredLayers,
    populationRadiusKm,
    proximityScale,
    proximityBandRadiiKm,
    proximityRadiusKm,
    selectedFeature,
  ]);

  React.useEffect(() => {
    const map = mapRef.current;
    const hotspotGroup = hotspotGroupRef.current;
    if (!map || !hotspotGroup) return undefined;

    const redrawHotspot = () => {
      hotspotGroup.clearLayers();

      if (activeTool !== 'hotspot' || !hotspotLayer) {
        setHotspotAnalysisSummary(null);
        return;
      }

      const bufferCenter = hotspotBufferKm > 0 ? map.getCenter() : null;
      const hotspotAnalysis = buildHotspotBins({
        cellSizePx: 72,
        layers: hotspotLayers,
        map,
        mode: hotspotMode,
        bufferCenter,
        bufferRadiusKm: hotspotBufferKm,
      });
      const bins = Array.isArray(hotspotAnalysis?.bins)
        ? hotspotAnalysis.bins
        : [];
      const summary = hotspotAnalysis?.summary || null;
      setHotspotAnalysisSummary(summary);

      if (summary?.bufferApplied && bufferCenter) {
        L.circle(bufferCenter, {
          radius: hotspotBufferKm * METERS_PER_KILOMETER,
          color: '#0f766e',
          weight: 1.8,
          opacity: 0.9,
          fillColor: '#0f766e',
          fillOpacity: 0.06,
          dashArray: '5 4',
        }).addTo(hotspotGroup);
      }

      if (!bins.length) return;
      const maxMetric = Number(bins[0]?.metric || 0);

      bins.slice(0, 180).forEach((bin) => {
        const metricValue = Number(bin.metric || 0);
        const color = getHotspotColor(metricValue, maxMetric);
        const intensity = maxMetric > 0 ? metricValue / maxMetric : 0;

        const marker = L.circleMarker(bin.center, {
          radius: Math.max(14, Math.min(42, 14 + intensity * 28)),
          color,
          weight: 1.4,
          fillColor: color,
          fillOpacity: Math.min(0.9, 0.48 + intensity * 0.38),
          opacity: Math.min(1, 0.74 + intensity * 0.26),
        }).addTo(hotspotGroup);

        const tooltip =
          hotspotMode === 'spend'
            ? `${bin.count} obra(s) · ${formatCurrencyValue(bin.weight)}`
            : `${bin.count} obra(s)`;
        marker.bindTooltip(tooltip, {
          permanent: false,
          direction: 'top',
          className: 'measure-label',
        });
      });
    };

    redrawHotspot();
    map.on('moveend zoomend', redrawHotspot);

    return () => {
      map.off('moveend zoomend', redrawHotspot);
      hotspotGroup.clearLayers();
    };
  }, [
    activeTool,
    hotspotBufferKm,
    hotspotLayer,
    hotspotLayers,
    hotspotMode,
    mapReadyVersion,
  ]);

  React.useEffect(() => {
    measurementGroupRef.current?.clearLayers();
    clearAdvancedOverlays();
    setActiveTool(null);
    setActiveMenu(null);
  }, [clearAdvancedOverlays, clearSignal, mapReadyVersion]);

  const operationalVisibleLayers = React.useMemo(
    () =>
      mapLayersForRender.filter(
        (layer) =>
          layer?.visible &&
          isOperationalWorkLayer(layer) &&
          Array.isArray(layer?.data?.features) &&
          layer.data.features.length > 0
      ),
    [mapLayersForRender]
  );
  const analysisStatusSummary = React.useMemo(() => {
    const workStatusMap = new Map();
    const summary = {
      total: 0,
      entregadas: 0,
      terminadas: 0,
      enProceso: 0,
      sinIniciar: 0,
      completionPct: 0,
      avgProgress: 0,
      riskCount: 0,
    };

    operationalVisibleLayers.forEach((layer) => {
      const movilidadLayer = isMovilidadLayer(layer);
      const features = layer?.data?.features || [];
      features.forEach((feature, featureIndex) => {
        const geometryType = feature?.geometry?.type;
        if (movilidadLayer) {
          if (!shouldCountFeature(feature, layer)) return;
          if (!geometryType || isPointLikeGeometry(geometryType)) return;
        } else if (!isPointLikeGeometry(geometryType)) {
          return;
        }
        const statusKey = resolveFeatureStatus(feature?.properties || {});
        if (!statusKey) return;
        const workKey =
          buildFeatureWorkKey(feature) || `${layer.id || 'layer'}:${featureIndex}`;
        const previousStatus = workStatusMap.get(workKey);
        const previousPriority = STATUS_PRIORITY[previousStatus] || 0;
        const currentPriority = STATUS_PRIORITY[statusKey] || 0;
        if (!previousStatus || currentPriority > previousPriority) {
          workStatusMap.set(workKey, statusKey);
        }
      });
    });

    summary.total = workStatusMap.size;
    workStatusMap.forEach((statusKey) => {
      if (statusKey === 'entregado') summary.entregadas += 1;
      else if (statusKey === 'terminado') summary.terminadas += 1;
      else if (statusKey === 'proceso') summary.enProceso += 1;
      else if (statusKey === 'sin iniciar') summary.sinIniciar += 1;
    });
    summary.completionPct =
      summary.total > 0
        ? Math.round(((summary.entregadas + summary.terminadas) / summary.total) * 100)
        : 0;

    const progressValues = operationalVisibleLayers
      .map((layer) => Number(layerMetricsById.get(layer.id)?.averageProgress))
      .filter((value) => Number.isFinite(value));
    summary.avgProgress = progressValues.length
      ? Math.round(
          progressValues.reduce((total, value) => total + value, 0) /
            progressValues.length
        )
      : 0;
    summary.riskCount = operationalVisibleLayers.reduce(
      (total, layer) => total + Number(layerMetricsById.get(layer.id)?.riskCount || 0),
      0
    );

    return summary;
  }, [layerMetricsById, operationalVisibleLayers]);
  const analysisCoverageSummary = React.useMemo(() => {
    const geometryBuckets = {
      point: 0,
      line: 0,
      polygon: 0,
      other: 0,
    };
    const alcaldiaCounter = new Map();
    const dgCounter = new Map();
    let totalFeatures = 0;

    operationalVisibleLayers.forEach((layer) => {
      const layerFeatures = layer?.data?.features || [];
      const layerFeatureCount = layerFeatures.length;
      totalFeatures += layerFeatureCount;

      const dgName = String(layer?.dg || 'Sin DG').trim() || 'Sin DG';
      const dgState = dgCounter.get(dgName) || { layers: 0, features: 0 };
      dgState.layers += 1;
      dgState.features += layerFeatureCount;
      dgCounter.set(dgName, dgState);

      layerFeatures.forEach((feature) => {
        const bucket = resolveGeometryBucket(feature?.geometry?.type || '');
        geometryBuckets[bucket] += 1;

        const alcaldia = resolveFeatureAlcaldia(feature?.properties || {});
        alcaldiaCounter.set(alcaldia, (alcaldiaCounter.get(alcaldia) || 0) + 1);
      });
    });

    const toPercent = (value) =>
      totalFeatures > 0 ? Math.round((Number(value || 0) / totalFeatures) * 100) : 0;

    return {
      totalFeatures,
      totalLayers: operationalVisibleLayers.length,
      geometryBuckets,
      topAlcaldias: Array.from(alcaldiaCounter.entries())
        .map(([name, count]) => ({ name, count, pct: toPercent(count) }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 6),
      topDgs: Array.from(dgCounter.entries())
        .map(([name, stats]) => ({
          name,
          layers: Number(stats.layers || 0),
          features: Number(stats.features || 0),
          pct: toPercent(stats.features),
        }))
        .sort((left, right) => right.features - left.features)
        .slice(0, 6),
    };
  }, [operationalVisibleLayers]);

  const toolDetailPanel = React.useMemo(() => {
    if (!showAdvancedTools || !activeTool) return null;

    const bufferSourceName =
      bufferSourceMode === 'selected-feature'
        ? selectedFeature?.layerName || 'Sin elemento seleccionado'
        : bufferSourceLayer?.name || 'Sin capa activa';
    const bufferRadiusInUnit =
      bufferDistanceUnit === 'm'
        ? Math.round(bufferRadiusKm * METERS_PER_KILOMETER)
        : Number(bufferRadiusKm.toFixed(3));
    const bufferDistanceLabel =
      bufferDistanceUnit === 'm'
        ? `${bufferRadiusInUnit.toLocaleString('es-MX')} m`
        : `${bufferRadiusInUnit} km`;
    const proximitySnapshot =
      analysisResult?.type === 'proximity' ? analysisResult.data : null;
    const proximityRows = Array.isArray(proximitySnapshot?.groupedResults)
      ? proximitySnapshot.groupedResults
      : [];
    const proximityPoint = proximitySnapshot?.point || null;
    const proximityMinutesBands = Array.isArray(proximitySnapshot?.ringMinutes)
      ? proximitySnapshot.ringMinutes
      : PROXIMITY_BAND_MINUTES;
    const proximityRadiiBands = Array.isArray(proximitySnapshot?.ringRadiiKm)
      ? proximitySnapshot.ringRadiiKm
      : proximityBandRadiiKm;
    const hasProximityResult = Boolean(
      proximityPoint &&
        Number.isFinite(Number(proximityPoint.lat)) &&
        Number.isFinite(Number(proximityPoint.lng))
    );
    const parsedRingPreview = parseRingDistancesInput(
      bufferRingInput,
      bufferDistanceUnit,
      Number(bufferRadiusKm)
    );
    const bufferDetailContent = (idPrefix) => (
      <>
        <p>
          Buffer para puntos, líneas y polígonos: múltiple anillo, disolver bordes,
          distancia variable por campo y modo interior/exterior.
        </p>
        <div className="map-view__tools-row">
          <AdvancedToolChip
            active={bufferSourceMode === 'click-point'}
            onClick={() => setBufferSourceMode('click-point')}
          >
            Punto clic
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferSourceMode === 'selected-feature'}
            onClick={() => setBufferSourceMode('selected-feature')}
          >
            Elemento
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferSourceMode === 'selected-layer'}
            onClick={() => setBufferSourceMode('selected-layer')}
          >
            Capa
          </AdvancedToolChip>
        </div>
        <strong>{bufferSourceName}</strong>
        <div className="map-view__tools-row">
          <AdvancedToolChip
            active={bufferDistanceUnit === 'km'}
            onClick={() => setBufferDistanceUnit('km')}
          >
            km
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferDistanceUnit === 'm'}
            onClick={() => setBufferDistanceUnit('m')}
          >
            m
          </AdvancedToolChip>
        </div>
        <div className="map-view__tools-range">
          <label htmlFor={`${idPrefix}-radius-range`}>Distancia base</label>
          <div className="map-view__tools-range-actions">
            <button
              className="map-view__range-btn"
              onClick={() => adjustBufferRadius(-0.5)}
              type="button"
            >
              −
            </button>
            <button
              className="map-view__range-btn"
              onClick={() => setBufferRadiusKm(30)}
              type="button"
            >
              MAX
            </button>
            <button
              className="map-view__range-btn"
              onClick={() => adjustBufferRadius(0.5)}
              type="button"
            >
              +
            </button>
          </div>
          <input
            id={`${idPrefix}-radius-range`}
            max="30"
            min="0.5"
            onChange={(event) => setBufferRadiusKm(Number(event.target.value))}
            step="0.5"
            type="range"
            value={bufferRadiusKm}
          />
          <strong>{bufferDistanceLabel}</strong>
        </div>
        <div className="map-view__tools-row">
          <AdvancedToolChip
            active={!bufferUseMultipleRings}
            onClick={() => setBufferUseMultipleRings(false)}
          >
            Un anillo
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferUseMultipleRings}
            onClick={() => setBufferUseMultipleRings(true)}
          >
            Multi anillo
          </AdvancedToolChip>
        </div>
        {bufferUseMultipleRings ? (
          <div className="map-view__tools-range">
            <label htmlFor={`${idPrefix}-rings-input`}>
              Distancias (coma): ej. 1, 3, 5, 10
            </label>
            <input
              className="map-view__tools-input"
              id={`${idPrefix}-rings-input`}
              onChange={(event) => setBufferRingInput(event.target.value)}
              type="text"
              value={bufferRingInput}
            />
            <small className="map-view__tools-note">
              Se aplicarán: {parsedRingPreview.join(' · ')} km
            </small>
          </div>
        ) : null}
        <div className="map-view__tools-row">
          <AdvancedToolChip
            active={!bufferUseVariableDistance}
            onClick={() => setBufferUseVariableDistance(false)}
          >
            Distancia fija
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferUseVariableDistance}
            onClick={() => setBufferUseVariableDistance(true)}
          >
            Por atributo
          </AdvancedToolChip>
        </div>
        {bufferUseVariableDistance ? (
          <div className="map-view__tools-range">
            <label htmlFor={`${idPrefix}-field-select`}>Campo numérico</label>
            <select
              className="map-view__tools-select"
              id={`${idPrefix}-field-select`}
              onChange={(event) => setBufferDistanceField(event.target.value)}
              value={bufferDistanceField}
            >
              {bufferNumericFields.length ? (
                bufferNumericFields.map((fieldName) => (
                  <option key={fieldName} value={fieldName}>
                    {fieldName}
                  </option>
                ))
              ) : (
                <option value="">Sin campos numéricos</option>
              )}
            </select>
            <small className="map-view__tools-note">
              En modo atributo, cada entidad usa su propio valor de distancia.
            </small>
          </div>
        ) : null}
        <div className="map-view__tools-row">
          <AdvancedToolChip
            active={bufferLineSide === 'both'}
            onClick={() => setBufferLineSide('both')}
          >
            Línea ambos lados
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferLineSide === 'left'}
            onClick={() => setBufferLineSide('left')}
          >
            Línea izquierda
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferLineSide === 'right'}
            onClick={() => setBufferLineSide('right')}
          >
            Línea derecha
          </AdvancedToolChip>
        </div>
        <div className="map-view__tools-row">
          <AdvancedToolChip
            active={bufferPolygonDirection === 'outside'}
            onClick={() => setBufferPolygonDirection('outside')}
          >
            Polígono exterior
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferPolygonDirection === 'inside'}
            onClick={() => setBufferPolygonDirection('inside')}
          >
            Polígono interior
          </AdvancedToolChip>
        </div>
        <div className="map-view__tools-row">
          <AdvancedToolChip
            active={!bufferDissolve}
            onClick={() => setBufferDissolve(false)}
          >
            Bordes intactos
          </AdvancedToolChip>
          <AdvancedToolChip
            active={bufferDissolve}
            onClick={() => setBufferDissolve(true)}
          >
            Bordes disueltos
          </AdvancedToolChip>
        </div>
      </>
    );

    if (activeTool === 'basemap') {
      return (
        <div className="map-view__tools-detail map-view__tools-detail--menu">
          <span className="map-view__tools-title">Base map</span>
          <div className="map-view__tools-menu">
            {orderedBaseMaps.map((baseMap) => (
              <button
                className={`map-view__menu-item${
                  activeBaseMap.id === baseMap.id ? ' is-active' : ''
                }`}
                key={baseMap.id}
                onClick={() => {
                  actions.setActiveBaseMapId(baseMap.id);
                }}
                type="button"
              >
                <img
                  alt={`Vista previa ${getBasemapDisplayName(baseMap)}`}
                  className="map-view__menu-thumb"
                  loading="lazy"
                  src={baseMap.previewUrl}
                />
                <span className="map-view__menu-copy">
                  <strong>{getBasemapDisplayName(baseMap)}</strong>
                  <span>{baseMap.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (activeTool === 'layers') {
      return (
        <div className="map-view__tools-detail map-view__tools-detail--layers">
          <span className="map-view__tools-title">Capas</span>
          <div className="lp-header">
            <div className="lp-stats">
              <span>
                <strong>{visibleLayerCount}</strong> activas
              </span>
              <span>
                <strong>{manageableLayerCount}</strong> total
              </span>
            </div>
            <div className="lp-actions">
              <button
                className="lp-action-btn"
                onClick={() => actions.setAllLayersVisible(true)}
                type="button"
              >
                Encender todas
              </button>
              <button
                className="lp-action-btn"
                onClick={() => actions.setAllLayersVisible(false)}
                type="button"
              >
                Apagar todas
              </button>
            </div>
          </div>
          <div className="map-view__layers-scroll">
            {!layersByDG.length ? (
              <p className="map-view__tools-empty">No hay capas disponibles.</p>
            ) : (
              <div className="lp-groups">
                {layersByDG.map(([dg, dgLayers]) => {
                  const isExpanded = expandedDGs[dg] ?? false;
                  const visibleInGroup = dgLayers.filter((layer) => layer.visible).length;
                  const hasRisk = dgLayers.some(
                    (layer) => (layerMetricsById.get(layer.id)?.riskCount || 0) > 0
                  );

                  return (
                    <div className="lp-group" key={dg}>
                      <button
                        className={`lp-group__head${isExpanded ? ' is-open' : ''}${
                          hasRisk ? ' has-risk' : ''
                        }`}
                        onClick={() =>
                          setExpandedDGs((current) => ({
                            ...current,
                            [dg]: !isExpanded,
                          }))
                        }
                        type="button"
                      >
                        <span className="lp-group__chevron">
                          <svg
                            fill="none"
                            height="14"
                            viewBox="0 0 14 14"
                            width="14"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d={isExpanded ? 'M3 5l4 4 4-4' : 'M5 3l4 4-4 4'}
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.6"
                            />
                          </svg>
                        </span>
                        <span className="lp-group__name">{dg}</span>
                        <span className="lp-group__count">
                          {visibleInGroup}/{dgLayers.length}
                        </span>
                        {hasRisk ? <span className="lp-group__risk" /> : null}
                      </button>

                      {isExpanded ? (
                        <div className="lp-group__body">
                          {dgLayers.map((layer) => {
                            const metrics = layerMetricsById.get(layer.id) || {};
                            const isRisk = (metrics.riskCount || 0) > 0;
                            const status = getLayerStatus(
                              layer,
                              mapViewportBounds,
                              metrics
                            );

                            return (
                              <div
                                className={`lp-layer${isRisk ? ' is-risk' : ''}`}
                                key={layer.id}
                              >
                                <div className="lp-layer__main">
                                  <span
                                    className="lp-layer__sym"
                                    style={{ color: layer.style?.color || layer.color }}
                                  >
                                    {geomSymbol(layer.geometryType)}
                                  </span>
                                  <div className="lp-layer__info">
                                    <strong>{layer.name}</strong>
                                    <div className="lp-layer__meta">
                                      <span>{status.detail}</span>
                                    </div>
                                  </div>
                                  <LayerToggle
                                    checked={layer.visible}
                                    label={`${
                                      layer.visible ? 'Apagar' : 'Encender'
                                    } ${layer.name}`}
                                    onClick={() => actions.toggleLayerVisibility(layer.id)}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTool === 'draw') {
      return (
        <div className="map-view__tools-detail">
          <span className="map-view__tools-title">Dibujo</span>
          <div className="map-view__tools-row">
            <AdvancedToolChip
              active={drawToolMode === 'draw-point'}
              onClick={() => setDrawToolMode('draw-point')}
            >
              Punto
            </AdvancedToolChip>
            <AdvancedToolChip
              active={drawToolMode === 'draw-line'}
              onClick={() => setDrawToolMode('draw-line')}
            >
              Línea
            </AdvancedToolChip>
            <AdvancedToolChip
              active={drawToolMode === 'draw-polygon'}
              onClick={() => setDrawToolMode('draw-polygon')}
            >
              Polígono
            </AdvancedToolChip>
          </div>
        </div>
      );
    }

    if (activeTool === 'measure') {
      return (
        <div className="map-view__tools-detail">
          <span className="map-view__tools-title">Medición</span>
          <div className="map-view__tools-row">
            <AdvancedToolChip
              active={measureToolMode === 'measure-distance'}
              onClick={() => setMeasureToolMode('measure-distance')}
            >
              Distancia
            </AdvancedToolChip>
            <AdvancedToolChip
              active={measureToolMode === 'measure-area'}
              onClick={() => setMeasureToolMode('measure-area')}
            >
              Área
            </AdvancedToolChip>
          </div>
        </div>
      );
    }

    if (activeTool === 'population') {
      return (
        <div className="map-view__tools-detail map-view__tools-detail--population">
          <span className="map-view__tools-title">Poblacion INEGI</span>
          <p>
            Haz clic en el mapa para iniciar. Luego mueve el radio y la suma de
            población se actualiza automáticamente por área.
          </p>
          <div className="map-view__tool-highlight map-view__tool-highlight--population">
            <span>Radio activo</span>
            <strong>{populationRadiusKm.toFixed(1)} km</strong>
          </div>
          <div className="map-view__tools-row">
            {[0.5, 1, 2, 3, 5, 7, 10].map((radius) => (
              <AdvancedToolChip
                active={populationRadiusKm === radius}
                key={radius}
                onClick={() => setPopulationRadiusKm(radius)}
              >
                {radius} km
              </AdvancedToolChip>
            ))}
          </div>
          <div className="map-view__tools-range">
            <label htmlFor="population-radius-range">Radio de análisis</label>
            <div className="map-view__tools-range-actions">
              <button
                className="map-view__range-btn"
                onClick={() => adjustPopulationRadius(-0.1)}
                type="button"
              >
                −
              </button>
              <button
                className="map-view__range-btn"
                onClick={() => setPopulationRadiusKm(POPULATION_RADIUS_MAX_KM)}
                type="button"
              >
                MAX
              </button>
              <button
                className="map-view__range-btn"
                onClick={() => adjustPopulationRadius(0.1)}
                type="button"
              >
                +
              </button>
            </div>
            <input
              id="population-radius-range"
              max={POPULATION_RADIUS_MAX_KM}
              min="0.5"
              onChange={(event) =>
                setPopulationRadiusKm(
                  Number(
                    clampNumber(
                      Number(event.target.value),
                      0.5,
                      POPULATION_RADIUS_MAX_KM
                    ).toFixed(1)
                  )
                )
              }
              step="0.1"
              type="range"
              value={populationRadiusKm}
            />
            <strong>{populationRadiusKm.toFixed(1)} km</strong>
          </div>
          {populationResult?.error ? <strong>{populationResult.error}</strong> : null}
        </div>
      );
    }

    if (activeTool === 'buffer') {
      return (
        <div className="map-view__tools-detail">
          <span className="map-view__tools-title">Buffer</span>
          {bufferDetailContent('buffer')}
        </div>
      );
    }

    if (activeTool === 'proximity') {
      return (
        <div className="map-view__tools-detail map-view__tools-detail--proximity">
          <span className="map-view__tools-title">Proximidad (5 / 15 / 20 min)</span>
          <p>
            Haz clic en el mapa para trazar los tres anillos y ver el desglose por capa.
          </p>
          <div className="map-view__tool-highlight map-view__tool-highlight--proximity">
            <span>Cobertura peatonal escalada</span>
            <strong>
              5' {proximityRadiiBands[0] || 0} km · 15' {proximityRadiiBands[1] || 0} km
              {' · '}
              20' {proximityRadiiBands[2] || 0} km
            </strong>
          </div>
          <div className="map-view__tools-range">
            <label htmlFor="prox-scale-range">Aumentar radio</label>
            <div className="map-view__tools-range-actions">
              <button
                className="map-view__range-btn"
                onClick={() => adjustProximityScale(-0.5)}
                type="button"
              >
                −
              </button>
              <button
                className="map-view__range-btn"
                onClick={() => setProximityScale(12)}
                type="button"
              >
                MAX
              </button>
              <button
                className="map-view__range-btn"
                onClick={() => adjustProximityScale(0.5)}
                type="button"
              >
                +
              </button>
            </div>
            <input
              id="prox-scale-range"
              max="12"
              min="1"
              onChange={(event) => setProximityScale(Number(event.target.value))}
              step="0.5"
              type="range"
              value={proximityScale}
            />
            <strong>x{proximityScale.toFixed(1)} · radio máximo {proximityRadiusKm} km</strong>
          </div>

          {hasProximityResult ? (
            <>
              <div className="map-view__prox-head">
                <span>
                  {Number(proximityPoint.lat).toFixed(4)}, {Number(proximityPoint.lng).toFixed(4)}
                </span>
                <button
                  className="map-view__prox-clear"
                  onClick={clearProximityPreview}
                  type="button"
                >
                  Limpiar
                </button>
              </div>
              <div className="map-view__prox-table-wrap">
                <table className="map-view__prox-table">
                  <thead>
                    <tr>
                      <th>Capa</th>
                      {proximityMinutesBands.map((minutes) => (
                        <th key={`prox-head-${minutes}`}>{minutes}'</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {proximityRows.length ? (
                      proximityRows.slice(0, 14).map((row) => (
                        <tr key={row.label}>
                          <td title={row.label}>{row.label}</td>
                          {(row.counts || []).map((count, index) => (
                            <td key={`${row.label}-count-${index}`}>
                              {Number(count || 0).toLocaleString('es-MX')}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={1 + proximityMinutesBands.length}>
                          No se encontraron elementos cercanos.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="map-view__tools-note">
              Aún sin consulta. Haz clic en el mapa para calcular cobertura.
            </p>
          )}
        </div>
      );
    }

    if (activeTool === 'analysis') {
      const geometryRows = [
        {
          id: 'point',
          label: 'Puntos',
          count: analysisCoverageSummary.geometryBuckets.point,
        },
        {
          id: 'line',
          label: 'Líneas',
          count: analysisCoverageSummary.geometryBuckets.line,
        },
        {
          id: 'polygon',
          label: 'Polígonos',
          count: analysisCoverageSummary.geometryBuckets.polygon,
        },
        {
          id: 'other',
          label: 'Otros',
          count: analysisCoverageSummary.geometryBuckets.other,
        },
      ];

      return (
        <div className="map-view__tools-detail map-view__tools-detail--analysis">
          <span className="map-view__tools-title">Análisis de información</span>
          <div className="map-view__tools-row">
            <AdvancedToolChip
              active={analysisMode === 'population'}
              onClick={() => setAnalysisMode('population')}
            >
              Población
            </AdvancedToolChip>
            <AdvancedToolChip
              active={analysisMode === 'buffer'}
              onClick={() => setAnalysisMode('buffer')}
            >
              Buffer
            </AdvancedToolChip>
            <AdvancedToolChip
              active={analysisMode === 'proximity'}
              onClick={() => setAnalysisMode('proximity')}
            >
              Proximidad
            </AdvancedToolChip>
            <AdvancedToolChip
              active={analysisMode === 'status'}
              onClick={() => setAnalysisMode('status')}
            >
              Estado
            </AdvancedToolChip>
            <AdvancedToolChip
              active={analysisMode === 'coverage'}
              onClick={() => setAnalysisMode('coverage')}
            >
              Cobertura
            </AdvancedToolChip>
          </div>
          <p>
            {analysisMode === 'population'
              ? 'Haz clic en el mapa para iniciar y ajusta el radio para actualizar la suma automáticamente.'
              : analysisMode === 'buffer'
                ? 'Haz clic en el mapa para ejecutar buffer avanzado.'
                : analysisMode === 'proximity'
                  ? 'Haz clic en el mapa para evaluar cobertura de servicios esenciales en 5, 15 y 20 minutos.'
                  : analysisMode === 'status'
                    ? 'Resumen ejecutivo del estado de obra para las capas visibles.'
                    : 'Cobertura territorial y distribución geométrica de la vista actual.'}
          </p>
          <div className="map-view__tools-row">
            {analysisMode === 'population'
              ? [0.5, 1, 2, 3, 5, 7, 10].map((radius) => (
                  <AdvancedToolChip
                    active={populationRadiusKm === radius}
                    key={radius}
                    onClick={() => setPopulationRadiusKm(radius)}
                  >
                    {radius} km
                  </AdvancedToolChip>
                ))
              : null}
          </div>
          {analysisMode === 'buffer' ? bufferDetailContent('buffer-analysis') : null}
          {analysisMode === 'population' ? (
            <div className="map-view__tools-range">
              <label htmlFor="population-radius-range-analysis">
                Radio de análisis
              </label>
              <div className="map-view__tools-range-actions">
                <button
                  className="map-view__range-btn"
                  onClick={() => adjustPopulationRadius(-0.1)}
                  type="button"
                >
                  −
                </button>
                <button
                  className="map-view__range-btn"
                  onClick={() => setPopulationRadiusKm(POPULATION_RADIUS_MAX_KM)}
                  type="button"
                >
                  MAX
                </button>
                <button
                  className="map-view__range-btn"
                  onClick={() => adjustPopulationRadius(0.1)}
                  type="button"
                >
                  +
                </button>
              </div>
              <input
                id="population-radius-range-analysis"
                max={POPULATION_RADIUS_MAX_KM}
                min="0.5"
                onChange={(event) =>
                  setPopulationRadiusKm(
                    Number(
                      clampNumber(
                        Number(event.target.value),
                        0.5,
                        POPULATION_RADIUS_MAX_KM
                      ).toFixed(1)
                    )
                  )
                }
                step="0.1"
                type="range"
                value={populationRadiusKm}
              />
              <strong>{populationRadiusKm.toFixed(1)} km</strong>
            </div>
          ) : null}
          {analysisMode === 'proximity' ? (
            <>
              <div className="map-view__tools-range">
                <label htmlFor="prox-scale-range-analysis">Aumentar radio</label>
                <div className="map-view__tools-range-actions">
                  <button
                    className="map-view__range-btn"
                    onClick={() => adjustProximityScale(-0.5)}
                    type="button"
                  >
                    −
                  </button>
                  <button
                    className="map-view__range-btn"
                    onClick={() => setProximityScale(12)}
                    type="button"
                  >
                    MAX
                  </button>
                  <button
                    className="map-view__range-btn"
                    onClick={() => adjustProximityScale(0.5)}
                    type="button"
                  >
                    +
                  </button>
                </div>
                <input
                  id="prox-scale-range-analysis"
                  max="12"
                  min="1"
                  onChange={(event) => setProximityScale(Number(event.target.value))}
                  step="0.5"
                  type="range"
                  value={proximityScale}
                />
              </div>
              <strong>
                {proximityLayer?.name || selectedLayer?.name || 'Sin capa activa'} · 5/15/20 min · {proximityRadiusKm} km
              </strong>
            </>
          ) : null}
          {analysisMode === 'status' ? (
            <>
              <div className="map-view__analysis-grid">
                <article className="map-view__analysis-kpi map-view__analysis-kpi--info">
                  <span>Total obras</span>
                  <strong>
                    {Number(analysisStatusSummary.total || 0).toLocaleString('es-MX')}
                  </strong>
                </article>
                <article className="map-view__analysis-kpi map-view__analysis-kpi--ok">
                  <span>Obras inauguradas</span>
                  <strong>
                    {Number(analysisStatusSummary.entregadas || 0).toLocaleString('es-MX')}
                  </strong>
                </article>
                <article className="map-view__analysis-kpi map-view__analysis-kpi--ok">
                  <span>Obras terminadas</span>
                  <strong>
                    {Number(analysisStatusSummary.terminadas || 0).toLocaleString('es-MX')}
                  </strong>
                </article>
                <article className="map-view__analysis-kpi map-view__analysis-kpi--warn">
                  <span>Obras en proceso</span>
                  <strong>
                    {Number(analysisStatusSummary.enProceso || 0).toLocaleString('es-MX')}
                  </strong>
                </article>
                <article className="map-view__analysis-kpi map-view__analysis-kpi--risk">
                  <span>Obras sin iniciar</span>
                  <strong>
                    {Number(analysisStatusSummary.sinIniciar || 0).toLocaleString('es-MX')}
                  </strong>
                </article>
                <article className="map-view__analysis-kpi map-view__analysis-kpi--info">
                  <span>Cierre (inaugurada + terminada)</span>
                  <strong>{Number(analysisStatusSummary.completionPct || 0)}%</strong>
                </article>
              </div>
              <div className="map-view__analysis-row">
                <span className="map-view__analysis-pill">
                  Riesgos detectados: {Number(analysisStatusSummary.riskCount || 0).toLocaleString('es-MX')}
                </span>
                <span className="map-view__analysis-pill">
                  Avance promedio: {Number(analysisStatusSummary.avgProgress || 0)}%
                </span>
              </div>
            </>
          ) : null}
          {analysisMode === 'coverage' ? (
            <>
              <div className="map-view__analysis-grid">
                <article className="map-view__analysis-kpi map-view__analysis-kpi--info">
                  <span>Capas visibles</span>
                  <strong>
                    {Number(analysisCoverageSummary.totalLayers || 0).toLocaleString('es-MX')}
                  </strong>
                </article>
                <article className="map-view__analysis-kpi map-view__analysis-kpi--info">
                  <span>Elementos visibles</span>
                  <strong>
                    {Number(analysisCoverageSummary.totalFeatures || 0).toLocaleString('es-MX')}
                  </strong>
                </article>
              </div>
              <div className="map-view__analysis-row">
                {geometryRows.map((row) => (
                  <span className="map-view__analysis-pill" key={row.id}>
                    {row.label}: {Number(row.count || 0).toLocaleString('es-MX')}
                  </span>
                ))}
              </div>
              <div className="map-view__analysis-list">
                <strong>Top alcaldías (vista actual)</strong>
                {analysisCoverageSummary.topAlcaldias.length ? (
                  analysisCoverageSummary.topAlcaldias.map((row) => (
                    <div className="map-view__analysis-list-item" key={`alc-${row.name}`}>
                      <span>{row.name}</span>
                      <strong>
                        {Number(row.count || 0).toLocaleString('es-MX')} ({row.pct}%)
                      </strong>
                    </div>
                  ))
                ) : (
                  <p className="map-view__analysis-empty">Sin datos de alcaldía en la vista.</p>
                )}
              </div>
              <div className="map-view__analysis-list">
                <strong>Top DG por volumen</strong>
                {analysisCoverageSummary.topDgs.length ? (
                  analysisCoverageSummary.topDgs.map((row) => (
                    <div className="map-view__analysis-list-item" key={`dg-${row.name}`}>
                      <span>{row.name}</span>
                      <strong>
                        {Number(row.features || 0).toLocaleString('es-MX')} ({row.layers}{' '}
                        capas)
                      </strong>
                    </div>
                  ))
                ) : (
                  <p className="map-view__analysis-empty">Sin capas visibles para este análisis.</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      );
    }

    if (activeTool === 'hotspot') {
      const summary = hotspotAnalysisSummary || {
        totalFeatures: 0,
        totalWeight: 0,
        topAlcaldias: [],
      };
      const topAlcaldia = summary.topAlcaldias?.[0] || null;
      const hotspotMetricLabel =
        hotspotMode === 'spend' ? 'Índice de gasto' : 'Obras';
      const topAlcaldiaMetric =
        hotspotMode === 'spend'
          ? formatCurrencyValue(topAlcaldia?.weight || 0)
          : Number(topAlcaldia?.count || 0).toLocaleString('es-MX');

      return (
        <div className="map-view__tools-detail">
          <span className="map-view__tools-title">Hotspot de obras</span>
          <p>
            Buffer y concentración conectados a las capas de base de datos ya
            cargadas en mapa.
          </p>
          <strong>
            {hotspotLayers.length
              ? `${hotspotLayers.length} capa(s) en análisis · ${hotspotLayer?.name || 'Capa prioritaria'}`
              : 'Selecciona o activa una capa con datos'}
          </strong>
          <div className="map-view__tools-row">
            <AdvancedToolChip
              active={hotspotMode === 'count'}
              onClick={() => setHotspotMode('count')}
            >
              Por obras
            </AdvancedToolChip>
            <AdvancedToolChip
              active={hotspotMode === 'spend'}
              onClick={() => setHotspotMode('spend')}
            >
              Por gasto
            </AdvancedToolChip>
          </div>
          <div className="map-view__range-control">
            <button
              className="map-view__range-btn"
              onClick={() => adjustHotspotBuffer(-0.5)}
              type="button"
            >
              -0.5
            </button>
            <input
              max={HOTSPOT_BUFFER_MAX_KM}
              min="0"
              onChange={(event) =>
                setHotspotBufferKm(
                  Number(
                    clampNumber(
                      Number(event.target.value),
                      0,
                      HOTSPOT_BUFFER_MAX_KM
                    ).toFixed(1)
                  )
                )
              }
              step="0.5"
              type="range"
              value={hotspotBufferKm}
            />
            <button
              className="map-view__range-btn"
              onClick={() => adjustHotspotBuffer(0.5)}
              type="button"
            >
              +0.5
            </button>
          </div>
          <strong>
            Buffer del hotspot:{' '}
            {hotspotBufferKm > 0 ? `${hotspotBufferKm} km` : 'sin buffer'}
          </strong>
          <div className="map-view__analysis-grid">
            <article className="map-view__analysis-kpi map-view__analysis-kpi--info">
              <span>Obras analizadas</span>
              <strong>
                {Number(summary.totalFeatures || 0).toLocaleString('es-MX')}
              </strong>
            </article>
            <article className="map-view__analysis-kpi map-view__analysis-kpi--warn">
              <span>{hotspotMetricLabel}</span>
              <strong>
                {hotspotMode === 'spend'
                  ? formatCurrencyValue(summary.totalWeight || 0)
                  : Number(summary.totalFeatures || 0).toLocaleString('es-MX')}
              </strong>
            </article>
            <article className="map-view__analysis-kpi map-view__analysis-kpi--ok">
              <span>Alcaldía líder</span>
              <strong>{topAlcaldia?.name || 'Sin dato'}</strong>
            </article>
            <article className="map-view__analysis-kpi map-view__analysis-kpi--risk">
              <span>Valor líder</span>
              <strong>{topAlcaldia ? topAlcaldiaMetric : '—'}</strong>
            </article>
          </div>
          <div className="map-view__analysis-list">
            <strong>Top alcaldías del hotspot</strong>
            {summary.topAlcaldias?.length ? (
              summary.topAlcaldias.slice(0, 5).map((row) => (
                <div className="map-view__analysis-list-item" key={`hotspot-alc-${row.name}`}>
                  <span>{row.name}</span>
                  <strong>
                    {hotspotMode === 'spend'
                      ? formatCurrencyValue(row.weight || 0)
                      : `${Number(row.count || 0).toLocaleString('es-MX')} obras`}
                  </strong>
                </div>
              ))
            ) : (
              <p className="map-view__analysis-empty">
                Sin datos para construir hotspot en la vista actual.
              </p>
            )}
          </div>
        </div>
      );
    }

    return null;
  }, [
    activeTool,
    activeBaseMap.id,
    actions,
    analysisCoverageSummary,
    analysisMode,
    analysisStatusSummary,
    adjustBufferRadius,
    adjustHotspotBuffer,
    adjustPopulationRadius,
    adjustProximityScale,
    bufferDissolve,
    bufferDistanceField,
    bufferDistanceUnit,
    bufferLineSide,
    bufferNumericFields,
    bufferPolygonDirection,
    bufferRadiusKm,
    bufferRingInput,
    bufferSourceLayer,
    bufferSourceMode,
    bufferUseMultipleRings,
    bufferUseVariableDistance,
    drawToolMode,
    hotspotAnalysisSummary,
    hotspotBufferKm,
    hotspotLayer,
    hotspotLayers,
    hotspotMode,
    measureToolMode,
    orderedBaseMaps,
    populationRadiusKm,
    populationResult,
    proximityBandRadiiKm,
    proximityScale,
    proximityLayer,
    proximityRadiusKm,
    analysisResult,
    clearProximityPreview,
    selectedFeature,
    selectedLayer,
    showAdvancedTools,
    expandedDGs,
    layerMetricsById,
    layersByDG,
    manageableLayerCount,
    mapViewportBounds,
    visibleLayerCount,
  ]);

  const currentToolLabel =
    activeTool === 'basemap'
      ? 'Base map'
      : activeTool === 'layers'
        ? 'Capas'
        : activeTool === 'population'
          ? `Poblacion ${populationRadiusKm} km`
        : activeTool === 'buffer'
          ? `Buffer ${bufferRadiusKm} km`
          : activeTool === 'proximity'
            ? `Proximidad 5/15/20 min (${proximityRadiusKm} km)`
        : activeTool === 'analysis'
          ? analysisMode === 'buffer'
            ? `Buffer ${bufferRadiusKm} km`
            : analysisMode === 'population'
              ? `Población ${populationRadiusKm} km`
              : analysisMode === 'proximity'
                ? `Proximidad 5/15/20 min (${proximityRadiusKm} km)`
                : analysisMode === 'status'
                  ? 'Estado de obras'
                  : 'Cobertura territorial'
          : activeTool === 'hotspot'
            ? 'Concentración de obra'
            : activeTool === 'draw'
              ? drawToolMode === 'draw-point'
                ? 'Dibujo punto'
                : drawToolMode === 'draw-line'
                  ? 'Dibujo línea'
                  : 'Dibujo polígono'
              : activeTool === 'measure'
                ? measureToolMode === 'measure-distance'
                  ? 'Medición lineal'
                  : 'Medición de área'
                : interactionMode === 'select'
                  ? 'Selección'
                  : interactionMode === 'measure-distance'
                    ? 'Medición lineal'
                    : interactionMode === 'measure-area'
                      ? 'Medición de área'
                      : interactionMode === 'draw-point'
                        ? 'Dibujo punto'
                        : interactionMode === 'draw-line'
                          ? 'Dibujo línea'
                          : interactionMode === 'draw-polygon'
                            ? 'Dibujo polígono'
                            : 'Exploración';
  const shouldRenderMobileFeatureCard = Boolean(
    selectedFeature &&
      activeTool !== 'population' &&
      selectedFeature?.properties?.tipo !== 'POBLACION'
  );
  const operationalDatabaseTableNames = React.useMemo(() => {
    const tableNames = new Set();
    layers.forEach((layer) => {
      if (!isOperationalWorkLayer(layer) || !layer?.databaseLayer) return;

      const geometryTypeHint = String(
        layer?.databaseMetadata?.geometry_type || ''
      ).toUpperCase();
      if (geometryTypeHint && !geometryTypeHint.includes('POINT')) return;

      const tableName = String(
        layer?.databaseTable || layer?.databaseMetadata?.table_name || ''
      ).trim();
      if (tableName) tableNames.add(tableName);
    });
    return Array.from(tableNames);
  }, [layers]);
  const panelKpiCounts = React.useMemo(() => {
    if (USE_STATIC_EXECUTIVE_KPIS) {
      return { ...STATIC_EXECUTIVE_KPIS };
    }

    const totals = globalKpiSummary?.totals;
    if (totals) {
      return {
        totalObras: parseKpiCount(totals.total_obras),
        entregadas: parseKpiCount(totals.entregadas),
        terminadas: parseKpiCount(totals.terminadas),
        enProceso: parseKpiCount(totals.en_proceso),
        sinIniciar: parseKpiCount(totals.sin_iniciar),
      };
    }

    const rows = Array.isArray(globalKpiSummary?.by_table)
      ? globalKpiSummary.by_table
      : null;
    if (rows && operationalDatabaseTableNames.length) {
      const allowedTables = new Set(operationalDatabaseTableNames);
      const filteredRows = rows.filter((row) =>
        {
          const tableName = String(row?.table_name || '').trim();
          if (!allowedTables.has(tableName)) return false;
          const rowGeometryType = String(row?.geometry_type || '').toUpperCase();
          if (rowGeometryType && !rowGeometryType.includes('POINT')) return false;
          return true;
        }
      );

      if (filteredRows.length) {
        const aggregated = filteredRows.reduce(
          (accumulator, row) => {
            accumulator.total_obras += parseKpiCount(row?.total);
            accumulator.entregadas += parseKpiCount(row?.entregado);
            accumulator.terminadas += parseKpiCount(row?.terminado);
            accumulator.en_proceso += parseKpiCount(row?.proceso);
            accumulator.sin_iniciar += parseKpiCount(row?.sin_iniciar);
            return accumulator;
          },
          {
            total_obras: 0,
            entregadas: 0,
            terminadas: 0,
            en_proceso: 0,
            sin_iniciar: 0,
          }
        );
        return {
          totalObras: parseKpiCount(aggregated.total_obras),
          entregadas: parseKpiCount(aggregated.entregadas),
          terminadas: parseKpiCount(aggregated.terminadas),
          enProceso: parseKpiCount(aggregated.en_proceso),
          sinIniciar: parseKpiCount(aggregated.sin_iniciar),
        };
      }
    }

    // Evita mostrar subtotales parciales del cliente cuando no hay KPI global.
    return {
      ...STATIC_EXECUTIVE_KPIS,
    };
  }, [globalKpiSummary, operationalDatabaseTableNames]);

  const selectedStatusFeatureCount = React.useMemo(() => {
    if (USE_STATIC_EXECUTIVE_KPIS) {
      if (!selectedKpiStatus) return Number(STATIC_EXECUTIVE_KPIS.totalObras || 0);
      if (selectedKpiStatus === 'entregado') return Number(STATIC_EXECUTIVE_KPIS.entregadas || 0);
      if (selectedKpiStatus === 'terminado') return Number(STATIC_EXECUTIVE_KPIS.terminadas || 0);
      if (selectedKpiStatus === 'proceso') return Number(STATIC_EXECUTIVE_KPIS.enProceso || 0);
      if (selectedKpiStatus === 'sin iniciar') return Number(STATIC_EXECUTIVE_KPIS.sinIniciar || 0);
      return Number(STATIC_EXECUTIVE_KPIS.totalObras || 0);
    }

    if (!selectedKpiStatus) return Number(panelKpiCounts.totalObras || 0);
    if (selectedKpiStatus === 'entregado') return Number(panelKpiCounts.entregadas || 0);
    if (selectedKpiStatus === 'terminado') return Number(panelKpiCounts.terminadas || 0);
    if (selectedKpiStatus === 'proceso') return Number(panelKpiCounts.enProceso || 0);
    if (selectedKpiStatus === 'sin iniciar') return Number(panelKpiCounts.sinIniciar || 0);
    return Number(panelKpiCounts.totalObras || 0);
  }, [panelKpiCounts, selectedKpiStatus]);
  const displayedRecordCount = USE_STATIC_EXECUTIVE_KPIS
    ? Number(STATIC_EXECUTIVE_KPIS.totalObras || 0)
    : Number(filteredFeatureCount || 0);

  const fullscreenKpi = React.useMemo(() => {
    const visibleLayers = mapLayersForRender.filter((layer) => layer?.visible);
    const metrics = visibleLayers
      .map((layer) => layerMetricsById.get(layer.id))
      .filter(Boolean);
    const progressValues = metrics
      .map((metric) => Number(metric?.averageProgress))
      .filter((value) => Number.isFinite(value));
    const avgProgress = progressValues.length
      ? Math.round(
          progressValues.reduce((total, value) => total + value, 0) /
            progressValues.length
        )
      : 0;
    const riskCount = metrics.reduce(
      (total, metric) => total + Number(metric?.riskCount || 0),
      0
    );

    let progressTone = '#16a34a';
    if (avgProgress < 80) progressTone = '#f59e0b';
    if (avgProgress < 50) progressTone = '#ef4444';

    return {
      avgProgress,
      progressTone,
      riskCount,
      totalVisibleLayers: visibleLayers.length,
    };
  }, [layerMetricsById, mapLayersForRender]);
  const menuMetaById = {
    layers: {
      title: 'Capas',
      subtitle: 'Administra la información visible en el mapa',
    },
    panel: {
      title: 'Panel',
      subtitle: 'Indicadores ejecutivos globales de la base de datos',
    },
    tools: {
      title: 'Herramientas',
      subtitle: 'Medición, dibujo y análisis espacial',
    },
    more: {
      title: 'Más',
      subtitle: 'Mapa base y vista de referencia',
    },
  };
  const activeMenuMeta =
    (activeMenu && menuMetaById[activeMenu]) || menuMetaById.layers;
  const mapViewMenuClassName = `map-side-menu${
    activeMenu ? ` map-side-menu--${activeMenu}` : ''
  }`;
  const mapViewClassName = `map-view${isMobile ? ' map-view--mobile' : ''}${
    isCompactViewport ? ' map-view--compact' : ''
  }${
    isFullscreenActive || isFullstackRouteMode || isFullstackModeForced
      ? ' map-view--fullscreen'
      : ''
  }`;

  const switchWorkspaceMode = React.useCallback((nextMode) => {
    if (typeof window === 'undefined') return;
    const nextUrl = new URL(window.location.href);
    if (nextMode === 'pro') {
      window.sessionStorage?.setItem('sigsobse_allow_pro_once', '1');
      nextUrl.searchParams.set('mode', 'pro');
      nextUrl.searchParams.set('fullstack', '0');
      nextUrl.searchParams.set('force_pro', '1');
    } else {
      window.sessionStorage?.removeItem('sigsobse_allow_pro_once');
      nextUrl.searchParams.set('mode', 'fullstack');
      nextUrl.searchParams.set('fullstack', '1');
      nextUrl.searchParams.delete('force_pro');
    }
    window.location.assign(nextUrl.toString());
  }, []);
  const menuPanelContent = React.useMemo(() => {
    if (!activeMenu) return null;

    if (activeMenu === 'layers' || activeMenu === 'more') {
      return toolDetailPanel;
    }

    if (activeMenu === 'panel') {
      const kpiCards = [
        {
          id: 'total',
          label: 'Total de obras',
          value: panelKpiCounts.totalObras,
          tone: 'total',
          status: null,
        },
        {
          id: 'entregadas',
          label: 'Obras inauguradas',
          value: panelKpiCounts.entregadas,
          tone: 'entregadas',
          status: 'entregado',
        },
        {
          id: 'terminadas',
          label: 'Obras terminadas',
          value: panelKpiCounts.terminadas,
          tone: 'terminadas',
          status: 'terminado',
        },
        {
          id: 'proceso',
          label: 'Obras en proceso',
          value: panelKpiCounts.enProceso,
          tone: 'proceso',
          status: 'proceso',
        },
        {
          id: 'sin_iniciar',
          label: 'Obras sin iniciar',
          value: panelKpiCounts.sinIniciar,
          tone: 'sininiciar',
          status: 'sin iniciar',
        },
      ];

      return (
        <div className="map-menu-panel">
          <h4 className="map-menu-panel__title">KPIS Ejecutivos</h4>
          <div className="map-menu-kpi-grid map-menu-kpi-grid--exec">
            {kpiCards.map((card) => {
              const isActive = selectedKpiStatus === card.status;
              return (
                <button
                  key={card.id}
                  className={`map-menu-kpi map-menu-kpi--exec map-menu-kpi--${card.tone}${
                    isActive ? ' is-active' : ''
                  }`}
                  onClick={() => {
                    if (card.status == null) {
                      setSelectedKpiStatus(null);
                      return;
                    }
                    setSelectedKpiStatus((current) =>
                      current === card.status ? null : card.status
                    );
                  }}
                  type="button"
                >
                  <span className="map-menu-kpi__label">{card.label}</span>
                  <strong className="map-menu-kpi__value">
                    {Number(card.value || 0).toLocaleString('es-MX')}
                  </strong>
                </button>
              );
            })}
          </div>
          {globalKpiLoading ? (
            <p className="map-menu-panel__note">Actualizando KPIs globales...</p>
          ) : null}
          {isOffline ? (
            <p className="map-menu-panel__status map-menu-panel__status--warning">
              Sin conexión: mostrando la última información guardada.
            </p>
          ) : null}
          {globalKpiError ? (
            <p className="map-menu-panel__error">{globalKpiError}</p>
          ) : null}
          <div className="map-menu-panel__footer">
            <span>
              {selectedKpiStatus
                ? `Filtro activo: ${selectedKpiStatus}`
                : 'Filtro activo: todos los estatus'}
            </span>
            <strong>
              {Number(selectedStatusFeatureCount || 0).toLocaleString('es-MX')} obras
            </strong>
          </div>
          {selectedKpiStatus && Number(selectedStatusFeatureCount || 0) === 0 ? (
            <div className="map-menu-panel__hint">
              <p className="map-menu-panel__note">
                No hay puntos cargados para ese estatus en la vista actual.
              </p>
              <button
                className="map-menu-panel__hint-btn"
                onClick={() => actions.setAllLayersVisible(true)}
                type="button"
              >
                Encender capas para cargar datos
              </button>
            </div>
          ) : null}
          <div className="map-menu-panel__mini-grid">
            <article className="map-menu-kpi map-menu-kpi--mini">
              <span className="map-menu-kpi__label">Capas activas</span>
              <strong className="map-menu-kpi__value">
                {Number(fullscreenKpi.totalVisibleLayers || 0).toLocaleString('es-MX')}
              </strong>
            </article>
            <article className="map-menu-kpi map-menu-kpi--mini">
              <span className="map-menu-kpi__label">Avance promedio</span>
              <strong className="map-menu-kpi__value">{fullscreenKpi.avgProgress}%</strong>
            </article>
          </div>
        </div>
      );
    }

    const showToolDetail = TOOLS_OPERATION_SET.has(activeTool);

    return (
      <div className="map-tools-sections">
        <section className="map-tools-section">
          <h4 className="map-tools-section__label">Edición</h4>
          <div className="map-tools-grid">
            <MenuToolCard
              active={!showToolDetail}
              desc="Explorar elementos y abrir detalle"
              icon={<PanelGridIcon />}
              onClick={activateSelectMode}
              title="Seleccionar"
            />
            <MenuToolCard
              active={activeTool === 'measure' && measureToolMode === 'measure-distance'}
              desc="Trazo de distancia acumulada"
              icon={<ToolIcon alt="Medición" src={`${TOOL_ICON_BASE}/medicion.svg`} />}
              onClick={() =>
                activateOperationalTool('measure', {
                  measureMode: 'measure-distance',
                })
              }
              title="Medir distancia"
            />
            <MenuToolCard
              active={activeTool === 'measure' && measureToolMode === 'measure-area'}
              desc="Cálculo de superficie por polígono"
              icon={<ToolIcon alt="Medición área" src={`${TOOL_ICON_BASE}/medicion.svg`} />}
              onClick={() =>
                activateOperationalTool('measure', {
                  measureMode: 'measure-area',
                })
              }
              title="Medir área"
            />
            <MenuToolCard
              active={activeTool === 'draw' && drawToolMode === 'draw-point'}
              desc="Marcador puntual de referencia"
              icon={<PointGeomIcon />}
              onClick={() =>
                activateOperationalTool('draw', {
                  drawMode: 'draw-point',
                })
              }
              title="Punto"
            />
            <MenuToolCard
              active={activeTool === 'draw' && drawToolMode === 'draw-line'}
              desc="Trazo lineal de recorridos"
              icon={<LineGeomIcon />}
              onClick={() =>
                activateOperationalTool('draw', {
                  drawMode: 'draw-line',
                })
              }
              title="Línea"
            />
            <MenuToolCard
              active={activeTool === 'draw' && drawToolMode === 'draw-polygon'}
              desc="Dibujo de área de intervención"
              icon={<PolygonGeomIcon />}
              onClick={() =>
                activateOperationalTool('draw', {
                  drawMode: 'draw-polygon',
                })
              }
              title="Polígono"
            />
          </div>
        </section>

        <section className="map-tools-section">
          <h4 className="map-tools-section__label">Análisis</h4>
          <div className="map-tools-grid map-tools-grid--analysis">
            <MenuToolCard
              active={activeTool === 'analysis'}
              desc="Estado, cobertura, buffer, proximidad y población"
              icon={<AnalysisToolIcon />}
              onClick={() =>
                activateOperationalTool('analysis', {
                  nextAnalysisMode: 'status',
                })
              }
              title="Análisis info"
            />
            <MenuToolCard
              active={activeTool === 'population'}
              desc={`Radio dinámico hasta ${POPULATION_RADIUS_MAX_KM} km`}
              icon={<PopulationToolIcon />}
              onClick={() => activateOperationalTool('population')}
              title="Población"
            />
            <MenuToolCard
              active={activeTool === 'proximity'}
              desc={`Ciudad 5/15/20 min · ${proximityRadiusKm} km`}
              icon={<CommunityToolIcon />}
              onClick={() => activateOperationalTool('proximity')}
              title="Proximidad"
            />
            <MenuToolCard
              active={activeTool === 'hotspot'}
              className="map-tool-card--hotspot"
              desc="Concentración por obras o índice de gasto"
              icon={<ToolIcon alt="Concentración de obra" src={`${TOOL_ICON_BASE}/hotspot.svg`} />}
              onClick={() => activateOperationalTool('hotspot')}
              title="Concentración de obra"
            />
          </div>
        </section>

        <section className="map-tools-detail-slot">
          {showToolDetail ? (
            toolDetailPanel
          ) : (
            <p className="map-tools-detail-slot__hint">
              Selecciona una herramienta para abrir su configuración.
            </p>
          )}
        </section>
      </div>
    );
  }, [
    activeMenu,
    activeTool,
    actions,
    activateOperationalTool,
    activateSelectMode,
    drawToolMode,
    fullscreenKpi.avgProgress,
    fullscreenKpi.totalVisibleLayers,
    globalKpiError,
    globalKpiLoading,
    isOffline,
    measureToolMode,
    panelKpiCounts.enProceso,
    panelKpiCounts.entregadas,
    panelKpiCounts.sinIniciar,
    panelKpiCounts.terminadas,
    panelKpiCounts.totalObras,
    proximityRadiusKm,
    selectedKpiStatus,
    selectedStatusFeatureCount,
    toolDetailPanel,
  ]);

  return (
    <section className={mapViewClassName}>
      <div
        className={`map-view__surface${isFocusMode ? ' is-focus-mode' : ''}`}
      >
        <div className="map-view__canvas" ref={mapNodeRef} />

        {!isMobile && !showAdvancedTools ? (
          <div className="map-view__hud map-view__hud--top">
            <div className="map-view__badge">
              <span>Ciudad</span>
              <strong>Ciudad de México</strong>
            </div>
            <div className="map-view__badge">
              <span>Base</span>
              <strong>{activeBaseMap.name}</strong>
            </div>
            <div className="map-view__badge">
              <span>Visible</span>
              <strong>{displayedRecordCount} registros</strong>
            </div>
          </div>
        ) : null}

        {!isMobile && showAdvancedTools ? (
          <div className="map-advanced-header">
            <div className="map-advanced-brand">
              <img
                alt="Gobierno CDMX y SOBSE"
                src={`${process.env.PUBLIC_URL || ''}/assets/img/nuevologoSinfondo.png`}
              />
            </div>
            <label className="map-advanced-search" htmlFor="map-advanced-search-input">
              <svg
                aria-hidden="true"
                className="map-advanced-search__icon"
                fill="none"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="11.1" cy="11.1" r="6.8" stroke="currentColor" strokeWidth="1.9" />
                <path
                  d="m16.15 16.15 4 4"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.9"
                />
              </svg>
              <input
                id="map-advanced-search-input"
                onChange={(event) => setQuickSearchText(event.target.value)}
                placeholder="Buscar plantel, colonia..."
                type="text"
                value={quickSearchText}
              />
            </label>
            <button
              className="map-mode-switch-btn"
              onClick={() => switchWorkspaceMode('pro')}
              type="button"
            >
              Modo Pro
            </button>
          </div>
        ) : null}

        {!isMobile && showAdvancedTools ? (
          <div
            className={`map-topnav${
              !showToolsTopMenuButton ? ' map-topnav--no-tools' : ''
            }${isMobileLikeLayout ? ' map-topnav--compact' : ''}`}
            role="tablist"
            aria-label="Navegación de vista"
          >
            <TopMenuButton
              active={activeMenu === 'layers'}
              icon={<LayersMenuIcon />}
              label="Capas"
              onClick={() => handleTopMenuToggle('layers')}
            />
            <TopMenuButton
              active={activeMenu === 'panel'}
              icon={<PanelGridIcon />}
              label="Panel"
              onClick={() => handleTopMenuToggle('panel')}
            />
            {showToolsTopMenuButton ? (
              <TopMenuButton
                active={activeMenu === 'tools'}
                icon={<WrenchMenuIcon />}
                label="Herramientas"
                onClick={() => handleTopMenuToggle('tools')}
              />
            ) : null}
            <TopMenuButton
              active={activeMenu === 'more'}
              icon={<MoreDotsIcon />}
              label="Más"
              onClick={() => handleTopMenuToggle('more')}
            />
          </div>
        ) : null}

        {/* Panel negro legacy deshabilitado: se usa solo panel blanco de población */}

        {!isMobile && showAdvancedTools && activeTool === 'population' ? (
          <PopulationInsightsPanel
            loading={populationLoading}
            onClose={activateSelectMode}
            onRadiusChange={handlePopulationRadiusInput}
            radiusKm={populationRadiusKm}
            result={populationResult}
          />
        ) : null}

        {showAdvancedTools && activeMenu ? (
          <aside className={mapViewMenuClassName}>
            <header className="map-side-menu__header">
              <div className="map-side-menu__titles">
                <h3>{activeMenuMeta.title}</h3>
                <p>{activeMenuMeta.subtitle}</p>
              </div>
              <button
                aria-label="Cerrar menú"
                className="map-side-menu__close"
                onClick={() => setActiveMenu(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="map-side-menu__body">{menuPanelContent}</div>
          </aside>
        ) : null}

        {shouldRenderMobileFeatureCard ? (
          <div className="mfc-wrap mfc-wrap--fullscreen">
            <MobileFeatureCard feature={selectedFeature} />
          </div>
        ) : null}

      </div>
    </section>
  );
}

export default MapView;
