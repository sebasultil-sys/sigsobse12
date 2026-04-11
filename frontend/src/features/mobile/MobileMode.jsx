import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';
import MapView from '../map/MapView';
import BottomNav from './BottomNav';
import BottomSheet from './BottomSheet';
import MobileLayersPanel from './MobileLayersPanel';
import MobileSearchPanel from './MobileSearchPanel';
import MobileDashboardPanel from './MobileDashboardPanel';
import MobileToolsPanel from './MobileToolsPanel';
import MobileMorePanel from './MobileMorePanel';
import MobileFeatureCard from './MobileFeatureCard';
import MobileOnboarding, { shouldShowOnboarding } from './MobileOnboarding';
import AttributeTableSheet from './AttributeTableSheet';

const SHEET_META = {
  layers:    { title: 'Capas',              subtitle: 'Administra la información visible en el mapa' },
  search:    { title: 'Buscar',             subtitle: 'Obras, alcaldías y programas' },
  dashboard: { title: 'Indicadores',        subtitle: 'Avance, riesgos y semaforización' },
  tools:     { title: 'Herramientas',       subtitle: 'Medición, dibujo y análisis espacial' },
  more:      { title: 'Más',               subtitle: 'Leyenda, mapa base y guía de uso' },
  table:     { title: 'Tabla de atributos', subtitle: 'Explora y filtra los datos de la capa' },
};

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 18 18" width="18" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m16 16-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function MobileMode() {
  const [onboardingDone, setOnboardingDone] = React.useState(!shouldShowOnboarding());

  const {
    actions,
    isCompactViewport,
    mapApi,
    mobileModeManual,
    mobileSheet,
    selectedFeature,
  } = useGISWorkspace();
  const showExitButton = mobileModeManual && !isCompactViewport;

  const handleNavSelect = (sheetId) => {
    if (mobileSheet === sheetId) {
      actions.closeMobileSheet();
    } else {
      actions.openMobileSheet(sheetId);
    }
  };

  const meta = SHEET_META[mobileSheet] || { title: '', subtitle: '' };

  React.useEffect(() => {
    if (!mapApi?.invalidateSize) return undefined;

    const timerId = window.setTimeout(() => {
      mapApi.invalidateSize();
    }, 300);

    return () => window.clearTimeout(timerId);
  }, [isCompactViewport, mapApi, mobileSheet]);

  let panelContent = null;
  if (mobileSheet === 'layers')    panelContent = <MobileLayersPanel />;
  if (mobileSheet === 'search')    panelContent = <MobileSearchPanel onClose={actions.closeMobileSheet} />;
  if (mobileSheet === 'dashboard') panelContent = <MobileDashboardPanel />;
  if (mobileSheet === 'tools')     panelContent = <MobileToolsPanel onClose={actions.closeMobileSheet} />;
  if (mobileSheet === 'more')      panelContent = <MobileMorePanel />;
  if (mobileSheet === 'table')     panelContent = <AttributeTableSheet />;

  return (
    <div
      className={`mobile-mode${
        isCompactViewport ? ' is-compact' : ' is-desktop-simulator'
      }`}
    >
      {!isCompactViewport && <div className="mobile-mode__backdrop" />}

      <section className="mobile-mode__device">
        {/* MAP — full screen, behind everything */}
        <div className="mobile-mode__map-shell">
          <MapView mode="mobile" />
        </div>

        {/* TOP BAR — Google Maps style */}
        <header className="mtopbar">
          <div className="mtopbar__brand">
            <span>SIG</span>
            <strong>SOBSE</strong>
          </div>

          {mobileSheet !== 'search' && (
            <button
              className="mtopbar__search"
              onClick={() => handleNavSelect('search')}
              type="button"
            >
              <SearchIcon />
              <span>Buscar obra, alcaldía...</span>
            </button>
          )}

          {showExitButton && (
            <button
              className="mtopbar__exit"
              onClick={actions.exitMobileMode}
              type="button"
            >
              Salir
            </button>
          )}
        </header>

        {/* FEATURE CARD — Airbnb style, floats above bottom nav */}
        {selectedFeature && (
          <div className="mfc-wrap">
            <MobileFeatureCard />
          </div>
        )}

        {/* BOTTOM NAV */}
        <BottomNav activeItem={mobileSheet} onSelect={handleNavSelect} />

        {/* BOTTOM SHEET */}
        <BottomSheet
          isOpen={Boolean(mobileSheet)}
          onClose={actions.closeMobileSheet}
          subtitle={meta.subtitle}
          title={meta.title}
        >
          {panelContent}
        </BottomSheet>

        {/* ONBOARDING — first use */}
        {!onboardingDone && (
          <MobileOnboarding onDone={() => setOnboardingDone(true)} />
        )}
      </section>
    </div>
  );
}

export default MobileMode;
