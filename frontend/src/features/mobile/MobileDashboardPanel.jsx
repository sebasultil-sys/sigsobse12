import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';
import { shouldCountFeature } from '../map/movilidadLayerUtils';

const ANALYSIS_VIEWS = [
  { id: 'general', label: 'General' },
  { id: 'dg', label: 'DG' },
  { id: 'alcaldias', label: 'Alcaldías' },
  { id: 'finanzas', label: 'Finanzas' },
  { id: 'riesgo', label: 'Riesgo' },
];

const ANALYSIS_SCOPES = [
  { id: 'all', label: 'Cargadas' },
  { id: 'visible', label: 'Activas' },
];

// Normaliza un valor de status a una clave canónica (igual que GeoJsonLayer.js).
function resolveStatus(rawValue) {
  if (!rawValue) return null;
  const v = String(rawValue)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (v.includes('entregad')) return 'entregado';
  if (v.includes('terminad') || v.includes('concluid') || v.includes('finaliz')) return 'terminado';
  if (v.includes('proceso') || v.includes('ejecuci') || v.includes('avance')) return 'proceso';
  if (v.includes('sin iniciar') || v.includes('no inici')) return 'sin iniciar';
  return null;
}

const STATUS_ICON_KEYS_LOCAL = ['F_ESTATUS', 'ESTATUS', 'estatus', 'ESTADO', 'estado', 'STATUS', 'status'];

function firstPropertyValue(properties, keys) {
  for (const key of keys) {
    const value = properties?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }

  return null;
}

function parseNumericValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') return null;

  const normalized = value.replace(/[^0-9.-]+/g, '');
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCompactCurrency(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)} mil M`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)} M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)} mil`;

  return value.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
}

function formatInteger(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('es-MX') : '—';
}

function SemaforoBar({ verde, amarillo, rojo }) {
  const total = verde + amarillo + rojo || 1;
  return (
    <div className="sbar">
      <div className="sbar__seg sbar__seg--verde" style={{ width: `${(verde / total) * 100}%` }} />
      <div className="sbar__seg sbar__seg--amarillo" style={{ width: `${(amarillo / total) * 100}%` }} />
      <div className="sbar__seg sbar__seg--rojo" style={{ width: `${(rojo / total) * 100}%` }} />
    </div>
  );
}

function KpiCard({ label, value, variant, note }) {
  return (
    <div className={`exec-kpi${variant ? ` exec-kpi--${variant}` : ''}`}>
      <span className="exec-kpi__label">{label}</span>
      <strong className="exec-kpi__value">{value}</strong>
      {note ? <span className="exec-kpi__note">{note}</span> : null}
    </div>
  );
}

// Tarjeta de conteo por estatus con color específico (proceso/terminado/entregado/sin iniciar)
function StatusKpiCard({ label, value, color }) {
  return (
    <div className="exec-kpi exec-kpi--status" style={{ '--status-color': color }}>
      <div className="exec-kpi__dot" />
      <strong className="exec-kpi__value">{value}</strong>
      <span className="exec-kpi__label">{label}</span>
    </div>
  );
}

function DashboardChip({ active, onClick, children }) {
  return (
    <button
      className={`dash-chip${active ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function InsightRow({ title, subtitle, badge, value, tone = 'default' }) {
  return (
    <div className={`dash-insight dash-insight--${tone}`}>
      <div className="dash-insight__main">
        <strong className="dash-insight__title">{title}</strong>
        {subtitle ? <span className="dash-insight__subtitle">{subtitle}</span> : null}
      </div>
      <div className="dash-insight__side">
        {badge ? <span className="dash-insight__badge">{badge}</span> : null}
        {value ? <span className="dash-insight__value">{value}</span> : null}
      </div>
    </div>
  );
}

function SummaryCard({ title, right, children }) {
  return (
    <div className="dash-semaforo">
      <div className="dash-semaforo__header">
        <strong>{title}</strong>
        {right ? <span>{right}</span> : null}
      </div>
      {children}
    </div>
  );
}

function MobileDashboardPanel() {
  const { layerMetricsById, layers } = useGISWorkspace();
  const [activeView, setActiveView] = React.useState('general');
  const [scope, setScope] = React.useState('all');

  // Capas de BD con GeoJSON ya cargado (tienen features reales).
  // Las capas del catálogo que aún no se han activado tienen data=null y se excluyen.
  const loadedLayers = React.useMemo(
    () =>
      layers.filter(
        (layer) => layer.databaseLayer && (layer.data?.features?.length ?? 0) > 0
      ),
    [layers]
  );

  // Capas activas en el mapa: cargadas Y visibles.
  const activeLayers = React.useMemo(
    () => loadedLayers.filter((layer) => layer.visible),
    [loadedLayers]
  );

  // Total de capas en catálogo (para mensaje de estado vacío)
  const catalogCount = React.useMemo(
    () => layers.filter((layer) => layer.databaseLayer).length,
    [layers]
  );

  const scopedLayers = React.useMemo(() => {
    if (scope === 'visible') return activeLayers;
    return loadedLayers;
  }, [activeLayers, loadedLayers, scope]);

  const scopedFeatures = React.useMemo(
    () =>
      scopedLayers.flatMap((layer) =>
        (layer.data?.features || []).map((feature) => ({
          layer,
          feature,
          properties: feature?.properties || {},
        }))
      ),
    [scopedLayers]
  );

  const layerBudgetById = React.useMemo(() => {
    const budgetMap = new Map();

    scopedLayers.forEach((layer) => {
      const budget = (layer.data?.features || []).reduce((total, feature) => {
        const amount = parseNumericValue(
          firstPropertyValue(feature?.properties || {}, [
            'MONTO',
            'monto',
            'IMPORTE',
            'importe',
            'PRESUPUESTO',
            'presupuesto',
            'INVERSION',
            'inversion',
            'COSTO',
            'costo',
            'MONTO_TOTAL',
            'monto_total',
            'MONTO_CONTRATO',
            'monto_contrato',
          ])
        );

        return total + (amount || 0);
      }, 0);

      budgetMap.set(layer.id, budget);
    });

    return budgetMap;
  }, [scopedLayers]);

  // BUG-06: Envolver todos los cómputos pesados en useMemo para evitar
  // re-cálculo en cada render cuando el estado del componente no cambia.

  const coreStats = React.useMemo(() => {
    let totalAvance = 0;
    let avanceCount = 0;
    let totalRisk = 0;
    let verde = 0;
    let amarillo = 0;
    let rojo = 0;

    scopedLayers.forEach((layer) => {
      const metrics = layerMetricsById.get(layer.id);
      if (!metrics) return;

      if (metrics.averageProgress != null) {
        totalAvance += metrics.averageProgress;
        avanceCount += 1;
      }

      totalRisk += metrics.riskCount || 0;

      if ((metrics.riskCount || 0) === 0) verde += 1;
      else if ((metrics.riskCount || 0) < (metrics.totalElements || 0)) amarillo += 1;
      else rojo += 1;
    });

    const avgAvance = avanceCount > 0 ? totalAvance / avanceCount : null;
    const avanceColor =
      avgAvance == null ? undefined
        : avgAvance >= 80 ? 'ok'
        : avgAvance >= 50 ? 'warn'
        : 'risk';

    return { totalAvance, avanceCount, totalRisk, verde, amarillo, rojo, avgAvance, avanceColor };
  }, [scopedLayers, layerMetricsById]);

  const { totalRisk, verde, amarillo, rojo, avgAvance, avanceColor } = coreStats;

  const totalBudget = React.useMemo(
    () => Array.from(layerBudgetById.values()).reduce((total, amount) => total + amount, 0),
    [layerBudgetById]
  );

  // Conteo de obras por estatus: proceso / terminado / entregado / sin iniciar
  const statusCounts = React.useMemo(() => {
    const counts = { proceso: 0, terminado: 0, entregado: 0, 'sin iniciar': 0, otro: 0 };
    scopedFeatures.forEach(({ layer, feature, properties }) => {
      if (!shouldCountFeature(feature, layer)) return;
      let resolved = null;
      for (const key of STATUS_ICON_KEYS_LOCAL) {
        const raw = properties?.[key];
        if (raw != null && raw !== '') {
          resolved = resolveStatus(raw);
          if (resolved) break;
        }
      }
      if (resolved && counts[resolved] !== undefined) counts[resolved] += 1;
      else if (resolved === null) counts.otro += 1;
    });
    return counts;
  }, [scopedFeatures]);

  const featureStats = React.useMemo(() => {
    const contracts = new Set();
    const companies = new Set();
    const alcaldiaMap = new Map();

    scopedFeatures.forEach(({ properties }) => {
      const contract = firstPropertyValue(properties, [
        'CONTRATO',
        'N_CONTRATO',
        'NO_CONTRATO',
        'NUM_CONTRATO',
        'contrato',
      ]);
      if (contract) contracts.add(String(contract).trim());

      const company = firstPropertyValue(properties, [
        'EMPRESA',
        'N_EMPRESA',
        'CONTRATISTA',
        'empresa',
        'contratista',
      ]);
      if (company) companies.add(String(company).trim());

      const alcaldia =
        firstPropertyValue(properties, ['ALCALDIA', 'alcaldia', 'ALCALDÍA', 'alcaldía']) ||
        'Sin alcaldía';
      const risk = properties?.RIESGO === true ? 1 : 0;
      const advance = parseNumericValue(
        firstPropertyValue(properties, ['AVANCE', 'avance', 'PORC_AVANCE', 'porc_avance'])
      );

      if (!alcaldiaMap.has(alcaldia)) {
        alcaldiaMap.set(alcaldia, {
          alcaldia,
          records: 0,
          risk: 0,
          progressTotal: 0,
          progressCount: 0,
        });
      }

      const bucket = alcaldiaMap.get(alcaldia);
      bucket.records += 1;
      bucket.risk += risk;
      if (advance != null) {
        bucket.progressTotal += advance;
        bucket.progressCount += 1;
      }
    });

    return { contracts, companies, alcaldiaMap };
  }, [scopedFeatures]);

  const { contracts, companies, alcaldiaMap } = featureStats;

  const dgSummary = React.useMemo(() => {
    const dgRows = scopedLayers.reduce((map, layer) => {
      const dg = layer.dg || 'Sin DG';
      const metrics = layerMetricsById.get(layer.id) || {};
      const budget = layerBudgetById.get(layer.id) || 0;

      if (!map.has(dg)) {
        map.set(dg, {
          dg,
          layers: 0,
          visible: 0,
          records: 0,
          risk: 0,
          progressTotal: 0,
          progressCount: 0,
          budget: 0,
        });
      }

      const bucket = map.get(dg);
      bucket.layers += 1;
      bucket.visible += layer.visible ? 1 : 0;
      bucket.records += layer.data?.features?.length || 0;
      bucket.risk += metrics.riskCount || 0;
      bucket.budget += budget;

      if (metrics.averageProgress != null) {
        bucket.progressTotal += metrics.averageProgress;
        bucket.progressCount += 1;
      }

      return map;
    }, new Map());

    return Array.from(dgRows.values())
      .map((item) => ({
        ...item,
        avgProgress:
          item.progressCount > 0 ? item.progressTotal / item.progressCount : null,
      }))
      .sort((left, right) => {
        if (right.risk !== left.risk) return right.risk - left.risk;
        return right.records - left.records;
      });
  }, [scopedLayers, layerMetricsById, layerBudgetById]);

  const alcaldiaSummary = React.useMemo(
    () =>
      Array.from(alcaldiaMap.values())
        .map((item) => ({
          ...item,
          avgProgress:
            item.progressCount > 0 ? item.progressTotal / item.progressCount : null,
        }))
        .sort((left, right) => {
          if (right.records !== left.records) return right.records - left.records;
          return right.risk - left.risk;
        }),
    [alcaldiaMap]
  );

  const financeLayers = React.useMemo(
    () =>
      scopedLayers
        .map((layer) => ({
          id: layer.id,
          name: layer.name,
          budget: layerBudgetById.get(layer.id) || 0,
          progress: layerMetricsById.get(layer.id)?.averageProgress ?? null,
        }))
        .filter((item) => item.budget > 0)
        .sort((left, right) => right.budget - left.budget)
        .slice(0, 5),
    [scopedLayers, layerBudgetById, layerMetricsById]
  );

  const riskLayers = React.useMemo(
    () =>
      scopedLayers
        .map((layer) => ({
          layer,
          metrics: layerMetricsById.get(layer.id) || {},
        }))
        .filter(({ metrics }) => (metrics.riskCount || 0) > 0)
        .sort((left, right) => {
          if ((right.metrics.riskCount || 0) !== (left.metrics.riskCount || 0)) {
            return (right.metrics.riskCount || 0) - (left.metrics.riskCount || 0);
          }
          return (right.metrics.averageProgress || 0) - (left.metrics.averageProgress || 0);
        }),
    [scopedLayers, layerMetricsById]
  );

  const riskDgCount = React.useMemo(
    () => dgSummary.filter((item) => item.risk > 0).length,
    [dgSummary]
  );

  const criticalLayerCount = React.useMemo(
    () =>
      scopedLayers.filter((layer) => {
        const metrics = layerMetricsById.get(layer.id) || {};
        return (
          (metrics.totalElements || 0) > 0 &&
          (metrics.riskCount || 0) === (metrics.totalElements || 0)
        );
      }).length,
    [scopedLayers, layerMetricsById]
  );

  const topDg = dgSummary[0] || null;
  const topAlcaldia = alcaldiaSummary[0] || null;
  const renderGeneralView = () => (
    <>
      {/* Hero: monto total + avance */}
      <div className="dash-hero">
        <div className="dash-hero__block">
          <span className="dash-hero__label">Monto total</span>
          <strong className="dash-hero__value">{formatCompactCurrency(totalBudget)}</strong>
        </div>
        <div className="dash-hero__divider" />
        <div className="dash-hero__block">
          <span className="dash-hero__label">Avance promedio</span>
          <strong className={`dash-hero__value dash-hero__value--${avanceColor || 'neutral'}`}>
            {avgAvance != null ? `${Math.round(avgAvance)}%` : '—'}
          </strong>
        </div>
      </div>

      {/* Conteo de obras por estatus */}
      <div className="dash-status-grid">
        <StatusKpiCard label="En proceso" value={formatInteger(statusCounts.proceso)} color="#FF9800" />
        <StatusKpiCard label="Terminadas" value={formatInteger(statusCounts.terminado)} color="#4CAF50" />
        <StatusKpiCard label="Entregadas" value={formatInteger(statusCounts.entregado)} color="#4FC3F7" />
        <StatusKpiCard label="Sin iniciar" value={formatInteger(statusCounts['sin iniciar'])} color="#F44336" />
      </div>

      <div className="dash-kpi-grid">
        <KpiCard
          label="En riesgo"
          note={`${riskDgCount} DG impactadas`}
          value={formatInteger(totalRisk)}
          variant={totalRisk > 0 ? 'risk' : 'ok'}
        />
        <KpiCard
          label="Capas activas"
          note={`${loadedLayers.length} cargadas · ${catalogCount} catálogo`}
          value={formatInteger(activeLayers.length)}
        />
        <KpiCard
          label="Registros"
          note={`${alcaldiaSummary.length} alcaldías`}
          value={formatInteger(scopedFeatures.length)}
        />
        <KpiCard
          label="Contratos"
          note={`${formatInteger(companies.size)} empresas`}
          value={formatInteger(contracts.size)}
        />
      </div>

      <SummaryCard title="Semaforización de capas" right={`${scopedLayers.length} capas`}>
        <SemaforoBar verde={verde} amarillo={amarillo} rojo={rojo} />
        <div className="dash-semaforo__legend">
          <span className="sdot sdot--verde" />
          <span>{verde} sin riesgo</span>
          <span className="sdot sdot--amarillo" />
          <span>{amarillo} riesgo parcial</span>
          <span className="sdot sdot--rojo" />
          <span>{rojo} crítico</span>
        </div>
      </SummaryCard>

      <div className="dash-risk-list">
        <strong className="dash-section-title">Capas con elementos en riesgo</strong>
        {scopedLayers.length === 0 ? (
          <div className="dash-empty-state">
            <span className="dash-empty-state__icon">📂</span>
            <strong className="dash-empty-state__title">Sin datos cargados</strong>
            <p className="dash-empty-state__body">
              {scope === 'visible'
                ? activeLayers.length === 0 && loadedLayers.length > 0
                  ? `Hay ${loadedLayers.length} capas con datos — activa alguna en el panel Capas o cambia a "Cargadas".`
                  : 'Activa capas desde el panel Capas para ver indicadores.'
                : `Activa capas desde el panel Capas para cargar datos. ${catalogCount > 0 ? `(${catalogCount} capas disponibles en catálogo)` : ''}`}
            </p>
          </div>
        ) : riskLayers.length === 0 ? (
          <p className="dash-empty">Ninguna capa presenta riesgo activo</p>
        ) : (
          riskLayers.slice(0, 6).map(({ layer, metrics }) => (
            <div className="dash-risk-row" key={layer.id}>
              <span
                className="dash-risk-dot"
                style={{ background: layer.style?.color || layer.color }}
              />
              <span className="dash-risk-name">{layer.name}</span>
              <span className="dash-risk-badge">{metrics.riskCount || 0} riesgo</span>
              {metrics.averageProgress != null ? (
                <span className="dash-risk-pct">{Math.round(metrics.averageProgress)}%</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </>
  );

  const renderDgView = () => (
    <>
      <div className="dash-kpi-grid">
        <KpiCard label="DG activas" value={formatInteger(dgSummary.length)} />
        <KpiCard
          label="DG con riesgo"
          value={formatInteger(riskDgCount)}
          variant={riskDgCount > 0 ? 'risk' : 'ok'}
        />
        <KpiCard
          label="Mayor DG"
          value={topDg ? topDg.dg : '—'}
          note={topDg ? `${formatInteger(topDg.records)} registros` : null}
        />
        <KpiCard
          label="Monto líder"
          value={topDg ? formatCompactCurrency(topDg.budget) : '—'}
          note={topDg ? topDg.dg : null}
        />
      </div>

      <div className="dash-risk-list">
        <strong className="dash-section-title">Resumen por dirección general</strong>
        {dgSummary.length === 0 ? (
          <p className="dash-empty">No hay DG disponibles en las capas cargadas</p>
        ) : (
          dgSummary.slice(0, 8).map((item) => (
            <InsightRow
              badge={`${item.risk} riesgo`}
              key={item.dg}
              subtitle={`${item.layers} capas · ${formatInteger(item.records)} registros`}
              title={item.dg}
              tone={item.risk > 0 ? 'risk' : 'default'}
              value={item.avgProgress != null ? formatPercent(item.avgProgress) : formatCompactCurrency(item.budget)}
            />
          ))
        )}
      </div>
    </>
  );

  const renderAlcaldiasView = () => (
    <>
      <div className="dash-kpi-grid">
        <KpiCard label="Alcaldías" value={formatInteger(alcaldiaSummary.length)} />
        <KpiCard
          label="Más obra"
          value={topAlcaldia ? topAlcaldia.alcaldia : '—'}
          note={topAlcaldia ? `${formatInteger(topAlcaldia.records)} registros` : null}
        />
        <KpiCard
          label="En riesgo"
          value={formatInteger(
            alcaldiaSummary.reduce((total, item) => total + item.risk, 0)
          )}
          variant={
            alcaldiaSummary.some((item) => item.risk > 0) ? 'risk' : 'ok'
          }
        />
        <KpiCard
          label="Avance medio"
          value={
            topAlcaldia && topAlcaldia.avgProgress != null
              ? formatPercent(topAlcaldia.avgProgress)
              : '—'
          }
          note={topAlcaldia ? topAlcaldia.alcaldia : null}
        />
      </div>

      <div className="dash-risk-list">
        <strong className="dash-section-title">Carga operativa por alcaldía</strong>
        {alcaldiaSummary.length === 0 ? (
          <p className="dash-empty">No hay alcaldías detectadas en la base</p>
        ) : (
          alcaldiaSummary.slice(0, 8).map((item) => (
            <InsightRow
              badge={`${item.risk} riesgo`}
              key={item.alcaldia}
              subtitle={`${formatInteger(item.records)} registros`}
              title={item.alcaldia}
              tone={item.risk > 0 ? 'risk' : 'default'}
              value={item.avgProgress != null ? formatPercent(item.avgProgress) : null}
            />
          ))
        )}
      </div>
    </>
  );

  const renderFinanzasView = () => (
    <>
      <div className="dash-kpi-grid">
        <KpiCard
          label="Monto total"
          note={`${formatInteger(scopedFeatures.length)} registros revisados`}
          value={formatCompactCurrency(totalBudget)}
          variant={totalBudget > 0 ? 'ok' : undefined}
        />
        <KpiCard label="Contratos" value={formatInteger(contracts.size)} />
        <KpiCard label="Empresas" value={formatInteger(companies.size)} />
        <KpiCard
          label="Monto medio"
          value={
            contracts.size > 0
              ? formatCompactCurrency(totalBudget / contracts.size)
              : '—'
          }
          note="por contrato"
        />
      </div>

      <div className="dash-risk-list">
        <strong className="dash-section-title">Capas con mayor monto detectado</strong>
        {financeLayers.length === 0 ? (
          <p className="dash-empty">Estas capas aún no traen montos monetarios utilizables</p>
        ) : (
          financeLayers.map((item) => (
            <InsightRow
              badge={item.progress != null ? formatPercent(item.progress) : null}
              key={item.id}
              subtitle="Monto acumulado detectado"
              title={item.name}
              tone="money"
              value={formatCompactCurrency(item.budget)}
            />
          ))
        )}
      </div>
    </>
  );

  const renderRiskView = () => (
    <>
      <div className="dash-kpi-grid">
        <KpiCard
          label="Riesgos totales"
          value={formatInteger(totalRisk)}
          variant={totalRisk > 0 ? 'risk' : 'ok'}
        />
        <KpiCard
          label="Capas afectadas"
          value={formatInteger(riskLayers.length)}
          variant={riskLayers.length > 0 ? 'risk' : 'ok'}
        />
        <KpiCard
          label="DG impactadas"
          value={formatInteger(riskDgCount)}
          variant={riskDgCount > 0 ? 'risk' : 'ok'}
        />
        <KpiCard
          label="Capas críticas"
          value={formatInteger(criticalLayerCount)}
          variant={criticalLayerCount > 0 ? 'risk' : 'ok'}
        />
      </div>

      <div className="dash-risk-list">
        <strong className="dash-section-title">Prioridad de atención</strong>
        {riskLayers.length === 0 ? (
          <p className="dash-empty">No hay elementos en riesgo en este alcance</p>
        ) : (
          riskLayers.slice(0, 8).map(({ layer, metrics }) => (
            <InsightRow
              badge={`${metrics.riskCount || 0} riesgo`}
              key={layer.id}
              subtitle={`${formatInteger(metrics.totalElements || 0)} elementos · ${layer.dg || 'Sin DG'}`}
              title={layer.name}
              tone="risk"
              value={metrics.averageProgress != null ? formatPercent(metrics.averageProgress) : null}
            />
          ))
        )}
      </div>
    </>
  );

  let body = renderGeneralView();
  if (activeView === 'dg') body = renderDgView();
  if (activeView === 'alcaldias') body = renderAlcaldiasView();
  if (activeView === 'finanzas') body = renderFinanzasView();
  if (activeView === 'riesgo') body = renderRiskView();

  return (
    <div className="mobile-panel">
      <div className="dash-controls">
        <div className="dash-chip-row">
          {ANALYSIS_VIEWS.map((view) => (
            <DashboardChip
              active={activeView === view.id}
              key={view.id}
              onClick={() => setActiveView(view.id)}
            >
              {view.label}
            </DashboardChip>
          ))}
        </div>
        <div className="dash-chip-row dash-chip-row--scope">
          {ANALYSIS_SCOPES.map((item) => (
            <DashboardChip
              active={scope === item.id}
              key={item.id}
              onClick={() => setScope(item.id)}
            >
              {item.label}
            </DashboardChip>
          ))}
        </div>
      </div>

      {body}
    </div>
  );
}

export default MobileDashboardPanel;
