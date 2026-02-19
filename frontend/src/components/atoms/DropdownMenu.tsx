import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../utils/cn';

export interface DropdownMenuItem {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onClick?: () => void;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  children: React.ReactNode;
  align?: 'left' | 'right';
  sideOffset?: number;
  triggerClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

type Coords = { top: number; left: number; maxHeight?: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  items,
  children,
  align = 'right',
  sideOffset = 8,
  triggerClassName,
  menuClassName,
  ariaLabel = 'More actions',
  disabled = false
}) => {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);

  const isBrowser = typeof document !== 'undefined';

  const visibleItems = useMemo(() => items.filter((item) => Boolean(item?.label)), [items]);

  useEffect(() => {
    if (!open) {
      setCoords(null);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (!isBrowser) return;

    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const updatePosition = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const padding = 10;

      let left =
        align === 'right' ? triggerRect.right - menuRect.width : triggerRect.left;
      left = clamp(left, padding, viewportW - padding - menuRect.width);

      let top = triggerRect.bottom + sideOffset;
      let maxHeight: number | undefined;
      if (top + menuRect.height > viewportH - padding) {
        const above = triggerRect.top - sideOffset - menuRect.height;
        if (above >= padding) {
          top = above;
        } else {
          const spaceBelow = viewportH - padding - (triggerRect.bottom + sideOffset);
          const spaceAbove = triggerRect.top - sideOffset - padding;
          if (spaceAbove > spaceBelow) {
            maxHeight = spaceAbove;
            top = padding;
          } else {
            maxHeight = spaceBelow;
            top = triggerRect.bottom + sideOffset;
          }
        }
      }

      setCoords({ top, left, maxHeight });
    };

    updatePosition();

    let raf = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(updatePosition);
    };

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.cancelAnimationFrame(raf);
    };
  }, [align, isBrowser, open, sideOffset]);

  useEffect(() => {
    if (!open) return;
    if (!isBrowser) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isBrowser, open]);

  const handleTriggerClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const handleItemClick = (item: DropdownMenuItem) => (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (item.disabled) return;
    if (item.onClick) item.onClick();
    setOpen(false);
  };

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onClick={handleTriggerClick}
        className={cn(triggerClassName)}
      >
        {children}
      </button>

      {open && isBrowser
        ? createPortal(
            <div
              id={menuId}
              ref={menuRef}
              role="menu"
              className={cn(
                'fixed z-[9999] w-60 rounded-xl border border-line/70 bg-card/95 p-1 shadow-lg shadow-black/10 backdrop-blur-sm',
                menuClassName
              )}
              style={{
                top: coords?.top ?? 0,
                left: coords?.left ?? 0,
                opacity: coords ? 1 : 0,
                pointerEvents: coords ? 'auto' : 'none',
                maxHeight: coords?.maxHeight ?? undefined,
                overflowY: coords?.maxHeight ? 'auto' : undefined
              }}
            >
              {visibleItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      item.tone === 'danger'
                        ? 'text-red-500 hover:bg-red-500/10'
                        : 'text-foreground hover:bg-panel/70'
                    )}
                    disabled={item.disabled}
                    onClick={handleItemClick(item)}
                  >
                    {Icon ? (
                      <Icon
                        className={cn(
                          'h-4 w-4',
                          item.tone === 'danger' ? 'text-red-500' : 'text-muted'
                        )}
                      />
                    ) : null}
                    {item.label}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
};

