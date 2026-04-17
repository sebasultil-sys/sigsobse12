// ─────────────────────────────────────────────────────────────────────────────
// GeoJsonLayer.js — Fábrica de capas GeoJSON para Leaflet
//
// Este módulo encapsula toda la lógica visual de las capas del mapa:
//   - Estilos de vectores (polígonos, líneas) según el estado interactivo
//   - Estilos de puntos (CircleMarker) según el estado interactivo
//   - Cálculo del "visual state" de una capa (selected, highlighted, dimmed…)
//   - Creación del objeto L.geoJSON con eventos de hover, click y popup
//
// La pieza clave de arquitectura es el patrón "stateRef":
//   En lugar de capturar valores de estado React directamente en el closure de
//   Leaflet (donde quedarían "congelados" en el momento de creación), recibimos
//   un React.ref cuyo .current se actualiza durante cada render del componente
//   padre. Así Leaflet siempre lee el estado más reciente sin necesidad de
//   recrear las capas cada vez que cambia hoveredLayerId o focusedLayerId.
// ─────────────────────────────────────────────────────────────────────────────

import L from "leaflet";
import { getLayerIcon } from "../../config/layerIcons";

// ── Seguridad de HTML en popups ───────────────────────────────────────────────

// Escapa caracteres especiales HTML para evitar XSS en los popups del mapa.
// Los valores de las propiedades GeoJSON vienen de la base de datos y pueden
// contener caracteres como <, >, &, " que romperían el HTML del popup.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Popup de ficha técnica ────────────────────────────────────────────────────

// Genera el HTML que aparece dentro del popup al hacer clic en un elemento.
// Muestra una tabla con los atributos más relevantes del feature GeoJSON:
// OBRA, PROGRAMA, DG, ALCALDIA, FRENTE. Omite campos nulos o vacíos.
function buildPopupMarkup(feature, layerName) {
  const properties = feature?.properties || {};

  const firstValue = (keys = []) => {
    for (const key of keys) {
      const value = properties?.[key];
      if (value != null && String(value).trim() !== "") return value;
    }
    return null;
  };

  // Pares [etiqueta, valor] — se filtran automáticamente los que no tienen dato
  const rows = [
    ["Obra", properties.OBRA],
    ["Programa", properties.PROGRAMA],
    ["DG", properties.DG],
    ["Alcaldía", properties.ALCALDIA],
    ["Frente", properties.FRENTE],
    [
      "Inicio de contrato",
      firstValue([
        "INICIO DE CONTRATO",
        "FECHA INICIO CONTRATO",
        "FECHA_INICIO",
        "fecha_inicio",
        "INICIO_CONTRATO",
        "inicio_contrato",
        "F_FECHA_IN",
        "F_INICIO_CONTRATO",
      ]),
    ],
    [
      "Fin de contrato",
      firstValue([
        "TERMINO DE CONTRATO",
        "FIN DE CONTRATO",
        "FECHA TERMINO CONTRATO",
        "FECHA FIN CONTRATO",
        "FECHA_TERMINO",
        "fecha_termino",
        "TERMINO_CONTRATO",
        "termino_contrato",
        "FIN_CONTRATO",
        "fin_contrato",
        "FECHA_FIN",
        "fecha_fin",
        "F_FECHA_TE",
        "F_FIN_CONTRATO",
      ]),
    ],
  ].filter(([, value]) => value != null && value !== "");

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return `
    <div class="map-popup">
      <strong>${escapeHtml(properties.OBRA || layerName)}</strong>
      <table>${tableRows}</table>
    </div>
  `;
}

// ── Iconos de status por feature ─────────────────────────────────────────────

// Colores por estado de avance/status de la obra.
// Se usan como borde del círculo blanco (estilo "pin institucional").
const STATUS_COLORS = {
  entregado: "#2196F3", // azul — obra entregada
  proceso: "#FF9800", // naranja — en proceso
  terminado: "#4CAF50", // verde — terminada/concluida
  "sin iniciar": "#F44336", // rojo — sin iniciar
  "en proceso avanzado": "#FFEB3B", // amarillo — en proceso avanzado
};

const STATUS_ICON_KEYS = [
  "F_ESTATUS",
  "ESTATUS",
  "estatus",
  "ESTADO",
  "estado",
  "STATUS",
  "status",
];

// Normaliza un valor de status a una clave de STATUS_COLORS.
// Retorna null si no hay coincidencia reconocida.
function resolveStatusKey(rawValue) {
  if (!rawValue) return null;
  const v = String(rawValue)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (v.includes("entregad")) return "entregado";
  if (v.includes("terminad") || v.includes("concluid") || v.includes("finaliz"))
    return "terminado";
  if (v.includes("proceso avanzad")) return "en proceso avanzado";
  if (v.includes("proceso") || v.includes("ejecuci") || v.includes("avance"))
    return "proceso";
  if (v.includes("sin iniciar") || v.includes("no inici")) return "sin iniciar";
  return null;
}

function normalizeStatus(value) {
  if (!value) return "DEFAULT";

  const s = String(value).toUpperCase().trim();

  if (s.includes("TERMINADO")) return "TERMINADO";
  if (s.includes("PROCESO AVANZADO")) return "AVANZADO";
  if (s.includes("EN PROCESO")) return "EN PROCESO";
  if (s.includes("SIN INICIAR")) return "SIN INICIAR";
  if (s.includes("ENTREGADO")) return "ENTREGADO";

  return "DEFAULT";
}

function getStatusFeatureStyle(properties) {
  const status = normalizeStatus(properties?.estatus || properties?.ESTATUS || properties?.status || properties?.Status);

  switch (status) {
    case "TERMINADO":
      return { color: "#2e7d32", weight: 3 };
    case "EN PROCESO":
      return { color: "#fb8c00", weight: 3 };
    case "AVANZADO":
      return { color: "#fdd835", weight: 3 };
    case "SIN INICIAR":
      return { color: "#e53935", weight: 3 };
    case "ENTREGADO":
      return { color: "#1e88e5", weight: 3 };
    default:
      return null;
  }
}

// Obtiene el color de borde del pin a partir de las propiedades del feature.
// Retorna null si el feature no tiene un campo de status reconocido.
export function getFeatureStatusColor(properties) {
  for (const key of STATUS_ICON_KEYS) {
    const raw = properties?.[key];
    if (raw == null || raw === "") continue;
    const statusKey = resolveStatusKey(raw);
    if (statusKey) return STATUS_COLORS[statusKey];
  }
  return null;
}

// Caché de L.divIcon por clave de status — evita recrear el mismo icono en cada feature.
// Solo almacena el estado 'default'; Effect 2 reconstruye el icono para selected/highlighted.
const iconCache = {};

// Genera el HTML de un "pin" circular institucional:
//   - fondo blanco, borde del color del status
//   - punto de relleno interior del MISMO color (estilo story map)
//   - wrapper con class=lmap-status-wrap y data-vs para que Effect 2 actualice el estado
export function buildStatusIconHtml(borderColor, visualState) {
  const isSelected = visualState === "selected";
  const isHighlighted = visualState === "highlighted";
  const size = isSelected ? 34 : isHighlighted ? 30 : 28;
  const border = isSelected ? 5 : 4;
  const fillSize = isSelected ? 14 : isHighlighted ? 12 : 10;
  const shadow = isSelected
    ? `0 0 0 3px #691C32,0 2px 8px rgba(0,0,0,0.35)`
    : isHighlighted
      ? `0 0 0 2px #C5A572,0 2px 6px rgba(0,0,0,0.28)`
      : `0 2px 6px rgba(0,0,0,0.28)`;
  return (
    `<div class="lmap-status-wrap" data-vs="${visualState}" data-color="${borderColor}" style="` +
    `width:${size}px;height:${size}px;border-radius:50%;` +
    `border:${border}px solid ${borderColor};background:#fff;` +
    `box-shadow:${shadow};` +
    `display:flex;align-items:center;justify-content:center;">` +
    `<div style="width:${fillSize}px;height:${fillSize}px;border-radius:50%;background:${borderColor};opacity:0.85;"></div>` +
    `</div>`
  );
}

// Devuelve un L.divIcon cacheado para el status dado (estado 'default').
// Usar solo en pointToLayer; Effect 2 llama buildStatusIconHtml directamente.
export function getStatusIcon(statusRaw) {
  const statusKey = resolveStatusKey(statusRaw) || "sin iniciar";
  if (iconCache[statusKey]) return iconCache[statusKey];
  const color = STATUS_COLORS[statusKey] || "#9E9E9E";
  const html = buildStatusIconHtml(color, "default");
  const icon = L.divIcon({
    className: "",
    html,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  iconCache[statusKey] = icon;
  return icon;
}

// ── Estilos de línea ──────────────────────────────────────────────────────────

// Convierte el nombre del estilo de línea en el patrón CSS dashArray de SVG.
// 'dash' → línea discontinua larga (ej. carreteras en diseño)
// 'dot'  → línea de puntos
// null   → línea continua (sin patrón)
function getDashArray(dashStyle) {
  if (dashStyle === "dash") return "10 6";
  if (dashStyle === "dot") return "2 8";
  return null;
}

// ── Estilo de vectores (polígonos y líneas) ───────────────────────────────────

// Calcula el objeto de estilo Leaflet para un feature de tipo vector
// (polígono o línea) según su "visual state" actual.
//
// Visual states posibles:
//   'selected'    → feature individual seleccionado por clic → guinda #691C32
//   'highlighted' → capa entera enfocada o en hover         → dorado #C5A572
//   'dimmed'      → hay otra capa enfocada, esta queda fondo → gris apagado
//   'hidden'      → capa desactivada (toggle OFF)           → opacity 0
//   'default'     → estado normal sin interacción activa
export function createVectorStyle(layer, visualState, feature) {
  const layerStyle = layer.style || {};
  const isSelected = visualState === "selected";
  const isHighlighted = visualState === "highlighted";
  const isDimmed = visualState === "dimmed";
  const isHidden = visualState === "hidden";

  const statusStyle = getStatusFeatureStyle(feature?.properties || {});
  const statusColor = statusStyle?.color;
  const statusWeight = statusStyle?.weight;

  // El color base viene del estilo configurado en el panel, o del color de la capa
  const baseColor = layerStyle.color || layer.color;

  // El color final cambia según el estado interactivo
  let color = isSelected
    ? "#691C32" // guinda institucional para la selección
    : isHighlighted
      ? "#C5A572" // dorado para hover/focus
      : isDimmed
        ? "#94a3b8" // gris azulado neutro para capas de fondo
        : baseColor;

  if (statusColor && !isSelected && !isHighlighted && !isDimmed) {
    color = statusColor;
  }

  const weight = statusWeight || (layerStyle.weight || 3);

  const opacityBase = layerStyle.opacity ?? 0.94;
  const fillOpacityBase = layerStyle.fillOpacity ?? 0.24;

  return {
    className: "gis-feature-path",
    color,
    // El grosor del borde aumenta +2 si está seleccionado, +1 si destacado
    weight: weight + (isSelected ? 2 : isHighlighted ? 1 : 0),
    opacity: isHidden ? 0 : isDimmed ? 0.18 : opacityBase,
    fillColor: color,
    fillOpacity: isHidden
      ? 0
      : isDimmed
        ? Math.min(0.08, fillOpacityBase) // relleno casi invisible al dimmear
        : isSelected
          ? Math.min(0.45, fillOpacityBase + 0.14) // relleno más sólido al seleccionar
          : fillOpacityBase,
    dashArray: getDashArray(layerStyle.dashStyle),
  };
}

// ── Estilo de puntos (CircleMarker) ───────────────────────────────────────────

// Calcula el objeto de estilo Leaflet para features de tipo punto.
// Los puntos se renderizan con L.circleMarker (SVG circular) porque los
// L.Marker con íconos PNG no permiten cambiar color dinámicamente.
//
// markerKind controla la apariencia del círculo:
//   'solid' → círculo relleno (default) — más visible en mapas densos
//   'ring'  → solo el contorno circular — estilo más sutil
//   'soft'  → relleno semi-transparente — intermedio
export function createPointStyle(layer, visualState) {
  const layerStyle = layer.style || {};
  const markerKind = layerStyle.markerKind || "solid";
  const baseColor = layerStyle.color || layer.color;
  const isSelected = visualState === "selected";
  const isHighlighted = visualState === "highlighted";
  const isDimmed = visualState === "dimmed";
  const isHidden = visualState === "hidden";

  const color = isSelected
    ? "#691C32"
    : isHighlighted
      ? "#C5A572"
      : isDimmed
        ? "#94a3b8"
        : baseColor;

  return {
    className: "gis-feature-path",
    // El radio aumenta +2 si seleccionado, +1 si destacado (retroalimentación visual)
    radius:
      (layerStyle.pointRadius || 6) + (isSelected ? 2 : isHighlighted ? 1 : 0),
    // Para 'ring': el color exterior es el tinte, interior blanco
    // Para 'solid'/'soft': borde blanco, interior del color
    color: markerKind === "ring" ? color : "#ffffff",
    weight: markerKind === "ring" ? 3 : 2,
    fillColor: markerKind === "ring" ? "#ffffff" : color,
    fillOpacity: isHidden
      ? 0
      : isDimmed
        ? 0.15
        : markerKind === "soft"
          ? 0.42
          : markerKind === "ring"
            ? 1
            : 0.96,
    opacity: isHidden ? 0 : isDimmed ? 0.18 : (layerStyle.opacity ?? 0.94),
  };
}

// ── Estilo de hover individual sobre un feature ───────────────────────────────

// Calcula el estilo de resaltado cuando el cursor entra a un feature concreto
// (no a toda la capa, sino al polígono o punto específico bajo el cursor).
// Toma el estilo base actual y le aplica el color dorado + leve aumento de grosor.
// Se usa en el evento 'mouseover' de cada feature para dar feedback inmediato.
function buildFeatureHoverStyle(leafletLayer, baseStyle) {
  if (leafletLayer instanceof L.CircleMarker) {
    return {
      ...baseStyle,
      color: "#C5A572",
      weight: (baseStyle.weight || 2) + 1,
      fillOpacity: Math.min(1, (baseStyle.fillOpacity || 0.8) + 0.08),
    };
  }

  return {
    ...baseStyle,
    color: "#C5A572",
    weight: (baseStyle.weight || 3) + 1,
    fillOpacity: Math.min(0.85, (baseStyle.fillOpacity || 0.24) + 0.16),
  };
}

// ── Determinación del visual state ───────────────────────────────────────────

// Calcula qué "visual state" le corresponde a un feature dado el contexto
// actual de la interacción (qué capa está enfocada, cuál está en hover,
// si hay un feature seleccionado, etc.).
//
// La jerarquía de prioridad es:
//   1. Si la capa está oculta → 'hidden'
//   2. Si este feature específico está seleccionado → 'selected'
//   3. Si esta capa está en hover o enfocada → 'highlighted'
//   4. Si HAY alguna interacción activa (pero no esta capa) → 'dimmed'
//   5. Sin ninguna interacción → 'default'
export function getVisualState({
  focusedLayerId,
  hoveredLayerId,
  isLayerVisible,
  layerId,
  selectedFeatureKey,
  featureKey,
}) {
  const isSelectedFeature = featureKey && featureKey === selectedFeatureKey;
  const isLayerHovered = hoveredLayerId && hoveredLayerId === layerId;
  const isLayerFocused = focusedLayerId && focusedLayerId === layerId;

  // isFocusMode es true cuando hay CUALQUIER interacción activa en el visor.
  // En ese modo, las capas que no están involucradas se "dimean" al fondo.
  const isFocusMode = Boolean(
    focusedLayerId || selectedFeatureKey || hoveredLayerId,
  );

  if (!isLayerVisible) return "hidden";
  if (isSelectedFeature) return "selected";
  if (isLayerHovered || isLayerFocused) return "highlighted";
  // No dimmear otras capas — múltiples capas deben permanecer visibles
  return "default";
}

// ── Fábrica principal de capas Leaflet ────────────────────────────────────────

/**
 * createGeoJsonLayer — crea un L.geoJSON con estilos reactivos y eventos.
 *
 * @param {Object} params
 * @param {React.MutableRefObject} params.stateRef
 *   Ref que apunta siempre a { focusedLayerId, hoveredLayerId, selectedFeatureKey }.
 *   Se actualiza sincrónicamente durante el render del componente padre,
 *   ANTES de que corran los effects. Así los callbacks de Leaflet leen el
 *   estado más reciente sin depender de closures "congelados".
 *   → Esto evita recrear capas Leaflet completas en cada hover o selección.
 * @param {boolean}  params.interactive
 *   Si es false, la capa no responde a eventos (modo medición/dibujo).
 * @param {Object}   params.layer
 *   Definición completa de la capa: id, data (GeoJSON), style, color, visible…
 * @param {Function} params.onSelectFeature
 *   Callback que el componente padre llama cuando el usuario hace clic en un feature.
 * @param {boolean}  params.forcePointStyle
 *   Si es true, usa createPointStyle en lugar de createVectorStyle para todos los
 *   features (incluyendo los que se renderizaron como CircleMarker via pointToLayer).
 *   Necesario cuando las geometrías originales (líneas) fueron convertidas a puntos
 *   antes de pasar a esta función, para que Effect 2 (resetStyle) aplique el estilo correcto.
 */
export function createGeoJsonLayer({
  enablePopup = true,
  stateRef,
  interactive,
  layer,
  onSelectFeature,
  forcePointStyle = false,
}) {
  // Función auxiliar interna que resuelve el estilo según el flag forcePointStyle.
  // Se usa en el callback style() y en el handler mouseover para consistencia.
  function resolveStyle(feature) {
    const { focusedLayerId, hoveredLayerId, selectedFeatureKey } =
      stateRef.current;
    const visualState = getVisualState({
      focusedLayerId,
      hoveredLayerId,
      isLayerVisible: layer.visible,
      layerId: layer.id,
      selectedFeatureKey,
      featureKey: feature?.properties?.__featureKey || null,
    });
    return forcePointStyle
      ? createPointStyle(layer, visualState)
      : createVectorStyle(layer, visualState, feature);
  }

  const geoJsonLayer = L.geoJSON(layer.data, {
    interactive,

    // style() se llama por Leaflet cada vez que necesita el estilo de un polígono/línea,
    // y también por resetStyle() en Effect 2. Al leer stateRef.current obtenemos
    // siempre el estado actual sin depender de closures "congelados".
    style: (feature) => resolveStyle(feature),

    // pointToLayer() convierte features de tipo Point/MultiPoint en un marcador visual.
    //
    // Si la capa tiene un icono personalizado en layerIcons.js → usa L.divIcon (PNG).
    //   El estado visual (selected/dimmed/highlighted) se gestiona mediante
    //   data-vs en el elemento DOM, que CSS transforma en filtros visuales.
    //   Effect 2 en MapView.jsx actualiza el atributo data-vs sin recrear el marcador.
    //
    // Si no hay icono personalizado → usa L.circleMarker (comportamiento original).
    //   CircleMarker soporta setStyle() y permite cambio dinámico de color/radio.
    pointToLayer: (feature, latlng) => {
      const { focusedLayerId, hoveredLayerId, selectedFeatureKey } =
        stateRef.current;
      const featureKey = feature?.properties?.__featureKey || null;
      const visualState = getVisualState({
        focusedLayerId,
        hoveredLayerId,
        isLayerVisible: layer.visible,
        layerId: layer.id,
        selectedFeatureKey,
        featureKey,
      });

      const iconUrl = getLayerIcon(layer.name);
      if (iconUrl) {
        // Icono personalizado PNG: L.divIcon con atributo data-vs para estados CSS
        const divIcon = L.divIcon({
          className: "", // sin clase extra de Leaflet — manejamos todo con nuestro CSS
          html: `<div class="lmap-icon-wrap" data-vs="${visualState}"><img class="lmap-icon" src="${iconUrl}" alt="" draggable="false" /></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -16],
        });
        return L.marker(latlng, { icon: divIcon, interactive: true });
      }

      // Icono de status: círculo blanco + relleno interior del color según ESTATUS del feature
      // Solo se aplica si el feature tiene un campo de status reconocido.
      const statusColor = getFeatureStatusColor(feature?.properties || {});
      if (statusColor && visualState !== "hidden") {
        let statusIcon;
        if (visualState === "default") {
          // Estado normal: usar icono cacheado para este status
          const statusRaw = (() => {
            const props = feature?.properties || {};
            for (const key of STATUS_ICON_KEYS) {
              if (props[key] != null && props[key] !== "") return props[key];
            }
            return null;
          })();
          statusIcon = getStatusIcon(statusRaw);
        } else {
          // Estado interactivo: reconstruir con color y tamaño ajustados
          const effectiveColor =
            visualState === "selected"
              ? "#691C32"
              : visualState === "highlighted"
                ? "#C5A572"
                : statusColor;
          const iconSize =
            visualState === "selected"
              ? 34
              : visualState === "highlighted"
                ? 30
                : 28;
          statusIcon = L.divIcon({
            className: "",
            html: buildStatusIconHtml(effectiveColor, visualState),
            iconSize: [iconSize, iconSize],
            iconAnchor: [iconSize / 2, iconSize / 2],
            popupAnchor: [0, -(iconSize / 2) - 2],
          });
        }
        return L.marker(latlng, { icon: statusIcon, interactive: true });
      }

      // Sin icono ni status: CircleMarker con estilo dinámico (comportamiento original)
      const style = createPointStyle(layer, visualState);
      return L.circleMarker(latlng, style);
    },

    // onEachFeature() se llama una sola vez por feature al crear la capa.
    // Aquí atamos el popup y los tres eventos de interacción: hover, mouseout, clic.
    onEachFeature: (feature, leafletLayer) => {
      if (!interactive) return;

      if (enablePopup) {
        leafletLayer.bindPopup(buildPopupMarkup(feature, layer.name));
      }

      // Hover: aplica estilo de resaltado inmediato sobre el feature concreto.
      // Importante: lee stateRef.current para obtener el estilo base actual,
      // no un valor congelado del momento en que se creó el evento.
      leafletLayer.on("mouseover", () => {
        if (typeof leafletLayer.setStyle === "function") {
          const baseStyle = resolveStyle(feature);
          leafletLayer.setStyle(
            buildFeatureHoverStyle(leafletLayer, baseStyle),
          );
        }

        // Trae el feature al frente para que no quede tapado por vecinos
        if (typeof leafletLayer.bringToFront === "function") {
          leafletLayer.bringToFront();
        }
      });

      // Mouse out: restaura el estilo correcto llamando a resetStyle().
      // resetStyle() vuelve a invocar options.style(feature), que a su vez
      // lee stateRef.current — así el feature queda con el estilo actualizado
      // (no el que tenía cuando el cursor entró).
      leafletLayer.on("mouseout", () => {
        if (
          typeof geoJsonLayer.resetStyle === "function" &&
          leafletLayer?._map &&
          geoJsonLayer?._map
        ) {
          try {
            geoJsonLayer.resetStyle(leafletLayer);
          } catch {
            // Layer puede estar en proceso de desmontaje/redraw.
          }
        }
      });

      // Clic: notifica al componente padre para actualizar el estado React
      // (selectedFeature, sidebar, etc.) sin manipular Leaflet directamente aquí.
      leafletLayer.on("click", () => {
        onSelectFeature({
          feature,
          layerId: layer.id,
          layerName: layer.name,
          properties: feature?.properties || {},
        });
      });
    },
  });

  return geoJsonLayer;
}
