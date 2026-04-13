function expandBounds(bounds, padding = 0) {
  if (!bounds) return null;

  return {
    west: bounds.west - padding,
    south: bounds.south - padding,
    east: bounds.east + padding,
    north: bounds.north + padding,
  };
}

function boundsIntersect(leftBounds, rightBounds) {
  if (!leftBounds || !rightBounds) return false;

  return !(
    leftBounds.east < rightBounds.west ||
    leftBounds.west > rightBounds.east ||
    leftBounds.north < rightBounds.south ||
    leftBounds.south > rightBounds.north
  );
}

function formatLayerCount(value, approximate = false) {
  const safeValue = Math.max(0, Number(value || 0));
  return `${approximate ? '~' : ''}${safeValue.toLocaleString('es-MX')}`;
}

function getLayerStatus(layer, mapViewportBounds, metrics) {
  const loadedCount = layer.data?.features?.length || 0;
  const estimatedCount = Math.max(0, Number(layer.estimatedFeatureCount || 0));
  const hasViewportIntersection =
    !mapViewportBounds ||
    !layer.catalogBbox ||
    boundsIntersect(
      expandBounds(layer.catalogBbox, 0.005),
      expandBounds(mapViewportBounds, 0.01)
    );

  if (!layer.databaseLayer) {
    return {
      tone: layer.visible ? (loadedCount > 0 ? 'on' : 'empty') : 'off',
      label: layer.visible ? (loadedCount > 0 ? 'Activa' : 'Vacía') : 'Apagada',
      detail: `${formatLayerCount(loadedCount)} elementos cargados`,
    };
  }

  if (!layer.visible) {
    return {
      tone: 'off',
      label: 'Apagada',
      detail:
        layer.loadStatus === 'loaded'
          ? `${formatLayerCount(loadedCount)} elementos cargados`
          : estimatedCount
            ? `${formatLayerCount(estimatedCount, true)} elementos estimados`
            : 'Disponible para cargar',
    };
  }

  if (layer.loadStatus === 'loading') {
    return {
      tone: 'loading',
      label: 'Cargando',
      detail: 'Descargando geometrías de la capa',
    };
  }

  if (layer.loadStatus === 'error') {
    return {
      tone: 'error',
      label: 'Error',
      detail: layer.loadError || 'No se pudo cargar la capa',
    };
  }

  if (layer.loadStatus === 'loaded') {
    if (!loadedCount) {
      return {
        tone: 'empty',
        label: 'Vacía',
        detail: '0 elementos en la capa cargada',
      };
    }

    const progressText =
      metrics?.averageProgress != null
        ? ` · ${metrics.averageProgress}% avance`
        : '';
    const riskText =
      metrics?.riskCount ? ` · ${metrics.riskCount} riesgo` : '';

    return {
      tone: 'on',
      label: 'Activa',
      detail: `${formatLayerCount(loadedCount)} elementos${progressText}${riskText}`,
    };
  }

  if (!hasViewportIntersection) {
    return {
      tone: 'waiting',
      label: 'Fuera de vista',
      detail: estimatedCount
        ? `${formatLayerCount(estimatedCount, true)} elementos · se cargará al entrar a su zona`
        : 'Se cargará al entrar a su zona',
    };
  }

  return {
    tone: 'pending',
    label: 'Lista',
    detail: estimatedCount
      ? `${formatLayerCount(estimatedCount, true)} elementos · lista para cargar`
      : 'Lista para cargar',
  };
}

export { boundsIntersect, expandBounds, formatLayerCount, getLayerStatus };
