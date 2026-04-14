// ─────────────────────────────────────────────────────────────────────────────
// layerIcons.js — Mapeo de nombres de capa a iconos PNG/SVG
//
// Coloca los archivos de icono en /public/icons/
// Las claves se comparan con el NOMBRE DE CAPA en mayúsculas (includes).
// Para agregar una capa nueva: añade la clave aquí y el archivo en /public/icons/
// ─────────────────────────────────────────────────────────────────────────────

export const layerIcons = {
  // Transporte
  'CABLEBUS':      '/logos/airbss.png',
  'CABLEBÚS':      '/logos/airbss.png',
  'TREN LIGERO':   '/logos/TREN_LIGERO.png',
  'TREN':          '/logos/TREN_LIGERO.png',
  'TROLEBUS':      '/logos/TROLEBUS.png',
  'TROLEBÚS':      '/logos/TROLEBUS.png',
  'METRO':         '/logos/axosobse.png',
  'METROBUS':      '/logos/axosobse.png',
  'METROBÚS':      '/logos/axosobse.png',
  'ECOBICI':       '/logos/BICIESTACIONAMIENTO.png',

  // Educación
  'ESCUELA':       '/logos/ESCUELAS.png',
  'COLEGIO':       '/logos/ESCUELAS.png',
  'PLANTEL':       '/logos/ESCUELAS.png',
  '1, 2, 3':       '/logos/1_2_3_PORMIESCUELA.png',
  '123':           '/logos/1_2_3_PORMIESCUELA.png',

  // Equipamiento urbano
  'UTOPIA':        '/logos/utopiaaaa.png',
  'UTOPÍA':        '/logos/utopiaaaa.png',
  'PARQUE':        '/logos/parques_alegria.png',
  'JARDIN':        '/logos/parques_alegria.png',
  'JARDÍN':        '/logos/parques_alegria.png',
  'MERCADO':       '/logos/MERCADO_HUIPUICO.png',
  'DEPORTIVO':     '/logos/CANCHAS_FUTBOL.png',
  'CANCHAS':       '/logos/CANCHAS_FUTBOL.png',
  'PILARES':       '/logos/pilares.png',
  'ALDEA':         '/logos/ALDEA_JUVENI.png',
  'ALBERGUE':      '/logos/ALBERGUES.png',
  'CAMINO':        '/logos/CAMINO_SEGUR.png',
  'COMUNIDAD':     '/logos/COMUNIDAD_SEGUR.png',
  'ILUMINACION':   '/logos/Ciudad_iluminada.png',
  'ILUMINACIÓN':   '/logos/Ciudad_iluminada.png',
  'BAJO PUENTE':   '/logos/BAJO_PUENTE.png',
  'BICIESTACION':  '/logos/BICIESTACIONAMIENTO.png',

  // Obra pública
  'PUENTE PEATONAL': '/logos/PUENTE_PEATONAL.png',
  'PUENTE VEHIC':    '/logos/puentes_vehicular.png',
  'PUENTE':          '/logos/PUENTE_PEATONAL.png',
  'CICLOVÍA':        '/logos/ciclovia.png',
  'CICLOVIA':        '/logos/ciclovia.png',

  // Seguridad / Gobierno
  'POLICIA':       '/logos/policialogo.png',
  'POLICÍA':       '/logos/policialogo.png',
  'ANAHUAC':       '/logos/ANAHUA.png',
  'ERUM':          '/logos/AGENCIA_EMPLE.png',
};

// Icono por defecto cuando no hay coincidencia
export const DEFAULT_ICON_URL = null;

/**
 * Devuelve la URL del icono para una capa dada su nombre.
 * Compara en mayúsculas con las claves de layerIcons (includes).
 * Devuelve null si no hay icono personalizado — en ese caso
 * el mapa usará CircleMarker y la leyenda usará el símbolo de geometría.
 *
 * @param {string} name — Nombre de la capa
 * @returns {string|null}
 */
export function getLayerIcon(name) {
  if (!name) return null;
  const upper = name.toUpperCase();
  const key = Object.keys(layerIcons).find((k) => upper.includes(k.toUpperCase()));
  if (!key) return null;
  const path = layerIcons[key];
  return path ? (process.env.PUBLIC_URL || '') + path : null;
}
