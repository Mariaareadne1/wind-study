import { useCallback, useEffect, useRef } from 'react';
import type { WindApp } from '../app/WindApp';
import { saveRecording, saveStill, startRecording, type ActiveRecording } from '../capture/capture';
import { type Store, type Strength, useStore } from '../state/store';
import type { PatternName } from '../wind/patterns';

const STRENGTHS: { id: Strength; label: string; tip: string }[] = [
  { id: 'breeze', label: 'Breeze', tip: 'Gentle wind' },
  { id: 'gust', label: 'Gust', tip: 'Medium wind' },
  { id: 'gale', label: 'Gale', tip: 'Strong wind' },
];

const PATTERNS: { key: string; name: PatternName; label: string }[] = [
  { key: '1', name: 'sweep', label: 'A long sweep' },
  { key: '2', name: 'spiral', label: 'A spiral' },
  { key: '3', name: 'flick', label: 'A quick flick' },
  { key: '4', name: 'crossing', label: 'Two crossing gusts' },
];

interface Props {
  store: Store;
  app: WindApp | null;
}

export function Controls({ store, app }: Props) {
  const s = useStore(store, (x) => x);
  const recording = useRef<ActiveRecording | null>(null);
  const toastTimer = useRef(0);

  const toast = useCallback(
    (message: string) => {
      store.set({ toast: message });
      clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => store.set({ toast: null }), 2600);
    },
    [store],
  );

  const capture = useCallback(async () => {
    if (!app) return;
    try {
      await saveStill(app);
      toast('Saved a still.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Capture failed.');
    }
  }, [app, toast]);

  const toggleRecording = useCallback(async () => {
    if (!app) return;
    if (recording.current) {
      const active = recording.current;
      recording.current = null;
      store.set({ recording: false });
      active.stop();
      try {
        const { blob, extension } = await active.done;
        saveRecording(blob, extension);
        toast('Saved the recording.');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Recording failed.');
      }
      return;
    }
    try {
      recording.current = startRecording(app.canvas);
      store.set({ recording: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Recording failed.');
    }
  }, [app, store, toast]);

  useEffect(() => {
    if (!app) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = store.get();
      const target = e.target as HTMLElement;
      if (e.key === 'Escape') {
        store.set({ helpOpen: false });
        return;
      }
      // Space and Enter belong to a focused button
      if ((e.key === ' ' || e.key === 'Enter') && target.tagName === 'BUTTON') return;
      const p = PATTERNS.find((x) => x.key === e.key);
      if (p) app.play(p.name);
      else if (e.key === ' ') {
        e.preventDefault();
        app.setPaused(!st.paused);
      } else if (e.key === 'z' || e.key === 'Z') app.undo();
      else if (e.key === 'c' || e.key === 'C') app.clearWind();
      else if (e.key === 'r' || e.key === 'R') app.resetScene();
      else if (e.key === 'h' || e.key === 'H') store.set({ uiHidden: !st.uiHidden });
      else if (e.key === 's' || e.key === 'S') void capture();
      else if (e.key === '?') store.set({ helpOpen: !st.helpOpen });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, store, capture]);

  if (s.uiHidden) {
    return (
      <div className="ui">
        <button className="reveal" onClick={() => store.set({ uiHidden: false })} aria-label="Show interface">
          Show interface
        </button>
      </div>
    );
  }

  const off = !app;
  return (
    <div className="ui">
      <header className="title">
        <h1>Wind Study</h1>
        <p>Draw the invisible.</p>
      </header>

      <nav className="corner top-right" aria-label="Scene">
        <button disabled={off} onClick={() => app?.resetScene()} title="Restore the original meadow (R)">Reset</button>
        <button onClick={() => store.set({ helpOpen: !s.helpOpen })} aria-expanded={s.helpOpen} title="Controls and shortcuts (?)">Help</button>
      </nav>

      <nav className="corner bottom-left" aria-label="Wind">
        <div className="segmented" role="radiogroup" aria-label="Wind strength">
          {STRENGTHS.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={s.strength === o.id}
              className={s.strength === o.id ? 'on' : ''}
              onClick={() => store.set({ strength: o.id })}
              title={o.tip}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="rule" aria-hidden="true" />
        <button disabled={off || s.active === 0} onClick={() => app?.undo()} title="Calm the latest gust that is still blowing (Z)">Undo</button>
        <button disabled={off} onClick={() => app?.clearWind()} title="Calm all drawn wind; the breeze stays (C)">Clear</button>
        <button disabled={off} onClick={() => app?.setPaused(!s.paused)} aria-pressed={s.paused} title="Freeze the wind (Space)">
          {s.paused ? 'Resume' : 'Pause'}
        </button>
      </nav>

      <nav className="corner bottom-right" aria-label="Capture">
        <button disabled={off} onClick={() => void capture()} title="Save a still, without the interface (S)">Capture</button>
        <button disabled={off} onClick={() => void toggleRecording()} aria-pressed={s.recording} title="Record the canvas to a video file">
          {s.recording ? 'Stop recording' : 'Record'}
        </button>
        <button onClick={() => store.set({ uiHidden: true })} title="Hide the interface (H)">Hide</button>
      </nav>

      {s.hint && !s.loading && !s.error && <p className="hint">Draw to make the wind blow.</p>}
      {s.toast && <p className="toast" role="status">{s.toast}</p>}

      {s.helpOpen && (
        <aside className="help" aria-label="Help">
          <p>Press and drag anywhere. A long line makes a rolling gust, a flick a short burst, a spiral a whirl. Overlapping gusts combine.</p>
          <h2>Wind without a pointer</h2>
          <ul className="patterns">
            {PATTERNS.map((p) => (
              <li key={p.key}>
                <button disabled={off} onClick={() => app?.play(p.name)}>{p.label}</button>
                <kbd>{p.key}</kbd>
              </li>
            ))}
          </ul>
          <h2>Keys</h2>
          <dl>
            <dt>Space</dt><dd>Pause</dd>
            <dt>Z</dt><dd>Undo the latest gust</dd>
            <dt>C</dt><dd>Clear drawn wind</dd>
            <dt>R</dt><dd>Reset</dd>
            <dt>S</dt><dd>Capture a still</dd>
            <dt>H</dt><dd>Hide the interface</dd>
          </dl>
          <button className="close" onClick={() => store.set({ helpOpen: false })}>Close</button>
        </aside>
      )}
    </div>
  );
}
