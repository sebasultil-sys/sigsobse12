import { GISWorkspaceProvider, useGISWorkspace } from './GISWorkspaceContext';
import WorkspaceHeader from '../features/layout/WorkspaceHeader';
import LayersPanel from '../features/layers/LayersPanel';
import MapView from '../features/map/MapView';
import MobileMode from '../features/mobile/MobileMode';
import Toolbar from '../features/toolbar/Toolbar';

function ViewerWorkspaceLayout() {
  const {
    activeBaseMap,
    filteredFeatureCount,
    isCompactViewport,
    isMobileModeActive,
    layers,
    visibleLayerCount,
  } = useGISWorkspace();

  return (
    <div className={`viewer-shell${isCompactViewport ? ' viewer-shell--compact' : ''}`}>
      {!isMobileModeActive ? (
        <>
          <WorkspaceHeader
            activeBaseMapName={activeBaseMap.name}
            filteredFeatureCount={filteredFeatureCount}
            layerCount={layers.length}
            visibleLayerCount={visibleLayerCount}
          />

          <Toolbar />

          <div className="workspace-grid workspace-grid--gis">
            <LayersPanel />
            <main className="workspace-main workspace-main--map">
              <MapView mode="desktop" />
            </main>
          </div>
        </>
      ) : (
        <MobileMode />
      )}
    </div>
  );
}

function ViewerWorkspace() {
  return (
    <GISWorkspaceProvider>
      <ViewerWorkspaceLayout />
    </GISWorkspaceProvider>
  );
}

export default ViewerWorkspace;
