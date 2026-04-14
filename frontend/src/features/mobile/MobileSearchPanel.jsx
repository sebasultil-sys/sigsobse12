import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const SEARCH_LOGO_SRC = process.env.PUBLIC_URL + '/assets/img/nuevologoSinfondo.png';

function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function firstPropertyValue(properties, keys) {
  for (const key of keys) {
    const value = properties?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }

  return null;
}

const FIELD_KEYS = {
  obra: ['OBRA', 'obra', 'NOMBRE_OBRA', 'nombre_obra'],
  plantel: [
    'NOMBRE DEL SITIO INTERVENIDO',
    'NOMBRE DEL SITIO INTERVENIDO ',
    'NOMBRE_SITIO_INTERVENIDO',
    'nombre del sitio intervenido',
    'nombre_sitio_intervenido',
    'PLANTEL',
    'plantel',
    'NOMBRE_PLANTEL',
    'nombre_plantel',
    'NOMBRE DEL PLANTEL',
    'nombre del plantel',
    'NOMBRE_ESCUELA',
    'nombre_escuela',
    'ESCUELA',
    'escuela',
    'FRENTE 1',
    'frente 1',
    'FRENTE1',
    'frente1',
  ],
  direccion: [
    'CALLE',
    'calle',
    'DIRECCION',
    'direccion',
    'DIRECCIÓN',
    'dirección',
    'DOMICILIO',
    'domicilio',
    'UBICACION',
    'ubicacion',
    'UBICACIÓN',
    'ubicación',
    'ENTRE CALLE',
    'ENTRE_CALLE',
    'entre calle',
    'entre_calle',
    'REFERENCIAS',
    'referencias',
  ],
  colonia: ['COLONIA', 'colonia'],
  alcaldia: ['ALCALDIA', 'alcaldia', 'ALCALDÍA', 'alcaldía'],
  programa: ['PROGRAMA', 'programa'],
  dg: ['DG', 'dg', 'DIRECCION GENERAL', 'DIRECCION_GENERAL', 'direccion_general'],
  contrato: ['CONTRATO', 'N_CONTRATO', 'NO_CONTRATO', 'NUM_CONTRATO', 'contrato', 'F_CONTRATO', 'F_CONTRAT'],
  tipo: ['TIPO', 'tipo', 'TIPO_OBRA', 'tipo_obra'],
  frente: ['FRENTE', 'frente'],
};

// Campos indexados con pesos para ranking Google-style
// programa: 5, dg: 4, calle: 3, alcaldia: 2, contrato: 1 (más los pesos de calidad del match)
const SEARCHABLE_FIELDS = [
  { id: 'plantel',  label: 'Plantel',            keys: FIELD_KEYS.plantel,   weight: 9 },
  { id: 'obra',     label: 'Obra',               keys: FIELD_KEYS.obra,      weight: 8 },
  { id: 'programa', label: 'Programa',           keys: FIELD_KEYS.programa,  weight: 5 },
  { id: 'dg',       label: 'Dirección General',  keys: FIELD_KEYS.dg,        weight: 4 },
  { id: 'direccion',label: 'Calle',              keys: FIELD_KEYS.direccion, weight: 3 },
  { id: 'colonia',  label: 'Colonia',            keys: FIELD_KEYS.colonia,   weight: 3 },
  { id: 'alcaldia', label: 'Alcaldía',           keys: FIELD_KEYS.alcaldia,  weight: 2 },
  { id: 'contrato', label: 'Contrato',           keys: FIELD_KEYS.contrato,  weight: 1 },
  { id: 'tipo',     label: 'Tipo',               keys: FIELD_KEYS.tipo,      weight: 1 },
];

const MAX_RESULTS = 25;

function getSearchEntries(properties) {
  return SEARCHABLE_FIELDS.map((field) => ({
    ...field,
    value: firstPropertyValue(properties, field.keys) || '',
  })).filter((field) => field.value);
}

function buildResultTitle(properties) {
  return (
    firstPropertyValue(properties, FIELD_KEYS.obra) ||
    firstPropertyValue(properties, FIELD_KEYS.plantel) ||
    firstPropertyValue(properties, FIELD_KEYS.frente) ||
    firstPropertyValue(properties, FIELD_KEYS.direccion) ||
    firstPropertyValue(properties, FIELD_KEYS.programa) ||
    firstPropertyValue(properties, FIELD_KEYS.tipo) ||
    'Elemento sin nombre'
  );
}

function buildResultSubtitle(properties) {
  const programa = firstPropertyValue(properties, FIELD_KEYS.programa);
  const colonia  = firstPropertyValue(properties, FIELD_KEYS.colonia);
  const alcaldia = firstPropertyValue(properties, FIELD_KEYS.alcaldia);
  const dg       = firstPropertyValue(properties, FIELD_KEYS.dg);

  return [programa, colonia || alcaldia, dg].filter(Boolean).join(' · ');
}

function buildIndexedFeature({ feature, layer }) {
  const properties = feature?.properties || {};
  const searchEntries = getSearchEntries(properties);

  return {
    feature,
    layer,
    properties,
    searchEntries: searchEntries.map((entry) => ({
      ...entry,
      normalizedValue: normalize(entry.value),
    })),
    title: buildResultTitle(properties),
  };
}

function getMatchMeta(indexedItem, normalizedQuery) {
  if (!normalizedQuery) return null;

  const matchedFields = [];
  let score = 0;

  indexedItem.searchEntries.forEach((entry) => {
    const nv = entry.normalizedValue;
    if (!nv || !nv.includes(normalizedQuery)) return;

    matchedFields.push(entry.label);

    // Calidad del match
    if (nv === normalizedQuery)           score += 12;
    else if (nv.startsWith(normalizedQuery)) score += 8;
    else                                  score += 4;

    // Peso del campo (programa=5, dg=4, calle=3, alcaldía=2, contrato=1…)
    score += entry.weight || 0;
  });

  if (!matchedFields.length) return null;

  return {
    matchedFields: [...new Set(matchedFields)],
    score,
  };
}

function getRankedResults(searchIndex, query) {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];

  return searchIndex
    .map((item) => {
      const matchMeta = getMatchMeta(item, normalizedQuery);
      if (!matchMeta) return null;
      return { ...item, ...matchMeta };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.title.localeCompare(right.title, 'es');
    })
    .slice(0, MAX_RESULTS);
}

function MobileSearchPanel({ onClose }) {
  const { actions, filteredLayers, layers, mapApi } = useGISWorkspace();
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef(null);

  // Foco automático al abrir el panel
  React.useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  const filteredFeatureKeys = React.useMemo(() => {
    const keys = new Set();
    filteredLayers.forEach((layer) => {
      (layer.data?.features || []).forEach((feature) => {
        const featureKey = feature?.properties?.__featureKey;
        if (featureKey) keys.add(featureKey);
      });
    });
    return keys;
  }, [filteredLayers]);

  // BUG-07: indexar solo capas con datos cargados
  const searchIndex = React.useMemo(
    () =>
      layers
        .filter((layer) => (layer.data?.features?.length || 0) > 0)
        .flatMap((layer) =>
          (layer.data?.features || []).map((feature) =>
            buildIndexedFeature({ feature, layer })
          )
        ),
    [layers]
  );

  // Búsqueda libre en todos los campos — sin scope
  const results = React.useMemo(
    () => getRankedResults(searchIndex, query),
    [query, searchIndex]
  );

  const handleSelect = ({ feature, layer }) => {
    const featureKey = feature?.properties?.__featureKey || null;
    const isOutsideFilteredScope =
      featureKey && !filteredFeatureKeys.has(featureKey);

    if (isOutsideFilteredScope) {
      actions.clearDataFilters();
    }

    if (!layer.visible) {
      actions.toggleLayerVisibility(layer.id);
    }

    const selectionPayload = {
      feature,
      layerId: layer.id,
      layerName: buildResultTitle(feature?.properties || {}),
      properties: feature?.properties || {},
    };

    actions.setInteractionMode('select');
    actions.focusLayer(layer.id);
    onClose();

    window.setTimeout(() => {
      actions.setSelectedFeature(selectionPayload);
      mapApi?.invalidateSize?.();
      mapApi?.zoomToFeatureBounds?.(feature);
    }, 140);
  };

  const hasQuery = normalize(query).length >= 2;

  return (
    <div className="msearch">
      <div className="msearch__input-row search-container">
        <img
          alt="Logo institucional"
          className="search-logo"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
          src={SEARCH_LOGO_SRC}
        />
        <input
          autoComplete="off"
          className="msearch__input search-input"
          placeholder="Buscar obras, colonias, programas..."
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            aria-label="Limpiar"
            className="msearch__clear"
            onClick={() => setQuery('')}
            type="button"
          >
            <svg fill="none" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4 4 12M4 4l8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
            </svg>
          </button>
        )}
      </div>

      {!hasQuery && (
        <div className="msearch__start msearch__start--pick">
          <span className="msearch__pick-icon">🔍</span>
          <p className="msearch__hint msearch__hint--bold">
            Busca en todos los campos
          </p>
          <p className="msearch__hint">
            Programa · Dirección General · Calle · Alcaldía · Contrato
          </p>
        </div>
      )}

      {hasQuery && results.length === 0 && (
        <div className="msearch__empty">
          <span>Sin resultados para</span>
          <strong>"{query}"</strong>
        </div>
      )}

      {results.length > 0 && (
        <div className="msearch__results">
          <span className="msearch__count">
            {results.length} resultado{results.length !== 1 ? 's' : ''}
          </span>
          {results.map(({ feature, layer, matchedFields, properties, title }) => {
            const subtitle = buildResultSubtitle(properties);
            const isRisk = properties.RIESGO === true;
            // BUG-04: clave estable basada en layer + featureKey
            const resultKey = `${layer.id}-${feature?.properties?.__featureKey || title}`;
            return (
              <button
                className="msearch__result"
                key={resultKey}
                onClick={() => handleSelect({ feature, layer })}
                type="button"
              >
                <span
                  className="msearch__result-dot"
                  style={{ background: layer.style?.color || layer.color }}
                />
                <div className="msearch__result-info">
                  <strong>{title}</strong>
                  {subtitle && <span>{subtitle}</span>}
                </div>
                <div className="msearch__result-right">
                  {matchedFields.length > 0 && (
                    <span className="msearch__group-badge">
                      {matchedFields[0]}
                    </span>
                  )}
                  {isRisk && <span className="msearch__risk-badge">Riesgo</span>}
                  <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
                    <path d="m6 4 4 4-4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MobileSearchPanel;
