import React from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { StoreProvider } from './store';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { Spinner } from './components';
import { installCrashHandlers } from './lib/crashLog';
import { Restaurants } from './pages/Restaurants';
import { Scan } from './pages/Scan';
import { TableGate } from './pages/TableGate';
import { Menu } from './pages/Menu';
import { Cart } from './pages/Cart';
import { Track } from './pages/Track';
import { Bill } from './pages/Bill';

/**
 * PHASE 3: ONLY THE DINER'S SCREENS ARE IN THE FIRST DOWNLOAD.
 *
 * A diner scanning a table QR on a slow phone used to download the whole
 * restaurant portal (billing, reports, the menu manager, Excel import) before
 * the menu could appear. The portal now loads in its own chunks, on demand,
 * the first time someone opens /partner -- the diner path is the scan, the
 * menu, the cart, tracking and the bill, and nothing else.
 */
const lazyNamed = <T extends Record<string, any>>(load: () => Promise<T>, name: keyof T) =>
  React.lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType<any> })));

const Reserve = lazyNamed(() => import('./pages/Reserve'), 'Reserve');
const BuffetPick = lazyNamed(() => import('./pages/BuffetPick'), 'BuffetPick');
const PublicRestaurant = lazyNamed(() => import('./pages/PublicRestaurant'), 'PublicRestaurant');
const BillOnline = lazyNamed(() => import('./pages/BillOnline'), 'BillOnline');
const PartnerLogin = lazyNamed(() => import('./pages/partner/PartnerLogin'), 'PartnerLogin');
const PlanScreen = lazyNamed(() => import('./pages/partner/PlanScreen'), 'PlanScreen');
const PartnerShell = lazyNamed(() => import('./pages/partner/PartnerShell'), 'PartnerShell');
const Register = lazyNamed(() => import('./pages/partner/Register'), 'Register');
const OrdersBoard = lazyNamed(() => import('./pages/partner/OrdersBoard'), 'OrdersBoard');
const MenuManager = lazyNamed(() => import('./pages/partner/MenuManager'), 'MenuManager');
const Reports = lazyNamed(() => import('./pages/partner/Reports'), 'Reports');
const TablesQR = lazyNamed(() => import('./pages/partner/TablesQR'), 'TablesQR');
const Billing = lazyNamed(() => import('./pages/partner/Billing'), 'Billing');
const Reservations = lazyNamed(() => import('./pages/partner/Reservations'), 'Reservations');
const Buffets = lazyNamed(() => import('./pages/partner/Buffets'), 'Buffets');
const Showcase = lazyNamed(() => import('./pages/partner/Showcase'), 'Showcase');
const Settings = lazyNamed(() => import('./pages/partner/Settings'), 'Settings');
const Notifications = lazyNamed(() => import('./pages/partner/Notifications'), 'Notifications');
const Account = lazyNamed(() => import('./pages/partner/Account'), 'Account');
const DesignPreview = lazyNamed(() => import('./pages/partner/DesignPreview'), 'DesignPreview');
const Gate = lazyNamed(() => import('./pages/partner/Gate'), 'Gate');
const BillSettings = lazyNamed(() => import('./pages/partner/BillSettings'), 'BillSettings');

/** The platform console. Lazy, so its code and styles live in their own chunk
 *  and are never downloaded by a diner or a restaurant -- only by someone who
 *  opens /admin. Everything it reads is admin-checked in Postgres. */
const AdminApp = React.lazy(() => import('./pages/admin/AdminApp'));

/** The retired Chat and Alerts addresses, query string kept: a stale
 *  /partner/chat?table=… link still opens that table's reply. */
function LegacyToNotifications() {
  const loc = useLocation();
  return <Navigate to={`/partner/notifications${loc.search}`} replace />;
}

/** One broken screen never takes the site down, and leaving it clears it. */
function Boundary({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return <RouteErrorBoundary resetKey={loc.pathname}>{children}</RouteErrorBoundary>;
}

// Path routing in production (printed QRs encode /scan/<token>); hash routing
// for single-file/static-preview builds where the host can't rewrite paths.
const Router = import.meta.env.VITE_HASH_ROUTER ? HashRouter : BrowserRouter;

export function App() {
  React.useEffect(() => { installCrashHandlers(); }, []);
  return (
    <StoreProvider>
      <div className="ambient" aria-hidden />
      <Router>
        <Boundary>
        <React.Suspense fallback={<Spinner label="Loading…" />}>
        <Routes>
          {/* '/' is the static marketing page, copied over index.html at deploy
              (see .github/workflows/deploy.yml). Inside the SPA -- hash-router
              previews -- it has nothing to show, so it goes where every other
              unknown path goes. */}
          <Route path="/" element={<Navigate to="/table" replace />} />
          <Route path="/restaurants" element={<Restaurants />} />
          <Route path="/r/:slug" element={<PublicRestaurant />} />
          {/* THE DINER FALLBACK. Every session-less diner path lands here --
              see TableGate for why it is not '/'. */}
          <Route path="/table" element={<TableGate />} />
          <Route path="/reserve" element={<Reserve />} />
          <Route path="/buffet" element={<BuffetPick />} />
          <Route path="/scan/:token" element={<Scan />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/track/:id" element={<Track />} />
          <Route path="/bill" element={<Bill />} />
          {/* The bill a diner was sent on WhatsApp (2026-10-11). */}
          <Route path="/b/:token" element={<BillOnline />} />
          <Route path="/partner" element={<PartnerLogin />} />
          <Route path="/partner/register" element={<Register />} />
          {/* Screens for approval, drawn from fixtures. See DesignPreview. */}
          <Route path="/partner/preview" element={<DesignPreview />} />
          <Route element={<PartnerShell />}>
            <Route path="/partner/orders" element={<OrdersBoard />} />
            <Route path="/partner/menu" element={<MenuManager />} />
            <Route path="/partner/tables" element={<TablesQR />} />
            <Route path="/partner/billing" element={<Billing />} />

            <Route path="/partner/reports" element={<Gate feature="detailed_reports" what="Detailed reports"><Reports /></Gate>} />
            <Route path="/partner/buffets" element={<Buffets />} />
            <Route path="/partner/showcase" element={<Showcase />} />
            <Route path="/partner/reservations" element={<Gate feature="reservations" what="Reservations"><Reservations /></Gate>} />
            {/* Chat and Alerts are one section now. Their old addresses still
                land somewhere useful -- a bookmarked /partner/chat?table=… opens
                that table's reply. */}
            <Route path="/partner/notifications" element={<Gate feature="notifications" what="Notifications"><Notifications /></Gate>} />
            <Route path="/partner/chat" element={<LegacyToNotifications />} />
            <Route path="/partner/alerts" element={<LegacyToNotifications />} />
            <Route path="/partner/account" element={<Account />} />
            <Route path="/partner/bill-settings" element={<BillSettings />} />
            <Route path="/partner/settings" element={<Settings />} />
          </Route>
          <Route path="/partner/plan" element={<PlanScreen />} />
          <Route path="/admin/*" element={<AdminApp />} />
          {/* UNKNOWN PATHS GO TO THE TABLE GATE, not to '/'.
              '/' is the marketing landing on the deployed site, so a diner who
              mistypes a URL or follows a stale link would have been dropped on
              a page selling restaurant accounts. The gate is the safe default. */}
          <Route path="*" element={<Navigate to="/table" replace />} />
        </Routes>
        </React.Suspense>
        </Boundary>
      </Router>
    </StoreProvider>
  );
}
