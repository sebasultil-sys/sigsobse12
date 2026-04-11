import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

jest.mock('./features/map/MapView.jsx', () => () => <div>Mapa GIS</div>);

test('renders gis workspace shell', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = ReactDOM.createRoot(container);

  act(() => {
    root.render(<App />);
  });

  expect(container.textContent).toMatch(/visualizador gis operativo/i);
  expect(container.textContent).toMatch(/navegador de proyecto/i);
  expect(container.textContent).toMatch(/mapa gis/i);

  act(() => {
    root.unmount();
  });

  document.body.removeChild(container);
});
