// DebugPanel — herramienta de diagnóstico de datos GIS.
// SOLO se muestra en desarrollo (NODE_ENV !== 'production').
// Muestra distribución de features por DG, features sin DG y
// capas con nombre de DG inesperado para detectar inconsistencias
// entre el frontend y la base de datos.

import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const DG_KEYS = [
  'dg', 'DG',
  'direccion_general', 'DIRECCION_GENERAL',
  'DIRECCION GENERAL', 'direccion general',
];

function readFeatureDg(properties) {
  for (const key of DG_KEYS) {
    const v = properties?.[key];
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      return String(v).trim().toUpperCase();
    }
  }
  return null;
}

function DebugPanel() {
  const [open, setOpen] = React.useState(false);
  const { layers } = useGISWorkspace();

  // Solo en desarrollo
  if (process.env.NODE_ENV === 'production') return null;

  const loadedLayers = layers.filter((l) => (l.data?.features?.length || 0) > 0);
  const allFeatures  = loadedLayers.flatMap((l) => l.data?.features || []);

  // Distribución por valor RAW de DG (antes de normalizar) para detectar inconsistencias
  const dgDistribution = {};
  let noDgCount = 0;

  allFeatures.forEach((feature) => {
    const raw = readFeatureDg(feature.properties);
    if (!raw) {
      noDgCount++;
    } else {
      dgDistribution[raw] = (dgDistribution[raw] || 0) + 1;
    }
  });

  const dgEntries = Object.entries(dgDistribution).sort((a, b) => b[1] - a[1]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 12,
        zIndex: 9999,
        fontFamily: 'monospace',
        fontSize: 11,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: '#111',
          color: '#0f0',
          border: '1px solid #0f0',
          borderRadius: 6,
          padding: '4px 10px',
          cursor: 'pointer',
          fontSize: 11,
        }}
        type="button"
      >
        {open ? '▼ DEBUG GIS' : '▶ DEBUG GIS'}
      </button>

      {open && (
        <div
          style={{
            marginTop: 4,
            background: '#111',
            color: '#eee',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 12,
            width: 280,
            maxHeight: 400,
            overflowY: 'auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ color: '#0f0', fontWeight: 'bold', marginBottom: 8 }}>
            🧠 DEBUG GIS
          </div>

          <div>📦 Capas cargadas: <b>{loadedLayers.length}</b> / {layers.length}</div>
          <div>🗺 Total features: <b>{allFeatures.length}</b></div>

          <hr style={{ border: '1px solid #333', margin: '8px 0' }} />

          <div style={{ color: '#aaa', marginBottom: 4 }}>
            Distribución por DG (valor RAW en BD):
          </div>

          {dgEntries.length === 0 && (
            <div style={{ color: '#f80' }}>⚠️ Sin features cargados</div>
          )}

          {dgEntries.map(([dg, count]) => (
            <div key={dg} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
              <span>{dg}</span>
              <span style={{ color: '#0f0' }}>{count}</span>
            </div>
          ))}

          {noDgCount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f44' }}>
              <span>⚠️ Sin DG</span>
              <span>{noDgCount}</span>
            </div>
          )}

          <hr style={{ border: '1px solid #333', margin: '8px 0' }} />

          <div style={{ color: '#aaa', marginBottom: 4 }}>
            DG por capa (layer.dg):
          </div>
          {loadedLayers.slice(0, 12).map((layer) => (
            <div
              key={layer.id}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: 10 }}
            >
              <span style={{ color: '#888', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {layer.name}
              </span>
              <span style={{ color: '#f0a', flexShrink: 0 }}>{layer.dg || '—'}</span>
            </div>
          ))}
          {loadedLayers.length > 12 && (
            <div style={{ color: '#555', fontSize: 10 }}>… {loadedLayers.length - 12} más</div>
          )}
        </div>
      )}
    </div>
  );
}

export default DebugPanel;
