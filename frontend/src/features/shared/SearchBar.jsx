import React, { useState, useEffect, useCallback } from "react";
import { useGISWorkspace } from "../../app/GISWorkspaceContext";
import { fetchSearchResults } from "../../services/gisApi";

const SEARCH_DEBOUNCE_MS = 300;

function SearchBar() {
  const { actions, mapApi } = useGISWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const performSearch = useCallback(async (searchQuery) => {
    if (!searchQuery.trim()) {
      setResults(null);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetchSearchResults(searchQuery);
      setResults(response.results);
      setShowResults(true);
    } catch (error) {
      console.error("Search error:", error);
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(query);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [query, performSearch]);

  const handleResultClick = (feature) => {
    if (feature.geometry && mapApi) {
      // Center map on the feature
const L = window.L;
      const bounds = L.geoJSON(feature).getBounds();
      mapApi.fitBounds(bounds, { padding: [20, 20] });
    }

    // Select the feature
    actions.setSelectedFeature(feature);
    setShowResults(false);
    setQuery("");
  };

  const handleInputFocus = () => {
    if (results) {
      setShowResults(true);
    }
  };

  const handleInputBlur = () => {
    // Delay hiding to allow clicks on results
    setTimeout(() => setShowResults(false), 200);
  };

  return (
    <div className="search-bar">
      <div className="search-input-container">
        <input
          type="search"
          className="search-input"
          placeholder="Buscar obras, programas, capas..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
        />
        {isSearching && <div className="search-spinner">⟳</div>}
      </div>

      {showResults && results && (
        <div className="search-results">
          {results.obras.length > 0 && (
            <div className="search-group">
              <h4 className="search-group-title">Obras</h4>
              {results.obras.slice(0, 5).map((feature, index) => (
                <div
                  key={`obra-${index}`}
                  className="search-result-item"
                  onClick={() => handleResultClick(feature)}
                >
                  <div className="search-result-title">
                    {feature.properties.nombre_obra || "Sin nombre"}
                  </div>
                  <div className="search-result-meta">
                    {feature.properties.programa}
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.programas.length > 0 && (
            <div className="search-group">
              <h4 className="search-group-title">Programas</h4>
              {results.programas.slice(0, 5).map((feature, index) => (
                <div
                  key={`programa-${index}`}
                  className="search-result-item"
                  onClick={() => handleResultClick(feature)}
                >
                  <div className="search-result-title">
                    {feature.properties.programa}
                  </div>
                  <div className="search-result-meta">
                    {feature.properties.nombre_obra || feature.table_name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.capas.length > 0 && (
            <div className="search-group">
              <h4 className="search-group-title">Capas</h4>
              {results.capas.slice(0, 5).map((capa, index) => (
                <div
                  key={`capa-${index}`}
                  className="search-result-item"
                  onClick={() => {
                    // Load and show the layer
                    actions.toggleLayerVisibility(capa.table_name);
                    setShowResults(false);
                    setQuery("");
                  }}
                >
                  <div className="search-result-title">{capa.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
