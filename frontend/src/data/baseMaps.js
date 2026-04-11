const PREVIEW_TILE = {
  z: 11,
  x: 460,
  y: 911,
};

export const BASE_MAPS = [
  {
    id: 'cartographic',
    name: 'Cartográfico',
    description: 'Base limpia para operación diaria',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    previewUrl: `https://a.tile.openstreetmap.org/${PREVIEW_TILE.z}/${PREVIEW_TILE.x}/${PREVIEW_TILE.y}.png`,
  },
  {
    id: 'satellite',
    name: 'Satelital',
    description: 'Imagery ESRI para inspección visual',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    previewUrl: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${PREVIEW_TILE.z}/${PREVIEW_TILE.y}/${PREVIEW_TILE.x}`,
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Contraste alto para capas operativas',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    previewUrl: `https://a.basemaps.cartocdn.com/dark_all/${PREVIEW_TILE.z}/${PREVIEW_TILE.x}/${PREVIEW_TILE.y}.png`,
  },
  {
    id: 'topographic',
    name: 'Topográfico ESRI',
    description: 'Contexto de relieve y red vial',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    previewUrl: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${PREVIEW_TILE.z}/${PREVIEW_TILE.y}/${PREVIEW_TILE.x}`,
  },
];

export const DEFAULT_BASE_MAP_ID = 'cartographic';
