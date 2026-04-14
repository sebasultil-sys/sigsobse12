import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const SEARCH_LOGO_SRC = process.env.PUBLIC_URL + '/assets/img/nuevologoSinfondo.png';

function FilterSelect({ label, options, value, onChange }) {
  return (
    <label className="data-filter">
      <span className="field-label">{label}</span>
      <select value={value} onChange={onChange}>
        <option value="all">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function FiltersPanel() {
  const {
    actions,
    dataFilters,
    filterOptions,
    filteredFeatureCount,
    filteredLayers,
    selectedFeature,
  } = useGISWorkspace();

  const selectedProperties = selectedFeature?.properties || null;

  return (
    <section className="filters-panel">
      <div className="filters-panel__header">
        <div>
          <h3 className="filters-panel__title">Filtros y datos</h3>
          <p className="filters-panel__subtitle">
            Filtra por dirección general y programa, y busca por plantel,
            dirección, colonia, alcaldía o programa.
          </p>
        </div>
        <button
          className="ghost-button ghost-button--small"
          onClick={actions.clearDataFilters}
          type="button"
        >
          Limpiar filtros
        </button>
      </div>

      <div className="filters-panel__grid">
        <FilterSelect
          label="Dirección"
          onChange={(event) =>
            actions.updateDataFilter('dg', event.target.value)
          }
          options={filterOptions.dg}
          value={dataFilters.dg}
        />
        <FilterSelect
          label="Programa"
          onChange={(event) =>
            actions.updateDataFilter('programa', event.target.value)
          }
          options={filterOptions.programa}
          value={dataFilters.programa}
        />
        <FilterSelect
          label="Alcaldía"
          onChange={(event) =>
            actions.updateDataFilter('alcaldia', event.target.value)
          }
          options={filterOptions.alcaldia}
          value={dataFilters.alcaldia}
        />
        <label className="data-filter data-filter--search">
          <span className="field-label">Búsqueda</span>
          <div className="search-container search-container--filter">
            <img
              alt="Logo institucional"
              className="search-logo"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
              src={SEARCH_LOGO_SRC}
            />
            <input
              className="search-input"
              onChange={(event) =>
                actions.updateDataFilter('obra', event.target.value)
              }
              placeholder="Buscar plantel, dirección, colonia, alcaldía o programa"
              type="search"
              value={dataFilters.obra}
            />
          </div>
        </label>
      </div>

      <div className="filters-panel__stats">
        <div className="mini-card">
          <span className="mini-card__label">Capas con resultado</span>
          <span className="mini-card__value">{filteredLayers.length}</span>
        </div>
        <div className="mini-card">
          <span className="mini-card__label">Features visibles</span>
          <span className="mini-card__value">{filteredFeatureCount}</span>
        </div>
      </div>

      <div className="filters-panel__selection">
        <div className="filters-panel__selection-header">
          <strong>Detalle</strong>
          <span>
            {selectedFeature
              ? 'Detalle del elemento seleccionado en el mapa.'
              : 'Selecciona una obra o elemento en el mapa.'}
          </span>
        </div>

        {!selectedProperties ? (
          <div className="attribute-table__empty">
            No hay una obra seleccionada todavía.
          </div>
        ) : (
          <table className="feature-sheet">
            <tbody>
              {[
                ['Obra', selectedProperties.OBRA],
                ['Programa', selectedProperties.PROGRAMA],
                ['DG', selectedProperties.DG],
                ['Alcaldía', selectedProperties.ALCALDIA],
                ['Frente', selectedProperties.FRENTE],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td>{String(value)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default FiltersPanel;
