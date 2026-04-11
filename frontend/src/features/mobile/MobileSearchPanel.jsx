import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';

function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const QUICK_TAGS = ['Bacheo', 'Hospital', 'Ciclovía', 'Escuela', 'Utopías', 'Cablebús'];

function MobileSearchPanel({ onClose }) {
  const { layers, mapApi } = useGISWorkspace();
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, []);

  const results = React.useMemo(() => {
    const q = normalize(query);
    if (q.length < 2) return [];

    const matches = [];
    for (const layer of layers) {
      for (const feature of layer.data?.features || []) {
        const p = feature.properties || {};
        const haystack = normalize(
          [p.OBRA, p.ALCALDIA, p.PROGRAMA, p.FRENTE].join(' ')
        );
        if (haystack.includes(q)) {
          matches.push({ feature, layer });
          if (matches.length >= 25) return matches;
        }
      }
    }
    return matches;
  }, [query, layers]);

  const handleSelect = ({ feature, layer }) => {
    mapApi?.zoomToFeatureBounds?.(feature);
    onClose();
  };

  const hasQuery = query.length >= 2;

  return (
    <div className="msearch">
      <div className="msearch__input-row">
        <svg
          aria-hidden="true"
          className="msearch__icon"
          fill="none"
          height="18"
          viewBox="0 0 18 18"
          width="18"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="m16 16-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        </svg>
        <input
          className="msearch__input"
          placeholder="Buscar obra, alcaldía, programa..."
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
        <div className="msearch__start">
          <p className="msearch__hint">Escribe para buscar en todas las capas</p>
          <div className="msearch__tags">
            {QUICK_TAGS.map((tag) => (
              <button
                className="msearch__tag"
                key={tag}
                onClick={() => setQuery(tag)}
                type="button"
              >
                {tag}
              </button>
            ))}
          </div>
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
          {results.map(({ feature, layer }, index) => {
            const p = feature.properties || {};
            const subtitle = [p.ALCALDIA, p.PROGRAMA].filter(Boolean).join(' · ');
            const isRisk = p.RIESGO === true;
            return (
              <button
                className="msearch__result"
                key={index}
                onClick={() => handleSelect({ feature, layer })}
                type="button"
              >
                <span
                  className="msearch__result-dot"
                  style={{ background: layer.style?.color || layer.color }}
                />
                <div className="msearch__result-info">
                  <strong>{p.OBRA || layer.name}</strong>
                  {subtitle && <span>{subtitle}</span>}
                </div>
                <div className="msearch__result-right">
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
