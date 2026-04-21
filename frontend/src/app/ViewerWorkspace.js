import React from 'react';
import { GISWorkspaceProvider, useGISWorkspace } from './GISWorkspaceContext';
import WorkspaceHeader from '../features/layout/WorkspaceHeader';
import LayersPanel from '../features/layers/LayersPanel';
import MapView from '../features/map/MapView';
import MobileMode from '../features/mobile/MobileMode';
import Toolbar from '../features/toolbar/Toolbar';

function EntryLoader({ message, totalLayers, visible }) {
  return (
    <div className={`entry-loader-overlay${visible ? ' is-visible' : ''}`}>
      <div className="entry-loader-card">
        <div className="entry-loader-spinner" />
        <h2>Cargando visualizador</h2>
        <p>{message}</p>
        <small>
          {Number(totalLayers || 0).toLocaleString('es-MX')} capas en catálogo
        </small>
      </div>
    </div>
  );
}

function ViewerWorkspaceLayout() {
  const {
    activeBaseMap,
    databaseBootstrapReady,
    filteredFeatureCount,
    isCompactViewport,
    isFullstackModeForced,
    isMobileModeActive,
    layers,
    mapApi,
    visibleLayerCount,
  } = useGISWorkspace();
  const databaseLayerCount = layers.filter((layer) => layer.databaseLayer).length;
  const readyToDisplay = databaseBootstrapReady && Boolean(mapApi);
  const loadingMessage = !databaseBootstrapReady
    ? 'Conectando catálogo de capas...'
    : 'Inicializando mapa base...';

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const params = url.searchParams;
    const modeParam = String(params.get('mode') || '').toLowerCase();
    const forceProParam = String(params.get('force_pro') || '').toLowerCase();
    const allowProOnce =
      window.sessionStorage?.getItem('sigsobse_allow_pro_once') === '1';
    const explicitProRequest =
      (forceProParam === '1' || forceProParam === 'true') &&
      (modeParam === 'pro' || modeParam === 'editor') &&
      allowProOnce;

    if (explicitProRequest) {
      // Pro solo cuando se activó explícitamente desde el botón.
      // En siguientes cargas vuelve a principal fullscreen.
      window.sessionStorage?.removeItem('sigsobse_allow_pro_once');
      return;
    }

    window.sessionStorage?.removeItem('sigsobse_allow_pro_once');

    let changed = false;
    if (modeParam !== 'fullstack') {
      params.set('mode', 'fullstack');
      changed = true;
    }
    if (String(params.get('fullstack') || '') !== '1') {
      params.set('fullstack', '1');
      changed = true;
    }
    if (params.has('force_pro')) {
      params.delete('force_pro');
      changed = true;
    }

    if (changed) {
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const switchToPrincipalMode = () => {
    if (typeof window === 'undefined') return;
    window.sessionStorage?.removeItem('sigsobse_allow_pro_once');
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('mode', 'fullstack');
    nextUrl.searchParams.set('fullstack', '1');
    nextUrl.searchParams.delete('force_pro');
    window.location.assign(nextUrl.toString());
  };

  if (!isMobileModeActive && isFullstackModeForced) {
    return (
      <div className="viewer-shell viewer-shell--fullstack">
        <main className="workspace-main workspace-main--map workspace-main--fullstack">
          <MapView mode="desktop" />
        </main>
        <EntryLoader
          message={loadingMessage}
          totalLayers={databaseLayerCount}
          visible={!readyToDisplay}
        />
      </div>
    );
  }

  return (
    <div className={`viewer-shell${isCompactViewport ? ' viewer-shell--compact' : ''}`}>
      {!isMobileModeActive ? (
        <>
          <WorkspaceHeader
            activeBaseMapName={activeBaseMap.name}
            filteredFeatureCount={filteredFeatureCount}
            layerCount={layers.length}
            modeToggleLabel="Vista principal"
            onModeToggle={switchToPrincipalMode}
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
      <EntryLoader
        message={loadingMessage}
        totalLayers={databaseLayerCount}
        visible={!readyToDisplay}
      />
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
