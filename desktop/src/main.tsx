import './styles/app.css';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { Providers } from './app/providers';
import { ErrorBoundary } from './components/domain/ScreenFrame';
const root=document.getElementById('root');
if(!root)throw new Error('Missing #root element.');
createRoot(root).render(<ErrorBoundary><Providers><App/></Providers></ErrorBoundary>);
