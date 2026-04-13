import React from 'react';

const STORAGE_KEY = 'sigsobse_onboarding_v1';

const STEPS = [
  {
    emoji: '🗺️',
    title: 'Bienvenido al SIG-SOBSE',
    body: 'Sistema de Información Geográfica de la Secretaría de Obras y Servicios de la Ciudad de México.',
  },
  {
    emoji: '🔍',
    title: 'Busca cualquier obra',
    body: 'Usa el buscador para encontrar obras por plantel, dirección, colonia o programa. Toca un resultado para centrarlo y abrir su ficha.',
  },
  {
    emoji: '🗂️',
    title: 'Controla las capas',
    body: 'Activa o desactiva capas desde el panel. Cada capa representa un programa de obra pública agrupado por Dirección General.',
  },
  {
    emoji: '📊',
    title: 'Monitorea el avance',
    body: 'El panel de indicadores muestra avance, riesgos y semaforización geográfica actualizada.',
  },
];

export function shouldShowOnboarding() {
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

function MobileOnboarding({ onDone }) {
  const [step, setStep] = React.useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // silently ignore
    }
    onDone();
  };

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <span className="onboarding__emoji" aria-hidden="true">
          {current.emoji}
        </span>
        <h2 className="onboarding__title">{current.title}</h2>
        <p className="onboarding__body">{current.body}</p>

        <div className="onboarding__dots">
          {STEPS.map((_, i) => (
            <span
              className={`onboarding__dot${i === step ? ' is-active' : ''}`}
              key={i}
            />
          ))}
        </div>

        <button
          className="onboarding__next"
          onClick={isLast ? finish : () => setStep((s) => s + 1)}
          type="button"
        >
          {isLast ? 'Comenzar' : 'Siguiente'}
        </button>

        {!isLast && (
          <button
            className="onboarding__skip"
            onClick={finish}
            type="button"
          >
            Saltar guía
          </button>
        )}
      </div>
    </div>
  );
}

export default MobileOnboarding;
