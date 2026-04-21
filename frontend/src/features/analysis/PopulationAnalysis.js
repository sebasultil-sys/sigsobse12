import L from 'leaflet';

export const POPULATION_LAYER_STYLE = {
  color: '#6366f1',
  weight: 1,
  fillOpacity: 0.3,
};

export const POPULATION_BUFFER_STYLE = {
  color: '#6366f1',
  weight: 2,
  fillOpacity: 0.1,
  dashArray: '4 4',
};

function toNumeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function buildPopulationQuerySnapshot(latlng, radiusKm) {
  if (!latlng) return null;

  return {
    lat: Number(latlng.lat.toFixed(6)),
    lng: Number(latlng.lng.toFixed(6)),
    radiusKm: Number(radiusKm),
  };
}

export function isSamePopulationQuery(previousQuery, nextQuery) {
  if (!previousQuery || !nextQuery) return false;

  return (
    previousQuery.lat === nextQuery.lat &&
    previousQuery.lng === nextQuery.lng &&
    previousQuery.radiusKm === nextQuery.radiusKm
  );
}

export function ensurePopulationLayer({ data, layerRef, map }) {
  if (!map || !Array.isArray(data?.features)) return null;

  if (!layerRef.current) {
    layerRef.current = L.geoJSON(undefined, {
      style: POPULATION_LAYER_STYLE,
      interactive: false,
    });
  }

  layerRef.current.clearLayers();
  if (data.features.length > 0) {
    layerRef.current.addData(data);
  }

  if (data.features.length > 0 && !map.hasLayer(layerRef.current)) {
    layerRef.current.addTo(map);
  } else if (data.features.length === 0 && map.hasLayer(layerRef.current)) {
    map.removeLayer(layerRef.current);
  }

  return layerRef.current;
}

export function removePopulationLayer({ layerRef, map }) {
  if (!map || !layerRef.current) return;

  if (map.hasLayer(layerRef.current)) {
    map.removeLayer(layerRef.current);
  }
}

export function buildPopulationSelection(result) {
  const center = result?.center;
  const radiusKm = toNumeric(result?.radiusKm ?? result?.radius ?? 0);
  const total = toNumeric(
    result?.POBTOT ?? result?.total ?? result?.pob_total
  );
  const females = toNumeric(result?.POBFEM);
  const males = toNumeric(result?.POBMAS);
  const seniorsFemale = toNumeric(result?.POB60_MAS_F);
  const seniorsMale = toNumeric(result?.POB60_MAS_M);
  const minorsFemale = toNumeric(result?.POB18_MEN_F);
  const minorsMale = toNumeric(result?.POB18_MEN_M);
  const elements = toNumeric(
    result?.featureCount ?? result?.featuresCount ?? result?.elementos
  );

  return {
    layerId: 'analysis-population',
    layerName: 'Analisis de poblacion',
    feature:
      center && Number.isFinite(center.lat) && Number.isFinite(center.lng)
        ? {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [center.lng, center.lat],
            },
            properties: {},
          }
        : null,
    properties: {
      nombre: 'Analisis de poblacion',
      tipo: 'POBLACION',
    },
    detail: {
      poblacion_total: total,
      elementos: elements,
      radio: radiusKm,
      POBTOT: total,
      POBFEM: females,
      POBMAS: males,
      POB60_MAS_F: seniorsFemale,
      POB60_MAS_M: seniorsMale,
      POB18_MEN_F: minorsFemale,
      POB18_MEN_M: minorsMale,
      featuresCount: elements,
      error: result?.error || null,
    },
  };
}
