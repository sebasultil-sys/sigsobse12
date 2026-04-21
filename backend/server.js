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

import path from "node:path";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import compression from "compression";
import { pool, query } from "./db.js";
import {
  PopulationAnalysisEngine,
  buildPopulationFileCandidates,
} from "./populationEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT || 3001);
app.set("trust proxy", 1);

// Schema de PostgreSQL donde viven todas las tablas de obra pública
const GIS_SCHEMA = process.env.PGSCHEMA || "sig_sobse";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ENABLE_BACKEND_DEBUG =
  !IS_PRODUCTION ||
  String(process.env.GIS_DEBUG || "").toLowerCase() === "true";
const CACHE_INVALIDATE_TOKEN = String(
  process.env.CACHE_INVALIDATE_TOKEN || "",
).trim();
const CORS_ALLOWED_ORIGINS = String(
  process.env.CORS_ALLOWED_ORIGINS || "",
).trim();
const SERVE_FRONTEND =
  String(process.env.SERVE_FRONTEND || "true").toLowerCase() !== "false";
const FRONTEND_BUILD_DIR = path.resolve(__dirname, "../frontend/build");
const FRONTEND_INDEX_FILE = path.join(FRONTEND_BUILD_DIR, "index.html");
const HAS_FRONTEND_BUILD = SERVE_FRONTEND && fs.existsSync(FRONTEND_INDEX_FILE);
const POPULATION_MAX_RENDER_FEATURES = Math.max(
  0,
  Number(process.env.POPULATION_MAX_RENDER_FEATURES || 0),
);
const API_REQUEST_TIMEOUT_MS = Math.max(
  2000,
  Number(process.env.GIS_REQUEST_TIMEOUT_MS || 25000),
);
const ENABLE_RATE_LIMIT =
  String(process.env.GIS_ENABLE_RATE_LIMIT || "true").toLowerCase() !== "false";
const RATE_LIMIT_WINDOW_MS = Math.max(
  1000,
  Number(process.env.GIS_RATE_LIMIT_WINDOW_MS || 60 * 1000),
);
const RATE_LIMIT_MAX_REQUESTS = Math.max(
  10,
  Number(process.env.GIS_RATE_LIMIT_MAX_REQUESTS || 180),
);
const KPI_HEALTH_CHECK_TTL_MS = Math.max(
  5000,
  Number(process.env.GIS_KPI_HEALTH_CHECK_TTL_MS || 60 * 1000),
);
const populationFileCandidates = buildPopulationFileCandidates({
  rootDir: path.resolve(__dirname, ".."),
  backendDir: __dirname,
  explicitPath: process.env.POPULATION_GEOJSON_PATH,
});
const populationAnalysisEngine = new PopulationAnalysisEngine({
  fileCandidates: populationFileCandidates,
});

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

const allowedOrigins = CORS_ALLOWED_ORIGINS.split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const DEFAULT_CORS_ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https?:\/\/[^/]+\.hstgr\.io$/i,
];

function isOriginAllowed(origin) {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return true;
  if (!allowedOrigins.length) return true;
  if (allowedOrigins.includes(normalizedOrigin)) return true;
  return DEFAULT_CORS_ALLOWED_ORIGIN_PATTERNS.some((pattern) =>
    pattern.test(normalizedOrigin),
  );
}

const corsOptions = {
  origin: (origin, callback) => {
    callback(null, isOriginAllowed(origin));
  },
};

const MOVILIDAD_LAYERS = ["trolebus", "cablebus", "tren_ligero"];

function normalizeMobilityKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isMobilityTableName(value) {
  const normalized = normalizeMobilityKey(value);
  if (!normalized) return false;
  const compact = normalized.replace(/_/g, "");
  return MOVILIDAD_LAYERS.some((token) => {
    const compactToken = token.replace(/_/g, "");
    return normalized.includes(token) || compact.includes(compactToken);
  });
}

function buildKpiGeometryFilterSql(tableName, safeGeometryColumn) {
  if (!safeGeometryColumn) return "TRUE";
  if (!isMobilityTableName(tableName)) return "TRUE";
  return `COALESCE(UPPER(GeometryType(${safeGeometryColumn})) NOT IN ('POINT', 'MULTIPOINT'), TRUE)`;
}

// ── Middlewares globales ──────────────────────────────────────────────────────

// compression() comprime automáticamente todas las respuestas con gzip.
// Reduce el tamaño del JSON hasta un 70-80% → capas cargan mucho más rápido.
app.use(compression());

// CORS configurable por variable de entorno CORS_ALLOWED_ORIGINS.
// Si no se define, queda abierto para facilitar entornos de prueba.
app.use(cors(corsOptions));

app.use(express.json());

// Middleware operativo: request-id, rate-limit, timeout por request y log estructurado.
app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAtHr = process.hrtime.bigint();
  const startedAtMs = Date.now();
  const requestPath = String(req.path || req.originalUrl || "");
  const isApiRequest = isApiLikePath(requestPath);

  req.requestId = requestId;
  res.set("X-Request-Id", requestId);

  const timeoutId = isApiRequest
    ? setTimeout(() => {
        if (res.headersSent) return;
        res.status(503).json({
          ok: false,
          error: "Tiempo de espera agotado en la API.",
          request_id: requestId,
          timeout_ms: API_REQUEST_TIMEOUT_MS,
        });
      }, API_REQUEST_TIMEOUT_MS)
    : null;

  const clearTimeoutGuard = () => {
    if (timeoutId) clearTimeout(timeoutId);
  };

  if (isApiRequest && ENABLE_RATE_LIMIT) {
    const rateLimit = consumeRateLimit(req);
    res.set("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
    res.set("X-RateLimit-Remaining", String(rateLimit.remaining));
    if (rateLimit.reset_ms != null) {
      res.set("X-RateLimit-Reset", String(Math.ceil(rateLimit.reset_ms / 1000)));
    }

    if (!rateLimit.allowed) {
      clearTimeoutGuard();
      const retryAfterSec = Math.max(1, Math.ceil((rateLimit.reset_ms || 0) / 1000));
      res.set("Retry-After", String(retryAfterSec));
      res.status(429).json({
        ok: false,
        error: "Demasiadas solicitudes. Intenta nuevamente en unos segundos.",
        request_id: requestId,
        retry_after_seconds: retryAfterSec,
      });
      return;
    }
  }

  res.on("finish", () => {
    clearTimeoutGuard();
    const durationMs = Number(process.hrtime.bigint() - startedAtHr) / 1e6;
    const level = res.statusCode >= 500 ? "error" : "info";
    if (!isApiRequest && !ENABLE_BACKEND_DEBUG) return;
    logStructuredEvent(level, "http.request", {
      request_id: requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: Number(durationMs.toFixed(1)),
      ip: getClientIpAddress(req),
      user_agent: String(req.get("user-agent") || ""),
      started_at_epoch_ms: startedAtMs,
    });
  });

  res.on("close", clearTimeoutGuard);
  next();
});

// ── Caché en memoria del catálogo de tablas ───────────────────────────────────
// Escanear information_schema cada vez que alguien pide una capa es lento.
// Guardamos el resultado en RAM durante 5 minutos para evitar queries repetidas.
// TTL = Time To Live = tiempo que dura válido el caché.
let catalogCache = null;
let catalogCacheTime = 0;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos en milisegundos
const DEFAULT_LAYER_CACHE_TTL_MS =
  process.env.NODE_ENV === "production" ? 5 * 60 * 1000 : 60 * 1000;
const LAYER_CACHE_TTL_MS = Math.max(
  15000,
  Number(process.env.GIS_LAYER_CACHE_TTL_MS || DEFAULT_LAYER_CACHE_TTL_MS),
);
const KPI_CACHE_TTL_MS = Math.max(
  15000,
  Number(process.env.GIS_KPI_CACHE_TTL_MS || 3 * 60 * 1000),
);
const CATALOG_SUMMARY_CONCURRENCY = Math.max(
  1,
  Number(process.env.GIS_CATALOG_SUMMARY_CONCURRENCY || 2),
);
const KPI_SUMMARY_CONCURRENCY = Math.max(
  1,
  Number(process.env.GIS_KPI_SUMMARY_CONCURRENCY || 4),
);
const layerGeoJsonCache = new Map();
const layerGeoJsonInFlight = new Map();
const rateLimitBuckets = new Map();
let kpiSummaryCache = null;
let kpiSummaryCacheTime = 0;
let kpiRouteHealthCache = {
  checked_at: null,
  checked_at_epoch_ms: 0,
  ok: null,
  source: "not_checked",
  error: null,
  total_obras: null,
};
let lastRateLimitSweepAt = 0;

// Borra el caché para forzar una nueva consulta a PostgreSQL
function invalidateCatalogCache() {
  catalogCache = null;
  catalogCacheTime = 0;
}

function invalidateKpiSummaryCache() {
  kpiSummaryCache = null;
  kpiSummaryCacheTime = 0;
  kpiRouteHealthCache = {
    checked_at: null,
    checked_at_epoch_ms: 0,
    ok: null,
    source: "invalidated",
    error: null,
    total_obras: null,
  };
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

function getValidKpiSummaryCache() {
  if (!kpiSummaryCache) return null;
  if (Date.now() - kpiSummaryCacheTime >= KPI_CACHE_TTL_MS) return null;
  return kpiSummaryCache;
}

function getCachedLayerGeoJson(tableName) {
  const cached = layerGeoJsonCache.get(tableName);
  if (!cached) return null;

  if (Date.now() - cached.cachedAt >= LAYER_CACHE_TTL_MS) {
    layerGeoJsonCache.delete(tableName);
    return null;
  }

  return cached;
}

function parseJsonOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return null;
}

function collectCoordinatePairs(coordinates, pairs = []) {
  if (!Array.isArray(coordinates)) return pairs;

  if (
    coordinates.length >= 2 &&
    !Array.isArray(coordinates[0]) &&
    !Array.isArray(coordinates[1])
  ) {
    pairs.push([coordinates[0], coordinates[1]]);
    return pairs;
  }

  coordinates.forEach((entry) => collectCoordinatePairs(entry, pairs));
  return pairs;
}

function isValidLngLatPair(pair) {
  const lng = Number(pair?.[0]);
  const lat = Number(pair?.[1]);

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (Math.abs(lng) <= 1e-9 && Math.abs(lat) <= 1e-9) return false; // Null Island (0,0)
  if (lng < -180 || lng > 180) return false;
  if (lat < -90 || lat > 90) return false;
  return true;
}

function hasValidWgs84Geometry(geometry) {
  if (!geometry || typeof geometry !== "object") return false;

  if (geometry.type === "GeometryCollection") {
    const geometries = Array.isArray(geometry.geometries) ? geometry.geometries : [];
    if (!geometries.length) return false;
    return geometries.every((entry) => hasValidWgs84Geometry(entry));
  }

  const coordinatePairs = collectCoordinatePairs(geometry.coordinates, []);
  if (!coordinatePairs.length) return false;
  return coordinatePairs.every((pair) => isValidLngLatPair(pair));
}

function buildGeoJsonFeatureFromRow(row, geometryColumn) {
  const hasStructuredProperties =
    row?.properties &&
    typeof row.properties === "object" &&
    !Array.isArray(row.properties);
  const properties = hasStructuredProperties ? { ...row.properties } : { ...row };
  let geometry = null;

  if (row?.geometry_geojson !== undefined) {
    geometry = parseJsonOrNull(row.geometry_geojson);
  }

  if (properties.geometry !== undefined) {
    geometry = parseJsonOrNull(properties.geometry);
  }

  if (!geometry && properties.geom !== undefined) {
    geometry = parseJsonOrNull(properties.geom);
  }

  if (!geometry && geometryColumn && properties[geometryColumn] !== undefined) {
    geometry = parseJsonOrNull(properties[geometryColumn]);
  }

  if (!geometry && properties.X != null && properties.Y != null) {
    const x = Number(properties.X);
    const y = Number(properties.Y);
    if (!Number.isNaN(x) && !Number.isNaN(y) && isValidLngLatPair([x, y])) {
      geometry = {
        type: 'Point',
        coordinates: [x, y],
      };
    }
  }

  if (geometry && !hasValidWgs84Geometry(geometry)) {
    geometry = null;
  }

  if (geometryColumn) {
    delete properties[geometryColumn];
  }
  delete properties.geometry;
  delete properties.geom;
  delete properties.geometry_geojson;

  return {
    type: 'Feature',
    geometry,
    properties,
  };
}

function buildGeoJsonFeatureCollection(rows, geometryColumn) {
  return {
    type: 'FeatureCollection',
    features: (rows || []).map((row) => buildGeoJsonFeatureFromRow(row, geometryColumn)),
  };
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
  const headerToken = String(req.get("x-cache-token") || "").trim();
  const authHeader = String(req.get("authorization") || "").trim();
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return headerToken || String(bearerMatch?.[1] || "").trim();
}

function getServiceStatus() {
  return {
    ok: true,
    service: "sigsobse-backend",
    message: "API GIS operativa",
    serve_frontend: HAS_FRONTEND_BUILD,
    schema: GIS_SCHEMA,
  };
}

function buildPayloadHash(payload) {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function buildWeakEtag(payload) {
  return `W/"${buildPayloadHash(payload)}"`;
}

function matchesIfNoneMatch(ifNoneMatchHeader, etag) {
  const rawHeader = String(ifNoneMatchHeader || "").trim();
  if (!rawHeader) return false;
  if (rawHeader === "*") return true;

  const candidates = rawHeader.split(",").map((value) => value.trim());
  return candidates.includes(etag);
}

function getClientIpAddress(req) {
  const forwardedFor = String(req.get("x-forwarded-for") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0];
  return (
    forwardedFor ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function logStructuredEvent(level, event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...details,
  };
  const serialized = JSON.stringify(payload);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  console.log(serialized);
}

function sweepRateLimitBuckets(nowMs) {
  if (nowMs - lastRateLimitSweepAt < RATE_LIMIT_WINDOW_MS) return;
  lastRateLimitSweepAt = nowMs;

  for (const [bucketKey, bucket] of rateLimitBuckets.entries()) {
    if (nowMs - bucket.window_start_ms >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(bucketKey);
    }
  }
}

function consumeRateLimit(req) {
  if (!ENABLE_RATE_LIMIT) {
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS };
  }

  const nowMs = Date.now();
  sweepRateLimitBuckets(nowMs);

  const ip = getClientIpAddress(req);
  const pathKey = String(req.path || "").split("?")[0] || "/";
  const bucketKey = `${ip}::${pathKey}`;
  const currentBucket = rateLimitBuckets.get(bucketKey);

  if (!currentBucket || nowMs - currentBucket.window_start_ms >= RATE_LIMIT_WINDOW_MS) {
    const nextBucket = {
      window_start_ms: nowMs,
      request_count: 1,
    };
    rateLimitBuckets.set(bucketKey, nextBucket);
    return {
      allowed: true,
      remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - nextBucket.request_count),
      reset_ms: RATE_LIMIT_WINDOW_MS,
    };
  }

  if (currentBucket.request_count >= RATE_LIMIT_MAX_REQUESTS) {
    const resetMs = Math.max(
      0,
      RATE_LIMIT_WINDOW_MS - (nowMs - currentBucket.window_start_ms),
    );
    return { allowed: false, remaining: 0, reset_ms: resetMs };
  }

  currentBucket.request_count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - currentBucket.request_count),
    reset_ms: Math.max(
      0,
      RATE_LIMIT_WINDOW_MS - (nowMs - currentBucket.window_start_ms),
    ),
  };
}

function isApiLikePath(requestPath) {
  return /^\/(api(?:\/|$)|test|search|layers|layer(?:\/|$)|cache(?:\/|$)|health(?:\/|$)|population(?:\/|$)|kpis?(?:\/|$))/.test(
    requestPath,
  );
}

function shouldServeFrontendApp(req) {
  if (!HAS_FRONTEND_BUILD || req.method !== "GET") return false;
  if (isApiLikePath(req.path)) return false;
  if (path.extname(req.path)) return false;

  const acceptHeader = String(req.get("accept") || "").toLowerCase();
  return acceptHeader.includes("text/html") || acceptHeader.includes("*/*");
}

function sendJsonWithEtag(req, res, payload, cacheControl = null) {
  const etag = buildWeakEtag(payload);
  res.set("ETag", etag);
  if (cacheControl) {
    res.set("Cache-Control", cacheControl);
  }

  if (matchesIfNoneMatch(req.get("if-none-match"), etag)) {
    res.status(304).end();
    return;
  }

  res.json(payload);
}

async function getKpiRouteHealth(options = {}) {
  const { force = false } = options;
  const nowMs = Date.now();

  if (
    !force &&
    kpiRouteHealthCache.checked_at_epoch_ms &&
    nowMs - kpiRouteHealthCache.checked_at_epoch_ms < KPI_HEALTH_CHECK_TTL_MS
  ) {
    return kpiRouteHealthCache;
  }

  try {
    const summary = await getKpiSummaryCatalog();
    kpiRouteHealthCache = {
      checked_at: new Date().toISOString(),
      checked_at_epoch_ms: nowMs,
      ok: true,
      source: "kpi_summary",
      error: null,
      total_obras: Number(summary?.totals?.total_obras || 0),
    };
  } catch (error) {
    kpiRouteHealthCache = {
      checked_at: new Date().toISOString(),
      checked_at_epoch_ms: nowMs,
      ok: false,
      source: "kpi_summary",
      error: String(error?.message || error || "Error desconocido"),
      total_obras: null,
    };
  }

  return kpiRouteHealthCache;
}

// ── Funciones de seguridad SQL ────────────────────────────────────────────────

// Escapa identificadores SQL (nombres de tablas, columnas, schemas) para
// evitar inyección SQL. Los nombres de tablas NO pueden parametrizarse con $1
// igual que los valores, por eso necesitamos esta función manual.
// Ejemplo: "OBRAS PUBLICAS" → `"OBRAS PUBLICAS"` (comillas dobles internas duplicadas)
function quoteIdentifier(value) {
  const normalized = String(value || "");

  if (!normalized.trim() || normalized.includes("\0")) {
    throw new Error("Identificador SQL inválido.");
  }

  return `"${normalized.replace(/"/g, '""')}"`;
}

// ── Funciones de detección de geometría ──────────────────────────────────────

// Determina si una columna de PostgreSQL es una columna de geometría PostGIS.
// Las columnas geom aparecen en information_schema con data_type = 'USER-DEFINED'
// y udt_name = 'geometry' (tipo definido por la extensión PostGIS).
function isGeometryColumn(column) {
  return (
    String(column?.column_name || "").toLowerCase() === "geom" &&
    String(column?.data_type || "").toUpperCase() === "USER-DEFINED" &&
    String(column?.udt_name || "").toLowerCase() === "geometry"
  );
}

function normalizeCatalogKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function normalizeDgKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isOperationalDg(value) {
  const normalized = normalizeDgKey(value);
  if (!normalized || normalized === "SIN DG") return false;
  if (normalized.includes("CARTOGRAFIA BASE")) return false;
  return normalized.startsWith("DG") || normalized === "ILIFE";
}

function isPointGeometryType(value) {
  const geometryType = String(value || "").toUpperCase().trim();
  if (!geometryType) return false;
  return geometryType.includes("POINT");
}

const DG_COLUMN_CANDIDATES = ["DG", "DIRECCIONGENERAL"];
const STATUS_COLUMN_CANDIDATES = [
  "FESTATUS",
  "ESTATUS",
  "ESTADO",
  "STATUS",
];
const STRICT_WORK_ID_COLUMN_CANDIDATES = [
  "ID_OBRA",
  "IDOBRA",
  "CVE_OBRA",
  "CVEOBRA",
  "OBRA_ID",
  "OBRAID",
  "IDOBRAS",
  "IDPROYECTO",
  "CLAVEOBRA",
  "FOLIOOBRA",
  "NUMOBRA",
  "NOOBRA",
  "NROOBRA",
];
const GENERIC_WORK_ID_COLUMN_CANDIDATES = [
  "ID",
  "IDREGISTRO",
  "OBJECTID",
  "OBJECTID1",
  "OBJECTID2",
  "GID",
  "FID",
];
const ALLOW_GENERIC_WORK_ID_COLUMNS =
  String(process.env.GIS_ALLOW_GENERIC_WORK_ID_COLUMNS || "").toLowerCase() ===
  "true";
const DEFAULT_KPI_CANONICAL_KEY_COLUMNS = [
  "ID OBRA",
  "DIRECCION GENERAL",
  "PROGRAMA",
  "ALCALDIA",
];
const KPI_CANONICAL_SOURCE_ENABLED =
  String(process.env.GIS_KPI_CANONICAL_SOURCE_ENABLED || "true").toLowerCase() !==
  "false";
const KPI_CANONICAL_TABLE = String(
  process.env.GIS_KPI_CANONICAL_TABLE || "obras_centralizadas",
).trim();
const KPI_CANONICAL_KEY_COLUMNS = String(
  process.env.GIS_KPI_CANONICAL_KEY_COLUMNS || "",
)
  .split(",")
  .map((columnName) => String(columnName || "").trim())
  .filter(Boolean);
const KPI_CANONICAL_MIN_KEY_COVERAGE = Math.max(
  0,
  Math.min(
    1,
    Number(process.env.GIS_KPI_CANONICAL_MIN_KEY_COVERAGE || 0.85),
  ),
);
const KPI_CANONICAL_MIN_DISTINCT_RATIO = Math.max(
  0,
  Math.min(
    1,
    Number(process.env.GIS_KPI_CANONICAL_MIN_DISTINCT_RATIO || 0.85),
  ),
);

function findColumnByCandidates(columns, candidates) {
  const candidateRank = new Map(
    Array.from(candidates || []).map((candidate, index) => [
      normalizeCatalogKey(candidate),
      index,
    ]),
  );
  if (!candidateRank.size) return null;

  let bestColumn = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const column of columns || []) {
    const normalizedColumn = normalizeCatalogKey(column?.column_name);
    if (!candidateRank.has(normalizedColumn)) continue;
    const rank = candidateRank.get(normalizedColumn);
    if (rank < bestRank) {
      bestColumn = column;
      bestRank = rank;
    }
  }

  return bestColumn || null;
}

function resolveWorkIdColumn(columns) {
  const strictColumn = findColumnByCandidates(
    columns,
    STRICT_WORK_ID_COLUMN_CANDIDATES,
  )?.column_name;
  if (strictColumn) return strictColumn;

  if (!ALLOW_GENERIC_WORK_ID_COLUMNS) return null;
  return findColumnByCandidates(
    columns,
    GENERIC_WORK_ID_COLUMN_CANDIDATES,
  )?.column_name;
}

function pickCanonicalKeyColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) return [];

  const preferredColumns = KPI_CANONICAL_KEY_COLUMNS.length
    ? KPI_CANONICAL_KEY_COLUMNS
    : DEFAULT_KPI_CANONICAL_KEY_COLUMNS;
  const normalizedToColumn = new Map();
  columns.forEach((column) => {
    const columnName = String(column?.column_name || "").trim();
    if (!columnName) return;
    const normalized = normalizeCatalogKey(columnName);
    if (!normalized || normalizedToColumn.has(normalized)) return;
    normalizedToColumn.set(normalized, columnName);
  });

  const pickedColumns = [];
  preferredColumns.forEach((candidate) => {
    const normalizedCandidate = normalizeCatalogKey(candidate);
    const existingColumn = normalizedToColumn.get(normalizedCandidate);
    if (!existingColumn) return;
    if (pickedColumns.includes(existingColumn)) return;
    pickedColumns.push(existingColumn);
  });

  return pickedColumns;
}

function buildCanonicalCompositeKeySql(keyColumns) {
  if (!Array.isArray(keyColumns) || !keyColumns.length) return "NULL";
  const normalizedParts = keyColumns.map((columnName) => {
    const safeColumn = quoteIdentifier(columnName);
    return `REGEXP_REPLACE(UPPER(BTRIM(COALESCE(${safeColumn}::text, ''))), '[^A-Z0-9]', '', 'g')`;
  });

  return `NULLIF(CONCAT_WS('|', ${normalizedParts.join(", ")}), '')`;
}

function buildEmptyStatusCounters() {
  return {
    entregado: 0,
    terminado: 0,
    proceso: 0,
    sin_iniciar: 0,
    otro: 0,
  };
}

function buildStatusKeyCaseSql(statusColumnSql) {
  if (!statusColumnSql) return "NULL";
  return `
    CASE
      WHEN ${statusColumnSql}::text ILIKE '%entregad%' THEN 'entregado'
      WHEN ${statusColumnSql}::text ILIKE '%terminad%' OR ${statusColumnSql}::text ILIKE '%concluid%' OR ${statusColumnSql}::text ILIKE '%finaliz%' THEN 'terminado'
      WHEN ${statusColumnSql}::text ILIKE '%sin iniciar%' OR ${statusColumnSql}::text ILIKE '%no inici%' THEN 'sin_iniciar'
      WHEN ${statusColumnSql}::text ILIKE '%proceso%' OR ${statusColumnSql}::text ILIKE '%ejecuci%' OR ${statusColumnSql}::text ILIKE '%avance%' THEN 'proceso'
      ELSE NULL
    END
  `;
}

function buildNormalizedWorkIdSql(workIdColumnSql) {
  if (!workIdColumnSql) return "NULL";
  const normalizedAlnumSql = `REGEXP_REPLACE(UPPER(BTRIM(${workIdColumnSql}::text)), '[^A-Z0-9]', '', 'g')`;
  const normalizedDigitsSql = `REGEXP_REPLACE(${normalizedAlnumSql}, '[^0-9]', '', 'g')`;
  return `
    NULLIF(
      CASE
        -- Si contiene una cadena numérica "robusta", la usamos como canónica.
        -- Esto unifica casos como OB-001234 vs 1234.
        WHEN LENGTH(${normalizedDigitsSql}) >= 4 THEN
          COALESCE(NULLIF(LTRIM(${normalizedDigitsSql}, '0'), ''), '0')
        ELSE
          ${normalizedAlnumSql}
      END,
      ''
    )
  `;
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
    [GIS_SCHEMA, tableName],
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
        SELECT ST_EstimatedExtent(($1)::text, ($2)::text, ($3)::text) AS extent_box
      ) AS ext
      WHERE extent_box IS NOT NULL
    `,
    [GIS_SCHEMA, tableName, geometryColumn],
  );

  const row = result.rows[0];
  if (!row) return null;

  const west = Number(row.west);
  const south = Number(row.south);
  const east = Number(row.east);
  const north = Number(row.north);

  if ([west, south, east, north].some((value) => !Number.isFinite(value))) {
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
    `,
  );

  return String(result.rows[0]?.value || "").trim() || null;
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

async function getTableKpiSummary(
  tableName,
  statusColumn,
  workIdColumn,
  geometryColumn = null,
) {
  const safeSchema = quoteIdentifier(GIS_SCHEMA);
  const safeTable = quoteIdentifier(tableName);
  const safeWorkIdColumn = workIdColumn ? quoteIdentifier(workIdColumn) : null;
  const safeGeometryColumn = geometryColumn
    ? quoteIdentifier(geometryColumn)
    : null;
  const normalizedWorkIdSql = safeWorkIdColumn
    ? buildNormalizedWorkIdSql(safeWorkIdColumn)
    : "NULL";
  const geometryFilterSql = buildKpiGeometryFilterSql(
    tableName,
    safeGeometryColumn,
  );

  if (!statusColumn) {
    const result = safeWorkIdColumn
      ? await query(
          `
            WITH base AS (
              SELECT
                ${normalizedWorkIdSql} AS work_id
              FROM ${safeSchema}.${safeTable}
              WHERE ${geometryFilterSql}
            )
            SELECT
              COUNT(DISTINCT work_id)::bigint AS total
            FROM base
            WHERE work_id IS NOT NULL
        `
      )
      : await query(
          `
            SELECT COUNT(*)::bigint AS total
            FROM ${safeSchema}.${safeTable}
            WHERE ${geometryFilterSql}
          `
        );

    return {
      table_name: tableName,
      status_column: null,
      work_id_column: workIdColumn || null,
      total: Number(result.rows[0]?.total || 0),
      ...buildEmptyStatusCounters(),
    };
  }

  const safeStatusColumn = quoteIdentifier(statusColumn);
  const statusCaseSql = buildStatusKeyCaseSql(safeStatusColumn);
  const result = safeWorkIdColumn
    ? await query(
        `
          WITH normalized AS (
            SELECT
              ${statusCaseSql} AS status_key,
              ${normalizedWorkIdSql} AS work_id
            FROM ${safeSchema}.${safeTable}
            WHERE ${geometryFilterSql}
          )
          SELECT
            COUNT(DISTINCT work_id) FILTER (WHERE work_id IS NOT NULL)::bigint AS total,
            COUNT(DISTINCT work_id) FILTER (WHERE status_key = 'entregado' AND work_id IS NOT NULL)::bigint AS entregado,
            COUNT(DISTINCT work_id) FILTER (WHERE status_key = 'terminado' AND work_id IS NOT NULL)::bigint AS terminado,
            COUNT(DISTINCT work_id) FILTER (WHERE status_key = 'proceso' AND work_id IS NOT NULL)::bigint AS proceso,
            COUNT(DISTINCT work_id) FILTER (WHERE status_key = 'sin_iniciar' AND work_id IS NOT NULL)::bigint AS sin_iniciar
          FROM normalized
        `
      )
    : await query(
        `
          WITH normalized AS (
            SELECT
              ${statusCaseSql} AS status_key
            FROM ${safeSchema}.${safeTable}
            WHERE ${geometryFilterSql}
          )
          SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE status_key = 'entregado')::bigint AS entregado,
            COUNT(*) FILTER (WHERE status_key = 'terminado')::bigint AS terminado,
            COUNT(*) FILTER (WHERE status_key = 'proceso')::bigint AS proceso,
            COUNT(*) FILTER (WHERE status_key = 'sin_iniciar')::bigint AS sin_iniciar
          FROM normalized
        `
      );

  const row = result.rows[0] || {};
  const total = Number(row.total || 0);
  const entregado = Number(row.entregado || 0);
  const terminado = Number(row.terminado || 0);
  const proceso = Number(row.proceso || 0);
  const sinIniciar = Number(row.sin_iniciar || 0);
  const classified = entregado + terminado + proceso + sinIniciar;

  return {
    table_name: tableName,
    status_column: statusColumn,
    work_id_column: workIdColumn || null,
    total,
    entregado,
    terminado,
    proceso,
    sin_iniciar: sinIniciar,
    otro: Math.max(0, total - classified),
  };
}

async function getGlobalDistinctKpiTotals(targetTables, columnsByTable) {
  const safeSchema = quoteIdentifier(GIS_SCHEMA);
  const unionQueries = [];

  targetTables.forEach((table) => {
    const tableName = String(table?.table_name || "").trim();
    if (!tableName) return;

    const columns = columnsByTable.get(tableName) || [];
    const workIdColumn = resolveWorkIdColumn(columns);
    if (!workIdColumn) return;

    const statusColumn = findColumnByCandidates(
      columns,
      STATUS_COLUMN_CANDIDATES
    )?.column_name;

    const safeTable = quoteIdentifier(tableName);
    const safeWorkIdColumn = quoteIdentifier(workIdColumn);
    const safeGeometryColumn = table?.geometry_column
      ? quoteIdentifier(table.geometry_column)
      : null;
    const normalizedWorkIdSql = buildNormalizedWorkIdSql(safeWorkIdColumn);
    const geometryFilterSql = buildKpiGeometryFilterSql(
      tableName,
      safeGeometryColumn,
    );
    const statusCaseSql = statusColumn
      ? buildStatusKeyCaseSql(quoteIdentifier(statusColumn))
      : "NULL";

    unionQueries.push(`
      SELECT
        ${normalizedWorkIdSql} AS work_id,
        ${statusCaseSql} AS status_key
      FROM ${safeSchema}.${safeTable}
      WHERE ${safeWorkIdColumn} IS NOT NULL
        AND BTRIM(${safeWorkIdColumn}::text) <> ''
        AND ${geometryFilterSql}
    `);
  });

  if (!unionQueries.length) return null;

  const result = await query(`
    WITH all_rows AS (
      ${unionQueries.join("\nUNION ALL\n")}
    ),
    normalized AS (
      SELECT
        work_id,
        CASE
          WHEN status_key = 'entregado' THEN 4
          WHEN status_key = 'terminado' THEN 3
          WHEN status_key = 'proceso' THEN 2
          WHEN status_key = 'sin_iniciar' THEN 1
          ELSE 0
        END AS status_rank
      FROM all_rows
      WHERE work_id IS NOT NULL
    ),
    ranked AS (
      SELECT
        work_id,
        MAX(status_rank) AS status_rank
      FROM normalized
      GROUP BY work_id
    )
    SELECT
      COUNT(*)::bigint AS total_obras,
      COUNT(*) FILTER (WHERE status_rank = 4)::bigint AS entregadas,
      COUNT(*) FILTER (WHERE status_rank = 3)::bigint AS terminadas,
      COUNT(*) FILTER (WHERE status_rank = 2)::bigint AS en_proceso,
      COUNT(*) FILTER (WHERE status_rank = 1)::bigint AS sin_iniciar,
      COUNT(*) FILTER (WHERE status_rank = 0)::bigint AS otro
    FROM ranked
  `);

  const row = result.rows[0] || {};
  return {
    total_obras: Number(row.total_obras || 0),
    entregadas: Number(row.entregadas || 0),
    terminadas: Number(row.terminadas || 0),
    en_proceso: Number(row.en_proceso || 0),
    sin_iniciar: Number(row.sin_iniciar || 0),
    otro: Number(row.otro || 0),
  };
}

async function getCanonicalKpiSummary(columnsByTable) {
  if (!KPI_CANONICAL_SOURCE_ENABLED) return null;
  if (!KPI_CANONICAL_TABLE) return null;

  const tableName = KPI_CANONICAL_TABLE;
  const columns = columnsByTable.get(tableName) || [];
  if (!columns.length) return null;

  const statusColumn = findColumnByCandidates(
    columns,
    STATUS_COLUMN_CANDIDATES,
  )?.column_name;
  if (!statusColumn) return null;

  const keyColumns = pickCanonicalKeyColumns(columns);
  if (!keyColumns.length) return null;

  const safeSchema = quoteIdentifier(GIS_SCHEMA);
  const safeTable = quoteIdentifier(tableName);
  const safeStatusColumn = quoteIdentifier(statusColumn);
  const statusCaseSql = buildStatusKeyCaseSql(safeStatusColumn);
  const compositeKeySql = buildCanonicalCompositeKeySql(keyColumns);

  const result = await query(`
    WITH normalized AS (
      SELECT
        ${compositeKeySql} AS work_key,
        ${statusCaseSql} AS status_key
      FROM ${safeSchema}.${safeTable}
    ),
    ranked AS (
      SELECT
        work_key,
        MAX(
          CASE
            WHEN status_key = 'entregado' THEN 4
            WHEN status_key = 'terminado' THEN 3
            WHEN status_key = 'proceso' THEN 2
            WHEN status_key = 'sin_iniciar' THEN 1
            ELSE 0
          END
        ) AS status_rank
      FROM normalized
      WHERE work_key IS NOT NULL
      GROUP BY work_key
    ),
    totals_rows AS (
      SELECT
        COUNT(*)::bigint AS total_obras,
        COUNT(*) FILTER (WHERE status_key = 'entregado')::bigint AS entregadas,
        COUNT(*) FILTER (WHERE status_key = 'terminado')::bigint AS terminadas,
        COUNT(*) FILTER (WHERE status_key = 'proceso')::bigint AS en_proceso,
        COUNT(*) FILTER (WHERE status_key = 'sin_iniciar')::bigint AS sin_iniciar,
        COUNT(*) FILTER (WHERE status_key IS NULL)::bigint AS otro
      FROM normalized
    ),
    totals_distinct AS (
      SELECT
        COUNT(*)::bigint AS total_obras,
        COUNT(*) FILTER (WHERE status_rank = 4)::bigint AS entregadas,
        COUNT(*) FILTER (WHERE status_rank = 3)::bigint AS terminadas,
        COUNT(*) FILTER (WHERE status_rank = 2)::bigint AS en_proceso,
        COUNT(*) FILTER (WHERE status_rank = 1)::bigint AS sin_iniciar,
        COUNT(*) FILTER (WHERE status_rank = 0)::bigint AS otro
      FROM ranked
    ),
    key_stats AS (
      SELECT
        COUNT(*)::bigint AS total_rows,
        COUNT(*) FILTER (WHERE work_key IS NOT NULL)::bigint AS rows_with_key
      FROM normalized
    )
    SELECT
      tr.total_obras AS rows_total_obras,
      tr.entregadas AS rows_entregadas,
      tr.terminadas AS rows_terminadas,
      tr.en_proceso AS rows_en_proceso,
      tr.sin_iniciar AS rows_sin_iniciar,
      tr.otro AS rows_otro,
      td.total_obras AS distinct_total_obras,
      td.entregadas AS distinct_entregadas,
      td.terminadas AS distinct_terminadas,
      td.en_proceso AS distinct_en_proceso,
      td.sin_iniciar AS distinct_sin_iniciar,
      td.otro AS distinct_otro,
      ks.total_rows AS total_rows,
      ks.rows_with_key AS rows_with_key
    FROM totals_rows tr
    CROSS JOIN totals_distinct td
    CROSS JOIN key_stats ks
  `);

  const row = result.rows[0] || {};
  const rowTotals = {
    total_obras: Number(row.rows_total_obras || 0),
    entregadas: Number(row.rows_entregadas || 0),
    terminadas: Number(row.rows_terminadas || 0),
    en_proceso: Number(row.rows_en_proceso || 0),
    sin_iniciar: Number(row.rows_sin_iniciar || 0),
    otro: Number(row.rows_otro || 0),
  };
  const distinctTotals = {
    total_obras: Number(row.distinct_total_obras || 0),
    entregadas: Number(row.distinct_entregadas || 0),
    terminadas: Number(row.distinct_terminadas || 0),
    en_proceso: Number(row.distinct_en_proceso || 0),
    sin_iniciar: Number(row.distinct_sin_iniciar || 0),
    otro: Number(row.distinct_otro || 0),
  };
  const totalRows = Number(row.total_rows || rowTotals.total_obras || 0);
  const rowsWithKey = Number(row.rows_with_key || 0);
  const keyCoverage =
    totalRows > 0 ? Number((rowsWithKey / totalRows).toFixed(4)) : 0;
  const distinctToRowsRatio =
    totalRows > 0
      ? Number((distinctTotals.total_obras / totalRows).toFixed(4))
      : 1;
  const useDistinctTotals =
    keyCoverage >= KPI_CANONICAL_MIN_KEY_COVERAGE &&
    distinctToRowsRatio >= KPI_CANONICAL_MIN_DISTINCT_RATIO;
  const totals = useDistinctTotals ? distinctTotals : rowTotals;
  const totalsStrategy = useDistinctTotals
    ? "canonical_distinct_composite_key"
    : "canonical_table_row_sum_fallback";

  return {
    generated_at: new Date().toISOString(),
    cache_ttl_ms: KPI_CACHE_TTL_MS,
    totals,
    by_table: [
      {
        table_name: tableName,
        status_column: statusColumn,
        work_id_column: null,
        canonical_key_columns: keyColumns,
        total: totals.total_obras,
        entregado: totals.entregadas,
        terminado: totals.terminadas,
        proceso: totals.en_proceso,
        sin_iniciar: totals.sin_iniciar,
        otro: totals.otro,
      },
    ],
    audit: {
      source: "canonical_table",
      canonical_table: tableName,
      canonical_key_columns: keyColumns,
      target_tables: 1,
      included_tables: 1,
      included_tables_with_work_id: 1,
      work_id_coverage_ratio: keyCoverage,
      canonical_key_coverage: keyCoverage,
      canonical_distinct_to_rows_ratio: distinctToRowsRatio,
      canonical_min_key_coverage: KPI_CANONICAL_MIN_KEY_COVERAGE,
      canonical_min_distinct_ratio: KPI_CANONICAL_MIN_DISTINCT_RATIO,
      skipped_tables: [],
      totals_strategy: totalsStrategy,
      totals_from_table_sum: rowTotals,
      totals_from_global_distinct: distinctTotals,
    },
  };
}

async function getKpiSummaryCatalog() {
  const validCachedSummary = getValidKpiSummaryCache();
  if (validCachedSummary) return validCachedSummary;

  const catalog = await getLayerCatalog();
  const schemaColumns = await getSchemaColumns();
  const columnsByTable = schemaColumns.reduce((accumulator, column) => {
    const tableName = String(column?.table_name || "").trim();
    if (!tableName) return accumulator;
    const currentColumns = accumulator.get(tableName) || [];
    currentColumns.push(column);
    accumulator.set(tableName, currentColumns);
    return accumulator;
  }, new Map());

  try {
    const canonicalSummary = await getCanonicalKpiSummary(columnsByTable);
    if (canonicalSummary) {
      kpiSummaryCache = canonicalSummary;
      kpiSummaryCacheTime = Date.now();
      return canonicalSummary;
    }
  } catch (error) {
    logBackendError(
      `[GIS API] Falló KPI canónico para "${KPI_CANONICAL_TABLE}"`,
      error?.message || error,
    );
  }

  const targetTables = catalog.filter(
    (table) =>
      table?.has_geom &&
      isOperationalDg(table?.dg) &&
      // Regla general: capas puntuales.
      // Excepción: movilidad (trolebus/cablebus/tren_ligero) puede ser línea y
      // debe incluirse para KPI ejecutivo.
      (
        !table?.geometry_type ||
        isPointGeometryType(table?.geometry_type) ||
        isMobilityTableName(table?.table_name || table?.name)
      )
  );

  const tableCandidates = targetTables.map((table) => {
    const tableName = String(table?.table_name || "").trim();
    const columns = columnsByTable.get(tableName) || [];
    const statusColumn = findColumnByCandidates(
      columns,
      STATUS_COLUMN_CANDIDATES
    )?.column_name;
    const workIdColumn = resolveWorkIdColumn(columns);

    return {
      tableName,
      table,
      statusColumn: statusColumn || null,
      workIdColumn: workIdColumn || null,
      // Incluimos tablas con ID de obra o, al menos, con columna de estatus.
      // Cuando no hay ID, se contabilizan por suma de filas de la tabla.
      includeInTotals: Boolean(tableName && (workIdColumn || statusColumn)),
      skipReason: !tableName
        ? "table_name_vacio"
        : !workIdColumn && !statusColumn
          ? "sin_columna_id_obra_y_sin_estatus"
          : null,
    };
  });

  const includedTableCandidates = tableCandidates.filter(
    (candidate) => candidate.includeInTotals
  );
  const rows = await mapWithConcurrency(
    includedTableCandidates,
    KPI_SUMMARY_CONCURRENCY,
    async (candidate) => {
      const { tableName, statusColumn, workIdColumn, table } = candidate;
      try {
        const summary = await getTableKpiSummary(
          tableName,
          statusColumn || null,
          workIdColumn || null,
          table?.geometry_column || null,
        );
        return {
          ...summary,
          dg: table?.dg || null,
          geometry_type: table?.geometry_type || null,
        };
      } catch (error) {
        logBackendError(
          `[GIS API] No se pudo obtener KPI para "${GIS_SCHEMA}"."${tableName}"`,
          error?.message || error
        );
        return {
          table_name: tableName,
          status_column: statusColumn || null,
          work_id_column: workIdColumn || null,
          dg: table?.dg || null,
          geometry_type: table?.geometry_type || null,
          error: String(error?.message || error || "Error desconocido"),
          total: 0,
          ...buildEmptyStatusCounters(),
        };
      }
    }
  );

  const fallbackSummedTotals = rows.reduce(
    (accumulator, row) => {
      if (!row) return accumulator;
      accumulator.total_obras += Number(row.total || 0);
      accumulator.entregadas += Number(row.entregado || 0);
      accumulator.terminadas += Number(row.terminado || 0);
      accumulator.en_proceso += Number(row.proceso || 0);
      accumulator.sin_iniciar += Number(row.sin_iniciar || 0);
      accumulator.otro += Number(row.otro || 0);
      return accumulator;
    },
    {
      total_obras: 0,
      entregadas: 0,
      terminadas: 0,
      en_proceso: 0,
      sin_iniciar: 0,
      otro: 0,
    }
  );
  const globalDistinctTotals = await getGlobalDistinctKpiTotals(
    targetTables,
    columnsByTable
  );
  const includedWithWorkIdCount = includedTableCandidates.filter(
    (candidate) => Boolean(candidate.workIdColumn)
  ).length;
  const workIdCoverageRatio = targetTables.length
    ? includedWithWorkIdCount / targetTables.length
    : 0;
  const useGlobalDistinctTotals = Boolean(
    globalDistinctTotals &&
    includedWithWorkIdCount >= 2 &&
    workIdCoverageRatio >= 0.35
  );
  const totals = useGlobalDistinctTotals
    ? globalDistinctTotals
    : fallbackSummedTotals;
  const skippedTables = tableCandidates
    .filter((candidate) => !candidate.includeInTotals)
    .map((candidate) => ({
      table_name: candidate.tableName,
      dg: candidate.table?.dg || null,
      geometry_type: candidate.table?.geometry_type || null,
      status_column: candidate.statusColumn,
      work_id_column: candidate.workIdColumn,
      reason: candidate.skipReason || "excluida",
    }));

  const summaryPayload = {
    generated_at: new Date().toISOString(),
    cache_ttl_ms: KPI_CACHE_TTL_MS,
    totals,
    by_table: rows.filter(Boolean),
    audit: {
      target_tables: targetTables.length,
      included_tables: includedTableCandidates.length,
      included_tables_with_work_id: includedWithWorkIdCount,
      work_id_coverage_ratio: Number(workIdCoverageRatio.toFixed(4)),
      skipped_tables: skippedTables,
      totals_strategy: useGlobalDistinctTotals
        ? "global_distinct"
        : "table_sum_fallback",
      totals_from_table_sum: fallbackSummedTotals,
      totals_from_global_distinct: globalDistinctTotals,
    },
  };

  kpiSummaryCache = summaryPayload;
  kpiSummaryCacheTime = Date.now();
  return summaryPayload;
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
    [GIS_SCHEMA],
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
    [GIS_SCHEMA, tableName],
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
    [GIS_SCHEMA],
  );

  return result.rows;
}

async function getSchemaGeometryTypes() {
  try {
    const result = await query(
      `
        SELECT
          f_table_name AS table_name,
          type AS geometry_type
        FROM public.geometry_columns
        WHERE f_table_schema = $1
      `,
      [GIS_SCHEMA],
    );

    return result.rows;
  } catch (error) {
    // Algunas instalaciones exponen PostGIS sin la vista pública
    // `public.geometry_columns`. En ese caso degradamos a information_schema
    // para no romper KPIs/catálogo.
    if (String(error?.code || "") !== "42P01") {
      throw error;
    }

    const fallback = await query(
      `
        SELECT
          table_name,
          NULL::text AS geometry_type
        FROM information_schema.columns
        WHERE table_schema = $1
          AND (
            udt_name = 'geometry'
            OR udt_name = 'geography'
            OR (
              data_type = 'USER-DEFINED'
              AND lower(column_name) = 'geom'
            )
          )
        ORDER BY table_name ASC
      `,
      [GIS_SCHEMA],
    );

    return fallback.rows;
  }
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
    }),
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

  logBackend(
    `[GIS API] Consultando schema "${GIS_SCHEMA}" para catálogo de tablas...`,
  );

  const tables = await getSchemaTables();
  const schemaColumns = await getSchemaColumns();
  const schemaGeometryTypes = await getSchemaGeometryTypes();
  const columnsByTable = schemaColumns.reduce((accumulator, column) => {
    const tableName = String(column?.table_name || "").trim();
    if (!tableName) return accumulator;

    const currentColumns = accumulator.get(tableName) || [];
    currentColumns.push(column);
    accumulator.set(tableName, currentColumns);
    return accumulator;
  }, new Map());
  const geometryTypeByTable = schemaGeometryTypes.reduce((accumulator, row) => {
    const tableName = String(row?.table_name || "").trim();
    if (!tableName) return accumulator;
    const geometryType = String(row?.geometry_type || "").trim() || null;
    accumulator.set(tableName, geometryType);
    return accumulator;
  }, new Map());

  const columnResults = tables.map((table) => {
    const tableName = String(table?.table_name || "").trim();
    return tableName ? columnsByTable.get(tableName) || [] : [];
  });

  const catalogSummaries = await mapWithConcurrency(
    tables.map((table, index) => {
      const tableName = String(table?.table_name || "").trim();
      const columns = columnResults[index] || [];
      const geometryColumn = columns.find(isGeometryColumn) || null;

      if (!tableName || !geometryColumn?.column_name) {
        return Promise.resolve(null);
      }

      return getLayerCatalogSummary(
        tableName,
        geometryColumn.column_name,
        columns,
      ).catch((error) => {
        logBackendError(
          `[GIS API] No se pudo obtener resumen del catálogo para "${GIS_SCHEMA}"."${tableName}"`,
          error,
        );
        return null;
      });
    }),
    CATALOG_SUMMARY_CONCURRENCY,
    (summaryTask) => summaryTask,
  );

  // Combina cada tabla con sus columnas y detecta si tiene geometría
  const catalog = tables
    .map((table, index) => {
      const tableName = String(table?.table_name || "").trim();
      const columns = columnResults[index] || [];
      const geometryColumn = columns.find(isGeometryColumn) || null;
      const hasGeom = Boolean(geometryColumn);
      const summary = catalogSummaries[index] || null;

      logBackend(
        `[GIS API] Tabla "${GIS_SCHEMA}"."${tableName}": geom=${hasGeom ? "sí" : "no"}`,
      );

      return {
        name: tableName,
        table_name: tableName,
        table_schema: GIS_SCHEMA,
        has_geom: hasGeom,
        geometry_column: hasGeom ? geometryColumn.column_name : null,
        geometry_type: hasGeom
          ? geometryTypeByTable.get(tableName) || null
          : null,
        source_type: hasGeom ? "postgis" : "table",
        estimated_count: hasGeom ? summary?.estimated_count || 0 : 0,
        bbox: hasGeom ? summary?.bbox || null : null,
        dg: summary?.dg || null,
      };
    })
    .filter((row) => row.name); // Elimina filas con nombre vacío

  logBackend(
    `[GIS API] Schema "${GIS_SCHEMA}" consultado: ${catalog.length} tablas encontradas`,
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
        (table) => String(table?.table_name || "").trim() === tableName,
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
    source_type: geometryColumn ? "postgis" : "table",
  };
}

// ── Simplificación de geometrías ──────────────────────────────────────────────

// Devuelve la tolerancia de simplificación para ST_Simplify.
// Tolerancia en grados decimales (EPSG:4326).
// 0.00005° ≈ 5.5 metros — buen balance entre calidad visual y peso del archivo.
// A mayor tolerancia → geometría más simple → archivo más pequeño → carga más rápida.
// A menor tolerancia → más detalle → archivo más pesado.
function getSimplifyTolerance(tableName) {
  return Number(process.env.GIS_SIMPLIFY_TOLERANCE || 0.0001);
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
  const safeGeomColumn = geometryColumn ? quoteIdentifier(geometryColumn) : null;
  const tolerance = getSimplifyTolerance(tableName);
  const normalizedGeomSql = `
    CASE
      WHEN COALESCE(ST_SRID(${safeGeomColumn}), 0) = 4326 THEN ${safeGeomColumn}
      WHEN COALESCE(ST_SRID(${safeGeomColumn}), 0) > 0 THEN ST_Transform(${safeGeomColumn}, 4326)
      ELSE ${safeGeomColumn}
    END
  `;

  logBackend(
    `[GIS API] Consultando capa GeoJSON desde "${GIS_SCHEMA}"."${tableName}" (tolerance=${tolerance})`,
  );

  const result = await query(
    `
      SELECT
        (to_jsonb(row_data) - ($2::text) - 'geometry' - 'geom' - 'the_geom') AS properties,
        ST_AsGeoJSON(
          ST_Simplify(${normalizedGeomSql}, ($1::double precision), true)
        ) AS geometry_geojson
      FROM ${safeSchema}.${safeTable} AS row_data
      WHERE ${safeGeomColumn} IS NOT NULL
        AND ST_IsValid(${safeGeomColumn})
        AND NOT ST_IsEmpty(${safeGeomColumn})
    `,
    [tolerance, geometryColumn],
  );

  return buildGeoJsonFeatureCollection(result.rows, geometryColumn);
}

async function getTableRowsGeoJson(tableName) {
  const safeSchema = quoteIdentifier(GIS_SCHEMA);
  const safeTable = quoteIdentifier(tableName);

  logBackend(`[GIS API] Consultando tabla sin columna geom como GeoJSON: "${GIS_SCHEMA}"."${tableName}"`);

  const result = await query(`SELECT * FROM ${safeSchema}.${safeTable}`);
  return buildGeoJsonFeatureCollection(result.rows, null);
}

async function getCachedPostgisLayerGeoJson(tableName, geometryColumn) {
  const cachedLayer = getCachedLayerGeoJson(tableName);
  if (cachedLayer) {
    return {
      geojson: cachedLayer.geojson,
      cacheStatus: "hit",
      etag: cachedLayer.etag || buildWeakEtag(cachedLayer.geojson),
    };
  }

  const sharedRequest = layerGeoJsonInFlight.get(tableName);
  if (sharedRequest) {
    const sharedPayload = await sharedRequest;
    return {
      geojson: sharedPayload.geojson,
      cacheStatus: "shared",
      etag: sharedPayload.etag,
    };
  }

  const requestPromise = getPostgisLayerGeoJson(tableName, geometryColumn)
    .then((geojson) => {
      const etag = buildWeakEtag(geojson);
      layerGeoJsonCache.set(tableName, {
        geojson,
        etag,
        cachedAt: Date.now(),
      });
      return { geojson, etag };
    })
    .finally(() => {
      layerGeoJsonInFlight.delete(tableName);
    });

  layerGeoJsonInFlight.set(tableName, requestPromise);
  const payload = await requestPromise;
  return {
    geojson: payload.geojson,
    cacheStatus: "miss",
    etag: payload.etag,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS — funciones reutilizables para registrar en / y /api
// ─────────────────────────────────────────────────────────────────────────────

async function handleHealth(req, res) {
  const healthPayload = {
    ...getServiceStatus(),
    checks: {
      kpi_summary: await getKpiRouteHealth({ force: false }),
    },
    limits: {
      request_timeout_ms: API_REQUEST_TIMEOUT_MS,
      rate_limit_enabled: ENABLE_RATE_LIMIT,
      rate_limit_window_ms: RATE_LIMIT_WINDOW_MS,
      rate_limit_max_requests: RATE_LIMIT_MAX_REQUESTS,
    },
  };
  sendJsonWithEtag(req, res, healthPayload, "no-store");
}

async function handleTest(_req, res) {
  try {
    const result = await query("SELECT NOW() AS server_time");
    res.json({
      ok: true,
      message: "Conexión PostgreSQL exitosa",
      rows: result.rows,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleLayers(req, res) {
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

    const payload = {
      ok: true,
      message: `Tablas del schema "${GIS_SCHEMA}" consultadas correctamente`,
      tables,
      total: tables.length,
    };
    sendJsonWithEtag(req, res, payload, "public, max-age=60");
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleLayerTable(req, res) {
  const tableName = String(req.params.table || "").trim();

  if (!tableName) {
    res.status(400).json({ ok: false, error: "Nombre de tabla inválido." });
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

    let geojson = null;
    let responseEtag = null;
    let cacheStatus = 'miss';

    if (metadata.has_geom && metadata.geometry_column) {
      const cached = await getCachedPostgisLayerGeoJson(
        metadata.table_name,
        metadata.geometry_column,
      );
      geojson = cached.geojson;
      cacheStatus = cached.cacheStatus;
      responseEtag = cached.etag;
    } else {
      geojson = await getTableRowsGeoJson(metadata.table_name);
      responseEtag = buildWeakEtag(geojson);
    }

    if (responseEtag) {
      res.set("ETag", responseEtag);
      if (matchesIfNoneMatch(req.get("if-none-match"), responseEtag)) {
        res.set("Cache-Control", "public, max-age=600");
        res.set("X-GIS-Cache", cacheStatus);
        res.status(304).end();
        return;
      }
    }
    res.set("Cache-Control", "public, max-age=600");
    res.set("X-GIS-Cache", cacheStatus);
    res.json(geojson);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleKpiSummary(req, res) {
  try {
    const forceParam = String(req.query?.force || "").toLowerCase();
    const forceRefresh =
      forceParam === "1" || forceParam === "true" || forceParam === "yes";
    if (forceRefresh) {
      invalidateKpiSummaryCache();
    }
    const summary = await getKpiSummaryCatalog();
    const payload = {
      ok: true,
      message: "KPIs ejecutivos calculados correctamente.",
      ...summary,
    };
    kpiRouteHealthCache = {
      checked_at: new Date().toISOString(),
      checked_at_epoch_ms: Date.now(),
      ok: true,
      source: "kpi_summary",
      error: null,
      total_obras: Number(summary?.totals?.total_obras || 0),
    };
    sendJsonWithEtag(req, res, payload, "public, max-age=60");
  } catch (error) {
    kpiRouteHealthCache = {
      checked_at: new Date().toISOString(),
      checked_at_epoch_ms: Date.now(),
      ok: false,
      source: "kpi_summary",
      error: String(error?.message || error || "Error desconocido"),
      total_obras: null,
    };
    res.status(500).json({ ok: false, error: error.message });
  }
}

async function handleKpiAudit(req, res) {
  try {
    const forceParam = String(req.query?.force || "").toLowerCase();
    const forceRefresh =
      forceParam === "1" || forceParam === "true" || forceParam === "yes";
    if (forceRefresh) {
      invalidateKpiSummaryCache();
    }

    const summary = await getKpiSummaryCatalog();
    const byTable = Array.isArray(summary?.by_table) ? summary.by_table : [];
    const totalsFromRows = byTable.reduce(
      (accumulator, row) => {
        accumulator.total_obras += Number(row?.total || 0);
        accumulator.entregadas += Number(row?.entregado || 0);
        accumulator.terminadas += Number(row?.terminado || 0);
        accumulator.en_proceso += Number(row?.proceso || 0);
        accumulator.sin_iniciar += Number(row?.sin_iniciar || 0);
        accumulator.otro += Number(row?.otro || 0);
        return accumulator;
      },
      {
        total_obras: 0,
        entregadas: 0,
        terminadas: 0,
        en_proceso: 0,
        sin_iniciar: 0,
        otro: 0,
      }
    );

    const totals = summary?.totals || {};
    const payload = {
      ok: true,
      message: "Auditoría KPI generada correctamente.",
      generated_at: new Date().toISOString(),
      summary_generated_at: summary?.generated_at || null,
      totals: {
        total_obras: Number(totals.total_obras || 0),
        entregadas: Number(totals.entregadas || 0),
        terminadas: Number(totals.terminadas || 0),
        en_proceso: Number(totals.en_proceso || 0),
        sin_iniciar: Number(totals.sin_iniciar || 0),
        otro: Number(totals.otro || 0),
      },
      table_rollup: totalsFromRows,
      deltas: {
        total_obras:
          Number(totals.total_obras || 0) - Number(totalsFromRows.total_obras || 0),
        entregadas:
          Number(totals.entregadas || 0) - Number(totalsFromRows.entregadas || 0),
        terminadas:
          Number(totals.terminadas || 0) - Number(totalsFromRows.terminadas || 0),
        en_proceso:
          Number(totals.en_proceso || 0) - Number(totalsFromRows.en_proceso || 0),
        sin_iniciar:
          Number(totals.sin_iniciar || 0) - Number(totalsFromRows.sin_iniciar || 0),
        otro: Number(totals.otro || 0) - Number(totalsFromRows.otro || 0),
      },
      table_count: byTable.length,
      table_errors: byTable
        .filter((row) => Boolean(row?.error))
        .map((row) => ({
          table_name: row.table_name,
          error: row.error,
        })),
      audit: summary?.audit || null,
    };

    sendJsonWithEtag(req, res, payload, "no-store");
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

function handleCacheInvalidate(req, res) {
  if (IS_PRODUCTION && !CACHE_INVALIDATE_TOKEN) {
    logBackendError(
      "[GIS API] Intento de invalidar caché bloqueado: CACHE_INVALIDATE_TOKEN no configurado en producción",
    );
    res.status(503).json({
      ok: false,
      error: "CACHE_INVALIDATE_TOKEN no está configurado en producción.",
    });
    return;
  }

  if (CACHE_INVALIDATE_TOKEN) {
    const requestToken = getInvalidateRequestToken(req);
    if (requestToken !== CACHE_INVALIDATE_TOKEN) {
      logBackendError("[GIS API] Intento no autorizado de invalidar caché");
      res
        .status(401)
        .json({ ok: false, error: "No autorizado para invalidar caché." });
      return;
    }
  }

  invalidateCatalogCache();
  invalidateLayerGeoJsonCache();
  invalidateKpiSummaryCache();
  logBackend("[GIS API] Caché de catálogo invalidado manualmente");
  res.json({ ok: true, message: "Caché de catálogo invalidado." });
}

async function handlePopulationQuery(req, res) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radiusKm = Math.min(10, Math.max(0.1, Number(req.query.radiusKm)));
  const maxRenderFeatures = Math.max(
    0,
    Number(req.query.maxRenderFeatures || POPULATION_MAX_RENDER_FEATURES),
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm)) {
    res.status(400).json({
      ok: false,
      error: "Parámetros inválidos: lat, lng y radiusKm son requeridos.",
    });
    return;
  }

  try {
    const result = await populationAnalysisEngine.queryRadius({
      lat,
      lng,
      radiusKm,
      maxRenderFeatures,
    });

    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      source: result.source || "backend",
      engine: populationAnalysisEngine.getStatus(),
      result,
    });
  } catch (error) {
    logBackendError("[GIS API] Population query error:", error?.message || error);
    res.status(500).json({
      ok: false,
      error: error?.message || "Error calculando población.",
    });
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/update-avance — Actualiza avance, estatus y campos de una obra
// Body: { tabla, nombre, avance, estatus, fecha_inauguracion, motivo_cancelacion }
// ─────────────────────────────────────────────────────────────────────────────

async function handleUpdateAvance(req, res) {
  const { tabla, nombre, avance, estatus, fecha_inauguracion, motivo_cancelacion } = req.body || {};

  if (!tabla || !nombre) {
    return res.status(400).json({ ok: false, error: "tabla y nombre son obligatorios" });
  }

  if (avance !== undefined && avance !== null && (typeof avance !== "number" || avance < 0 || avance > 100)) {
    return res.status(400).json({ ok: false, error: "avance debe ser un número entre 0 y 100" });
  }

  // Escapar nombre de tabla para prevenir SQL injection
  const safeTable = `"${tabla.replace(/"/g, '""')}"`;

  try {
    const result = await pool.query(
      `UPDATE ${safeTable}
       SET
         "AVANCE REAL"          = $1,
         "ESTATUS"              = $2,
         "fecha_inauguracion"   = $3,
         "motivo_cancelacion"   = $4
       WHERE TRIM("NOMBRE DEL SITIO INTERVENIDO") = TRIM($5)`,
      [avance ?? null, estatus ?? null, fecha_inauguracion ?? null, motivo_cancelacion ?? null, nombre]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "No se encontró el registro con ese nombre en la tabla indicada" });
    }

    res.json({ ok: true, message: "Actualizado correctamente" });
  } catch (error) {
    console.error("[GIS API] Error update-avance:", error.message);
    res.status(500).json({ ok: false, error: "Error interno del servidor" });
  }
}

logBackend("[GIS API] Backend activo — rutas disponibles en / y /api");

// GET / → sirve frontend o estado del backend
app.get("/", (_req, res) => {
  if (HAS_FRONTEND_BUILD) {
    res.sendFile(FRONTEND_INDEX_FILE);
    return;
  }
  res.json(getServiceStatus());
});

// Rutas montadas en ambos prefijos (/ y /api)
for (const prefix of ["", "/api"]) {
  app.get(`${prefix}/health`, handleHealth);
  app.get(`${prefix}/test`, handleTest);
  app.get(`${prefix}/search`, handleSearch);
  app.get(`${prefix}/layers`, handleLayers);
  app.get(`${prefix}/layer/:table`, handleLayerTable);
  app.get(`${prefix}/kpi/audit`, handleKpiAudit);
  app.get(`${prefix}/kpi/summary`, handleKpiSummary);
  app.get(`${prefix}/kpis/audit`, handleKpiAudit);
  app.get(`${prefix}/kpis/summary`, handleKpiSummary);
  app.get(`${prefix}/population/query`, handlePopulationQuery);
  app.post(`${prefix}/cache/invalidate`, handleCacheInvalidate);
  app.post(`${prefix}/update-avance`, handleUpdateAvance);
}

logBackend("[GIS API] Ruta /api/layers disponible");
logBackend("[GIS API] Ruta /api/layer/:table disponible");
logBackend("[GIS API] Ruta /api/kpi/audit disponible");
logBackend("[GIS API] Ruta /api/kpi/summary disponible");
logBackend("[GIS API] Ruta /api/kpis/audit disponible");
logBackend("[GIS API] Ruta /api/kpis/summary disponible");
logBackend("[GIS API] Ruta /api/population/query disponible");
logBackend("[GIS API] Ruta /api/search disponible");
logBackend("[GIS API] Ruta /api/update-avance disponible");

populationAnalysisEngine
  .ensureLoaded()
  .then(() => {
    logBackend(
      "[GIS API] Motor de población precargado:",
      populationAnalysisEngine.getStatus(),
    );
  })
  .catch((error) => {
    logBackendError(
      "[GIS API] No se pudo precargar motor de población:",
      error?.message || error,
    );
  });

// Si existe el build del frontend, sirve los assets estáticos ya compilados.
if (HAS_FRONTEND_BUILD) {
  app.use(
    express.static(FRONTEND_BUILD_DIR, {
      index: false,
      maxAge: IS_PRODUCTION ? "1d" : 0,
    }),
  );

  // Fallback SPA: cualquier ruta del frontend regresa index.html.
  // Se excluyen rutas de API y archivos estáticos para no romper el backend.
  app.get("*", (req, res, next) => {
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
    error: "Ruta no encontrada",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ARRANQUE Y APAGADO DEL SERVIDOR
// ─────────────────────────────────────────────────────────────────────────────

const server = app.listen(port, "0.0.0.0", () => {
  logBackend(
    `[GIS API] Backend iniciado en puerto ${port} (frontend integrado=${HAS_FRONTEND_BUILD ? "sí" : "no"})`,
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

process.on("SIGINT", () => shutdown("SIGINT")); // Ctrl+C en terminal
process.on("SIGTERM", () => shutdown("SIGTERM")); // kill desde sistema operativo
