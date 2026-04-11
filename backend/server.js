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
const CORS_ALLOWED_ORIGINS = String(
  process.env.CORS_ALLOWED_ORIGINS || ''
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
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

// cors() queda abierto en desarrollo para facilitar pruebas locales.
// En producción solo permite:
//   - requests sin Origin (curl, healthchecks)
//   - el mismo host que sirve la app
//   - origins explícitos en CORS_ALLOWED_ORIGINS
app.use(
  cors((req, callback) => {
    const requestOrigin = String(req.get('Origin') || '').trim();

    if (!requestOrigin) {
      callback(null, { origin: false });
      return;
    }

    if (!IS_PRODUCTION) {
      callback(null, { origin: true, credentials: true });
      return;
    }

    let isSameHost = false;

    try {
      const originUrl = new URL(requestOrigin);
      isSameHost = originUrl.host === String(req.get('host') || '').trim();
    } catch {
      isSameHost = false;
    }

    if (isSameHost || CORS_ALLOWED_ORIGINS.includes(requestOrigin)) {
      callback(null, { origin: true, credentials: true });
      return;
    }

    callback(new Error('Origin no permitido por CORS.'));
  })
);

app.use(express.json());

app.use((error, req, res, next) => {
  if (error?.message === 'Origin no permitido por CORS.') {
    logBackendError('[GIS API] Origin bloqueado por CORS:', req.get('Origin'));
    res.status(403).json({
      ok: false,
      error: 'Origin no permitido por CORS.',
    });
    return;
  }

  next(error);
});

// ── Caché en memoria del catálogo de tablas ───────────────────────────────────
// Escanear information_schema cada vez que alguien pide una capa es lento.
// Guardamos el resultado en RAM durante 5 minutos para evitar queries repetidas.
// TTL = Time To Live = tiempo que dura válido el caché.
let catalogCache = null;
let catalogCacheTime = 0;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos en milisegundos

// Borra el caché para forzar una nueva consulta a PostgreSQL
function invalidateCatalogCache() {
  catalogCache = null;
  catalogCacheTime = 0;
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
  return /^\/(test|layers|layer(?:\/|$)|cache(?:\/|$)|health(?:\/|$))/.test(
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

// ── Catálogo de capas ─────────────────────────────────────────────────────────

// Construye el catálogo completo: lista de tablas con metadatos.
// Optimización clave: consulta las columnas de TODAS las tablas en paralelo
// con Promise.all, en lugar de una por una en un loop secuencial.
// El resultado se guarda en caché 5 minutos para no repetir el escaneo.
async function getLayerCatalog() {
  // Devuelve el catálogo desde caché si está vigente
  if (catalogCache && Date.now() - catalogCacheTime < CATALOG_CACHE_TTL_MS) {
    return catalogCache;
  }

  logBackend(`[GIS API] Consultando schema "${GIS_SCHEMA}" para catálogo de tablas...`);

  const tables = await getSchemaTables();

  // Consultar columnas de TODAS las tablas en paralelo (antes era secuencial)
  const columnResults = await Promise.all(
    tables.map((table) => {
      const tableName = String(table?.table_name || '').trim();
      return tableName ? getTableColumns(tableName) : Promise.resolve([]);
    })
  );

  // Combina cada tabla con sus columnas y detecta si tiene geometría
  const catalog = tables.map((table, index) => {
    const tableName = String(table?.table_name || '').trim();
    const columns = columnResults[index] || [];
    const geometryColumn = columns.find(isGeometryColumn) || null;
    const hasGeom = Boolean(geometryColumn);

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

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS DE LA API
// ─────────────────────────────────────────────────────────────────────────────

// GET /health → estado del backend
// Mantiene una ruta explícita de salud aunque "/" sirva el frontend en producción.
app.get('/health', (req, res) => {
  res.json(getServiceStatus());
});

// GET / → si existe build del frontend, sirve la app React.
// Si no existe, responde el estado del backend como fallback operativo.
app.get('/', (req, res) => {
  if (HAS_FRONTEND_BUILD) {
    res.sendFile(FRONTEND_INDEX_FILE);
    return;
  }

  res.json(getServiceStatus());
});

// GET /test → prueba de conexión a PostgreSQL
// Ejecuta SELECT NOW() y devuelve la hora del servidor.
// Si falla, significa que PostgreSQL no está disponible.
app.get('/test', async (req, res) => {
  try {
    const result = await query('SELECT NOW() AS server_time');
    res.json({
      ok: true,
      message: 'Conexión PostgreSQL exitosa',
      rows: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// GET /layers → catálogo de todas las tablas del schema
// El frontend llama esto primero para saber qué capas existen.
// Cache-Control: 60 segundos en el navegador para evitar peticiones repetidas.
app.get('/layers', async (req, res) => {
  try {
    const catalog = await getLayerCatalog();
    const tables = catalog.map((table) => ({
      name: table.name,
      table_name: table.table_name,
      has_geom: table.has_geom,
    }));

    // Permite al navegador cachear este response hasta 60 segundos
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      ok: true,
      message: `Tablas del schema "${GIS_SCHEMA}" consultadas correctamente`,
      tables,
      total: tables.length,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// GET /layer/:table → GeoJSON de una tabla específica
// El frontend llama esto una vez por cada capa para obtener sus geometrías.
// :table es el nombre de la tabla en PostgreSQL (viene URL-encoded desde el frontend).
// Cache-Control: 120 segundos porque los datos de obra no cambian en tiempo real.
app.get('/layer/:table', async (req, res) => {
  const tableName = String(req.params.table || '').trim();

  if (!tableName) {
    res.status(400).json({
      ok: false,
      error: 'Nombre de tabla inválido.',
    });
    return;
  }

  try {
    // Validación directa: consulta solo las columnas de ESTA tabla.
    // Mucho más rápido que getLayerCatalog() que escanea todo el schema.
    const metadata = await getTableMetaDirect(tableName);

    if (!metadata) {
      res.status(404).json({
        ok: false,
        error: `La tabla "${tableName}" no existe en el schema "${GIS_SCHEMA}".`,
      });
      return;
    }

    // La tabla existe pero no tiene columna geom → no se puede servir como capa GIS
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

    const geojson = await getPostgisLayerGeoJson(
      metadata.table_name,
      metadata.geometry_column
    );

    // Permite al navegador cachear el GeoJSON 2 minutos
    res.set('Cache-Control', 'public, max-age=120');
    res.json(geojson);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// POST /cache/invalidate → borra el caché del catálogo
// Útil cuando se agregan tablas nuevas al schema y se quiere que el sistema
// las detecte sin esperar los 5 minutos del TTL automático.
app.post('/cache/invalidate', (req, res) => {
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
      logBackendError(
        '[GIS API] Intento no autorizado de invalidar caché'
      );
      res.status(401).json({
        ok: false,
        error: 'No autorizado para invalidar caché.',
      });
      return;
    }
  }

  invalidateCatalogCache();
  logBackend('[GIS API] Caché de catálogo invalidado manualmente');
  res.json({ ok: true, message: 'Caché de catálogo invalidado.' });
});

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
