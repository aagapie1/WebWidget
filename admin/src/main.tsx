import { render } from 'preact';
// Inter (SIL OFL 1.1, LICENSE-inter.txt), bundled: latin + latin-ext (Romanian), 400–700.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/inter/latin-ext-700.css';
import { App } from './App.js';
import './styles.css';

const root = document.getElementById('app');
if (root) render(<App />, root);
