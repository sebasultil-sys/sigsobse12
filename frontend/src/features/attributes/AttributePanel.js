function AttributePanel({ selectedLayer }) {
  const featureCount =
    selectedLayer && selectedLayer.data && Array.isArray(selectedLayer.data.features)
      ? selectedLayer.data.features.length
      : 0;
  const firstFeature = selectedLayer?.data?.features?.[0] || null;
  const propertyEntries = Object.entries(firstFeature?.properties || {}).slice(0, 6);

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2 className="panel-card__title">Atributos</h2>
          <div className="panel-card__meta">
            Tabla lista para conectarse cuando exista la primera capa real.
          </div>
        </div>
      </div>

      <div className="panel-card__body">
        {!selectedLayer ? (
          <div className="empty-state">
            <h3 className="empty-state__title">Sin selección activa</h3>
            <p className="empty-state__text">
              La tabla de atributos quedó vacía a propósito. Se activa cuando
              conectemos capas nuevas y una selección real de features.
            </p>
          </div>
        ) : (
          <div className="attribute-panel__content">
            <div className="attribute-panel__grid">
              <div className="mini-card">
                <span className="mini-card__label">Capa activa</span>
                <span className="mini-card__value">{selectedLayer.name}</span>
              </div>
              <div className="mini-card">
                <span className="mini-card__label">Features</span>
                <span className="mini-card__value">{featureCount}</span>
              </div>
              <div className="mini-card">
                <span className="mini-card__label">Geometría</span>
                <span className="mini-card__value">
                  {selectedLayer.geometryType}
                </span>
              </div>
            </div>

            <div className="attribute-table">
              <div className="attribute-table__header">
                <strong>Vista previa de atributos</strong>
                <span>
                  Primer feature disponible de la capa seleccionada.
                </span>
              </div>

              {propertyEntries.length === 0 ? (
                <div className="attribute-table__empty">
                  Esta capa no trae propiedades visibles.
                </div>
              ) : (
                <table>
                  <tbody>
                    {propertyEntries.map(([key, value]) => (
                      <tr key={key}>
                        <th>{key}</th>
                        <td>{String(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default AttributePanel;
