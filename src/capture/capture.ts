import type { WindApp } from '../app/WindApp';

const CANDIDATES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickRecordingType(isSupported: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string | null {
  return CANDIDATES.find((t) => isSupported(t)) ?? null;
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** A clean still of the painting: the drawing buffer as it was just rendered, with no interface in it. */
export function captureStill(app: WindApp): Promise<Blob> {
  return new Promise((resolve, reject) => {
    app.onceAfterFrame(() => {
      app.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the canvas.'))), 'image/png');
    });
  });
}

export async function saveStill(app: WindApp): Promise<void> {
  save(await captureStill(app), `wind-study-${stamp()}.png`);
}

export interface ActiveRecording {
  stop: () => void;
  done: Promise<{ blob: Blob; extension: 'mp4' | 'webm' }>;
}

/** Records the live canvas, so the file holds exactly what's on screen. The container depends on the browser. */
export function startRecording(canvas: HTMLCanvasElement): ActiveRecording {
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw new Error('This browser cannot record the canvas.');
  }
  const type = pickRecordingType();
  if (!type) throw new Error('No supported video format for recording.');
  const stream = canvas.captureStream(60);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 24_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<{ blob: Blob; extension: 'mp4' | 'webm' }>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Recording failed.'));
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      if (blob.size === 0) reject(new Error('The recording came out empty.'));
      else resolve({ blob, extension: type.startsWith('video/mp4') ? 'mp4' : 'webm' });
    };
  });
  recorder.start(250);
  return { stop: () => recorder.stop(), done };
}

export function saveRecording(blob: Blob, extension: string): void {
  save(blob, `wind-study-${stamp()}.${extension}`);
}
