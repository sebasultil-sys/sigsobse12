// ─────────────────────────────────────────────────────────────────────────────
// gisApi.js — Cliente HTTP que conecta el frontend con el backend Node.js
//
// Todas las llamadas al servidor pasan por aquí.
// Si necesitas cambiar la URL del backend (ej. en producción), solo cambias
// la variable de entorno REACT_APP_GIS_API_URL en el archivo .env del frontend.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveMovilidadLayerId } from "../features/map/movilidadLayerUtils";

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
const movilidadGeoJsonCache = new Map();
const etagCache = new Map();
let kpiSummaryCache = null;
let kpiSummaryCacheTime = 0;
let kpiSummaryInFlight = null;
const API_REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.REACT_APP_GIS_REQUEST_TIMEOUT_MS || 20000)
);
const API_REQUEST_RETRY_COUNT = Math.max(
  0,
  Number(process.env.REACT_APP_GIS_REQUEST_RETRY_COUNT || 1)
);
const API_RETRY_BASE_DELAY_MS = Math.max(
  120,
  Number(process.env.REACT_APP_GIS_RETRY_BASE_DELAY_MS || 350)
);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkLikeError(error) {
  const errorMessage = String(error?.message || "").toLowerCase();
  return (
    error?.name === "TypeError" ||
    errorMessage.includes("failed to fetch") ||
    errorMessage.includes("networkerror") ||
    errorMessage.includes("load failed")
  );
}

function isRouteError(error) {
  const errorMessage = String(error?.message || "").toLowerCase();
  return (
    error?.status === 404 ||
    errorMessage.includes("ruta no encontrada")
  );
}

function isRetryableError(error) {
  const status = Number(error?.status || 0);
  if (status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status <= 504) return true;
  if (error?.name === "AbortError") return true;
  return isNetworkLikeError(error);
}

async function fetchJsonFrom(baseUrl, path, options = {}) {
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

  const timeoutMs = Math.max(
    1000,
    Number(options.timeoutMs || API_REQUEST_TIMEOUT_MS)
  );
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId =
    controller != null
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;
  let response;

  try {
    response = await fetch(url, {
      headers,
      signal: controller?.signal,
    });
  } catch (error) {
    if (controller?.signal?.aborted) {
      const timeoutError = new Error(
        `Tiempo de espera agotado (${timeoutMs} ms)`
      );
      timeoutError.name = "AbortError";
      timeoutError.status = 408;
      timeoutError.url = url;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  }

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
async function requestJson(path, options = {}) {
  const maxRetries = Math.max(
    0,
    Number(
      options.maxRetries == null
        ? API_REQUEST_RETRY_COUNT
        : options.maxRetries
    )
  );
  const timeoutMs = Math.max(
    1000,
    Number(options.timeoutMs || API_REQUEST_TIMEOUT_MS)
  );
  const baseVariants = buildApiBaseVariants(activeApiBaseUrl);
  let lastError = null;

  for (const baseUrl of baseVariants) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const payload = await fetchJsonFrom(baseUrl, path, { timeoutMs });
        activeApiBaseUrl = baseUrl;
        return payload;
      } catch (error) {
        lastError = error;
        const routeError = isRouteError(error);
        const retryable = isRetryableError(error);

        if (retryable && attempt < maxRetries) {
          const backoffMs = Math.min(
            1600,
            API_RETRY_BASE_DELAY_MS * 2 ** attempt
          );
          await sleep(backoffMs);
          continue;
        }

        if (!routeError && !isNetworkLikeError(error) && !retryable) {
          throw error;
        }

        break;
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

function buildMovilidadCacheKey(layerId) {
  return String(layerId || "").trim().toLowerCase();
}

function readMovilidadCache(cacheKey) {
  const cached = movilidadGeoJsonCache.get(cacheKey);
  if (!cached) return null;
  if (cached.promise) return cached;
  if (Date.now() - cached.timestamp > GEOJSON_CACHE_TTL_MS) {
    movilidadGeoJsonCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function buildStaticGeoJsonUrls(path) {
  const cleanPath = String(path || "")
    .trim()
    .replace(/^\/+/, "");
  if (!cleanPath) return [];

  const publicUrl = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  const urls = [
    `/${cleanPath}`,
    cleanPath,
    `./${cleanPath}`,
  ];

  if (publicUrl) {
    urls.unshift(`${publicUrl}/${cleanPath}`);
  }

  if (typeof window !== "undefined") {
    const { origin, pathname } = window.location;
    const basePath = pathname.endsWith("/")
      ? pathname
      : pathname.slice(0, pathname.lastIndexOf("/") + 1);
    urls.push(`${origin}${basePath}${cleanPath}`);
  }

  return Array.from(
    new Set(
      urls
        .map((url) => String(url || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeFeatureCollection(payload) {
  if (!payload) return null;

  if (payload.type === "FeatureCollection" && Array.isArray(payload.features)) {
    return payload;
  }

  if (payload.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: [payload],
    };
  }

  if (Array.isArray(payload)) {
    return {
      type: "FeatureCollection",
      features: payload.filter((item) => item?.type === "Feature"),
    };
  }

  return null;
}

async function fetchStaticFeatureCollection(path, options = {}) {
  const timeoutMs = Math.max(
    1000,
    Number(options.timeoutMs || API_REQUEST_TIMEOUT_MS)
  );
  const candidates = buildStaticGeoJsonUrls(path);
  if (!candidates.length) return null;

  for (const url of candidates) {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId =
      controller != null
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : null;

    try {
      const response = await fetch(url, { signal: controller?.signal });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json();
      const featureCollection = normalizeFeatureCollection(payload);
      if (featureCollection) {
        return featureCollection;
      }
    } catch {
      // Probamos el siguiente candidato.
    } finally {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    }
  }

  return null;
}

function tagMovilidadFeatures(featureCollection, visualType) {
  if (!featureCollection || !Array.isArray(featureCollection.features)) {
    return {
      type: "FeatureCollection",
      features: [],
    };
  }

  return {
    ...featureCollection,
    features: featureCollection.features
      .filter((feature) => feature?.type === "Feature")
      .map((feature) => ({
        ...feature,
        properties: {
          ...(feature.properties || {}),
          __tipo_visual: visualType,
        },
      })),
  };
}

function mergeFeatureCollections(collections = []) {
  return {
    type: "FeatureCollection",
    features: collections.flatMap((collection) =>
      Array.isArray(collection?.features) ? collection.features : []
    ),
  };
}

export function getMovilidadSources(layerId) {
  const canonicalLayerId = resolveMovilidadLayerId(layerId);
  if (!canonicalLayerId) return null;

  return {
    linea: `data/${canonicalLayerId}_linea.geojson`,
    puntos: `data/${canonicalLayerId}_puntos.geojson`,
  };
}

export async function fetchMovilidadLayerGeoJSON(layerId, options = {}) {
  const { force = false, timeoutMs } = options;
  const canonicalLayerId = resolveMovilidadLayerId(layerId);
  if (!canonicalLayerId) return null;

  const cacheKey = buildMovilidadCacheKey(canonicalLayerId);
  if (!force) {
    const cached = readMovilidadCache(cacheKey);
    if (cached?.payload) return cached.payload;
    if (cached?.promise) return cached.promise;
  }

  const requestPromise = (async () => {
    const sources = getMovilidadSources(canonicalLayerId);
    const [lineaData, puntosData] = await Promise.all([
      fetchStaticFeatureCollection(sources?.linea, { timeoutMs }),
      fetchStaticFeatureCollection(sources?.puntos, { timeoutMs }),
    ]);

    const collections = [];
    if (lineaData) collections.push(tagMovilidadFeatures(lineaData, "linea"));
    if (puntosData) collections.push(tagMovilidadFeatures(puntosData, "estacion"));

    if (!collections.length) {
      const error = new Error(
        `No se encontraron archivos de movilidad para "${canonicalLayerId}".`
      );
      error.code = "MOVILIDAD_STATIC_NOT_FOUND";
      throw error;
    }

    const payload = mergeFeatureCollections(collections);
    movilidadGeoJsonCache.set(cacheKey, {
      payload,
      timestamp: Date.now(),
      promise: null,
    });
    return payload;
  })().catch((error) => {
    const current = movilidadGeoJsonCache.get(cacheKey);
    if (current?.promise === requestPromise) {
      movilidadGeoJsonCache.delete(cacheKey);
    }
    throw error;
  });

  movilidadGeoJsonCache.set(cacheKey, {
    payload: null,
    timestamp: Date.now(),
    promise: requestPromise,
  });

  return requestPromise;
}

// ─── Rutas públicas ───────────────────────────────────────────────────────────

// Verifica que la conexión al backend y a PostgreSQL esté funcionando.
// Llama al endpoint GET /test → responde con la hora del servidor.
export function fetchDatabaseTest() {
  return requestJson("/test", { maxRetries: 0 });
}

// Obtiene el catálogo de todas las tablas del schema "sig_sobse".
// Llama al endpoint GET /layers → devuelve lista con nombre y si tiene geometría.
// El frontend usa esto para saber qué capas existen antes de pedirlas.
export function fetchLayerTables() {
  return requestJson("/layers", { maxRetries: 1 });
}

// Descarga el GeoJSON completo de una tabla específica.
// Llama al endpoint GET /layer/:table → devuelve un FeatureCollection.
// encodeURIComponent protege contra nombres de tablas con espacios o caracteres especiales.
export function fetchLayerGeoJSON(table, options = {}) {
  const { force = false, maxRetries = 2, timeoutMs } = options;
  const cacheKey = buildLayerCacheKey(table);

  if (!force) {
    const cached = readLayerCache(cacheKey);
    if (cached?.payload) return Promise.resolve(cached.payload);
    if (cached?.promise) return cached.promise;
  }

  const requestPromise = requestJson(`/layer/${encodeURIComponent(table)}`, {
    maxRetries,
    timeoutMs,
  })
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
  const { force = false, maxRetries = 1 } = options;
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
  const requestPromise = requestJson(requestPath, { maxRetries })
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
  const { force = false, maxRetries = 1 } = options;
  const requestPath = force ? "/kpis/audit?force=1" : "/kpis/audit";
  return requestJson(requestPath, { maxRetries });
}

// Busca elementos en la base de datos.
// Llama al endpoint GET /search?q= → devuelve resultados agrupados por tipo.
export function fetchSearchResults(query) {
  return requestJson(`/search?q=${encodeURIComponent(query)}`, {
    maxRetries: 0,
  });
}

// Exporta la URL base por si algún componente necesita construir URLs manualmente
export { API_BASE_URL };
