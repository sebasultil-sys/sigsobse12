import React from 'react';

const CLOSE_THRESHOLD = 90;

function BottomSheet({ children, isOpen, onClose, subtitle, title }) {
  const [dragOffset, setDragOffset] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStateRef = React.useRef(null);

  React.useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isDragging) return undefined;

    const handleMove = (event) => {
      if (!dragStateRef.current) return;
      const delta = event.clientY - dragStateRef.current.startY;
      setDragOffset(Math.max(0, delta));
    };

    const handleUp = () => {
      if (!dragStateRef.current) return;
      if (dragOffset > CLOSE_THRESHOLD) onClose();
      dragStateRef.current = null;
      setIsDragging(false);
      setDragOffset(0);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragOffset, isDragging, onClose]);

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
