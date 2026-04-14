// ─────────────────────────────────────────────────────────────────────────────
// GISWorkspaceContext.jsx — Estado global del visor GIS
//
// Este archivo implementa el "cerebro" de toda la aplicación usando
// React Context API. Centraliza TODO el estado del visor en un único lugar
// para que cualquier componente hijo pueda leerlo o modificarlo sin pasar
// props manualmente por cada nivel del árbol de componentes.
//
// ¿Qué estado vive aquí?
//   - Lista de capas GIS (de PostgreSQL y archivos subidos por el usuario)
//   - Capa/feature seleccionado actualmente
//   - Estado de hover y foco (qué capa está resaltada)
//   - Mapa base activo (satélite, calles, etc.)
//   - Filtros de datos (DG, programa, alcaldía, búsqueda de texto)
//   - Modo de interacción (selección, medición, dibujo)
//   - Estado de la UI (tab activo, modo móvil, sheet abierto)
//
// Patrón de uso:
//   1. Envuelve la app con <GISWorkspaceProvider> en el punto de entrada
//   2. Cualquier componente hijo llama useGISWorkspace() para leer el estado
//   3. Las acciones se acceden como context.actions.toggleLayerVisibility(id)
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { BASE_MAPS, DEFAULT_BASE_MAP_ID } from '../data/baseMaps';
import cdmxBoundaryData from '../data/cdmxBoundary.json';
import { fetchLayerGeoJSON, fetchLayerTables } from '../services/gisApi';

// Contexto React — null es el valor default (se reemplaza por el Provider)
const GISWorkspaceContext = React.createContext(null);

// Ancho de pantalla en px a partir del cual activamos el layout compacto (móvil/tablet)
const MOBILE_BREAKPOINT = 820;

// Paleta de colores para capas subidas por el usuario.
// Se asignan cíclicamente según el índice de la capa.
const UPLOAD_COLORS = [
  '#0ea5e9', '#22c55e', '#a855f7', '#f97316',
  '#e11d48', '#14b8a6', '#eab308', '#6366f1',
];

// Cada cuánto tiempo (ms) reconsultamos el catálogo de capas de la base de datos.
// En desarrollo usamos 30 s para ver cambios rápido; en producción 5 min
// para no descargar GeoJSON pesados innecesariamente en cada sesión.
const DEFAULT_DATABASE_SYNC_INTERVAL_MS =
  process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 30000;
const DATABASE_SYNC_INTERVAL_MS = Math.max(
  15000,
  Number(process.env.REACT_APP_GIS_SYNC_INTERVAL_MS || DEFAULT_DATABASE_SYNC_INTERVAL_MS)
);
const DATABASE_LAYER_LOAD_CONCURRENCY = Math.max(
  1,
  Number(process.env.REACT_APP_GIS_LOAD_CONCURRENCY || 3)
);
const LEGACY_BOOTSTRAP_LAYER_PREFIX = 'bootstrap-';

// ── Persistencia de visibilidad en localStorage ───────────────────────────────
// Cuando el usuario refresca la página el estado React se pierde.
// Guardamos { tableName → visible } para restaurar las capas activas al reiniciar.
const VISIBILITY_STORAGE_KEY = 'sigsobse_layer_visibility';

function readSavedVisibility() {
  try {
    const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSavedVisibility(layers) {
  try {
    const snapshot = {};
    layers.forEach((layer) => {
      if (layer.databaseLayer && layer.databaseTable) {
        snapshot[layer.databaseTable] = layer.visible;
      }
    });
    localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage no disponible (modo privado, etc.)
  }
}

// Estado inicial de los filtros — 'all' significa "sin filtro activo"
const DEFAULT_FILTERS = {
  dg: 'all',
  programa: 'all',
  alcaldia: 'all',
  obra: '',  // búsqueda de texto libre
};

// Estado vacío de una medición (distancia o área)
const EMPTY_MEASUREMENT = {
  type: null,      // 'measure-distance' | 'measure-area'
  points: [],      // array de coordenadas [lat, lng] clickeadas
  summary: null,   // resultado calculado (metros, m², etc.)
  finished: false, // true cuando el usuario cierra la medición
};

// Estado vacío de un borrador de dibujo (punto/línea/polígono en construcción)
const EMPTY_DRAW_DRAFT = {
  type: null,   // 'draw-point' | 'draw-line' | 'draw-polygon'
  points: [],   // vértices dibujados hasta ahora
};

// ── Funciones auxiliares de detección de modo ─────────────────────────────────

// Retorna true si el modo actual es alguna variante de medición
function isMeasureMode(mode) {
  return mode === 'measure-distance' || mode === 'measure-area';
}

// Retorna true si el modo actual es alguna variante de dibujo
function isDrawMode(mode) {
  return (
    mode === 'draw-point' ||
    mode === 'draw-line' ||
    mode === 'draw-polygon'
  );
}

// ── Funciones de normalización y filtrado ─────────────────────────────────────

// Convierte un texto a minúsculas sin acentos para comparación insensible
// a mayúsculas/minúsculas y diacríticos (é, ñ, ü, etc.).
// Ejemplo: "Álcaldía" → "alcaldia"
function normalizeValue(value) {
  return String(value || '')
    .normalize('NFD')                    // separa letras de sus acentos
    .replace(/[\u0300-\u036f]/g, '')    // elimina los diacríticos
    .toLowerCase()
    .trim();
}

function firstPropertyValue(properties, keys) {
  for (const key of keys) {
    const value = properties?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }

  return null;
}

const FEATURE_TEXT_KEYS = {
  plantel: [
    'NOMBRE DEL SITIO INTERVENIDO',
    'NOMBRE DEL SITIO INTERVENIDO ',
    'NOMBRE_SITIO_INTERVENIDO',
    'nombre del sitio intervenido',
    'nombre_sitio_intervenido',
    'PLANTEL',
    'plantel',
    'NOMBRE_PLANTEL',
    'nombre_plantel',
    'NOMBRE DEL PLANTEL',
    'nombre del plantel',
    'NOMBRE_ESCUELA',
    'nombre_escuela',
    'ESCUELA',
    'escuela',
    'FRENTE 1',
    'frente 1',
    'FRENTE1',
    'frente1',
    'FRENTE',
    'frente',
  ],
  direccion: [
    'CALLE',
    'calle',
    'DIRECCION',
    'direccion',
    'DIRECCIÓN',
    'dirección',
    'DOMICILIO',
    'domicilio',
    'UBICACION',
    'ubicacion',
    'UBICACIÓN',
    'ubicación',
    'ENTRE CALLE',
    'ENTRE_CALLE',
    'entre calle',
    'entre_calle',
    'REFERENCIAS',
    'referencias',
  ],
  colonia: ['COLONIA', 'colonia'],
  programa: ['PROGRAMA', 'programa'],
  alcaldia: ['ALCALDIA', 'alcaldia', 'ALCALDÍA', 'alcaldía'],
  tipo: ['TIPO', 'tipo', 'TIPO_OBRA', 'tipo_obra'],
};

const FEATURE_FILTER_KEYS = {
  dg: [
    'DG',
    'dg',
    'DIRECCION GENERAL',
    'DIRECCION_GENERAL',
    'direccion general',
    'direccion_general',
  ],
  programa: ['PROGRAMA', 'programa'],
  alcaldia: ['ALCALDIA', 'alcaldia', 'ALCALDÍA', 'alcaldía'],
};

// Extrae los valores únicos de una propiedad GeoJSON de todas las capas.
// Sirve para construir los dropdowns de filtro (DG, programa, alcaldía).
// Ejemplo: collectOptions(layers, 'DG') → ['DGCOP', 'DGSUS', 'DGOT', ...]
function collectOptions(layers, key, transformValue) {
  const keys = Array.isArray(key) ? key : [key];
  const values = new Set();

  layers.forEach((layer) => {
    (layer.data?.features || []).forEach((feature) => {
      const rawValue = firstPropertyValue(feature?.properties, keys);
      const value = transformValue ? transformValue(rawValue) : rawValue;
      if (value) values.add(String(value));
    });
  });

  return Array.from(values).sort((left, right) => left.localeCompare(right, 'es'));
}

// Determina si un feature GeoJSON pasa todos los filtros activos.
// Se llama en el useMemo de filteredLayers para construir la vista filtrada.
// El filtro de texto busca en dirección, colonia y programa al mismo tiempo.
function featureMatchesFilters(feature, filters) {
  const properties = feature?.properties || {};

  // Filtros exactos por categoría
  if (
    filters.dg !== 'all' &&
    normalizeDG(firstPropertyValue(properties, FEATURE_FILTER_KEYS.dg)) !==
      filters.dg
  ) {
    return false;
  }

  if (
    filters.programa !== 'all' &&
    String(firstPropertyValue(properties, FEATURE_FILTER_KEYS.programa) || '') !==
      filters.programa
  ) {
    return false;
  }

  if (
    filters.alcaldia !== 'all' &&
    String(firstPropertyValue(properties, FEATURE_FILTER_KEYS.alcaldia) || '') !==
      filters.alcaldia
  ) {
    return false;
  }

  // Filtro de texto libre — busca en múltiples campos concatenados
  const obraQuery = normalizeValue(filters.obra);
  if (!obraQuery) return true;

  const searchableFields = [
    firstPropertyValue(properties, FEATURE_TEXT_KEYS.plantel),
    firstPropertyValue(properties, FEATURE_TEXT_KEYS.direccion),
    firstPropertyValue(properties, FEATURE_TEXT_KEYS.colonia),
    firstPropertyValue(properties, FEATURE_TEXT_KEYS.programa),
    firstPropertyValue(properties, FEATURE_TEXT_KEYS.alcaldia),
    firstPropertyValue(properties, FEATURE_TEXT_KEYS.tipo),
  ]
    .filter(Boolean)
    .map(normalizeValue)
    .join(' ');

  return searchableFields.includes(obraQuery);
}

// ── Reordenamiento de capas por drag-and-drop ─────────────────────────────────

// Mueve la capa con draggedId a la posición de targetId en el array.
// El orden del array es el orden de renderizado en el mapa (última = encima).
function reorderLayers(layers, draggedId, targetId) {
  const nextLayers = [...layers];
  const draggedIndex = nextLayers.findIndex((layer) => layer.id === draggedId);
  const targetIndex = nextLayers.findIndex((layer) => layer.id === targetId);

  if (
    draggedIndex === -1 ||
    targetIndex === -1 ||
    draggedIndex === targetIndex
  ) {
    return layers; // sin cambios si el drop es inválido
  }

  const [draggedLayer] = nextLayers.splice(draggedIndex, 1);
  nextLayers.splice(targetIndex, 0, draggedLayer);
  return nextLayers;
}

// ── Métricas de capa ──────────────────────────────────────────────────────────

// Calcula estadísticas de resumen para una capa a partir de sus features:
//   totalElements  → número de obras en la capa
//   averageProgress → promedio del campo AVANCE (0-100)
//   riskCount      → features con RIESGO = true
//   health         → 'risk' si hay elementos en riesgo, 'active' si no
function computeLayerMetrics(layer) {
  const features = layer?.data?.features || [];
  const totalElements = features.length;
  const progressValues = features
    .map((feature) => Number(feature?.properties?.AVANCE))
    .filter((value) => !Number.isNaN(value));
  const riskCount = features.filter(
    (feature) => feature?.properties?.RIESGO === true
  ).length;
  const averageProgress = progressValues.length
    ? Math.round(
        progressValues.reduce((total, value) => total + value, 0) /
          progressValues.length
      )
    : null;

  return {
    totalElements,
    averageProgress,
    riskCount,
    health: riskCount > 0 ? 'risk' : 'active',
  };
}

// ── Detección de viewport compacto ────────────────────────────────────────────

// Determina el estado inicial del layout leyendo el ancho de la ventana.
// Se llama una sola vez durante la inicialización del estado React.
// En SSR (server-side rendering) no hay `window`, por eso la guarda.
function getInitialCompactViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

// ── Utilidades de geometría y estilo de capas ─────────────────────────────────

// Extrae el tipo de geometría del primer feature válido de la capa.
// Necesario para decidir el estilo por defecto (pesos distintos para puntos/líneas/polígonos).
function getGeometryType(featureCollection) {
  const firstFeature = featureCollection?.features?.find(
    (feature) => feature?.geometry?.type
  );
  return firstFeature?.geometry?.type || 'Unknown';
}

function createEmptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

// Construye el estilo inicial de una capa según su tipo de geometría.
// Los valores están calibrados para que las capas se vean bien a escala CDMX
// sin necesidad de configuración manual por parte del usuario.
function buildLayerStyle(color, geometryType) {
  const isPoint = geometryType === 'Point' || geometryType === 'MultiPoint';
  const isLine =
    geometryType === 'LineString' || geometryType === 'MultiLineString';
  const isPolygon =
    geometryType === 'Polygon' || geometryType === 'MultiPolygon';

  return {
    color,
    weight: isLine ? 4 : 2,          // las líneas son más gruesas que los bordes de polígono
    pointRadius: isPoint ? 7 : 6,
    opacity: 0.94,
    fillOpacity: isPolygon ? 0.24 : 0.18,
    markerKind: 'solid',
    dashStyle: 'solid',
  };
}

// ── Enriquecimiento de features ───────────────────────────────────────────────

// Añade un __featureKey único a cada feature de la capa.
// Esta clave es fundamental para:
//   - Identificar qué feature está seleccionado en el estado React
//   - Que getVisualState() sepa si un feature específico está en 'selected'
//   - Que el mapa sepa a qué feature aplicar el estilo de selección
function enrichFeatureCollection(layerId, featureCollection) {
  return {
    ...featureCollection,
    features: (featureCollection?.features || []).map((feature, index) => ({
      ...feature,
      id: feature.id || `${layerId}-f${index + 1}`,
      properties: {
        ...(feature.properties || {}),
        __featureKey:
          feature?.properties?.__featureKey || `${layerId}-f${index + 1}`,
      },
    })),
  };
}

// ── Asignación de colores estables ────────────────────────────────────────────

// Asigna un color de la paleta de forma determinista basado en el nombre de la tabla.
// El mismo nombre de tabla siempre produce el mismo color, aunque se recargue la app.
// Usa un hash simple de la suma de códigos de caracteres.
function getStableColor(key, palette = UPLOAD_COLORS) {
  const hash = Array.from(String(key || '')).reduce(
    (total, char) => total + char.charCodeAt(0),
    0
  );
  return palette[hash % palette.length];
}

// ── Normalización de DG ───────────────────────────────────────────────────────

// Convierte los distintos formatos de DG que vienen de la base de datos
// a una sigla canónica para poder agrupar capas correctamente.
// Ejemplo: "Dirección General de Construcción de Obras Públicas" → "DGCOP"
// Se requiere porque los datos históricos tienen variantes inconsistentes.
function normalizeDG(value) {
  if (!value) return 'Sin DG';

  const raw = String(value).trim();
  if (!raw) return 'Sin DG';

  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  const compact = normalized.replace(/[^A-Z0-9]/g, '');

  if (
    compact.includes('DGCOP') ||
    normalized.includes('OBRAS PUBLICAS') ||
    normalized.includes('CONSTRUCCION DE OBRAS PUBLICAS')
  ) {
    return 'DGCOP';
  }

  if (compact.includes('DGSUS')) return 'DGSUS';
  if (compact.includes('DGOT')) return 'DGOT';
  if (compact.includes('DGPEST')) return 'DGPEST';
  if (compact.includes('DGOIV')) return 'DGOIV';

  return normalized;
}

const INSTITUTIONAL_ACRONYMS = new Set([
  'AIFA',
  'AICM',
  'BRT',
  'CDMX',
  'CETRAM',
  'CFE',
  'DG',
  'DGCOP',
  'DGOIV',
  'DGOT',
  'DGPEST',
  'DGSUS',
  'GPS',
  'IMSS',
  'ISSSTE',
  'SOBSE',
  'STE',
  'UACM',
  'UNAM',
  'VTC',
]);

const LOWERCASE_CONNECTORS = new Set([
  'a',
  'al',
  'con',
  'de',
  'del',
  'e',
  'el',
  'en',
  'la',
  'las',
  'los',
  'para',
  'por',
  'sin',
  'un',
  'una',
  'y',
]);

function formatInstitutionalWord(word, index) {
  const original = String(word || '').trim();
  if (!original) return '';

  const rawToken = original.replace(/[()]/g, '');
  const upperToken = rawToken.toUpperCase();
  const lowerToken = rawToken.toLowerCase();

  if (/^\d+$/.test(rawToken)) return rawToken;
  if (/^\d+[A-Z]+$/i.test(rawToken)) return rawToken.toUpperCase();
  if (INSTITUTIONAL_ACRONYMS.has(upperToken)) return upperToken;
  if (index > 0 && LOWERCASE_CONNECTORS.has(lowerToken)) return lowerToken;

  return lowerToken.charAt(0).toUpperCase() + lowerToken.slice(1);
}

function formatDatabaseLayerName(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Capa sin nombre';

  const normalizedSeparators = raw
    .replace(/[_]+/g, ' ')
    .replace(/[–—]+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

  const uniqueSegments = normalizedSeparators
    .split(/\s+-\s+/)
    .map((segment) =>
      segment.replace(/^(?:\d{2}\s+){1,4}/, '').trim()
    )
    .filter(Boolean)
    .reduce((segments, segment) => {
      const formattedSegment = segment
        .split(/\s+/)
        .map((word, index) => formatInstitutionalWord(word, index))
        .filter(Boolean)
        .join(' ');

      const normalizedSegment = normalizeValue(formattedSegment);
      const existingIndex = segments.findIndex((candidate) => {
        const normalizedCandidate = normalizeValue(candidate);
        return (
          normalizedCandidate === normalizedSegment ||
          normalizedCandidate.includes(normalizedSegment) ||
          normalizedSegment.includes(normalizedCandidate)
        );
      });

      if (existingIndex === -1) {
        segments.push(formattedSegment);
        return segments;
      }

      if (
        normalizedSegment.length >
        normalizeValue(segments[existingIndex]).length
      ) {
        segments[existingIndex] = formattedSegment;
      }

      return segments;
    }, []);

  return uniqueSegments.join(' - ') || 'Capa sin nombre';
}

// Lee el campo DG del primer feature de la capa para identificar a qué
// Dirección General pertenece. Prueba varios nombres de columna posibles
// porque los datos no siempre tienen el mismo nombre de campo.
function detectLayerDg(featureCollection) {
  const properties = featureCollection?.features?.[0]?.properties || {};
  const rawValue =
    properties.dg ||
    properties.DG ||
    properties.direccion_general ||
    properties.DIRECCION_GENERAL ||
    properties['DIRECCION GENERAL'] ||
    properties['direccion general'] ||
    'Sin DG';

  return normalizeDG(rawValue);
}

function normalizeCatalogBbox(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;

  const west = Number(bbox.west);
  const south = Number(bbox.south);
  const east = Number(bbox.east);
  const north = Number(bbox.north);

  if ([west, south, east, north].some((value) => !Number.isFinite(value))) {
    return null;
  }

  return { west, south, east, north };
}

function expandBounds(bounds, padding = 0) {
  if (!bounds) return null;

  return {
    west: bounds.west - padding,
    south: bounds.south - padding,
    east: bounds.east + padding,
    north: bounds.north + padding,
  };
}

function boundsIntersect(leftBounds, rightBounds) {
  if (!leftBounds || !rightBounds) return false;

  return !(
    leftBounds.east < rightBounds.west ||
    leftBounds.west > rightBounds.east ||
    leftBounds.north < rightBounds.south ||
    leftBounds.south > rightBounds.north
  );
}

function shouldLoadDatabaseLayerForViewport(layer, mapViewportBounds) {
  if (!layer?.databaseLayer || !layer.visible) return false;
  if (!layer.loadRequested) return false;
  if (layer.loadStatus === 'loading' || layer.loadStatus === 'loaded') return false;
  if (layer.loadStatus === 'error') return false;

  if (!mapViewportBounds) return !layer.catalogBbox;
  if (!layer.catalogBbox) return true;

  return boundsIntersect(
    expandBounds(layer.catalogBbox, 0.005),
    expandBounds(mapViewportBounds, 0.01)
  );
}

// ── Constructor de definición de capa de base de datos ────────────────────────

// Construye el objeto completo que representa una capa proveniente de PostgreSQL.
// Si ya existe una capa previa con el mismo nombre de tabla (actualizaciones
// periódicas cada 30 segundos), conserva el estilo personalizado del usuario
// mediante spread merging: baseStyle con los cambios del usuario encima.
function buildDatabaseLayerDefinition({
  existingLayer,
  geoJson,
  metadata,
  name,
}) {
  const tableName = String(metadata?.table_name || name || '').trim();
  const layerId = existingLayer?.id || `db-${tableName}`;
  const hasFreshGeoJson =
    geoJson &&
    geoJson.type === 'FeatureCollection' &&
    Array.isArray(geoJson.features);
  const baseCollection =
    hasFreshGeoJson
      ? geoJson
      : existingLayer?.data || createEmptyFeatureCollection();
  const geometryType = hasFreshGeoJson
    ? getGeometryType(geoJson)
    : existingLayer?.geometryType || 'Unknown';
  const enriched = enrichFeatureCollection(layerId, baseCollection);
  const color = existingLayer?.color || getStableColor(tableName);
  const baseStyle = buildLayerStyle(color, geometryType);
  const dg = normalizeDG(
    metadata?.dg || existingLayer?.dg || detectLayerDg(enriched)
  );
  const displayName = formatDatabaseLayerName(name || tableName);
  const estimatedFeatureCount = Math.max(
    0,
    Number(metadata?.estimated_count ?? existingLayer?.estimatedFeatureCount ?? 0)
  );
  const loadStatus = hasFreshGeoJson
    ? 'loaded'
    : existingLayer?.loadStatus || 'idle';
  const loadError = hasFreshGeoJson ? null : existingLayer?.loadError || null;
  const catalogBbox = normalizeCatalogBbox(
    metadata?.bbox || existingLayer?.catalogBbox
  );

  return {
    id: layerId,
    name: displayName,
    // Conserva la visibilidad del existente; las nuevas capas leen localStorage
    // para restaurar el estado tras un refresco de página.
    visible:
      typeof existingLayer?.visible === 'boolean'
        ? existingLayer.visible
        : (readSavedVisibility()[tableName] ?? false),
    color,
    source: 'PostgreSQL',
    dg,
    programa: displayName,
    alcaldia: null,
    data: enriched,
    geometryType,
    // Si ya existía, aplica el estilo base y encima el estilo personalizado del usuario
    style: existingLayer
      ? {
          ...baseStyle,
          ...(existingLayer.style || {}),
        }
      : baseStyle,
    // initialStyle guarda el estilo original para el botón "Restaurar estilos"
    initialStyle: existingLayer?.initialStyle || { ...baseStyle },
    uploaded: false,
    database: true,
    databaseLayer: true,          // flag para identificar capas de BD vs. subidas
    databaseTable: tableName,
    databaseDisplayName: displayName,
    databaseSchema: metadata?.table_schema || 'sig_sobse',
    databaseSourceType: metadata?.source_type || 'postgis',
    databaseGeometryColumn: metadata?.geometry_column || 'geom',
    databaseMetadata: {
      ...(existingLayer?.databaseMetadata || {}),
      ...(metadata || {}),
      table_name: tableName,
    },
    catalogBbox,
    estimatedFeatureCount,
    loadStatus,
    loadError,
    loadRequested:
      typeof existingLayer?.loadRequested === 'boolean'
        ? existingLayer.loadRequested
        : (readSavedVisibility()[tableName] ?? false),
  };
}

function buildReferenceLayerDefinition({
  id,
  name,
  featureCollection,
  color = '#691c32',
  source = 'Referencia oficial',
  visible = true,
}) {
  const geometryType = getGeometryType(featureCollection);
  const data = enrichFeatureCollection(id, featureCollection);
  const style = {
    ...buildLayerStyle(color, geometryType),
    weight: geometryType === 'LineString' || geometryType === 'MultiLineString' ? 3 : 2,
    fillOpacity: 0,
    opacity: 0.9,
  };

  return {
    id,
    name,
    visible,
    color,
    source,
    dg: null,
    programa: null,
    alcaldia: null,
    data,
    geometryType,
    style,
    initialStyle: { ...style },
    uploaded: false,
    referenceLayer: true,
  };
}

function createInitialLayers() {
  return [
    buildReferenceLayerDefinition({
      id: 'reference-cdmx-boundary',
      name: 'Limite de la CDMX',
      featureCollection: cdmxBoundaryData,
    }),
  ];
}

function mergeDatabaseLayers(currentLayers, layerPayloads, orderedTableNames) {
  const tableOrder = Array.isArray(orderedTableNames) ? orderedTableNames : [];
  const nonDatabaseLayers = currentLayers.filter((layer) => !layer.databaseLayer);
  const databaseLayersByTable = new Map(
    currentLayers
      .filter((layer) => layer.databaseLayer)
      .map((layer) => [layer.databaseTable, layer])
  );

  layerPayloads.forEach(({ tableName, geoJson, metadata }) => {
    const existingLayer = databaseLayersByTable.get(tableName);
    databaseLayersByTable.set(
      tableName,
      buildDatabaseLayerDefinition({
        existingLayer,
        geoJson,
        metadata,
        name: tableName,
      })
    );
  });

  const nextDatabaseLayers = tableOrder
    .map((tableName) => databaseLayersByTable.get(tableName))
    .filter(Boolean);

  return [...nonDatabaseLayers, ...nextDatabaseLayers];
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function GISWorkspaceProvider({ children }) {
  // El visor arranca sin capas locales demo.
  // Las capas operativas llegan desde PostgreSQL y se sincronizan por la API.
  const initialLayersRef = React.useRef(createInitialLayers());
  const databaseSyncInFlightRef = React.useRef(false);
  const databaseLoadInFlightRef = React.useRef(new Map());

  // Ref auxiliar para detectar transiciones de desktop → móvil
  // y ocultar capas automáticamente cuando el visor entra en modo compacto.
  const wasMobileModeActiveRef = React.useRef(false);

  // ── Estado principal de capas y selección ──────────────────────────────────
  const [layers, setLayers] = React.useState(initialLayersRef.current);
  const [selectedLayerId, setSelectedLayerId] = React.useState(null);
  const [selectedFeature, setSelectedFeature] = React.useState(null);

  // hoveredLayerId: capa bajo el cursor del mouse en el panel de capas
  const [hoveredLayerId, setHoveredLayerId] = React.useState(null);

  // focusedLayerId: capa que el usuario "enfocó" (clic en el ojo/lupa del panel)
  // Cuando hay foco, las demás capas se "dimean" visualmente en el mapa
  const [focusedLayerId, setFocusedLayerId] = React.useState(null);

  // ── Estado de UI ───────────────────────────────────────────────────────────
  const [activeBaseMapId, setActiveBaseMapId] = React.useState(DEFAULT_BASE_MAP_ID);
  const [sidebarTab, setSidebarTab] = React.useState('layers');
  const [layerQuery, setLayerQuery] = React.useState('');
  const [dataFilters, setDataFilters] = React.useState(DEFAULT_FILTERS);

  // interactionMode controla qué herramienta está activa:
  // 'select' | 'measure-distance' | 'measure-area' | 'draw-point' | 'draw-line' | 'draw-polygon'
  const [interactionMode, setInteractionMode] = React.useState('select');

  // Estado de la herramienta de medición activa
  const [measurement, setMeasurement] = React.useState(EMPTY_MEASUREMENT);

  // Estado del dibujo en construcción (vértices aún no confirmados)
  const [drawDraft, setDrawDraft] = React.useState(EMPTY_DRAW_DRAFT);

  // Lista de elementos ya dibujados y guardados por el usuario
  const [drawItems, setDrawItems] = React.useState([]);

  // mapApi: referencia al objeto Leaflet map que expone MapView hacia arriba
  const [mapApi, setMapApi] = React.useState(null);
  const [mapViewportBounds, setMapViewportBounds] = React.useState(null);

  // clearSignal: contador que incrementa para avisar a MapView que limpie dibujos
  // (mejor que un boolean porque siempre dispara el effect aunque ya fuera true)
  const [clearSignal, setClearSignal] = React.useState(0);

  // ── Estado de modo móvil ───────────────────────────────────────────────────
  const [mobileModeManual, setMobileModeManual] = React.useState(false);
  const [mobileSheet, setMobileSheet] = React.useState(null);
  const [isCompactViewport, setIsCompactViewport] = React.useState(
    getInitialCompactViewport()
  );

  // ── Effect: detectar cambio de tamaño de ventana ──────────────────────────
  // Escucha el evento resize para actualizar isCompactViewport cuando el usuario
  // cambia el tamaño de la ventana del navegador.
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      setIsCompactViewport(window.innerWidth <= MOBILE_BREAKPOINT);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // true si estamos en pantalla pequeña O si el usuario activó el modo móvil manualmente
  const isMobileModeActive = isCompactViewport || mobileModeManual;

  // ── Effect: persistir visibilidad de capas en localStorage ───────────────
  // Se ejecuta cada vez que el array de capas cambia.
  // Guarda { tableName → visible } para que un refresco de página restaure
  // las capas que el usuario había activado.
  React.useEffect(() => {
    writeSavedVisibility(layers);
  }, [layers]);

  // ── Effect: limpiar foco al entrar en modo móvil ──────────────────────────
  // Antes se apagaban automáticamente todas las capas visibles al entrar en móvil.
  // Eso rompía la experiencia en teléfono porque el usuario perdía contexto y
  // parecía que el mapa "no cargaba". En móvil solo limpiamos la selección.
  React.useEffect(() => {
    if (isMobileModeActive && !wasMobileModeActiveRef.current) {
      setSelectedFeature(null);
      setFocusedLayerId(null);
      setHoveredLayerId(null);
    }

    wasMobileModeActiveRef.current = isMobileModeActive;
  }, [isMobileModeActive]);

  // ── Effect: limpiar capas demo heredadas ────────────────────────────────
  // Si la app venía de una sesión anterior con datos bootstrap en memoria,
  // las retiramos para dejar solo capas reales de base de datos y las que
  // el usuario suba explícitamente.
  React.useEffect(() => {
    setLayers((currentLayers) => {
      const nextLayers = currentLayers.filter(
        (layer) =>
          !String(layer.id || '').startsWith(LEGACY_BOOTSTRAP_LAYER_PREFIX) &&
          layer.source !== 'SIG-SOBSE curado'
      );

      return nextLayers.length === currentLayers.length
        ? currentLayers
        : nextLayers;
    });
  }, []);

  // ── Effect: sincronización periódica con la base de datos ─────────────────
  // Al montar la app, consulta el catálogo de capas y crea definiciones stub
  // con metadatos (bbox, DG, conteo estimado). Las geometrías se descargan
  // después, solo cuando la capa visible entra al viewport actual.
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let cancelled = false;

    const syncDatabaseLayers = async () => {
      if (databaseSyncInFlightRef.current) return;
      databaseSyncInFlightRef.current = true;

      try {
        const catalog = await fetchLayerTables();
        const tables = Array.isArray(catalog?.tables) ? catalog.tables : [];

        if (process.env.NODE_ENV !== 'production') {
          console.log('[GIS SYNC] Catálogo recibido:', tables.length, 'tablas', tables);
        }

        const geomTables = tables.filter((tableInfo) => {
          const tableName = String(
            tableInfo?.name || tableInfo?.table_name || ''
          ).trim();
          return tableName && tableInfo?.has_geom;
        });
        const orderedTableNames = geomTables.map((tableInfo) =>
          String(tableInfo?.name || tableInfo?.table_name || '').trim()
        );

        if (process.env.NODE_ENV !== 'production') {
          console.log('[GIS SYNC] Capas con geometría:', orderedTableNames);
        }

        if (cancelled) return;

        setLayers((currentLayers) =>
          mergeDatabaseLayers(
            currentLayers,
            geomTables.map((tableInfo) => ({
              tableName: String(
                tableInfo?.name || tableInfo?.table_name || ''
              ).trim(),
              geoJson: null,
              metadata: tableInfo,
            })),
            orderedTableNames
          )
        );
      } catch (error) {
        if (!cancelled) {
          console.warn(
            '[GIS API] No se pudo consultar el catálogo GIS remoto',
            error
          );
        }
      } finally {
        databaseSyncInFlightRef.current = false;
      }
    };

    // Sincronización inmediata al montar + repetición periódica
    syncDatabaseLayers();
    const intervalId = window.setInterval(
      syncDatabaseLayers,
      DATABASE_SYNC_INTERVAL_MS
    );

    // Cleanup: cancelar la sincronización cuando el componente se desmonte
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []); // array vacío → solo corre una vez al montar la app

  const ensureDatabaseLayerLoaded = React.useCallback(async (layer) => {
    const tableName = String(layer?.databaseTable || '').trim();
    if (!tableName) return;

    const existingRequest = databaseLoadInFlightRef.current.get(tableName);
    if (existingRequest) {
      await existingRequest;
      return;
    }

    const requestPromise = (async () => {
      setLayers((currentLayers) =>
        currentLayers.map((currentLayer) =>
          currentLayer.databaseTable === tableName
            ? {
                ...currentLayer,
                loadStatus: 'loading',
                loadError: null,
              }
            : currentLayer
        )
      );

      try {
        const geoJson = await fetchLayerGeoJSON(tableName);

        if (process.env.NODE_ENV !== 'production') {
          const count = geoJson?.features?.length ?? 0;
          console.log(`[GIS LOAD] ${tableName}:`, count, 'features');

          // Validación de CRS: muestrear hasta 5 features para verificar coordenadas WGS84
          if (count > 0) {
            const sample = geoJson.features.slice(0, 5);
            let badCoords = 0;
            sample.forEach((f) => {
              const coords = f?.geometry?.coordinates;
              if (!coords) return;
              const flat = coords.flat(Infinity);
              for (let i = 0; i < flat.length - 1; i += 2) {
                const lng = flat[i];
                const lat = flat[i + 1];
                if (Math.abs(lng) > 180 || Math.abs(lat) > 90) {
                  badCoords++;
                }
              }
            });
            if (badCoords > 0) {
              console.warn(
                `[GIS LOAD] ⚠️ ${tableName}: ${badCoords} coordenadas fuera de rango WGS84. ` +
                '¿La capa está en una proyección diferente (ej. UTM)? Revisa el SRID en PostGIS.'
              );
            }
          }
        }

        if (!geoJson || !Array.isArray(geoJson.features)) {
          throw new Error(`GeoJSON inválido para ${tableName}`);
        }

        setLayers((currentLayers) => {
          const existingLayer = currentLayers.find(
            (currentLayer) =>
              currentLayer.databaseLayer &&
              currentLayer.databaseTable === tableName
          );

          if (!existingLayer) return currentLayers;

          return mergeDatabaseLayers(
            currentLayers,
            [
              {
                tableName,
                geoJson,
                metadata: existingLayer.databaseMetadata || {
                  table_name: tableName,
                },
              },
            ],
            currentLayers
              .filter((currentLayer) => currentLayer.databaseLayer)
              .map((currentLayer) => currentLayer.databaseTable)
          );
        });
      } catch (error) {
        console.warn('[GIS API]', error?.message || error);
        setLayers((currentLayers) =>
          currentLayers.map((currentLayer) =>
            currentLayer.databaseTable === tableName
              ? {
                  ...currentLayer,
                  loadStatus: 'error',
                  loadError:
                    error instanceof Error
                      ? error.message
                      : 'No se pudo cargar la capa.',
                }
              : currentLayer
          )
        );
      }
    })().finally(() => {
      databaseLoadInFlightRef.current.delete(tableName);
    });

    databaseLoadInFlightRef.current.set(tableName, requestPromise);
    await requestPromise;
  }, []);

  React.useEffect(() => {
    const candidateLayers = layers.filter((layer) =>
      shouldLoadDatabaseLayerForViewport(layer, mapViewportBounds)
    );

    if (!candidateLayers.length) return undefined;

    let cancelled = false;
    const queue = [...candidateLayers];
    const workerCount = Math.min(
      DATABASE_LAYER_LOAD_CONCURRENCY,
      queue.length
    );

    const loadVisibleLayers = async () => {
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (queue.length && !cancelled) {
            const nextLayer = queue.shift();
            if (!nextLayer) return;
            await ensureDatabaseLayerLoaded(nextLayer);
          }
        })
      );
    };

    loadVisibleLayers();

    return () => {
      cancelled = true;
    };
  }, [ensureDatabaseLayerLoaded, layers, mapViewportBounds]);

  // ── Valores derivados ──────────────────────────────────────────────────────

  // Objeto del mapa base actualmente seleccionado (contiene URL de tiles, nombre, etc.)
  const activeBaseMap =
    BASE_MAPS.find((baseMap) => baseMap.id === activeBaseMapId) || BASE_MAPS[0];

  // filterOptions: listas de valores únicos para los dropdowns de filtro.
  // useMemo evita recalcular en cada render — solo recalcula cuando cambia `layers`.
  const filterOptions = React.useMemo(
    () => ({
      dg: collectOptions(layers, FEATURE_FILTER_KEYS.dg, normalizeDG),
      programa: collectOptions(layers, FEATURE_FILTER_KEYS.programa),
      alcaldia: collectOptions(layers, FEATURE_FILTER_KEYS.alcaldia),
    }),
    [layers]
  );

  // filteredLayers: versión de `layers` con solo los features que pasan los filtros activos.
  // El mapa y el panel de información usan esta versión, no `layers` directamente.
  // Nota: las capas con 0 features tras filtrar se eliminan completamente.
  const filteredLayers = React.useMemo(
    () =>
      layers
        .map((layer) => {
          const features = (layer.data?.features || []).filter((feature) =>
            featureMatchesFilters(feature, dataFilters)
          );

          return {
            ...layer,
            data: {
              ...layer.data,
              features,
            },
          };
        })
        .filter((layer) => layer.data.features.length > 0),
    [dataFilters, layers]
  );

  // Métricas por capa (total de elementos, progreso promedio, conteo de riesgo).
  // Se usa en el panel lateral para mostrar resúmenes de cada capa.
  const layerMetricsById = React.useMemo(() => {
    const metrics = new Map();
    layers.forEach((layer) => {
      metrics.set(layer.id, computeLayerMetrics(layer));
    });
    return metrics;
  }, [layers]);

  // Total de features visibles tras aplicar los filtros — para el contador del header
  const filteredFeatureCount = React.useMemo(
    () =>
      filteredLayers.reduce(
        (total, layer) => total + (layer.data?.features?.length || 0),
        0
      ),
    [filteredLayers]
  );

  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) || null;
  const visibleLayerCount = layers.filter((layer) => layer.visible).length;

  // Resultados de búsqueda de capas en el panel lateral (filtro por texto en el buscador)
  const layerSearchResults = React.useMemo(() => {
    const normalizedQuery = normalizeValue(layerQuery);
    if (!normalizedQuery) return layers; // sin búsqueda → todas las capas

    return layers.filter((layer) => {
      // Concatenamos todos los campos buscables en un solo string
      const haystack = normalizeValue(
        [
          layer.name,
          layer.source,
          layer.geometryType,
          layer.dg,
          layer.programa,
          layer.alcaldia,
        ].join(' ')
      );

      return haystack.includes(normalizedQuery);
    });
  }, [layerQuery, layers]);

  // ── Effect: reset de estado al cambiar modo de interacción ────────────────
  // Cuando el usuario activa medir o dibujar, limpiamos el estado de la herramienta
  // anterior y preparamos el estado inicial de la nueva.
  React.useEffect(() => {
    if (isMeasureMode(interactionMode)) {
      setMeasurement({
        type: interactionMode,
        points: [],
        summary: null,
        finished: false,
      });
      setDrawDraft(EMPTY_DRAW_DRAFT);
      setSelectedFeature(null);
      setFocusedLayerId(null);
    }

    if (isDrawMode(interactionMode)) {
      setMeasurement(EMPTY_MEASUREMENT);
      setDrawDraft({
        type: interactionMode,
        points: [],
      });
      setSelectedFeature(null);
      setFocusedLayerId(null);
    }
  }, [interactionMode]);

  // ── Acciones (mutations del estado) ───────────────────────────────────────
  // Todas las funciones que modifican el estado están agrupadas en `actions`.
  // El useMemo evita recrear el objeto en cada render (solo se recrea si cambia
  // isCompactViewport, que es la única dependencia externa de las acciones).
  const actions = React.useMemo(
    () => ({
      // ── Setters directos de UI ──────────────────────────────────────────
      setSidebarTab,
      setLayerQuery,
      setSelectedLayerId,
      setSelectedFeature,
      setHoveredLayerId,
      setFocusedLayerId,
      setActiveBaseMapId,
      setInteractionMode,
      setMeasurement,
      setDrawDraft,
      setDrawItems,
      setMapApi,
      setMapViewportBounds,
      setMobileSheet,

      // ── Acciones de visibilidad de capas ───────────────────────────────

      // Alterna el estado visible/oculto de una capa específica
      toggleLayerVisibility(layerId) {
        setLayers((currentLayers) =>
          currentLayers.map((layer) =>
            layer.id === layerId
              ? (() => {
                  const nextVisible = !layer.visible;
                  return {
                    ...layer,
                    visible: nextVisible,
                    loadRequested:
                      layer.databaseLayer && nextVisible
                        ? true
                        : layer.loadRequested,
                    loadStatus:
                      nextVisible &&
                      layer.databaseLayer &&
                      layer.loadStatus === 'error'
                        ? 'idle'
                        : layer.loadStatus,
                    loadError:
                      nextVisible &&
                      layer.databaseLayer &&
                      layer.loadStatus === 'error'
                        ? null
                        : layer.loadError,
                  };
                })()
              : layer
          )
        );
      },

      // Pone todas las capas como visibles (true) u ocultas (false)
      setAllLayersVisible(visible) {
        setLayers((currentLayers) =>
          currentLayers.map((layer) => ({
            ...layer,
            visible,
            loadRequested:
              visible && layer.databaseLayer
                ? true
                : layer.loadRequested,
            loadStatus:
              visible && layer.databaseLayer && layer.loadStatus === 'error'
                ? 'idle'
                : layer.loadStatus,
            loadError:
              visible && layer.databaseLayer && layer.loadStatus === 'error'
                ? null
                : layer.loadError,
          }))
        );
      },

      // Muestra solo la capa indicada y oculta todas las demás.
      // También la selecciona y le da foco para que el mapa centre en ella.
      showOnlyLayer(layerId) {
        setLayers((currentLayers) =>
          currentLayers.map((layer) => ({
            ...layer,
            visible: layer.id === layerId,
            loadRequested:
              layer.id === layerId && layer.databaseLayer
                ? true
                : layer.loadRequested,
            loadStatus:
              layer.id === layerId &&
              layer.databaseLayer &&
              layer.loadStatus === 'error'
                ? 'idle'
                : layer.loadStatus,
            loadError:
              layer.id === layerId &&
              layer.databaseLayer &&
              layer.loadStatus === 'error'
                ? null
                : layer.loadError,
          }))
        );
        setSelectedLayerId(layerId);
        setFocusedLayerId(layerId);
      },

      // Selecciona y enfoca una capa (sin afectar la visibilidad de las demás)
      focusLayer(layerId) {
        setSelectedLayerId(layerId);
        setFocusedLayerId(layerId);
      },

      // Limpia el hover de la sidebar (cuando el cursor sale del panel de capas)
      clearLayerHover() {
        setHoveredLayerId(null);
      },

      // Reordena las capas por drag-and-drop en el panel lateral
      moveLayer(draggedId, targetId) {
        setLayers((currentLayers) =>
          reorderLayers(currentLayers, draggedId, targetId)
        );
      },

      // ── Acciones de estilo ─────────────────────────────────────────────

      // Aplica un parche parcial al estilo de una capa (ej. solo cambiar el color)
      updateLayerStyle(layerId, stylePatch) {
        setLayers((currentLayers) =>
          currentLayers.map((layer) => {
            if (layer.id !== layerId) return layer;

            const style = {
              ...(layer.style || {}),
              ...stylePatch,
            };

            return {
              ...layer,
              color: style.color || layer.color,
              style,
            };
          })
        );
      },

      // Restaura el estilo original de la capa (el que tenía al ser creada/cargada)
      resetLayerStyle(layerId) {
        setLayers((currentLayers) =>
          currentLayers.map((layer) => {
            if (layer.id !== layerId) return layer;

            return {
              ...layer,
              color: layer.initialStyle?.color || layer.color,
              style: { ...(layer.initialStyle || layer.style || {}) },
            };
          })
        );
      },

      // ── Acciones de filtros de datos ───────────────────────────────────

      // Actualiza un solo filtro (ej. cambiar el filtro de DG sin tocar los demás)
      updateDataFilter(key, value) {
        setDataFilters((current) => ({
          ...current,
          [key]: value,
        }));
      },

      // Limpia todos los filtros volviendo al estado inicial (sin filtros)
      clearDataFilters() {
        setDataFilters(DEFAULT_FILTERS);
      },

      // ── Acciones de carga de capas ─────────────────────────────────────

      // Añade una capa GeoJSON subida por el usuario desde un archivo local.
      // Enriquece los features con __featureKey y asigna un color de la paleta.
      addUploadedLayer(geoJson, name) {
        setLayers((current) => {
          const uploadCount = current.filter((l) => l.uploaded).length;
          const color = UPLOAD_COLORS[uploadCount % UPLOAD_COLORS.length];
          const layerId = `upload-${Date.now()}`;
          const geometryType =
            geoJson.features?.[0]?.geometry?.type || 'Unknown';
          const isPoint =
            geometryType === 'Point' || geometryType === 'MultiPoint';

          // Añadir __featureKey a cada feature para poder identificarlos en el mapa
          const enriched = {
            ...geoJson,
            features: (geoJson.features || []).map((feature, index) => ({
              ...feature,
              id: feature.id || `${layerId}-f${index + 1}`,
              properties: {
                ...feature.properties,
                __featureKey: `${layerId}-f${index + 1}`,
              },
            })),
          };

          const style = {
            color,
            weight: isPoint ? 0 : 2,
            pointRadius: 7,
            opacity: 0.94,
            fillOpacity: isPoint ? 0 : 0.22,
            markerKind: 'solid',
            dashStyle: 'solid',
          };

          const newLayer = {
            id: layerId,
            name,
            visible: true,
            color,
            source: 'Usuario',
            dg: 'Cargado por usuario',
            programa: name,
            alcaldia: null,
            data: enriched,
            geometryType,
            style,
            initialStyle: { ...style },
            uploaded: true,
          };

          return [...current, newLayer];
        });
      },

      // Añade o actualiza una capa proveniente de la base de datos.
      // Si ya existe una capa con ese nombre de tabla, la reemplaza
      // conservando el estilo personalizado del usuario.
      addDatabaseLayer(geoJson, name, metadata = {}) {
        setLayers((currentLayers) => {
          const tableName = String(metadata?.table_name || name || '').trim();
          if (!tableName) return currentLayers;

          const existingLayer = currentLayers.find(
            (layer) => layer.databaseLayer && layer.databaseTable === tableName
          );

          const nextLayer = buildDatabaseLayerDefinition({
            existingLayer,
            geoJson,
            metadata: {
              ...metadata,
              table_name: tableName,
            },
            name,
          });

          // Elimina la versión anterior (si existe) y añade la nueva al final
          const nextLayers = currentLayers.filter(
            (layer) => !(layer.databaseLayer && layer.databaseTable === tableName)
          );

          return [...nextLayers, nextLayer];
        });
      },

      // Elimina una capa por su id. También limpia cualquier estado de selección
      // que pudiera estar apuntando a esa capa.
      removeLayer(layerId) {
        setLayers((current) => current.filter((l) => l.id !== layerId));
        setSelectedLayerId((prev) => (prev === layerId ? null : prev));
        setFocusedLayerId((prev) => (prev === layerId ? null : prev));
        setSelectedFeature((prev) =>
          prev?.layerId === layerId ? null : prev
        );
      },

      // ── Acciones de dibujo ─────────────────────────────────────────────

      // Guarda un elemento dibujado por el usuario (punto, línea, polígono terminado)
      addDrawItem(item) {
        setDrawItems((current) => [...current, item]);
      },

      // Borra todos los elementos dibujados y vuelve al modo de selección
      clearDrawings() {
        setDrawItems([]);
        setDrawDraft(EMPTY_DRAW_DRAFT);
        setInteractionMode('select');
        // Incrementar la señal avisa a MapView para que limpie las capas de dibujo en Leaflet
        setClearSignal((value) => value + 1);
      },

      // Limpia la selección, el hover, el foco y todas las herramientas activas.
      // Se llama al presionar Escape o al cerrar el panel de detalle.
      clearSelectionAndTools() {
        setSelectedFeature(null);
        setHoveredLayerId(null);
        setFocusedLayerId(null);
        setInteractionMode('select');
        setMeasurement(EMPTY_MEASUREMENT);
        setDrawDraft(EMPTY_DRAW_DRAFT);
        setMobileSheet(null);
        setClearSignal((value) => value + 1);
      },

      // ── Acciones de modo móvil ─────────────────────────────────────────

      openMobileSheet(sheetId) {
        setMobileSheet(sheetId);
      },

      closeMobileSheet() {
        setMobileSheet(null);
      },

      // Activa o desactiva el modo móvil.
      // Si la pantalla ya es compacta por tamaño (isCompactViewport), solo abre el sheet.
      // Si no, alterna el modo manual.
      toggleMobileMode() {
        if (isCompactViewport) {
          setMobileSheet((current) => current || 'layers');
          return;
        }

        setMobileModeManual((current) => {
          const next = !current;
          if (next) setMobileSheet('layers');
          else setMobileSheet(null);
          return next;
        });
      },

      exitMobileMode() {
        setMobileModeManual(false);
        if (!isCompactViewport) {
          setMobileSheet(null);
        }
      },

      // Vuelve el workspace al estado base: capas de base de datos activas,
      // sin selección, modo selección, mapa base por defecto.
      resetWorkspace() {
        setLayers((currentLayers) =>
          currentLayers
            .filter((layer) => layer.databaseLayer || layer.referenceLayer)
            .map((layer) => ({
              ...layer,
              visible: layer.referenceLayer ? true : false,
              loadRequested: layer.referenceLayer ? layer.loadRequested : false,
            }))
        );
        setSelectedLayerId(null);
        setSelectedFeature(null);
        setHoveredLayerId(null);
        setFocusedLayerId(null);
        setActiveBaseMapId(DEFAULT_BASE_MAP_ID);
        setSidebarTab('layers');
        setLayerQuery('');
        setDataFilters(DEFAULT_FILTERS);
        setInteractionMode('select');
        setMeasurement(EMPTY_MEASUREMENT);
        setDrawDraft(EMPTY_DRAW_DRAFT);
        setDrawItems([]);
        setClearSignal((value) => value + 1);
      },
    }),
    [isCompactViewport] // las acciones solo se recrean si cambia el breakpoint
  );

  // ── Valor del contexto ─────────────────────────────────────────────────────
  // Todos los datos que los componentes hijos pueden leer via useGISWorkspace().
  // useMemo evita que todos los consumidores se re-renderizen en cada cambio de
  // estado — solo se re-renderizan si alguno de sus datos específicos cambió.
  const value = React.useMemo(
    () => ({
      activeBaseMap,
      baseMaps: BASE_MAPS,
      clearSignal,
      dataFilters,
      drawDraft,
      drawItems,
      focusedLayerId,
      filterOptions,
      filteredFeatureCount,
      filteredLayers,
      interactionMode,
      isCompactViewport,
      isMobileModeActive,
      layerQuery,
      layerMetricsById,
      layerSearchResults,
      layers,
      mapApi,
      mapViewportBounds,
      measurement,
      mobileModeManual,
      mobileSheet,
      hoveredLayerId,
      selectedFeature,
      selectedLayer,
      selectedLayerId,
      sidebarTab,
      visibleLayerCount,
      actions,
    }),
    [
      activeBaseMap,
      actions,
      clearSignal,
      dataFilters,
      drawDraft,
      drawItems,
      focusedLayerId,
      filterOptions,
      filteredFeatureCount,
      filteredLayers,
      interactionMode,
      isCompactViewport,
      isMobileModeActive,
      layerQuery,
      layerMetricsById,
      layerSearchResults,
      layers,
      mapApi,
      mapViewportBounds,
      measurement,
      mobileModeManual,
      mobileSheet,
      hoveredLayerId,
      selectedFeature,
      selectedLayer,
      selectedLayerId,
      sidebarTab,
      visibleLayerCount,
    ]
  );

  return (
    <GISWorkspaceContext.Provider value={value}>
      {children}
    </GISWorkspaceContext.Provider>
  );
}

// ── Hook de acceso al contexto ────────────────────────────────────────────────

// Hook personalizado que cualquier componente puede llamar para acceder al estado.
// Lanza un error descriptivo si se usa fuera del Provider, lo que facilita
// detectar problemas de estructura en el árbol de componentes.
// Uso: const { layers, actions } = useGISWorkspace();
export function useGISWorkspace() {
  const context = React.useContext(GISWorkspaceContext);

  if (!context) {
    throw new Error('useGISWorkspace debe usarse dentro de GISWorkspaceProvider');
  }

  return context;
}
