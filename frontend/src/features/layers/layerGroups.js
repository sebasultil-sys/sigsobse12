// ── Campos donde puede vivir el valor de DG en las propiedades de un feature ─
const DG_FEATURE_KEYS = [
  'dg', 'DG',
  'direccion_general', 'DIRECCION_GENERAL',
  'DIRECCION GENERAL', 'direccion general',
];

const BASE_LAYER_GROUP_KEY = 'Sin DG';
const BASE_LAYER_GROUP_LABEL = 'Cartografía base';

// Normalización local (espejo de normalizeDG en GISWorkspaceContext) para evitar
// dependencia circular. Convierte cualquier variante de nombre de DG al
// identificador canónico (DGCOP, DGSUS, etc.).
function normalizeDGValue(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

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
  if (compact.includes('ILIFE')) return 'ILIFE';
  if (compact.includes('DGUV')) return 'DGUV';
  if (compact.includes('DGAF')) return 'DGAF';

  return normalized || null;
}

// Devuelve todos los DGs únicos de una capa leyendo las propiedades de cada
// feature. Si la tabla mezcla features de varias Direcciones Generales (p.ej.
// DGCOP y DGUV dentro de "Canchas Mundialistas"), la capa aparecerá bajo cada
// DG con su propio grupo. Si la capa aún no está cargada (sin features),
// retorna el DG asignado al objeto capa como fallback.
function getLayerDgs(layer) {
  const features = layer.data?.features || [];

  if (!features.length) {
    // Capa no cargada todavía — usar el DG declarado en el objeto capa
    const fallback = normalizeDGValue(layer.dg);
    return [fallback || BASE_LAYER_GROUP_KEY];
  }

  const dgSet = new Set();

  features.forEach((feature) => {
    const props = feature.properties || {};
    for (const key of DG_FEATURE_KEYS) {
      const rawDg = props[key];
      if (rawDg) {
        // Un campo puede contener múltiples DGs separadas por coma
        String(rawDg)
          .split(',')
          .forEach((part) => {
            const normalized = normalizeDGValue(part.trim());
            if (normalized) dgSet.add(normalized);
          });
        break; // primer campo encontrado es suficiente
      }
    }
  });

  if (dgSet.size === 0) {
    const fallback = normalizeDGValue(layer.dg);
    return [fallback || BASE_LAYER_GROUP_KEY];
  }

  return [...dgSet];
}

function getLayerGroupKey(value) {
  const raw = String(value || '').trim();
  return raw || BASE_LAYER_GROUP_KEY;
}

function getLayerGroupLabel(value) {
  const groupKey = getLayerGroupKey(value);
  return groupKey === BASE_LAYER_GROUP_KEY
    ? BASE_LAYER_GROUP_LABEL
    : groupKey;
}

function compareLayerGroupNames(left, right) {
  const leftKey = getLayerGroupKey(left);
  const rightKey = getLayerGroupKey(right);
  const leftIsBase = leftKey === BASE_LAYER_GROUP_KEY;
  const rightIsBase = rightKey === BASE_LAYER_GROUP_KEY;

  if (leftIsBase !== rightIsBase) {
    return leftIsBase ? 1 : -1;
  }

  return getLayerGroupLabel(leftKey).localeCompare(
    getLayerGroupLabel(rightKey),
    'es'
  );
}

function orderLayerGroupEntries(entries) {
  return [...entries].sort(([left], [right]) =>
    compareLayerGroupNames(left, right)
  );
}

// Agrupa capas por DG. Una capa puede aparecer en múltiples grupos si sus
// features pertenecen a más de una Dirección General.
function getOrderedLayerGroups(layers) {
  const groups = new Map();

  layers.forEach((layer) => {
    const dgs = getLayerDgs(layer);
    dgs.forEach((dg) => {
      const groupKey = getLayerGroupKey(dg);
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      const bucket = groups.get(groupKey);
      // Evitar duplicados si la misma capa ya fue añadida al grupo
      if (!bucket.find((l) => l.id === layer.id)) {
        bucket.push(layer);
      }
    });
  });

  return orderLayerGroupEntries(Array.from(groups.entries()));
}

export {
  BASE_LAYER_GROUP_KEY,
  BASE_LAYER_GROUP_LABEL,
  compareLayerGroupNames,
  getLayerDgs,
  getLayerGroupKey,
  getLayerGroupLabel,
  getOrderedLayerGroups,
  orderLayerGroupEntries,
};
