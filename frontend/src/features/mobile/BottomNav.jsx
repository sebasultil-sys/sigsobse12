function Ico({ children }) {
  return (
    <svg
      aria-hidden="true"
      className="bnav__icon"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}



function LayersIcon() {
  return (
    <Ico>
      <path
        d="M12 4 4 8l8 4 8-4-8-4ZM4 12l8 4 8-4M4 16l8 4 8-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </Ico>
  );
}

function DashboardIcon() {
  return (
    <Ico>
      <rect
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
        width="7"
        x="3"
        y="3"
      />
      <rect
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
        width="7"
        x="14"
        y="3"
      />
      <rect
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
        width="7"
        x="3"
        y="14"
      />
      <rect
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
        width="7"
        x="14"
        y="14"
      />
    </Ico>
  );
}

function MoreIcon() {
  return (
    <Ico>
      <circle cx="12" cy="5" fill="currentColor" r="1.5" />
      <circle cx="12" cy="12" fill="currentColor" r="1.5" />
      <circle cx="12" cy="19" fill="currentColor" r="1.5" />
    </Ico>
  );
}

const NAV_ITEMS = [
  {
    id: 'layers',
    label: 'Capas',
    tooltip: 'Activa información en el mapa',
    IconComponent: LayersIcon,
  },
  {
    id: 'dashboard',
    label: 'Panel',
    tooltip: 'KPIs y semaforización',
    IconComponent: DashboardIcon,
  },
  {
    id: 'more',
    label: 'Más',
    tooltip: 'Leyenda, ayuda, configuración',
    IconComponent: MoreIcon,
  },
];

function BottomNav({ activeItem, onSelect }) {
  return (
    <nav aria-label="Menú inferior móvil" className="bnav">
      {NAV_ITEMS.map(({ id, label, IconComponent }) => (
        <button
          aria-label={label}
          className={`bnav__item${activeItem === id ? ' is-active' : ''}`}
          key={id}
          onClick={() => onSelect(id)}
          type="button"
        >
          <span className="bnav__icon-wrap">
            <IconComponent />
            {activeItem === id && <span className="bnav__active-ring" />}
          </span>
          <span className="bnav__label">{label}</span>
        </button>
      ))}
    </nav>
  );
}

export default BottomNav;
