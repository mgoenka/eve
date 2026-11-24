/* generated from app-platform/ui-kit — edit there and re-sync. */
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../utils/cx';
import { CloseIcon, MinusIcon, PlusIcon } from './icons';

export interface PlayerSetupRowProps {
  name: string;
  onNameChange: (name: string) => void;
  /** Placeholder / accessible label of the name field. Default "Player name". */
  nameLabel?: string;
  maxLength?: number;
  /** Current colour (any CSS colour). */
  color?: string;
  /** Colours to choose from; the swatch (44px) cycles through them, or opens a picker row when there are > 6. */
  colors?: string[];
  onColorChange?: (color: string) => void;
  /** Human / AI toggle (44px). Omit onAiChange to hide it. */
  isAi?: boolean;
  onAiChange?: (ai: boolean) => void;
  /** A −/+ stepper (44px each), e.g. AI level or handicap. */
  stepper?: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string; format?: (v: number) => ReactNode };
  /** Remove button (44px). */
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}

const square = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-mg border border-mg-border bg-mg-surface text-mg-muted transition-colors hover:bg-mg-surface-2 hover:text-mg-text disabled:opacity-40';

/** One player in a setup list: colour swatch · name · Human/AI · −/+ · remove. Every control is at least 44px. */
export function PlayerSetupRow({
  name,
  onNameChange,
  nameLabel = 'Player name',
  maxLength = 20,
  color,
  colors = [],
  onColorChange,
  isAi = false,
  onAiChange,
  stepper,
  onRemove,
  disabled,
  className,
}: PlayerSetupRowProps) {
  const id = useId();
  const [picking, setPicking] = useState(false);
  const many = colors.length > 6;
  const nextColor = () => {
    if (!onColorChange || !colors.length) return;
    if (many) return setPicking((v) => !v);
    const i = colors.indexOf(color ?? '');
    onColorChange(colors[(i + 1) % colors.length]!);
  };
  return (
    <div className={cx('flex flex-col gap-2 rounded-mg border border-mg-border bg-mg-surface/60 p-2', className)}>
      <div className="flex items-center gap-2">
        {color !== undefined ? (
          <button
            type="button"
            disabled={disabled || !onColorChange}
            onClick={nextColor}
            aria-label={`Colour for ${name || 'this player'}${onColorChange ? ', change' : ''}`}
            aria-expanded={many ? picking : undefined}
            className="relative h-11 w-11 shrink-0 rounded-full border-2 border-white/20 disabled:cursor-default"
            style={{ backgroundColor: color }}
          />
        ) : null}
        <input
          id={id}
          type="text"
          value={name}
          disabled={disabled}
          maxLength={maxLength}
          autoComplete="off"
          aria-label={nameLabel}
          placeholder={nameLabel}
          onChange={(e) => onNameChange(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-mg-sm border border-mg-border bg-mg-bg px-3 text-base text-mg-text placeholder:text-mg-subtle"
        />
        {onAiChange ? (
          <button
            type="button"
            role="switch"
            aria-checked={isAi}
            aria-label={`${name || 'Player'}: ${isAi ? 'AI' : 'Human'}`}
            disabled={disabled}
            onClick={() => onAiChange(!isAi)}
            className={cx(
              'inline-flex h-11 min-w-16 shrink-0 items-center justify-center rounded-mg border px-3 text-sm font-semibold transition-colors',
              isAi ? 'border-mg-info/40 bg-mg-info/10 text-sky-300' : 'border-mg-border bg-mg-surface text-mg-text-2',
            )}
          >
            {isAi ? '🤖 AI' : 'Human'}
          </button>
        ) : null}
        {onRemove ? (
          <button type="button" aria-label={`Remove ${name || 'player'}`} disabled={disabled} onClick={onRemove} className={square}>
            <CloseIcon size={18} />
          </button>
        ) : null}
      </div>
      {stepper ? (
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm text-mg-muted">{stepper.label}</span>
          <button
            type="button"
            aria-label={`${stepper.label}: less`}
            disabled={disabled || stepper.value <= (stepper.min ?? -Infinity)}
            onClick={() => stepper.onChange(Math.max(stepper.min ?? -Infinity, stepper.value - 1))}
            className={square}
          >
            <MinusIcon size={18} />
          </button>
          <span className="min-w-10 text-center font-mono text-base font-semibold text-mg-text" aria-live="polite">
            {stepper.format ? stepper.format(stepper.value) : stepper.value}
          </span>
          <button
            type="button"
            aria-label={`${stepper.label}: more`}
            disabled={disabled || stepper.value >= (stepper.max ?? Infinity)}
            onClick={() => stepper.onChange(Math.min(stepper.max ?? Infinity, stepper.value + 1))}
            className={square}
          >
            <PlusIcon size={18} />
          </button>
        </div>
      ) : null}
      {many && picking && onColorChange ? (
        <div role="listbox" aria-label="Colours" className="flex flex-wrap gap-2">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={c === color}
              aria-label={c}
              onClick={() => {
                onColorChange(c);
                setPicking(false);
              }}
              className={cx('h-11 w-11 rounded-full border-2', c === color ? 'border-mg-gold' : 'border-white/20')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
