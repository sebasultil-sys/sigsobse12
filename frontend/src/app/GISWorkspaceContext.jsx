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
const LEGACY_BOOTSTRAP_LAYER_PREFIX = 'bootstrap-';

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

// Extrae los valores únicos de una propiedad GeoJSON de todas las capas.
// Sirve para construir los dropdowns de filtro (DG, programa, alcaldía).
// Ejemplo: collectOptions(layers, 'DG') → ['DGCOP', 'DGSUS', 'DGOT', ...]
function collectOptions(layers, key) {
  const values = new Set();

  layers.forEach((layer) => {
    (layer.data?.features || []).forEach((feature) => {
      const value = feature?.properties?.[key];
      if (value) values.add(String(value));
    });
  });

  return Array.from(values).sort((left, right) => left.localeCompare(right, 'es'));
}

// Determina si un feature GeoJSON pasa todos los filtros activos.
// Se llama en el useMemo de filteredLayers para construir la vista filtrada.
// El filtro de texto busca en varios campos al mismo tiempo (OBRA, FRENTE, etc.)
function featureMatchesFilters(feature, filters) {
  const properties = feature?.properties || {};

  // Filtros exactos por categoría
  if (filters.dg !== 'all' && String(properties.DG || '') !== filters.dg) {
    return false;
  }

  if (
    filters.programa !== 'all' &&
    String(properties.PROGRAMA || '') !== filters.programa
  ) {
    return false;
  }

  if (
    filters.alcaldia !== 'all' &&
    String(properties.ALCALDIA || '') !== filters.alcaldia
  ) {
    return false;
  }

  // Filtro de texto libre — busca en múltiples campos concatenados
  const obraQuery = normalizeValue(filters.obra);
  if (!obraQuery) return true;

  const searchableFields = [
    properties.OBRA,
    properties.FRENTE,
    properties.PROGRAMA,
    properties.ALCALDIA,
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

  const withoutPrefix = raw.replace(/^(?:\d{2}\s+){2,}/, '');
  const normalizedSeparators = withoutPrefix
    .replace(/[_]+/g, ' ')
    .replace(/[–—]+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

  const uniqueSegments = normalizedSeparators
    .split(/\s+-\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter(
      (segment, index, segments) =>
        index ===
        segments.findIndex(
          (candidate) => normalizeValue(candidate) === normalizeValue(segment)
        )
    );

  const formattedSegments = uniqueSegments.map((segment) =>
    segment
      .split(/\s+/)
      .map((word, index) => formatInstitutionalWord(word, index))
      .filter(Boolean)
      .join(' ')
  );

  return formattedSegments.join(' - ') || 'Capa sin nombre';
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
  const geometryType = getGeometryType(geoJson);
  const enriched = enrichFeatureCollection(layerId, geoJson);
  const color = existingLayer?.color || getStableColor(tableName);
  const baseStyle = buildLayerStyle(color, geometryType);
  const dg = detectLayerDg(enriched);
  const displayName = formatDatabaseLayerName(name || tableName);

  return {
    id: layerId,
    name: displayName,
    // Conserva la visibilidad que tenía si ya existía; las nuevas capas empiezan visibles
    visible:
      typeof existingLayer?.visible === 'boolean'
        ? existingLayer.visible
        : true,
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function GISWorkspaceProvider({ children }) {
  // El visor arranca sin capas locales demo.
  // Las capas operativas llegan desde PostgreSQL y se sincronizan por la API.
  const initialLayersRef = React.useRef([]);

  // Ref auxiliar para detectar transiciones de desktop → móvil
  // y ocultar capas automáticamente cuando el visor entra en modo compacto.
  const wasMobileModeActiveRef = React.useRef(false);

  // ── Estado principal de capas y selección ──────────────────────────────────
  const [layers, setLayers] = React.useState(initialLayersRef.current);
  const [selectedLayerId, setSelectedLayerId] = React.useState(
    initialLayersRef.current[0]?.id || null
  );
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
  // Al montar la app, consulta el catálogo de capas del backend y descarga
  // el GeoJSON de todas las tablas con geometría en PARALELO (Promise.allSettled).
  // Luego repite la consulta cada DATABASE_SYNC_INTERVAL_MS (30 segundos).
  //
  // Optimizaciones clave:
  //   - Promise.allSettled: todas las capas se descargan simultáneamente
  //   - Si una capa falla, las demás siguen adelante (no bloquea todo)
  //   - La variable `cancelled` evita actualizar el estado si el componente
  //     se desmontó mientras esperábamos la respuesta del servidor
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let cancelled = false;

    const syncDatabaseLayers = async () => {
      try {
        // 1. Pedir el catálogo de tablas (nombres + si tienen geometría)
        const catalog = await fetchLayerTables();
        const tables = Array.isArray(catalog?.tables) ? catalog.tables : [];

        // 2. Filtrar solo las que tienen columna geom antes de hacer fetch
        //    (ahorramos peticiones para tablas alfanuméricas sin geometría)
        const geomTables = tables.filter((tableInfo) => {
          const tableName = String(
            tableInfo?.name || tableInfo?.table_name || ''
          ).trim();
          return tableName && tableInfo?.has_geom;
        });

        // 3. Descargar el GeoJSON de TODAS las capas al mismo tiempo
        //    Promise.allSettled no cancela todo si una falla — registra cada resultado por separado
        const results = await Promise.allSettled(
          geomTables.map(async (tableInfo) => {
            const tableName = String(
              tableInfo?.name || tableInfo?.table_name || ''
            ).trim();

            const geoJson = await fetchLayerGeoJSON(tableName);

            if (!geoJson || !Array.isArray(geoJson.features)) {
              throw new Error(`GeoJSON inválido para ${tableName}`);
            }

            if (!geoJson.features.length) {
              throw new Error(`Sin features en ${tableName}`);
            }

            return { tableName, geoJson, metadata: tableInfo };
          })
        );

        // Salir si el componente ya fue desmontado mientras esperábamos
        if (cancelled) return;

        // 4. Separar las descargas exitosas de las fallidas
        const collectedLayers = results
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value);

        // Loguear las fallidas sin bloquear la carga de las exitosas
        results
          .filter((result) => result.status === 'rejected')
          .forEach((result) => {
            console.warn('[GIS API]', result.reason?.message || result.reason);
          });

        // 5. Actualizar el estado React de forma atómica
        //    Para cada tabla exitosa: si ya existía una capa, la actualiza conservando
        //    el estilo del usuario; si es nueva, la añade al final de la lista.
        setLayers((currentLayers) => {
          // Separar capas que NO vienen de la BD (subidas por el usuario, bootstrap)
          const nonDatabaseLayers = currentLayers.filter(
            (layer) => !layer.databaseLayer
          );

          // Índice de capas de BD existentes → permite buscar rápido por nombre de tabla
          const existingDatabaseLayers = new Map(
            currentLayers
              .filter((layer) => layer.databaseLayer)
              .map((layer) => [layer.databaseTable, layer])
          );

          const nextDatabaseLayers = collectedLayers.map(
            ({ tableName, geoJson, metadata }) => {
              const existingLayer = existingDatabaseLayers.get(tableName);
              return buildDatabaseLayerDefinition({
                existingLayer,
                geoJson,
                metadata,
                name: tableName,
              });
            }
          );

          // Las capas no-BD van primero, luego las de BD al fondo del stack del mapa
          return [...nonDatabaseLayers, ...nextDatabaseLayers];
        });
      } catch (error) {
        if (!cancelled) {
          console.warn(
            '[GIS API] No se pudo consultar el catálogo GIS remoto',
            error
          );
        }
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

  // ── Valores derivados ──────────────────────────────────────────────────────

  // Objeto del mapa base actualmente seleccionado (contiene URL de tiles, nombre, etc.)
  const activeBaseMap =
    BASE_MAPS.find((baseMap) => baseMap.id === activeBaseMapId) || BASE_MAPS[0];

  // filterOptions: listas de valores únicos para los dropdowns de filtro.
  // useMemo evita recalcular en cada render — solo recalcula cuando cambia `layers`.
  const filterOptions = React.useMemo(
    () => ({
      dg: collectOptions(layers, 'DG'),
      programa: collectOptions(layers, 'PROGRAMA'),
      alcaldia: collectOptions(layers, 'ALCALDIA'),
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
      setMobileSheet,

      // ── Acciones de visibilidad de capas ───────────────────────────────

      // Alterna el estado visible/oculto de una capa específica
      toggleLayerVisibility(layerId) {
        setLayers((currentLayers) =>
          currentLayers.map((layer) =>
            layer.id === layerId
              ? { ...layer, visible: !layer.visible }
              : layer
          )
        );
      },

      // Pone todas las capas como visibles (true) u ocultas (false)
      setAllLayersVisible(visible) {
        setLayers((currentLayers) =>
          currentLayers.map((layer) => ({ ...layer, visible }))
        );
      },

      // Muestra solo la capa indicada y oculta todas las demás.
      // También la selecciona y le da foco para que el mapa centre en ella.
      showOnlyLayer(layerId) {
        setLayers((currentLayers) =>
          currentLayers.map((layer) => ({
            ...layer,
            visible: layer.id === layerId,
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
          currentLayers.filter((layer) => layer.databaseLayer)
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
