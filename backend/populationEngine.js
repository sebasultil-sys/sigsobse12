import fs from "node:fs/promises";
import path from "node:path";
import * as turf from "@turf/turf";

const POPULATION_NUMERIC_FIELDS = [
  "POBTOT",
  "POBFEM",
  "POBMAS",
  "POB0_14",
  "POB15_64",
  "POB65_MAS",
  "POB60_MAS_F",
  "POB60_MAS_M",
  "POB18_MEN_F",
  "POB18_MEN_M",
  "PSINDER",
  "TOTHOG",
  "HOGJEF_F",
];

const POPULATION_TOTAL_FIELD_CANDIDATES = [
  "POBTOT",
  "pob_total",
  "POB_TOTAL",
  "pobtot",
];

const POPULATION_FEMALE_FIELD_CANDIDATES = ["POBFEM", "pob_fem", "POB_FEM"];
const POPULATION_MALE_FIELD_CANDIDATES = ["POBMAS", "pob_mas", "POB_MAS"];
const POPULATION_SENIOR_TOTAL_FIELD_CANDIDATES = [
  "POB65_MAS",
  "P_60YMAS",
  "POB60_MAS",
  "POB60YMAS",
];
const POPULATION_SENIOR_FEMALE_FIELD_CANDIDATES = [
  "POB60_MAS_F",
  "POB60YMAS_F",
  "P_60YMAS_F",
  "P60YMAS_F",
  "POB65_MAS_F",
];
const POPULATION_SENIOR_MALE_FIELD_CANDIDATES = [
  "POB60_MAS_M",
  "POB60YMAS_M",
  "P_60YMAS_M",
  "P60YMAS_M",
  "POB65_MAS_M",
];
const POPULATION_MINOR_TOTAL_FIELD_CANDIDATES = [
  "POB18_MEN",
  "POB18MEN",
  "POB0_17",
  "P_0A17",
  "P_18YMEN",
  "POB_MENOR18",
];
const POPULATION_MINOR_FEMALE_FIELD_CANDIDATES = [
  "POB18_MEN_F",
  "POB18MEN_F",
  "POB0_17_F",
  "P_0A17_F",
  "P_18YMEN_F",
  "POB_MENOR18_F",
];
const POPULATION_MINOR_MALE_FIELD_CANDIDATES = [
  "POB18_MEN_M",
  "POB18MEN_M",
  "POB0_17_M",
  "P_0A17_M",
  "P_18YMEN_M",
  "POB_MENOR18_M",
];
const POPULATION_GRID_CELL_SIZE_DEGREES = 0.01;
const POPULATION_INDEX_BUILD_YIELD_EVERY = 450;
const POPULATION_QUERY_YIELD_EVERY = 260;
const MAX_POPULATION_RENDER_FEATURES_DEFAULT = 0;

function flattenCoordinates(input, bucket = []) {
  if (!Array.isArray(input)) return bucket;

  if (
    input.length >= 2 &&
    typeof input[0] === "number" &&
    typeof input[1] === "number"
  ) {
    bucket.push(input);
    return bucket;
  }

  input.forEach((entry) => flattenCoordinates(entry, bucket));
  return bucket;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function getPropertyByCandidates(properties, candidates) {
  for (const key of candidates) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    const numeric = toNumber(properties[key]);
    if (numeric !== 0 || properties[key] === 0 || properties[key] === "0") {
      return numeric;
    }
  }
  return 0;
}

function getPropertyByCandidatesMeta(properties, candidates) {
  for (const key of candidates) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    return { found: true, value: toNumber(properties[key]) };
  }
  return { found: false, value: 0 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundPopulation(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeFeature(feature) {
  if (!feature?.geometry) return null;
  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: feature.properties || {},
  };
}

function createZeroTotals() {
  const totals = {};
  POPULATION_NUMERIC_FIELDS.forEach((field) => {
    totals[field] = 0;
  });
  return totals;
}

function computePopulationMetrics(properties = {}) {
  const metrics = createZeroTotals();
  metrics.POBTOT = getPropertyByCandidates(
    properties,
    POPULATION_TOTAL_FIELD_CANDIDATES
  );
  metrics.POBFEM = getPropertyByCandidates(
    properties,
    POPULATION_FEMALE_FIELD_CANDIDATES
  );
  metrics.POBMAS = getPropertyByCandidates(
    properties,
    POPULATION_MALE_FIELD_CANDIDATES
  );
  metrics.POB0_14 = toNumber(properties.POB0_14);
  metrics.POB15_64 = toNumber(properties.POB15_64);
  metrics.POB65_MAS = toNumber(properties.POB65_MAS);
  metrics.PSINDER = toNumber(properties.PSINDER);
  metrics.TOTHOG = toNumber(properties.TOTHOG);
  metrics.HOGJEF_F = toNumber(properties.HOGJEF_F);

  const safeTotal = metrics.POBTOT > 0 ? metrics.POBTOT : 0;
  const femaleRatio =
    safeTotal > 0 ? clamp(metrics.POBFEM / safeTotal, 0, 1) : 0.5;
  const maleRatio = 1 - femaleRatio;

  const seniorTotalMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_SENIOR_TOTAL_FIELD_CANDIDATES
  );
  const seniorTotal = Math.max(
    0,
    seniorTotalMeta.found ? seniorTotalMeta.value : metrics.POB65_MAS || 0
  );
  const seniorFemaleMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_SENIOR_FEMALE_FIELD_CANDIDATES
  );
  const seniorMaleMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_SENIOR_MALE_FIELD_CANDIDATES
  );

  let seniorFemale = seniorFemaleMeta.value;
  let seniorMale = seniorMaleMeta.value;

  if (!seniorFemaleMeta.found && !seniorMaleMeta.found) {
    seniorFemale = seniorTotal * femaleRatio;
    seniorMale = seniorTotal * maleRatio;
  } else if (!seniorFemaleMeta.found) {
    seniorFemale = Math.max(0, seniorTotal - seniorMale);
  } else if (!seniorMaleMeta.found) {
    seniorMale = Math.max(0, seniorTotal - seniorFemale);
  }

  const minorTotalMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_MINOR_TOTAL_FIELD_CANDIDATES
  );
  const minorTotalEstimated = metrics.POB0_14 + metrics.POB15_64 * (3 / 50);
  const minorTotal = clamp(
    minorTotalMeta.found ? minorTotalMeta.value : minorTotalEstimated,
    0,
    safeTotal > 0 ? safeTotal : minorTotalEstimated
  );
  const minorFemaleMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_MINOR_FEMALE_FIELD_CANDIDATES
  );
  const minorMaleMeta = getPropertyByCandidatesMeta(
    properties,
    POPULATION_MINOR_MALE_FIELD_CANDIDATES
  );

  let minorFemale = minorFemaleMeta.value;
  let minorMale = minorMaleMeta.value;

  if (!minorFemaleMeta.found && !minorMaleMeta.found) {
    minorFemale = minorTotal * femaleRatio;
    minorMale = minorTotal * maleRatio;
  } else if (!minorFemaleMeta.found) {
    minorFemale = Math.max(0, minorTotal - minorMale);
  } else if (!minorMaleMeta.found) {
    minorMale = Math.max(0, minorTotal - minorFemale);
  }

  metrics.POB60_MAS_F = roundPopulation(seniorFemale);
  metrics.POB60_MAS_M = roundPopulation(seniorMale);
  metrics.POB18_MEN_F = roundPopulation(minorFemale);
  metrics.POB18_MEN_M = roundPopulation(minorMale);

  return metrics;
}

function computeGeometryBBox(geometry) {
  if (!geometry) return null;

  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates || [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat, lng, lat];
  }

  const coordinates = flattenCoordinates(geometry.coordinates);
  if (!coordinates.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  coordinates.forEach(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    minX = Math.min(minX, lng);
    minY = Math.min(minY, lat);
    maxX = Math.max(maxX, lng);
    maxY = Math.max(maxY, lat);
  });

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  return [minX, minY, maxX, maxY];
}

function bboxIntersects(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const [leftMinX, leftMinY, leftMaxX, leftMaxY] = left;
  const [rightMinX, rightMinY, rightMaxX, rightMaxY] = right;

  return !(
    leftMaxX < rightMinX ||
    leftMinX > rightMaxX ||
    leftMaxY < rightMinY ||
    leftMinY > rightMaxY
  );
}

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export class PopulationAnalysisEngine {
  constructor({
    fileCandidates = [],
    gridCellSize = POPULATION_GRID_CELL_SIZE_DEGREES,
  } = {}) {
    this.fileCandidates = fileCandidates;
    this.gridCellSize = gridCellSize;

    this.loadedFilePath = null;
    this.data = null;
    this.memoizedFeatures = null;
    this.featureRecords = null;
    this.gridIndex = null;

    this.loadingPromise = null;
    this.lastQuery = null;
    this.lastResult = null;
  }

  getStatus() {
    return {
      loaded: Boolean(this.data),
      loadedFilePath: this.loadedFilePath,
      featureCount: this.memoizedFeatures?.length || 0,
      indexedFeatureCount: this.featureRecords?.length || 0,
    };
  }

  async buildSpatialIndex(features) {
    const records = [];
    const gridIndex = new Map();

    for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
      if (
        featureIndex > 0 &&
        featureIndex % POPULATION_INDEX_BUILD_YIELD_EVERY === 0
      ) {
        await yieldToEventLoop();
      }

      const feature = features[featureIndex];
      const bbox = computeGeometryBBox(feature?.geometry);
      if (!Array.isArray(bbox) || bbox.some((value) => !Number.isFinite(value))) {
        continue;
      }

      const record = {
        feature,
        bbox,
        metrics: computePopulationMetrics(feature?.properties || {}),
      };
      const recordIndex = records.length;
      records.push(record);

      const [minX, minY, maxX, maxY] = bbox;
      const cellXStart = Math.floor(minX / this.gridCellSize);
      const cellYStart = Math.floor(minY / this.gridCellSize);
      const cellXEnd = Math.floor(maxX / this.gridCellSize);
      const cellYEnd = Math.floor(maxY / this.gridCellSize);

      for (let x = cellXStart; x <= cellXEnd; x += 1) {
        for (let y = cellYStart; y <= cellYEnd; y += 1) {
          const cellKey = `${x}:${y}`;
          if (!gridIndex.has(cellKey)) gridIndex.set(cellKey, []);
          gridIndex.get(cellKey).push(recordIndex);
        }
      }
    }

    this.featureRecords = records;
    this.gridIndex = gridIndex;
  }

  collectCandidateRecords(queryBbox) {
    const records = this.featureRecords || [];
    if (!records.length || !Array.isArray(queryBbox)) return [];
    if (!this.gridIndex || !this.gridIndex.size) return records;

    const [minX, minY, maxX, maxY] = queryBbox;
    const cellXStart = Math.floor(minX / this.gridCellSize);
    const cellYStart = Math.floor(minY / this.gridCellSize);
    const cellXEnd = Math.floor(maxX / this.gridCellSize);
    const cellYEnd = Math.floor(maxY / this.gridCellSize);
    const candidateIndexes = new Set();

    for (let x = cellXStart; x <= cellXEnd; x += 1) {
      for (let y = cellYStart; y <= cellYEnd; y += 1) {
        const cellKey = `${x}:${y}`;
        const bucket = this.gridIndex.get(cellKey);
        if (!bucket) continue;
        bucket.forEach((index) => candidateIndexes.add(index));
      }
    }

    if (!candidateIndexes.size) return [];

    return Array.from(candidateIndexes)
      .map((index) => records[index])
      .filter((record) => bboxIntersects(record.bbox, queryBbox));
  }

  async ensureLoaded() {
    if (this.data) return this.data;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      let lastError = null;

      for (const candidatePath of this.fileCandidates) {
        try {
          const rawBody = await fs.readFile(candidatePath, "utf8");
          const payload = JSON.parse(rawBody);
          if (!Array.isArray(payload?.features)) {
            throw new Error("GeoJSON inválido (features faltantes).");
          }

          this.data = payload;
          this.loadedFilePath = candidatePath;
          this.memoizedFeatures = payload.features
            .map(normalizeFeature)
            .filter(Boolean);

          await this.buildSpatialIndex(this.memoizedFeatures);
          return payload;
        } catch (error) {
          lastError = error;
        }
      }

      throw (
        lastError ||
        new Error("No se pudo cargar ningún archivo de población INEGI.")
      );
    })().finally(() => {
      this.loadingPromise = null;
    });

    return this.loadingPromise;
  }

  async queryRadius({
    lat,
    lng,
    radiusKm,
    maxRenderFeatures = MAX_POPULATION_RENDER_FEATURES_DEFAULT,
  }) {
    await this.ensureLoaded();

    const safeLat = Number(lat);
    const safeLng = Number(lng);
    const safeRadiusKm = Number(radiusKm);
    const safeMaxRender = Math.max(0, Number(maxRenderFeatures) || 0);

    if (
      !Number.isFinite(safeLat) ||
      !Number.isFinite(safeLng) ||
      !Number.isFinite(safeRadiusKm) ||
      safeRadiusKm <= 0
    ) {
      throw new Error("Parámetros inválidos para análisis de población.");
    }

    const queryKey = `${safeLat.toFixed(6)}:${safeLng.toFixed(6)}:${safeRadiusKm.toFixed(6)}:${safeMaxRender}`;
    if (this.lastQuery === queryKey && this.lastResult) {
      return this.lastResult;
    }

    const centerPoint = turf.point([safeLng, safeLat]);
    const buffer = turf.buffer(centerPoint, safeRadiusKm, {
      units: "kilometers",
    });
    const bufferBbox = turf.bbox(buffer);
    const candidateRecords = this.collectCandidateRecords(bufferBbox);

    const totals = {
      center: { lat: safeLat, lng: safeLng },
      featureCount: 0,
      featuresCount: 0,
      radiusKm: safeRadiusKm,
      sampledAreaKm2: Math.PI * safeRadiusKm * safeRadiusKm,
      ...createZeroTotals(),
    };

    const matchedFeatures = [];

    for (
      let recordIndex = 0;
      recordIndex < candidateRecords.length;
      recordIndex += 1
    ) {
      if (
        recordIndex > 0 &&
        recordIndex % POPULATION_QUERY_YIELD_EVERY === 0
      ) {
        await yieldToEventLoop();
      }

      const record = candidateRecords[recordIndex];
      let intersects = false;

      try {
        intersects = turf.booleanIntersects(record.feature, buffer);
      } catch {
        intersects = false;
      }

      if (!intersects) continue;

      totals.featureCount += 1;
      totals.featuresCount += 1;

      if (matchedFeatures.length < safeMaxRender) {
        matchedFeatures.push(record.feature);
      }

      POPULATION_NUMERIC_FIELDS.forEach((field) => {
        totals[field] += toNumber(record.metrics?.[field]);
      });
    }

    totals.total = totals.POBTOT;
    totals.elementos = totals.featureCount;
    totals.renderFeatureCount = matchedFeatures.length;
    totals.renderTruncated = totals.featureCount > matchedFeatures.length;
    totals.collection = {
      type: "FeatureCollection",
      features: matchedFeatures,
    };
    totals.source = "backend";

    this.lastQuery = queryKey;
    this.lastResult = totals;
    return totals;
  }
}

export function buildPopulationFileCandidates({
  rootDir,
  backendDir,
  explicitPath,
}) {
  const candidates = [];

  if (explicitPath) {
    candidates.push(path.resolve(explicitPath));
  }

  candidates.push(
    path.resolve(rootDir, "inegi_poblacion_cdmx.geojson"),
    path.resolve(rootDir, "frontend/public/data/inegi_poblacion_cdmx.geojson"),
    path.resolve(rootDir, "frontend/public/inegi_poblacion_cdmx.geojson"),
    path.resolve(backendDir, "../inegi_poblacion_cdmx.geojson")
  );

  return Array.from(new Set(candidates));
}
