// ─────────────────────────────────────────────────────────────────────────────
// gisApi.js — Cliente HTTP que conecta el frontend con el backend Node.js
//
// Todas las llamadas al servidor pasan por aquí.
// Si necesitas cambiar la URL del backend (ej. en producción), solo cambias
// la variable de entorno REACT_APP_GIS_API_URL en el archivo .env del frontend.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parseBaseUrlList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeBaseUrl(entry))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => normalizeBaseUrl(entry))
      .filter(Boolean);
  }

  return [];
}

function resolveDefaultApiBaseUrl() {
  if (typeof window !== "undefined") {
    const { protocol, hostname, origin } = window.location;
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";

    if (isLocalhost) {
      return `${protocol}//${hostname}:3001`;
    }

    return normalizeBaseUrl(origin);
  }

  return "http://localhost:3001";
}

function getRuntimeConfiguredApiUrls() {
  if (typeof window === "undefined") return [];

  const fromList = parseBaseUrlList(window.__GIS_CONFIG__?.API_BASE_URLS);
  const fromSingle = normalizeBaseUrl(window.__GIS_CONFIG__?.API_BASE_URL);
  if (fromSingle && !fromList.includes(fromSingle)) {
    fromList.unshift(fromSingle);
  }
  return fromList;
}

function getEnvConfiguredApiUrls() {
  const fromList = parseBaseUrlList(process.env.REACT_APP_GIS_API_URLS);
  const fromSingle = normalizeBaseUrl(process.env.REACT_APP_GIS_API_URL);
  if (fromSingle && !fromList.includes(fromSingle)) {
    fromList.unshift(fromSingle);
  }
  return fromList;
}

function resolveConfiguredApiBaseUrls() {
  const localDefault = resolveDefaultApiBaseUrl();
  const isBrowserLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const runtimeUrls = getRuntimeConfiguredApiUrls();
  if (runtimeUrls.length) {
    if (isBrowserLocalhost) {
      return [localDefault, ...runtimeUrls.filter((url) => url !== localDefault)];
    }
    return runtimeUrls;
  }

  const envUrls = getEnvConfiguredApiUrls();
  if (envUrls.length) {
    if (isBrowserLocalhost) {
      return [localDefault, ...envUrls.filter((url) => url !== localDefault)];
    }
    return envUrls;
  }

  return [localDefault];
}

function resolveFallbackApiBaseUrls() {
  const runtimeFallbacks =
    typeof window === "undefined"
      ? []
      : parseBaseUrlList(window.__GIS_CONFIG__?.API_BASE_URL_FALLBACKS);
  const envFallbacks = parseBaseUrlList(process.env.REACT_APP_GIS_API_FALLBACK_URLS);
  const envSingleFallback = normalizeBaseUrl(
    process.env.REACT_APP_GIS_API_FALLBACK_URL
  );
  const defaultRenderFallback = "https://sigsobse-backend.onrender.com/api";

  return [
    ...runtimeFallbacks,
    ...envFallbacks,
    envSingleFallback,
    defaultRenderFallback,
  ].filter(Boolean);
}

// URL base del backend.
// 1) Runtime: window.__GIS_CONFIG__.API_BASE_URLS / API_BASE_URL.
// 2) Build-time: REACT_APP_GIS_API_URLS / REACT_APP_GIS_API_URL.
// 3) Fallback local/origen actual.
const CONFIGURED_API_BASE_URLS = resolveConfiguredApiBaseUrls();
const API_BASE_URL = CONFIGURED_API_BASE_URLS[0];
const FALLBACK_API_BASE_URLS = resolveFallbackApiBaseUrls();
let activeApiBaseUrl = API_BASE_URL;
const GEOJSON_CACHE_TTL_MS = Math.max(
  15000,
  Number(process.env.REACT_APP_LAYER_CACHE_TTL_MS || 12 * 60 * 1000)
);
const KPI_CACHE_TTL_MS = Math.max(
  15000,
  Number(process.env.REACT_APP_KPI_CACHE_TTL_MS || 60 * 1000)
);
const layerGeoJsonCache = new Map();
const etagCache = new Map();
let kpiSummaryCache = null;
let kpiSummaryCacheTime = 0;
let kpiSummaryInFlight = null;

if (process.env.NODE_ENV !== "production") {
  console.log("[GIS API] API_BASE_URL:", API_BASE_URL);
  console.log("[GIS API] API_BASE_URLS:", CONFIGURED_API_BASE_URLS);
}

function buildApiBaseVariants(baseUrl) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const variants = [];

  const addVariant = (candidate) => {
    const normalizedCandidate = normalizeBaseUrl(candidate);
    if (!normalizedCandidate) return;
    if (!variants.includes(normalizedCandidate)) {
      variants.push(normalizedCandidate);
    }
  };

  const addWithAndWithoutApi = (candidate) => {
    const normalizedCandidate = normalizeBaseUrl(candidate);
    if (!normalizedCandidate) return;
    addVariant(normalizedCandidate);
    if (normalizedCandidate.endsWith("/api")) {
      addVariant(normalizedCandidate.slice(0, -4));
    } else {
      addVariant(`${normalizedCandidate}/api`);
    }
  };

  addWithAndWithoutApi(normalizedBase);
  CONFIGURED_API_BASE_URLS.forEach(addWithAndWithoutApi);
  FALLBACK_API_BASE_URLS.forEach(addWithAndWithoutApi);
  return variants;
}

async function fetchJsonFrom(baseUrl, path) {
  const url = `${baseUrl}${path}`;
  if (process.env.NODE_ENV !== "production") {
    console.log("[GIS API] Fetching:", url);
  }

  const shouldUseEtagCache =
    path === "/layers" ||
    path.startsWith("/kpi/") ||
    path.startsWith("/kpis/");
  const cachedEtagEntry = shouldUseEtagCache ? etagCache.get(url) : null;
  const headers = {};
  if (cachedEtagEntry?.etag) {
    headers["If-None-Match"] = cachedEtagEntry.etag;
  }

  const response = await fetch(url, {
    headers,
  });
  if (response.status === 304) {
    if (cachedEtagEntry?.payload) {
      return cachedEtagEntry.payload;
    }
    const staleError = new Error("Respuesta 304 sin caché local disponible");
    staleError.status = 304;
    staleError.url = url;
    throw staleError;
  }
  const rawBody = await response.text();
  let payload = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { raw: rawBody };
    }
  } else {
    payload = {};
  }

  if (!response.ok) {
    const messageFromPayload =
      payload?.error ||
      payload?.message ||
      (typeof payload?.raw === "string"
        ? payload.raw.slice(0, 160)
        : "") ||
      `Error consultando API GIS (${response.status})`;
    const error = new Error(messageFromPayload);
    error.payload = payload;
    error.status = response.status;
    error.url = url;
    throw error;
  }

  if (shouldUseEtagCache) {
    const responseEtag = String(response.headers.get("etag") || "").trim();
    if (responseEtag) {
      etagCache.set(url, {
        etag: responseEtag,
        payload,
        cachedAt: Date.now(),
      });
    }
  }

  return payload;
}

// ─── Función interna helper ───────────────────────────────────────────────────
// Hace fetch a cualquier ruta del backend y devuelve el JSON parseado.
// Si el servidor responde con un código de error (4xx, 5xx), lanza una
// excepción con el mensaje de error que manda el servidor.
async function requestJson(path) {
  const baseVariants = buildApiBaseVariants(activeApiBaseUrl);
  let lastError = null;

  for (const baseUrl of baseVariants) {
    try {
      const payload = await fetchJsonFrom(baseUrl, path);
      activeApiBaseUrl = baseUrl;
      return payload;
    } catch (error) {
      lastError = error;
      const errorMessage = String(error?.message || "").toLowerCase();
      const isRouteError =
        error?.status === 404 ||
        errorMessage.includes("ruta no encontrada");
      const isNetworkLikeError =
        error?.name === "TypeError" ||
        errorMessage.includes("failed to fetch") ||
        errorMessage.includes("networkerror") ||
        errorMessage.includes("load failed");
      if (!isRouteError && !isNetworkLikeError) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Error consultando API GIS");
}

function buildLayerCacheKey(table) {
  return String(table || "").trim().toLowerCase();
}

function readLayerCache(cacheKey) {
  const cached = layerGeoJsonCache.get(cacheKey);
  if (!cached) return null;
  if (cached.promise) return cached;
  if (Date.now() - cached.timestamp > GEOJSON_CACHE_TTL_MS) {
    layerGeoJsonCache.delete(cacheKey);
    return null;
  }
  return cached;
}

// ─── Rutas públicas ───────────────────────────────────────────────────────────

// Verifica que la conexión al backend y a PostgreSQL esté funcionando.
// Llama al endpoint GET /test → responde con la hora del servidor.
export function fetchDatabaseTest() {
  return requestJson("/test");
}

// Obtiene el catálogo de todas las tablas del schema "sig_sobse".
// Llama al endpoint GET /layers → devuelve lista con nombre y si tiene geometría.
// El frontend usa esto para saber qué capas existen antes de pedirlas.
export function fetchLayerTables() {
  return requestJson("/layers");
}

// Descarga el GeoJSON completo de una tabla específica.
// Llama al endpoint GET /layer/:table → devuelve un FeatureCollection.
// encodeURIComponent protege contra nombres de tablas con espacios o caracteres especiales.
export function fetchLayerGeoJSON(table, options = {}) {
  const { force = false } = options;
  const cacheKey = buildLayerCacheKey(table);

  if (!force) {
    const cached = readLayerCache(cacheKey);
    if (cached?.payload) return Promise.resolve(cached.payload);
    if (cached?.promise) return cached.promise;
  }

  const requestPromise = requestJson(`/layer/${encodeURIComponent(table)}`)
    .then((payload) => {
      layerGeoJsonCache.set(cacheKey, {
        payload,
        timestamp: Date.now(),
        promise: null,
      });
      return payload;
    })
    .catch((error) => {
      const current = layerGeoJsonCache.get(cacheKey);
      if (current?.promise === requestPromise) {
        layerGeoJsonCache.delete(cacheKey);
      }
      throw error;
    });

  layerGeoJsonCache.set(cacheKey, {
    payload: null,
    timestamp: Date.now(),
    promise: requestPromise,
  });

  return requestPromise;
}

export function clearLayerGeoJsonCache(table) {
  if (table == null) {
    layerGeoJsonCache.clear();
    return;
  }

  layerGeoJsonCache.delete(buildLayerCacheKey(table));
}

export async function fetchKpiSummary(options = {}) {
  const { force = false } = options;
  const now = Date.now();

  if (
    !force &&
    kpiSummaryCache &&
    now - kpiSummaryCacheTime < KPI_CACHE_TTL_MS
  ) {
    return kpiSummaryCache;
  }

  if (!force && kpiSummaryInFlight) {
    return kpiSummaryInFlight;
  }

  const requestPath = force ? "/kpis/summary?force=1" : "/kpis/summary";
  const requestPromise = requestJson(requestPath)
    .then((payload) => {
      kpiSummaryCache = payload;
      kpiSummaryCacheTime = Date.now();
      return payload;
    })
    .finally(() => {
      kpiSummaryInFlight = null;
    });

  kpiSummaryInFlight = requestPromise;
  return requestPromise;
}

export function fetchKpiAudit(options = {}) {
  const { force = false } = options;
  const requestPath = force ? "/kpis/audit?force=1" : "/kpis/audit";
  return requestJson(requestPath);
}

// Busca elementos en la base de datos.
// Llama al endpoint GET /search?q= → devuelve resultados agrupados por tipo.
export function fetchSearchResults(query) {
  return requestJson(`/search?q=${encodeURIComponent(query)}`);
}

// Exporta la URL base por si algún componente necesita construir URLs manualmente
export { API_BASE_URL };
