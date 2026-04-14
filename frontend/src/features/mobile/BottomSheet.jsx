import React from 'react';

const CLOSE_THRESHOLD = 90;

function BottomSheet({ children, isOpen, onClose, subtitle, title }) {
  const [dragOffset, setDragOffset] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStateRef = React.useRef(null);
  // Ref para evitar que dragOffset en el closure de handleUp quede desactualizado
  // y para no incluirlo en deps del effect (lo cual re-registraba listeners en cada frame).
  const dragOffsetRef = React.useRef(0);

  React.useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
      dragOffsetRef.current = 0;
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isDragging) return undefined;

    const handleMove = (event) => {
      if (!dragStateRef.current) return;
      const delta = Math.max(0, event.clientY - dragStateRef.current.startY);
      dragOffsetRef.current = delta;
      setDragOffset(delta);
    };

    const handleUp = () => {
      if (!dragStateRef.current) return;
      // Leer el ref, no el closure — evita leer valor desactualizado
      if (dragOffsetRef.current > CLOSE_THRESHOLD) onClose();
      dragStateRef.current = null;
      dragOffsetRef.current = 0;
      setIsDragging(false);
      setDragOffset(0);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // dragOffset ya NO está en deps — se lee por ref.
    // Esto evita des-registrar y re-registrar listeners en cada frame del drag.
  }, [isDragging, onClose]);

  const handlePointerDown = (event) => {
    dragStateRef.current = { startY: event.clientY };
    setIsDragging(true);
  };

  return (
    <div className={`bsheet${isOpen ? ' is-open' : ''}`}>
      <div className="bsheet__backdrop" onClick={onClose} />
      <section
        className="bsheet__surface"
        style={{
          transform: isOpen
            ? `translateY(${dragOffset}px)`
            : 'translateY(calc(100% + 20px))',
        }}
      >
        <header className="bsheet__header">
          <button
            className="bsheet__handle-btn"
            onPointerDown={handlePointerDown}
            type="button"
          >
            <span className="bsheet__handle" />
          </button>
          <div className="bsheet__title-group">
            <strong className="bsheet__title">{title}</strong>
            {subtitle && (
              <span className="bsheet__subtitle">{subtitle}</span>
            )}
          </div>
          <button
            className="bsheet__close"
            onClick={onClose}
            type="button"
          >
            <svg fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 5 5 15M5 5l10 10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            </svg>
          </button>
        </header>

        <div className="bsheet__content">{children}</div>
      </section>
    </div>
  );
}

export default BottomSheet;
