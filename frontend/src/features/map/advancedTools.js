import L from 'leaflet';

const POPULATION_NUMERIC_FIELDS = [
  'POBTOT',
  'POBFEM',
  'POBMAS',
  'POB0_14',
  'POB15_64',
  'POB65_MAS',
  'PSINDER',
  'TOTHOG',
  'HOGJEF_F',
];

function flattenCoordinates(input, bucket = []) {
  if (!Array.isArray(input)) return bucket;

  if (
    input.length >= 2 &&
    typeof input[0] === 'number' &&
    typeof input[1] === 'number'
  ) {
    bucket.push(input);
    return bucket;
  }

  input.forEach((entry) => flattenCoordinates(entry, bucket));
  return bucket;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function resolveFeatureLabel(feature, fallbackLabel = 'Elemento') {
  const properties = feature?.properties || {};

  return (
    properties.OBRA ||
    properties.NOMBRE ||
    properties.NOMBRE_OBRA ||
    properties.FRENTE ||
    properties.PROGRAMA ||
    properties.NOM_MZA ||
    properties.NOMBRE_COL ||
    feature?.id ||
    fallbackLabel
  );
}

export function isPointGeometry(geometryType) {
  return geometryType === 'Point' || geometryType === 'MultiPoint';
}

export function isPointLayer(layer) {
  return isPointGeometry(layer?.geometryType);
}

export function getFeatureRepresentativeLatLng(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates || [];
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return L.latLng(lat, lng);
    }
    return null;
  }

  if (geometry.type === 'MultiPoint') {
    const coords = geometry.coordinates || [];
    if (!coords.length) return null;
    const totals = coords.reduce(
      (accumulator, [lng, lat]) => ({
        lat: accumulator.lat + lat,
        lng: accumulator.lng + lng,
        count: accumulator.count + 1,
      }),
      { lat: 0, lng: 0, count: 0 }
    );

    if (!totals.count) return null;
    return L.latLng(totals.lat / totals.count, totals.lng / totals.count);
  }

  const coordinates = flattenCoordinates(geometry.coordinates);
  if (!coordinates.length) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  coordinates.forEach(([lng, lat]) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  });

  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  return L.latLng((minLat + maxLat) / 2, (minLng + maxLng) / 2);
}

export function getNearestFeatures({
  layer,
  latlng,
  limit = 5,
  maxDistanceMeters = Infinity,
}) {
  const features = layer?.data?.features || [];

  return features
    .map((feature) => {
      const point = getFeatureRepresentativeLatLng(feature);
      if (!point) return null;

      const distanceMeters = latlng.distanceTo(point);
      if (distanceMeters > maxDistanceMeters) return null;

      return {
        distanceMeters,
        feature,
        label: resolveFeatureLabel(feature, layer?.name),
        point,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, limit);
}

export function resolveLayerForProximity(layers, selectedLayerId) {
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  if (selectedLayer?.visible && selectedLayer?.data?.features?.length) {
    return selectedLayer;
  }

  return (
    layers.find((layer) => layer.visible && layer?.data?.features?.length) ||
    null
  );
}

export function resolveLayerForHotspot(layers, selectedLayerId) {
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  if (isPointLayer(selectedLayer) && selectedLayer?.visible) {
    return selectedLayer;
  }

  return (
    layers.find((layer) => isPointLayer(layer) && layer.visible) || null
  );
}

export function buildHotspotBins({ cellSizePx = 64, layer, map }) {
  if (!map || !layer?.data?.features?.length) return [];

  const zoom = map.getZoom();
  const bounds = map.getBounds().pad(0.25);
  const buckets = new Map();

  layer.data.features.forEach((feature) => {
    const point = getFeatureRepresentativeLatLng(feature);
    if (!point || !bounds.contains(point)) return;

    const projected = map.project(point, zoom);
    const bucketX = Math.floor(projected.x / cellSizePx);
    const bucketY = Math.floor(projected.y / cellSizePx);
    const bucketKey = `${bucketX}:${bucketY}`;

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        count: 0,
        latTotal: 0,
        lngTotal: 0,
      });
    }

    const bucket = buckets.get(bucketKey);
    bucket.count += 1;
    bucket.latTotal += point.lat;
    bucket.lngTotal += point.lng;
  });

  return Array.from(buckets.values())
    .map((bucket) => ({
      center: L.latLng(
        bucket.latTotal / bucket.count,
        bucket.lngTotal / bucket.count
      ),
      count: bucket.count,
    }))
    .sort((left, right) => right.count - left.count);
}

export function getHotspotColor(count, maxCount) {
  const ratio = maxCount > 0 ? count / maxCount : 0;

  if (ratio >= 0.85) return '#7f1d1d';
  if (ratio >= 0.65) return '#b91c1c';
  if (ratio >= 0.45) return '#ea580c';
  if (ratio >= 0.2) return '#f59e0b';
  return '#fde047';
}

export class PopulationEngine {
  constructor(url) {
    this.url = url;
    this.data = null;
    this.loadingPromise = null;
  }

  async ensureLoaded() {
    if (this.data) return this.data;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = fetch(this.url, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `No se encontró el archivo poblacional en ${this.url}`
          );
        }

        const payload = await response.json();
        if (!Array.isArray(payload?.features)) {
          throw new Error('El GeoJSON de población no es válido.');
        }

        this.data = payload;
        return payload;
      })
      .finally(() => {
        this.loadingPromise = null;
      });

    return this.loadingPromise;
  }

  async queryRadius(latlng, radiusKm) {
    const collection = await this.ensureLoaded();
    const radiusMeters = radiusKm * 1000;
    const totals = {
      center: latlng,
      featureCount: 0,
      radiusKm,
      sampledAreaKm2: Math.PI * radiusKm * radiusKm,
    };

    POPULATION_NUMERIC_FIELDS.forEach((field) => {
      totals[field] = 0;
    });

    collection.features.forEach((feature) => {
      const point = getFeatureRepresentativeLatLng(feature);
      if (!point) return;

      if (latlng.distanceTo(point) > radiusMeters) return;

      totals.featureCount += 1;
      const properties = feature?.properties || {};
      POPULATION_NUMERIC_FIELDS.forEach((field) => {
        totals[field] += toNumber(properties[field]);
      });
    });

    return totals;
  }
}
