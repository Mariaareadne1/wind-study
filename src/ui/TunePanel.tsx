import { type Store, useStore } from '../state/store';
import { DEFAULT_TUNING, PRESETS, type PresetName, presetOf, TUNING_CONTROLS, type TuningKey } from '../state/tuning';

const PRESET_LABELS: { id: PresetName; label: string; tip: string }[] = [
  { id: 'less', label: 'Less', tip: 'The grass barely stirs' },
  { id: 'default', label: 'Default', tip: 'As designed' },
  { id: 'more', label: 'More', tip: 'The grass is thrown about' },
];

interface Props {
  store: Store;
  onDemo: () => void;
  demoDisabled: boolean;
}

export function TunePanel({ store, onDemo, demoDisabled }: Props) {
  const tuning = useStore(store, (s) => s.tuning);
  const framed = useStore(store, (s) => s.framed);
  const active = presetOf(tuning);
  const set = (key: TuningKey, value: number) => store.set({ tuning: { ...tuning, [key]: value } });

  return (
    <aside className="help tune" aria-label="Tune the wind and grass">
      <div className="segmented presets" role="radiogroup" aria-label="How much the grass is affected">
        {PRESET_LABELS.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={active === p.id}
            className={active === p.id ? 'on' : ''}
            title={p.tip}
            onClick={() => store.set({ tuning: { ...PRESETS[p.id] } })}
          >
            {p.label}
          </button>
        ))}
      </div>
      {TUNING_CONTROLS.map((c) => (
        <label key={c.key} className="slider" title={c.hint}>
          <span>{c.label}</span>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={0.05}
            value={tuning[c.key]}
            onChange={(e) => set(c.key, Number(e.target.value))}
            onDoubleClick={() => set(c.key, DEFAULT_TUNING[c.key])}
          />
          <output>{Math.round(tuning[c.key] * 100)}%</output>
        </label>
      ))}
      <label className="check">
        <input type="checkbox" checked={framed} onChange={(e) => store.set({ framed: e.target.checked })} />
        <span>Painted border</span>
      </label>
      <button className="demo" disabled={demoDisabled} onClick={onDemo} title="Hides the interface, plays a 20-second demo and saves a video of it">
        Record 20-second demo
      </button>
      <button className="close" onClick={() => store.set({ tuneOpen: false })}>Close</button>
    </aside>
  );
}
