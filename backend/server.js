// ─────────────────────────────────────────────────────────────────────────────
// server.js — Servidor Express (API REST del backend GIS)
//
// Este archivo es el corazón del backend. Define todas las rutas HTTP que
// el frontend puede llamar para obtener datos de PostgreSQL/PostGIS.
//
// Rutas disponibles:
//   GET  /           → estado del servidor
//   GET  /test       → prueba de conexión a PostgreSQL
//   GET  /layers     → catálogo de tablas del schema sig_sobse
//   GET  /layer/:table → GeoJSON de una tabla específica
//   POST /cache/invalidate → fuerza recarga del catálogo
// ─────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import compression from 'compression';
import { pool, query } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = Number(process.env.PORT || 3001);
app.set('trust proxy', 1);

// Schema de PostgreSQL donde viven todas las tablas de obra pública
const GIS_SCHEMA = process.env.PGSCHEMA || 'sig_sobse';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ENABLE_BACKEND_DEBUG =
  !IS_PRODUCTION || String(process.env.GIS_DEBUG || '').toLowerCase() === 'true';
const CACHE_INVALIDATE_TOKEN = String(
  process.env.CACHE_INVALIDATE_TOKEN || ''
).trim();
const SERVE_FRONTEND =
  String(process.env.SERVE_FRONTEND || 'true').toLowerCase() !== 'false';
const FRONTEND_BUILD_DIR = path.resolve(__dirname, '../frontend/build');
const FRONTEND_INDEX_FILE = path.join(FRONTEND_BUILD_DIR, 'index.html');
const HAS_FRONTEND_BUILD =
  SERVE_FRONTEND && fs.existsSync(FRONTEND_INDEX_FILE);

// ── Middlewares globales ──────────────────────────────────────────────────────

// compression() comprime automáticamente todas las respuestas con gzip.
// Reduce el tamaño del JSON hasta un 70-80% → capas cargan mucho más rápido.
app.use(compression());

// CORS abierto — el frontend en Hostinger y el backend en Render son dominios distintos.
app.use(cors({ origin: '*' }));

app.use(express.json());

// ── Caché en memoria del catálogo de tablas ───────────────────────────────────
// Escanear information_schema cada vez que alguien pide una capa es lento.
// Guardamos el resultado en RAM durante 5 minutos para evitar queries repetidas.
// TTL = Time To Live = tiempo que dura válido el caché.
let catalogCache = null;
let catalogCacheTime = 0;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos en milisegundos
const DEFAULT_LAYER_CACHE_TTL_MS =
  process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 60 * 1000;
const LAYER_CACHE_TTL_MS = Math.max(
  15000,
  Number(process.env.GIS_LAYER_CACHE_TTL_MS || DEFAULT_LAYER_CACHE_TTL_MS)
);
const CATALOG_SUMMARY_CONCURRENCY = Math.max(
  1,
  Number(process.env.GIS_CATALOG_SUMMARY_CONCURRENCY || 2)
);
const layerGeoJsonCache = new Map();
const layerGeoJsonInFlight = new Map();

// Borra el caché para forzar una nueva consulta a PostgreSQL
function invalidateCatalogCache() {
  catalogCache = null;
  catalogCacheTime = 0;
}

function invalidateLayerGeoJsonCache(tableName = null) {
  if (tableName) {
    layerGeoJsonCache.delete(tableName);
    layerGeoJsonInFlight.delete(tableName);
    return;
  }

  layerGeoJsonCache.clear();
  layerGeoJsonInFlight.clear();
}

function getValidCatalogCache() {
  if (!catalogCache) return null;
  if (Date.now() - catalogCacheTime >= CATALOG_CACHE_TTL_MS) return null;
  return catalogCache;
}

function getCachedLayerGeoJson(tableName) {
  const cached = layerGeoJsonCache.get(tableName);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt >= LAYER_CACHE_TTL_MS) {
    layerGeoJsonCache.delete(tableName);
    return null;
  }

  return cached.geojson;
}

function logBackend(...args) {
  if (ENABLE_BACKEND_DEBUG) {
    console.log(...args);
  }
}

function logBackendError(...args) {
  console.error(...args);
}

function getInvalidateRequestToken(req) {
  const headerToken = String(req.get('x-cache-token') || '').trim();
  const authHeader = String(req.get('authorization') || '').trim();
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return headerToken || String(bearerMatch?.[1] || '').trim();
}

function getServiceStatus() {
  return {
    ok: true,
    service: 'sigsobse-backend',
    message: 'API GIS operativa',
    serve_frontend: HAS_FRONTEND_BUILD,
    schema: GIS_SCHEMA,
  };
}

function isApiLikePath(requestPath) {
  return /^\/(api(?:\/|$)|test|layers|layer(?:\/|$)|cache(?:\/|$)|health(?:\/|$))/.test(
    requestPath
  );
}

function shouldServeFrontendApp(req) {
  if (!HAS_FRONTEND_BUILD || req.method !== 'GET') return false;
  if (isApiLikePath(req.path)) return false;
  if (path.extname(req.path)) return false;

  const acceptHeader = String(req.get('accept') || '').toLowerCase();
  return acceptHeader.includes('text/html') || acceptHeader.includes('*/*');
}

// ── Funciones de seguridad SQL ────────────────────────────────────────────────

// Escapa identificadores SQL (nombres de tablas, columnas, schemas) para
// evitar inyección SQL. Los nombres de tablas NO pueden parametrizarse con $1
// igual que los valores, por eso necesitamos esta función manual.
// Ejemplo: "OBRAS PUBLICAS" → `"OBRAS PUBLICAS"` (comillas dobles internas duplicadas)
function quoteIdentifier(value) {
  const normalized = String(value || '');

  if (!normalized.trim() || normalized.includes('\0')) {
    throw new Error('Identificador SQL inválido.');
  }

  return `"${normalized.replace(/"/g, '""')}"`;
}

// ── Funciones de detección de geometría ──────────────────────────────────────

// Determina si una columna de PostgreSQL es una columna de geometría PostGIS.
// Las columnas geom aparecen en information_schema con data_type = 'USER-DEFINED'
// y udt_name = 'geometry' (tipo definido por la extensión PostGIS).
function isGeometryColumn(column) {
  return (
    String(column?.column_name || '').toLowerCase() === 'geom' &&
    String(column?.data_type || '').toUpperCase() === 'USER-DEFINED' &&
    String(column?.udt_name || '').toLowerCase() === 'geometry'
  );
}

function normalizeCatalogKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

const DG_COLUMN_CANDIDATES = new Set([
  'DG',
  'DIRECCIONGENERAL',
]);

function findColumnByCandidates(columns, candidates) {
  return (
    (columns || []).find((column) =>
      candidates.has(normalizeCatalogKey(column?.column_name))
    ) || null
  );
}

async function getTableEstimatedFeatureCount(tableName) {
  const result = await query(
    `
      SELECT GREATEST(c.reltuples::bigint, 0)::bigint AS estimated_count
      FROM pg_class AS c
      INNER JOIN pg_namespace AS n
        ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relname = $2
      LIMIT 1
    `,
    [GIS_SCHEMA, tableName]
  );

  return Number(result.rows[0]?.estimated_count || 0);
}

async function getTableEstimatedBbox(tableName, geometryColumn) {
  const result = await query(
    `
      SELECT
        ST_XMin(extent_box) AS west,
        ST_YMin(extent_box) AS south,
        ST_XMax(extent_box) AS east,
        ST_YMax(extent_box) AS north
      FROM (
        SELECT ST_EstimatedExtent($1, $2, $3) AS extent_box
      ) AS ext
      WHERE extent_box IS NOT NULL
    `,
    [GIS_SCHEMA, tableName, geometryColumn]
  );

  const row = result.rows[0];
  if (!row) return null;

  const west = Number(row.west);
  const south = Number(row.south);
  const east = Number(row.east);
  const north = Number(row.north);

  if (
    [west, south, east, north].some((value) => !Number.isFinite(value))
  ) {
    return null;
  }

  return { west, south, east, north };
}

async function getTableSampleTextValue(tableName, columnName) {
  if (!columnName) return null;

  const safeSchema = quoteIdentifier(GIS_SCHEMA);
  const safeTable = quoteIdentifier(tableName);
  const safeColumn = quoteIdentifier(columnName);
  const result = await query(
    `
      SELECT ${safeColumn}::text AS value
      FROM ${safeSchema}.${safeTable}
      WHERE ${safeColumn} IS NOT NULL
        AND BTRIM(${safeColumn}::text) <> ''
      LIMIT 1
    `
  );

  return String(result.rows[0]?.value || '').trim() || null;
}

async function getLayerCatalogSummary(tableName, geometryColumn, columns) {
  const dgColumn = findColumnByCandidates(columns, DG_COLUMN_CANDIDATES);

  const estimatedCount = await getTableEstimatedFeatureCount(tableName);
  const bbox = await getTableEstimatedBbox(tableName, geometryColumn);
  const dg = dgColumn
    ? await getTableSampleTextValue(tableName, dgColumn.column_name)
    : null;

  return {
    estimated_count: estimatedCount,
    bbox,
    dg,
  };
}

// ── Consultas a information_schema ───────────────────────────────────────────

// Devuelve todas las tablas del schema sig_sobse.
// information_schema es un schema especial de PostgreSQL que describe la
// estructura de la base de datos (tablas, columnas, tipos, etc.).
async function getSchemaTables() {
  const result = await query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
    `,
    [GIS_SCHEMA]
  );

  return result.rows;
}

// Devuelve todas las columnas de una tabla específica.
// Con esto detectamos si la tabla tiene columna geom y de qué tipo es.
async function getTableColumns(tableName) {
  const result = await query(
    `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position ASC
    `,
    [GIS_SCHEMA, tableName]
  );

  return result.rows;
}

async function getSchemaColumns() {
  const result = await query(
    `
      SELECT table_name, column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name ASC, ordinal_position ASC
    `,
    [GIS_SCHEMA]
  );

  return result.rows;
}

async function mapWithConcurrency(items, workerLimit, iteratee) {
  const results = new Array(items.length);
  const queue = items.map((item, index) => ({ item, index }));
  const limit = Math.max(1, Math.min(workerLimit, items.length || 1));

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) return;

        results[next.index] = await iteratee(next.item, next.index);
      }
    })
  );

  return results;
}

// ── Catálogo de capas ─────────────────────────────────────────────────────────

// Construye el catálogo completo: lista de tablas con metadatos.
// Optimización clave: consulta las columnas de TODAS las tablas en paralelo
// con Promise.all, en lugar de una por una en un loop secuencial.
// El resultado se guarda en caché 5 minutos para no repetir el escaneo.
async function getLayerCatalog() {
  // Devuelve el catálogo desde caché si está vigente
  const validCatalogCache = getValidCatalogCache();
  if (validCatalogCache) return validCatalogCache;

  logBackend(`[GIS API] Consultando schema "${GIS_SCHEMA}" para catálogo de tablas...`);

  const tables = await getSchemaTables();
  const schemaColumns = await getSchemaColumns();
  const columnsByTable = schemaColumns.reduce((accumulator, column) => {
    const tableName = String(column?.table_name || '').trim();
    if (!tableName) return accumulator;

    const currentColumns = accumulator.get(tableName) || [];
    currentColumns.push(column);
    accumulator.set(tableName, currentColumns);
    return accumulator;
  }, new Map());

  const columnResults = tables.map((table) => {
    const tableName = String(table?.table_name || '').trim();
    return tableName ? columnsByTable.get(tableName) || [] : [];
  });

  const catalogSummaries = await mapWithConcurrency(
    tables.map((table, index) => {
      const tableName = String(table?.table_name || '').trim();
      const columns = columnResults[index] || [];
      const geometryColumn = columns.find(isGeometryColumn) || null;

      if (!tableName || !geometryColumn?.column_name) {
        return Promise.resolve(null);
      }

      return getLayerCatalogSummary(
        tableName,
        geometryColumn.column_name,
        columns
      ).catch((error) => {
        logBackendError(
          `[GIS API] No se pudo obtener resumen del catálogo para "${GIS_SCHEMA}"."${tableName}"`,
          error
        );
        return null;
      });
    }),
    CATALOG_SUMMARY_CONCURRENCY,
    (summaryTask) => summaryTask
  );

  // Combina cada tabla con sus columnas y detecta si tiene geometría
  const catalog = tables.map((table, index) => {
    const tableName = String(table?.table_name || '').trim();
    const columns = columnResults[index] || [];
    const geometryColumn = columns.find(isGeometryColumn) || null;
    const hasGeom = Boolean(geometryColumn);
    const summary = catalogSummaries[index] || null;

    logBackend(
      `[GIS API] Tabla "${GIS_SCHEMA}"."${tableName}": geom=${hasGeom ? 'sí' : 'no'}`
    );

    return {
      name: tableName,
      table_name: tableName,
      table_schema: GIS_SCHEMA,
      has_geom: hasGeom,
      geometry_column: hasGeom ? geometryColumn.column_name : null,
      source_type: hasGeom ? 'postgis' : 'table',
      estimated_count: hasGeom ? summary?.estimated_count || 0 : 0,
      bbox: hasGeom ? summary?.bbox || null : null,
      dg: summary?.dg || null,
    };
  }).filter((row) => row.name); // Elimina filas con nombre vacío

  logBackend(
    `[GIS API] Schema "${GIS_SCHEMA}" consultado: ${catalog.length} tablas encontradas`
  );

  // Guardar en caché para las próximas 5 minutos
  catalogCache = catalog;
  catalogCacheTime = Date.now();

  return catalog;
}

async function getTableMeta(tableName) {
  const validCatalogCache = getValidCatalogCache();
  if (validCatalogCache) {
    return (
      validCatalogCache.find(
        (table) => String(table?.table_name || '').trim() === tableName
      ) || null
    );
  }

  return getTableMetaDirect(tableName);
}

// Obtiene los metadatos de UNA tabla específica consultando solo sus columnas.
// Más eficiente que llamar getLayerCatalog() completo cuando solo se necesita
// validar una tabla antes de servirle el GeoJSON al frontend.
// Devuelve null si la tabla no existe en el schema.
async function getTableMetaDirect(tableName) {
  const columns = await getTableColumns(tableName);
  if (!columns.length) return null;

  const geometryColumn = columns.find(isGeometryColumn) || null;

  return {
    name: tableName,
    table_name: tableName,
    table_schema: GIS_SCHEMA,
    has_geom: Boolean(geometryColumn),
    geometry_column: geometryColumn ? geometryColumn.column_name : null,
    source_type: geometryColumn ? 'postgis' : 'table',
  };
}

// ── Simplificación de geometrías ──────────────────────────────────────────────

// Devuelve la tolerancia de simplificación para ST_Simplify.
// Tolerancia en grados decimales (EPSG:4326).
// 0.00005° ≈ 5.5 metros — buen balance entre calidad visual y peso del archivo.
// A mayor tolerancia → geometría más simple → archivo más pequeño → carga más rápida.
// A menor tolerancia → más detalle → archivo más pesado.
function getSimplifyTolerance(tableName) {
  return 0.00005;
}

// ── Construcción del GeoJSON desde PostGIS ────────────────────────────────────

// Consulta una tabla y devuelve un FeatureCollection GeoJSON listo para Leaflet.
//
// Optimizaciones incluidas:
//   ST_Simplify → reduce la complejidad de polígonos/líneas complejas
//   preserve_collapsed=true → mantiene puntos y líneas muy cortas
//   ST_IsValid → filtra geometrías corruptas que crashearían el cliente
//   jsonb_build_object → construye el GeoJSON directamente en PostgreSQL
//     (más rápido que hacerlo en Node porque evita transferir datos crudos)
//   to_jsonb(row_data) - $1 → incluye todas las propiedades excepto la columna geom
//     (evitar duplicar la geometría en las propiedades)
async function getPostgisLayerGeoJson(tableName, geometryColumn) {
  const safeSchema = quoteIdentifier(GIS_SCHEMA);
  const safeTable = quoteIdentifier(tableName);
  const safeGeomColumn = quoteIdentifier(geometryColumn);
  const tolerance = getSimplifyTolerance(tableName);

  logBackend(
    `[GIS API] Consultando capa GeoJSON desde "${GIS_SCHEMA}"."${tableName}" (tolerance=${tolerance})`
  );

  const result = await query(
    `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(
                ST_Simplify(${safeGeomColumn}, $2, true)
              )::jsonb,
              'properties', to_jsonb(row_data) - $1
            )
          ),
          '[]'::jsonb
        )
      ) AS geojson
      FROM ${safeSchema}.${safeTable} AS row_data
      WHERE ${safeGeomColumn} IS NOT NULL
        AND ST_IsValid(${safeGeomColumn})
    `,
    [geometryColumn, tolerance]
  );

  // Si la tabla está vacía, devuelve un FeatureCollection vacío en lugar de null
  return result.rows[0]?.geojson || {
    type: 'FeatureCollection',
    features: [],
  };
}

async function getCachedPostgisLayerGeoJson(tableName, geometryColumn) {
  const cachedGeoJson = getCachedLayerGeoJson(tableName);
  if (cachedGeoJson) {
    return { geojson: cachedGeoJson, cacheStatus: 'hit' };
  }

  const sharedRequest = layerGeoJsonInFlight.get(tableName);
  if (sharedRequest) {
    return { geojson: await sharedRequest, cacheStatus: 'shared' };
  }

  const requestPromise = getPostgisLayerGeoJson(tableName, geometryColumn)
    .then((geojson) => {
      layerGeoJsonCache.set(tableName, {
        geojson,
        cachedAt: Date.now(),
      });
      return geojson;
    })
    .finally(() => {
      layerGeoJsonInFlight.delete(tableName);
    });

  layerGeoJsonInFlight.set(tableName, requestPromise);
  return { geojson: await requestPromise, cacheStatus: 'miss' };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS — funciones reutilizables para registrar en / y /api
// ─────────────────────────────────────────────────────────────────────────────

function handleHealth(_req, res) {
  res.json(getServiceStatus());
}

async function handleTest(_req, res) {
  try {
    const result = await query('SELECT NOW() AS server_time');
    res.json({
      ok: true,
      message: 'Conexión PostgreSQL exitosa',
      rows: result.rows,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleLayers(_req, res) {
  try {
    const catalog = await getLayerCatalog();
    const tables = catalog.map((table) => ({
      name: table.name,
      table_name: table.table_name,
      table_schema: table.table_schema,
      has_geom: table.has_geom,
      geometry_column: table.geometry_column,
      source_type: table.source_type,
      estimated_count: table.estimated_count,
      bbox: table.bbox,
      dg: table.dg,
    }));

    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      ok: true,
      message: `Tablas del schema "${GIS_SCHEMA}" consultadas correctamente`,
      tables,
      total: tables.length,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleLayerTable(req, res) {
  const tableName = String(req.params.table || '').trim();

  if (!tableName) {
    res.status(400).json({ ok: false, error: 'Nombre de tabla inválido.' });
    return;
  }

  try {
    const metadata = await getTableMeta(tableName);

    if (!metadata) {
      res.status(404).json({
        ok: false,
        error: `La tabla "${tableName}" no existe en el schema "${GIS_SCHEMA}".`,
      });
      return;
    }

    if (!metadata.has_geom || !metadata.geometry_column) {
      logBackend(
        `[GIS API] Tabla "${GIS_SCHEMA}"."${tableName}" encontrada sin columna geom geometry`
      );
      res.status(400).json({
        ok: false,
        error: `La tabla "${tableName}" no tiene una columna geom tipo geometry.`,
      });
      return;
    }

    const { geojson, cacheStatus } = await getCachedPostgisLayerGeoJson(
      metadata.table_name,
      metadata.geometry_column
    );

    res.set('Cache-Control', 'public, max-age=120');
    res.set('X-GIS-Cache', cacheStatus);
    res.json(geojson);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

function handleCacheInvalidate(req, res) {
  if (IS_PRODUCTION && !CACHE_INVALIDATE_TOKEN) {
    logBackendError(
      '[GIS API] Intento de invalidar caché bloqueado: CACHE_INVALIDATE_TOKEN no configurado en producción'
    );
    res.status(503).json({
      ok: false,
      error: 'CACHE_INVALIDATE_TOKEN no está configurado en producción.',
    });
    return;
  }

  if (CACHE_INVALIDATE_TOKEN) {
    const requestToken = getInvalidateRequestToken(req);
    if (requestToken !== CACHE_INVALIDATE_TOKEN) {
      logBackendError('[GIS API] Intento no autorizado de invalidar caché');
      res.status(401).json({ ok: false, error: 'No autorizado para invalidar caché.' });
      return;
    }
  }

  invalidateCatalogCache();
  invalidateLayerGeoJsonCache();
  logBackend('[GIS API] Caché de catálogo invalidado manualmente');
  res.json({ ok: true, message: 'Caché de catálogo invalidado.' });
}

// ── Búsqueda global en BD ─────────────────────────────────────────────────────

// Nombres de columna (en minúsculas) que se consideran campos de búsqueda.
// Se comparan contra information_schema.columns.column_name (case-insensitive).
const SEARCH_FIELD_NAMES = new Set([
  'nombre_obra', 'obra',
  'programa',
  'direccion_general', 'dg',
  'alcaldia',
  'colonia',
  'plantel', 'nombre_plantel',
  'nombre_sitio_intervenido',
  'calle', 'direccion',
  'contrato', 'n_contrato', 'no_contrato',
  'tipo', 'tipo_obra',
]);

const SEARCH_MAX_PER_TABLE = 4;
const SEARCH_MAX_TOTAL    = 30;

// GET /search?q=<término>
// Busca en todos los campos de texto configurados en SEARCH_FIELD_NAMES a través
// de todas las tablas con geometría del schema GIS. Devuelve hasta SEARCH_MAX_TOTAL
// resultados con sus propiedades y un punto representativo (centroide) para
// centrar el mapa cuando el usuario hace click en un resultado.
async function handleSearch(req, res) {
  const q = String(req.query.q || '').trim();

  if (q.length < 2) {
    res.json({ ok: true, results: [], q });
    return;
  }

  try {
    // Obtener columnas de texto de todo el schema en una sola query
    const colsResult = await query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = $1
         AND data_type IN ('text', 'character varying', 'character')
       ORDER BY table_name, ordinal_position`,
      [GIS_SCHEMA]
    );

    // Construir mapa: tableName → [columnas buscables que tiene esta tabla]
    const searchColsByTable = new Map();
    colsResult.rows.forEach(({ table_name, column_name }) => {
      if (!SEARCH_FIELD_NAMES.has(column_name.toLowerCase())) return;
      if (!searchColsByTable.has(table_name)) searchColsByTable.set(table_name, []);
      searchColsByTable.get(table_name).push(column_name);
    });

    // Solo buscar en tablas con geometría Y con al menos un campo buscable
    const catalog = await getLayerCatalog();
    const geoTables = catalog.filter(
      (t) => t.has_geom && t.geometry_column && searchColsByTable.has(t.table_name)
    );

    // Buscar en cada tabla en paralelo (concurrencia limitada para no saturar la BD)
    const tableResults = await mapWithConcurrency(
      geoTables,
      4,
      async (table) => {
        try {
          const cols = searchColsByTable.get(table.table_name);
          const safeSchema  = quoteIdentifier(GIS_SCHEMA);
          const safeTable   = quoteIdentifier(table.table_name);
          const safeGeom    = quoteIdentifier(table.geometry_column);
          const whereTerms  = cols
            .map((c) => `${quoteIdentifier(c)}::text ILIKE '%' || $1 || '%'`)
            .join(' OR ');

          const result = await query(
            `SELECT
               to_jsonb(row_data) - $2   AS properties,
               ST_AsGeoJSON(
                 COALESCE(ST_Centroid(${safeGeom}), ${safeGeom})
               )::jsonb                  AS center_geom
             FROM ${safeSchema}.${safeTable} AS row_data
             WHERE ${safeGeom} IS NOT NULL
               AND ST_IsValid(${safeGeom})
               AND (${whereTerms})
             LIMIT $3`,
            [q, table.geometry_column, SEARCH_MAX_PER_TABLE]
          );

          return result.rows
            .filter((row) => row.center_geom)
            .map((row) => ({
              table:     table.table_name,
              layerName: table.table_name,
              dg:        table.dg || null,
              properties: row.properties || {},
              geometry:  row.center_geom,
            }));
        } catch {
          // Tabla sin permisos, corrupción u otro error puntual → ignorar
          return [];
        }
      }
    );

    const results = tableResults.flat().slice(0, SEARCH_MAX_TOTAL);
    logBackend(`[GIS API] Búsqueda "${q}": ${results.length} resultados`);
    res.json({ ok: true, results, q });
  } catch (error) {
    logBackendError('[GIS API] Error en búsqueda global', error);
    res.status(500).json({ ok: false, error: 'Error en búsqueda', results: [] });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS DE LA API — registradas en / y en /api (mismo handler, sin duplicar lógica)
// ─────────────────────────────────────────────────────────────────────────────

logBackend('[GIS API] Backend activo — rutas disponibles en / y /api');

// GET / → sirve frontend o estado del backend
app.get('/', (_req, res) => {
  if (HAS_FRONTEND_BUILD) {
    res.sendFile(FRONTEND_INDEX_FILE);
    return;
  }
  res.json(getServiceStatus());
});

// Rutas montadas en ambos prefijos (/ y /api)
for (const prefix of ['', '/api']) {
  app.get(`${prefix}/health`,            handleHealth);
  app.get(`${prefix}/test`,              handleTest);
  app.get(`${prefix}/layers`,            handleLayers);
  app.get(`${prefix}/layer/:table`,      handleLayerTable);
  app.get(`${prefix}/search`,            handleSearch);
  app.post(`${prefix}/cache/invalidate`, handleCacheInvalidate);
}

logBackend('[GIS API] Ruta /api/layers disponible');
logBackend('[GIS API] Ruta /api/layer/:table disponible');
logBackend('[GIS API] Ruta /api/search disponible');

// Si existe el build del frontend, sirve los assets estáticos ya compilados.
if (HAS_FRONTEND_BUILD) {
  app.use(
    express.static(FRONTEND_BUILD_DIR, {
      index: false,
      maxAge: IS_PRODUCTION ? '1d' : 0,
    })
  );

  // Fallback SPA: cualquier ruta del frontend regresa index.html.
  // Se excluyen rutas de API y archivos estáticos para no romper el backend.
  app.get('*', (req, res, next) => {
    if (!shouldServeFrontendApp(req)) {
      next();
      return;
    }

    res.sendFile(FRONTEND_INDEX_FILE);
  });
}

// Manejador de rutas no encontradas (404)
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Ruta no encontrada',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ARRANQUE Y APAGADO DEL SERVIDOR
// ─────────────────────────────────────────────────────────────────────────────

const server = app.listen(port, '0.0.0.0', () => {
  logBackend(
    `[GIS API] Backend iniciado en puerto ${port} (frontend integrado=${HAS_FRONTEND_BUILD ? 'sí' : 'no'})`
  );
});

// Apagado limpio: cuando el sistema manda señal de cierre (Ctrl+C o kill),
// primero termina de responder las peticiones en curso y luego cierra el pool
// de conexiones a PostgreSQL antes de salir.
function shutdown(signal) {
  logBackend(`Cerrando servidor por ${signal}...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C en terminal
process.on('SIGTERM', () => shutdown('SIGTERM')); // kill desde sistema operativo
