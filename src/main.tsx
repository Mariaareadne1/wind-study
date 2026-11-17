import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/newsreader/opsz.css';
import './app/styles.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(<App />);
