import cetramData from './bootstrap/cetram.json';
import cicloviaData from './bootstrap/ciclovia.json';
import utopiasData from './bootstrap/utopias.json';

function getGeometryType(featureCollection) {
  const firstFeature = featureCollection?.features?.[0];
  return firstFeature?.geometry?.type || 'Unknown';
}

function buildDefaultStyle(color, geometryType) {
  const isPoint = geometryType === 'Point' || geometryType === 'MultiPoint';
  const isLine =
    geometryType === 'LineString' || geometryType === 'MultiLineString';
  const isPolygon =
    geometryType === 'Polygon' || geometryType === 'MultiPolygon';

  return {
    color,
    weight: isLine ? 4 : 2,
    pointRadius: isPoint ? 7 : 6,
    opacity: 0.94,
    fillOpacity: isPolygon ? 0.24 : 0.18,
    markerKind: 'solid',
    dashStyle: 'solid',
  };
}

function enrichFeatureCollection(layerId, featureCollection, metadata) {
  const features = (featureCollection?.features || []).map((feature, index) => {
    const properties = feature?.properties || {};
    const obra =
      properties.OBRA ||
      properties.NOMBRE ||
      properties.NOMBRE_OBRA ||
      properties.FRENTE ||
      metadata.programa;
    const progressValue =
      metadata.progressValues[index] ??
      metadata.progressValues[metadata.progressValues.length - 1] ??
      0;
    const isRisk =
      Array.isArray(metadata.riskIndexes) &&
      metadata.riskIndexes.includes(index);

    return {
      ...feature,
      id: feature.id || `${layerId}-feature-${index + 1}`,
      properties: {
        ...properties,
        DG: metadata.dg,
        PROGRAMA: properties.PROGRAMA || metadata.programa,
        ALCALDIA: metadata.alcaldia,
        OBRA: obra,
        AVANCE: progressValue,
        RIESGO: isRisk,
        __featureKey: `${layerId}-feature-${index + 1}`,
      },
    };
  });

  return {
    ...featureCollection,
    features,
  };
}

const LAYER_SPECS = [
  {
    id: 'bootstrap-ciclovia',
    name: 'Ciclovía Gran Tenochtitlán',
    source: 'SIG-SOBSE curado',
    color: '#006341',
    rawData: cicloviaData,
    metadata: {
      dg: 'DG Obras para el Transporte',
      programa: 'Ciclovía',
      alcaldia: 'Cuauhtémoc',
      progressValues: [82],
      riskIndexes: [],
    },
  },
  {
    id: 'bootstrap-utopias',
    name: 'Utopías',
    source: 'SIG-SOBSE curado',
    color: '#691C32',
    rawData: utopiasData,
    metadata: {
      dg: 'DG Construcción de Obras Públicas',
      programa: 'Utopías',
      alcaldia: 'Iztapalapa',
      progressValues: [78, 66, 82, 74, 58, 91],
      riskIndexes: [1, 4],
    },
  },
  {
    id: 'bootstrap-cetram',
    name: 'CETRAM',
    source: 'SIG-SOBSE curado',
    color: '#C5A572',
    rawData: cetramData,
    metadata: {
      dg: 'DG Obras para el Transporte',
      programa: 'CETRAM',
      alcaldia: 'Coyoacán',
      progressValues: [63, 48, 71],
      riskIndexes: [1],
    },
  },
];

export function createBootstrapLayers() {
  return LAYER_SPECS.map((spec) => {
    const data = enrichFeatureCollection(spec.id, spec.rawData, spec.metadata);
    const geometryType = getGeometryType(data);
    const style = buildDefaultStyle(spec.color, geometryType);

    return {
      id: spec.id,
      name: spec.name,
      visible: false,
      color: style.color,
      source: spec.source,
      dg: spec.metadata.dg,
      programa: spec.metadata.programa,
      alcaldia: spec.metadata.alcaldia,
      data,
      geometryType,
      style: { ...style },
      initialStyle: { ...style },
    };
  });
}
