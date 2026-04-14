import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const SEARCH_LOGO_SRC = '/files/web/assets/img/corazon-snfondo.png';

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
  contrato: ['CONTRATO', 'N_CONTRATO', 'NO_CONTRATO', 'NUM_CONTRATO', 'contrato', 'F_CONTRATO', 'F_CONTRAT'],
  tipo: ['TIPO', 'tipo', 'TIPO_OBRA', 'tipo_obra'],
  frente: ['FRENTE', 'frente'],
};

const SEARCH_SCOPES = [
  { id: 'plantel', label: 'Plantel', keys: FIELD_KEYS.plantel },
  { id: 'colonia', label: 'Colonia', keys: FIELD_KEYS.colonia },
  { id: 'programa', label: 'Programa', keys: FIELD_KEYS.programa },
  { id: 'contrato', label: 'Contrato', keys: FIELD_KEYS.contrato },
  { id: 'direccion', label: 'Dirección', keys: FIELD_KEYS.direccion },
];
const MAX_RESULTS = 25;
const SUGGESTION_LIMIT_BY_SCOPE = {
  plantel: 7,
  colonia: 7,
  programa: 7,
  contrato: 5,
  direccion: 5,
};

const SEARCHABLE_FIELDS = [
  { id: 'plantel', label: 'Plantel', keys: FIELD_KEYS.plantel, weight: 9 },
  { id: 'obra', label: 'Obra', keys: FIELD_KEYS.obra, weight: 8 },
  { id: 'contrato', label: 'Contrato', keys: FIELD_KEYS.contrato, weight: 7 },
  { id: 'direccion', label: 'Dirección', keys: FIELD_KEYS.direccion, weight: 6 },
  { id: 'colonia', label: 'Colonia', keys: FIELD_KEYS.colonia, weight: 6 },
  { id: 'alcaldia', label: 'Alcaldía', keys: FIELD_KEYS.alcaldia, weight: 5 },
  { id: 'programa', label: 'Programa', keys: FIELD_KEYS.programa, weight: 5 },
  { id: 'tipo', label: 'Tipo', keys: FIELD_KEYS.tipo, weight: 4 },
];

function getSearchEntries(properties) {
  return SEARCHABLE_FIELDS.map((field) => {
    return {
      ...field,
      value: firstPropertyValue(properties, field.keys) || '',
    };
  }).filter((field) => field.value);
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

function buildResultSubtitle(properties, activeScope) {
  const plantel = firstPropertyValue(properties, FIELD_KEYS.plantel);
  const direccion = firstPropertyValue(properties, FIELD_KEYS.direccion);
  const colonia = firstPropertyValue(properties, FIELD_KEYS.colonia);
  const alcaldia = firstPropertyValue(properties, FIELD_KEYS.alcaldia);
  const programa = firstPropertyValue(properties, FIELD_KEYS.programa);

  if (activeScope === 'direccion') {
    return [direccion, colonia || alcaldia, programa].filter(Boolean).join(' · ');
  }

  if (activeScope === 'colonia') {
    return [colonia || alcaldia, direccion || plantel, programa]
      .filter(Boolean)
      .join(' · ');
  }

  return [programa, plantel || colonia || alcaldia, direccion]
    .filter(Boolean)
    .join(' · ');
}

function buildResultGroup(properties, activeScope) {
  const obra = firstPropertyValue(properties, FIELD_KEYS.obra);
  const plantel = firstPropertyValue(properties, FIELD_KEYS.plantel);
  const colonia = firstPropertyValue(properties, FIELD_KEYS.colonia);
  const programa = firstPropertyValue(properties, FIELD_KEYS.programa);

  if (activeScope === 'colonia' && colonia) {
    return {
      id: 'colonia',
      label: 'Colonia',
      value: colonia,
    };
  }

  if (activeScope === 'programa' && programa) {
    return {
      id: 'programa',
      label: 'Programa',
      value: programa,
    };
  }

  if (obra || plantel) {
    return {
      id: 'plantel',
      label: obra ? 'Obra' : 'Plantel',
      value: obra || plantel,
    };
  }

  if (colonia) {
    return {
      id: 'colonia',
      label: 'Colonia',
      value: colonia,
    };
  }

  if (programa) {
    return {
      id: 'programa',
      label: 'Programa',
      value: programa,
    };
  }

  return {
    id: 'resultado',
    label: 'Resultado',
    value: buildResultTitle(properties),
  };
}

function buildResultGroupKey(properties, activeScope) {
  const group = buildResultGroup(properties, activeScope);
  const colonia = firstPropertyValue(properties, FIELD_KEYS.colonia);
  const programa = firstPropertyValue(properties, FIELD_KEYS.programa);
  const direccion = firstPropertyValue(properties, FIELD_KEYS.direccion);

  if (group.id === 'colonia') {
    return [group.id, normalize(group.value), normalize(programa)].join('|');
  }

  if (group.id === 'programa') {
    return [group.id, normalize(group.value), normalize(colonia)].join('|');
  }

  if (group.id === 'plantel') {
    return [
      group.id,
      normalize(group.value),
      normalize(colonia),
      normalize(programa),
    ].join('|');
  }

  return [group.id, normalize(group.value), normalize(direccion)].join('|');
}

function getScopeById(scopeId) {
  return SEARCH_SCOPES.find((scope) => scope.id === scopeId) || null;
}

function getScopeSuggestions(searchIndex, activeScope, query) {
  const normalizedQuery = normalize(query);
  const suggestionLimit = SUGGESTION_LIMIT_BY_SCOPE[activeScope] || 5;
  const buckets = new Map();

  searchIndex.forEach((item) => {
    const scopedEntry = item.searchEntries.find((entry) => entry.id === activeScope);
    if (!scopedEntry?.value || !scopedEntry.normalizedValue) return;

    if (
      normalizedQuery &&
      !scopedEntry.normalizedValue.includes(normalizedQuery)
    ) {
      return;
    }

    const bucketKey = scopedEntry.normalizedValue;
    const current = buckets.get(bucketKey);

    if (!current) {
      buckets.set(bucketKey, {
        label: scopedEntry.value,
        normalizedLabel: scopedEntry.normalizedValue,
        count: 1,
      });
      return;
    }

    current.count += 1;
    if (String(scopedEntry.value).length < String(current.label).length) {
      current.label = scopedEntry.value;
    }
  });

  return Array.from(buckets.values())
    .sort((left, right) => {
      const leftExact = left.normalizedLabel === normalizedQuery;
      const rightExact = right.normalizedLabel === normalizedQuery;
      if (leftExact !== rightExact) return rightExact ? 1 : -1;

      const leftPrefix = normalizedQuery && left.normalizedLabel.startsWith(normalizedQuery);
      const rightPrefix = normalizedQuery && right.normalizedLabel.startsWith(normalizedQuery);
      if (leftPrefix !== rightPrefix) return rightPrefix ? 1 : -1;

      if (right.count !== left.count) return right.count - left.count;
      return String(left.label).localeCompare(String(right.label), 'es');
    })
    .slice(0, suggestionLimit);
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

function getMatchMeta(indexedItem, query, activeScope) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return null;

  const matchedFields = [];
  let score = 0;

  indexedItem.searchEntries.forEach((entry) => {
    const normalizedValue = entry.normalizedValue;
    if (!normalizedValue || !normalizedValue.includes(normalizedQuery)) return;

    matchedFields.push(entry.label);
    if (normalizedValue === normalizedQuery) score += 12;
    else if (normalizedValue.startsWith(normalizedQuery)) score += 8;
    else score += 4;

    score += entry.weight || 0;

    if (entry.id === activeScope) {
      score += 6;
    }
  });

  if (!matchedFields.length) return null;

  return {
    matchedFields: [...new Set(matchedFields)],
    score,
  };
}

function getRankedResults(searchIndex, query, activeScope, options = {}) {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];

  return searchIndex
    .map((item) => {
      const matchMeta = getMatchMeta(item, normalizedQuery, activeScope);
      if (!matchMeta) return null;

      const scopedEntry = item.searchEntries.find((entry) => entry.id === activeScope);
      let scopeScore = 0;

      if (scopedEntry?.normalizedValue === normalizedQuery) scopeScore = 14;
      else if (scopedEntry?.normalizedValue?.startsWith(normalizedQuery)) scopeScore = 8;
      else if (scopedEntry?.normalizedValue?.includes(normalizedQuery)) scopeScore = 4;

      if (options.scopeOnly && scopeScore === 0) {
        return null;
      }

      return {
        ...item,
        ...matchMeta,
        score: matchMeta.score + scopeScore,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;

      return left.title.localeCompare(right.title, 'es');
    })
    .slice(0, options.limit || MAX_RESULTS);
}

function groupRankedResults(results, activeScope) {
  const grouped = new Map();

  results.forEach((item) => {
    const group = buildResultGroup(item.properties, activeScope);
    const groupKey = buildResultGroupKey(item.properties, activeScope);
    const current = grouped.get(groupKey);

    if (!current) {
      grouped.set(groupKey, {
        ...item,
        group,
        groupedCount: 1,
      });
      return;
    }

    current.groupedCount += 1;

    if (item.score > current.score) {
      grouped.set(groupKey, {
        ...item,
        group,
        groupedCount: current.groupedCount,
      });
    }
  });

  return Array.from(grouped.values())
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.title.localeCompare(right.title, 'es');
    })
    .slice(0, MAX_RESULTS);
}

function MobileSearchPanel({ onClose }) {
  const { actions, filteredLayers, layers, mapApi } = useGISWorkspace();
  const [query, setQuery] = React.useState('');
  const [activeScope, setActiveScope] = React.useState(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (activeScope) {
      const timer = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [activeScope]);

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

  // BUG-07: indexar solo capas que ya tienen datos cargados para evitar
  // flatMap sobre capas vacías (capas de BD pendientes de carga).
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
  const scopeSuggestions = React.useMemo(
    () => getScopeSuggestions(searchIndex, activeScope, query),
    [activeScope, query, searchIndex]
  );

  const rawResults = React.useMemo(
    () =>
      activeScope
        ? getRankedResults(searchIndex, query, activeScope, { scopeOnly: true })
        : [],
    [activeScope, query, searchIndex]
  );
  const results = React.useMemo(
    () => groupRankedResults(rawResults, activeScope),
    [activeScope, rawResults]
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

  const handleSuggestionSelect = (suggestionLabel) => {
    const nextQuery = String(suggestionLabel || '').trim();
    if (!nextQuery) return;

    setQuery(nextQuery);
    inputRef.current?.blur();
  };

  const hasQuery = normalize(query).length >= 2;
  const activeScopeConfig = getScopeById(activeScope);
  const placeholder = activeScope === null
    ? 'Selecciona un tipo de búsqueda ↓'
    : `Buscar por ${activeScopeConfig.label.toLowerCase()}...`;

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
          className={`msearch__input search-input${activeScope === null ? ' is-locked' : ''}`}
          disabled={activeScope === null}
          placeholder={placeholder}
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

      <div className="msearch__tags">
        {SEARCH_SCOPES.map((scope) => (
          <button
            aria-pressed={activeScope === scope.id}
            className={`msearch__tag${
              activeScope === scope.id ? ' is-active' : ''
            }`}
            key={scope.id}
            onClick={() => {
              if (activeScope !== scope.id) setQuery('');
              setActiveScope(scope.id);
            }}
            type="button"
          >
            {scope.label}
          </button>
        ))}
      </div>

      {scopeSuggestions.length > 0 && (
        <div className="msearch__suggestions">
          <div className="msearch__suggestions-head">
            <span className="msearch__suggestions-title">
              {`Sugerencias de ${activeScopeConfig?.label || 'búsqueda'}`}
            </span>
            <span className="msearch__suggestions-count">
              {scopeSuggestions.length}
            </span>
          </div>

          <div className="msearch__suggestions-list">
            {scopeSuggestions.map((suggestion) => (
              <button
                className="msearch__suggestion"
                key={suggestion.normalizedLabel}
                onClick={() => handleSuggestionSelect(suggestion.label)}
                type="button"
              >
                <span className="msearch__suggestion-label">
                  {suggestion.label}
                </span>
                <span className="msearch__suggestion-count">
                  {suggestion.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeScope === null && (
        <div className="msearch__start msearch__start--pick">
          <span className="msearch__pick-icon">🔍</span>
          <p className="msearch__hint msearch__hint--bold">
            Elige un tipo para comenzar
          </p>
          <p className="msearch__hint">
            Plantel · Colonia · Programa · Contrato · Dirección
          </p>
        </div>
      )}

      {activeScope !== null && !hasQuery && scopeSuggestions.length === 0 && (
        <div className="msearch__start">
          <p className="msearch__hint">
            Escribe para buscar por {activeScopeConfig?.label?.toLowerCase() || 'campo'}
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
          <span className="msearch__count">{results.length} resultado{results.length !== 1 ? 's' : ''}</span>
          {results.map(({ feature, group, groupedCount, layer, properties, title }) => {
            const subtitle = buildResultSubtitle(properties, activeScope);
            const isRisk = properties.RIESGO === true;
            // BUG-04: clave estable basada en layer + featureKey para evitar
            // re-render incorrecto cuando la lista de resultados cambia de orden.
            const resultKey = `${layer.id}-${feature?.properties?.__featureKey || group.value || title}`;
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
                  <span className="msearch__group-badge">
                    {group.label}
                    {groupedCount > 1 ? ` · ${groupedCount}` : ''}
                  </span>
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
