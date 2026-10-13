import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

// Adapted from https://ui.aceternity.com/registry/notch.json:
// same layout spring and staggered option reveal, anchored in the account header.
// `ghostClosed` renders the closed trigger without its own surface so the notch
// blends into a transparent navbar; opening still reveals the raised panel.
export default function AccountNotch({ label, trigger, options, onSelect, ghostClosed }: {
  label: string; trigger: ReactNode;
  options: { id: string; label: string; danger?: boolean }[];
  onSelect: (id: string) => void;
  ghostClosed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', close); };
  }, [open]);
  const restore = () => { setOpen(false); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus()); };
  return <div ref={root} className="relative h-11 w-32 shrink-0 md:w-60" onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); restore(); }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const items = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <motion.div layout initial={false} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
      style={{ width: '100%' }}
      className={cn(
        'absolute right-0 top-0 z-50 overflow-hidden rounded-2xl border shadow-sm',
        ghostClosed && !open
          ? 'border-transparent bg-transparent text-white [&>button:hover]:bg-white/5'
          : 'border-line bg-surface-raised text-ink',
      )}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-controls={id} aria-expanded={open}
        onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-surface-muted">
        {trigger}
      </button>
      <AnimatePresence initial={false} mode="popLayout">
        {open && <motion.div id={id} role="menu" aria-label={label} key="options"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.15 }}>
          <motion.div className="flex flex-col gap-1 border-t border-line p-2" initial="hidden" animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: reduced ? 0 : 0.045, delayChildren: reduced ? 0 : 0.08 } } }}>
            {options.map(option => <motion.button key={option.id} role="menuitem" type="button"
              variants={{ hidden: { opacity: 0, y: reduced ? 0 : -10, filter: reduced ? 'none' : 'blur(4px)' }, visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 30 } } }}
              className={`min-h-11 rounded-xl px-3 py-2 text-left text-sm ${option.danger ? 'text-danger hover:bg-danger/5' : 'hover:bg-accent/10 hover:text-accent'}`}
              onClick={() => { setOpen(false); onSelect(option.id); }}>{option.label}</motion.button>)}
          </motion.div>
        </motion.div>}
      </AnimatePresence>
    </motion.div>
  </div>;
}
