// ─────────────────────────────────────────────────────────────────────────────
// gisApi.js — Cliente HTTP que conecta el frontend con el backend Node.js
//
// Todas las llamadas al servidor pasan por aquí.
// Si necesitas cambiar la URL del backend (ej. en producción), solo cambias
// la variable de entorno REACT_APP_GIS_API_URL en el archivo .env del frontend.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getRuntimeConfiguredApiUrl() {
  if (typeof window === 'undefined') return '';

  return normalizeBaseUrl(window.__GIS_CONFIG__?.API_BASE_URL);
}

function resolveApiBaseUrl() {
  const runtimeUrl = getRuntimeConfiguredApiUrl();
  if (runtimeUrl) return runtimeUrl;

  const envUrl = normalizeBaseUrl(process.env.REACT_APP_GIS_API_URL);
  if (envUrl) return envUrl;

  if (typeof window !== 'undefined') {
    const { protocol, hostname, origin } = window.location;
    const isLocalhost =
      hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLocalhost) {
      return `${protocol}//${hostname}:3001`;
    }

    return normalizeBaseUrl(origin);
  }

  return 'http://localhost:3001';
}

// URL base del backend.
// 1) Usa window.__GIS_CONFIG__.API_BASE_URL si está definida en runtime-config.js.
// 2) Usa REACT_APP_GIS_API_URL si está definida en build-time.
// 3) En localhost cae a puerto 3001.
// 4) En producción usa el mismo origen del sitio.
const API_BASE_URL = resolveApiBaseUrl();

if (process.env.NODE_ENV !== 'production') {
  console.log('[GIS API] API_BASE_URL:', API_BASE_URL);
}

// ─── Función interna helper ───────────────────────────────────────────────────
// Hace fetch a cualquier ruta del backend y devuelve el JSON parseado.
// Si el servidor responde con un código de error (4xx, 5xx), lanza una
// excepción con el mensaje de error que manda el servidor.
async function requestJson(path) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[GIS API] Fetching:', `${API_BASE_URL}${path}`);
  }
  const response = await fetch(`${API_BASE_URL}${path}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || 'Error consultando API GIS');
  }

  return payload;
}

// ─── Rutas públicas ───────────────────────────────────────────────────────────

// Verifica que la conexión al backend y a PostgreSQL esté funcionando.
// Llama al endpoint GET /test → responde con la hora del servidor.
export function fetchDatabaseTest() {
  return requestJson('/test');
}

// Obtiene el catálogo de todas las tablas del schema "sig_sobse".
// Llama al endpoint GET /layers → devuelve lista con nombre y si tiene geometría.
// El frontend usa esto para saber qué capas existen antes de pedirlas.
export function fetchLayerTables() {
  return requestJson('/layers');
}

// Descarga el GeoJSON completo de una tabla específica.
// Llama al endpoint GET /layer/:table → devuelve un FeatureCollection.
// encodeURIComponent protege contra nombres de tablas con espacios o caracteres especiales.
export function fetchLayerGeoJSON(table) {
  return requestJson(`/layer/${encodeURIComponent(table)}`);
}

// Busca en todos los campos de texto configurados en el backend (nombre_obra,
// programa, direccion_general, alcaldia, colonia, etc.) usando ILIKE.
// Devuelve hasta 30 resultados con propiedades y geometría de punto representativo.
export function fetchSearch(q) {
  return requestJson(`/search?q=${encodeURIComponent(String(q || '').trim())}`);
}

// Exporta la URL base por si algún componente necesita construir URLs manualmente
export { API_BASE_URL };
