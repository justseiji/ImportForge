import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Boxes,
  Building2,
  ChevronDown,
  Import,
  LogOut,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { api, client } from './lib/api';
import { ErrorBox, Loading } from './components/ui';
import { Imports, NewImport } from './features/imports/overview';
import { ImportWorkspace } from './features/imports/workspace';
import { Catalog, ProductDetail } from './features/catalog';
import { Suppliers } from './features/suppliers';
import { Settings, Login } from './features/workspace';
import './styles.css';
import './readability.css';
import { useSession } from './lib/session';
function Shell() {
  const session = useSession();
  const navigate = useNavigate();
  if (session.isPending) return <Loading />;
  if (!session.data) return <Login />;
  const { user, workspace, mode } = session.data;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="wordmark" to="/imports">
          <span className="brand-glyph">
            <ArrowRightLeft size={20} />
          </span>
          ImportForge<span className="brand-period">.</span>
        </NavLink>
        <div className="workspace-selector">
          <span className="workspace-avatar">N</span>
          <div>
            <strong>{workspace.name}</strong>
            <small>Product workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            [Import, '/imports', 'Imports'],
            [Boxes, '/catalog', 'Catalog'],
            [Building2, '/suppliers', 'Suppliers'],
            [Settings2, '/settings', 'Workspace settings'],
          ].map(([Icon, path, label]: any) => (
            <NavLink key={path} to={path}>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={19} />
          <strong>Your catalog, under control.</strong>
          <p>
            Every change reviewed.
            <br />
            Every import traceable.
          </p>
        </div>
        <div className="sidebar-user">
          <span className="user-avatar">
            {user.name
              .split(' ')
              .map((n: string) => n[0])
              .join('')}
          </span>
          <div>
            <strong>{user.name}</strong>
            <small>
              {user.role} · {mode === 'local' ? 'Local demo' : 'Workspace'}
            </small>
          </div>
          <button
            className="logout"
            title="Sign out"
            aria-label="Sign out"
            onClick={async () => {
              await api('/auth/logout', {});
              client.clear();
              navigate('/imports');
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> <strong>{workspace.name}</strong>
          </span>
          <span className="environment">
            <span />
            {mode === 'local' ? 'Local workspace' : 'Connected workspace'}
          </span>
        </header>
        <main>
          <ErrorBox error={session.error} />
          <Routes>
            <Route path="/imports" element={<Imports />} />
            <Route path="/imports/new" element={<NewImport />} />
            <Route path="/imports/:id" element={<ImportWorkspace />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/catalog/:id" element={<ProductDetail />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/imports" replace />} />
          </Routes>
        </main>
        <footer className="app-footer">
          <span>
            IMPORTFORGE <span className="footer-dot">•</span> Built for better catalog data
          </span>
          <span>Review first. Import with confidence.</span>
        </footer>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
