import { useGISWorkspace } from '../../app/GISWorkspaceContext';

function MobileInfoPanel() {
  const {
    activeBaseMap,
    drawItems,
    filteredFeatureCount,
    measurement,
    selectedFeature,
    visibleLayerCount,
  } = useGISWorkspace();

  return (
    <div className="mobile-panel">
      <div className="mobile-panel__stats">
        <div className="mini-card">
          <span className="mini-card__label">Capas visibles</span>
          <span className="mini-card__value">{visibleLayerCount}</span>
        </div>
        <div className="mini-card">
          <span className="mini-card__label">Registros</span>
          <span className="mini-card__value">{filteredFeatureCount}</span>
        </div>
        <div className="mini-card">
          <span className="mini-card__label">Dibujos</span>
          <span className="mini-card__value">{drawItems.length}</span>
        </div>
        <div className="mini-card">
          <span className="mini-card__label">Base map</span>
          <span className="mini-card__value">{activeBaseMap.name}</span>
        </div>
      </div>

      <div className="mobile-info-card">
        <strong>Resumen operativo</strong>
        <p>
          {selectedFeature
            ? `Seleccionaste ${
                selectedFeature.properties?.OBRA || selectedFeature.layerName
              }.`
            : 'No hay obra seleccionada por ahora.'}
        </p>
        <p>
          {measurement.summary
            ? `La última medición registrada es ${measurement.summary}.`
            : 'No hay una medición activa.'}
        </p>
      </div>
    </div>
  );
}

export default MobileInfoPanel;
