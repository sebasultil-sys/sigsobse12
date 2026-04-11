import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const INTERNAL_PREFIX = '__';

function AttributeTableSheet() {
  const { layers, selectedLayerId } = useGISWorkspace();
  const [filter, setFilter] = React.useState('');
  const [visibleCols, setVisibleCols] = React.useState(null);
  const [showColPicker, setShowColPicker] = React.useState(false);

  const layer = React.useMemo(
    () => layers.find((l) => l.id === selectedLayerId) || null,
    [layers, selectedLayerId]
  );

  const features = React.useMemo(
    () => layer?.data?.features ?? [],
    [layer]
  );

  const allColumns = React.useMemo(() => {
    const keys = new Set();
    features.forEach((f) => {
      Object.keys(f.properties || {}).forEach((k) => {
        if (!k.startsWith(INTERNAL_PREFIX)) keys.add(k);
      });
    });
    return Array.from(keys);
  }, [features]);

  // Initialise visible columns once columns are known
  React.useEffect(() => {
    setVisibleCols(null);
  }, [selectedLayerId]);

  React.useEffect(() => {
    if (allColumns.length > 0 && visibleCols === null) {
      setVisibleCols(new Set(allColumns));
    }
  }, [allColumns, visibleCols]);

  const shownCols = React.useMemo(
    () => (visibleCols ? allColumns.filter((c) => visibleCols.has(c)) : allColumns),
    [allColumns, visibleCols]
  );

  const filteredFeatures = React.useMemo(() => {
    if (!filter.trim()) return features;
    const q = filter.toLowerCase();
    return features.filter((f) =>
      Object.entries(f.properties || {}).some(
        ([k, v]) => !k.startsWith(INTERNAL_PREFIX) && String(v).toLowerCase().includes(q)
      )
    );
  }, [features, filter]);

  const toggleCol = (col) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        if (next.size <= 1) return prev; // keep at least one column
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  };

  if (!layer) {
    return (
      <div className="attrtable-empty">
        <span className="attrtable-empty__icon" aria-hidden="true">📋</span>
        <p>Toca <strong>Ver datos</strong> en una capa para explorar sus atributos.</p>
      </div>
    );
  }

  return (
    <div className="attrtable">
      {/* Header */}
      <div className="attrtable__meta">
        <div>
          <strong>{layer.name}</strong>
          <span>
            {filteredFeatures.length} de {features.length} registros
            {' · '}{shownCols.length} columnas
          </span>
        </div>
        <button
          className={`attrtable__col-btn${showColPicker ? ' is-active' : ''}`}
          onClick={() => setShowColPicker((v) => !v)}
          title="Elegir columnas"
          type="button"
        >
          <svg fill="none" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
          </svg>
          Columnas
        </button>
      </div>

      {/* Column picker */}
      {showColPicker && (
        <div className="attrtable__col-picker">
          {allColumns.map((col) => (
            <button
              className={`attrtable__col-tag${visibleCols?.has(col) ? ' is-on' : ''}`}
              key={col}
              onClick={() => toggleCol(col)}
              type="button"
            >
              {visibleCols?.has(col) ? '✓ ' : ''}{col}
            </button>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="attrtable__filter-row">
        <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 15 15" width="15" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.4" />
          <path d="m13 13-3-3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
        </svg>
        <input
          className="attrtable__filter"
          placeholder="Filtrar registros..."
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button
            className="attrtable__filter-clear"
            onClick={() => setFilter('')}
            type="button"
          >
            ✕
          </button>
        )}
      </div>

      {/* Table */}
      {filteredFeatures.length === 0 ? (
        <p className="attrtable__no-results">Sin resultados para "{filter}"</p>
      ) : (
        <div className="attrtable__scroll">
          <table className="attrtable__table">
            <thead>
              <tr>
                {shownCols.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredFeatures.map((feature, rowIndex) => (
                <tr key={rowIndex}>
                  {shownCols.map((col) => {
                    const val = feature.properties?.[col];
                    const isNum = typeof val === 'number';
                    const isBool = typeof val === 'boolean';
                    return (
                      <td
                        className={isNum ? 'is-num' : isBool ? 'is-bool' : ''}
                        key={col}
                      >
                        {val == null
                          ? <span className="attrtable__null">—</span>
                          : isBool
                            ? <span className={`attrtable__bool${val ? ' is-true' : ''}`}>{val ? 'Sí' : 'No'}</span>
                            : String(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AttributeTableSheet;
