import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: IconName;
  children: ReactNode;
}

/**
 * A small modal: a sheet from the bottom on a phone, a centred panel on wider
 * screens. A native <dialog>, so focus stays inside, Escape closes it and
 * focus returns to the button that opened it. A tap on the backdrop closes it too.
 */
export function Sheet({ open, onClose, title, icon, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="sheet__panel">
        <header className="sheet__head">
          <h2 id={id} className="sheet__title">
            {icon && <Icon name={icon} size={20} className="sheet__icon" />}
            <span>{title}</span>
          </h2>
          <button type="button" className="sheet__close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </header>
        {open && children}
      </div>
    </dialog>
  );
}
