// Renderer entry point: loads styles and starts the app. The renderer never makes network requests itself.
import './styles/tokens.css';
import './styles/base.css';
import { startApp } from './ui/app';

const root = document.getElementById('app');
if (root) void startApp(root);
