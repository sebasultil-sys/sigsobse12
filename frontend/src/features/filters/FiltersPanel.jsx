import { useGISWorkspace } from '../../app/GISWorkspaceContext';

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
            Filtra la vista operativa por dirección general, programa, alcaldía
            y nombre de obra.
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
          label="DG"
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
        <label className="data-filter">
          <span className="field-label">Búsqueda de obra</span>
          <input
            onChange={(event) =>
              actions.updateDataFilter('obra', event.target.value)
            }
            placeholder="Buscar frente, obra o programa"
            type="search"
            value={dataFilters.obra}
          />
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
