import React from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider } from './store';
import { Landing } from './pages/Landing';
import { Restaurants } from './pages/Restaurants';
import { Scan } from './pages/Scan';
import { TableGate } from './pages/TableGate';
import { DinerStart } from './pages/DinerStart';
import { Reserve } from './pages/Reserve';
import { BuffetPick } from './pages/BuffetPick';
import { PublicRestaurant } from './pages/PublicRestaurant';
import { PartnerLogin } from './pages/partner/PartnerLogin';
import { PlanScreen } from './pages/partner/PlanScreen';
import { PartnerShell } from './pages/partner/PartnerShell';
import { Register } from './pages/partner/Register';
import { OrdersBoard } from './pages/partner/OrdersBoard';
import { MenuManager } from './pages/partner/MenuManager';
import { Reports } from './pages/partner/Reports';
import { TablesQR } from './pages/partner/TablesQR';
import { Billing } from './pages/partner/Billing';
import { Reservations } from './pages/partner/Reservations';
import { Buffets } from './pages/partner/Buffets';
import { Showcase } from './pages/partner/Showcase';
import { Staff } from './pages/partner/Staff';
import { Settings } from './pages/partner/Settings';
import { Menu } from './pages/Menu';
import { Cart } from './pages/Cart';
import { Track } from './pages/Track';
import { Bill } from './pages/Bill';

// Path routing in production (printed QRs encode /scan/<token>); hash routing
// for single-file/static-preview builds where the host can't rewrite paths.
const Router = import.meta.env.VITE_HASH_ROUTER ? HashRouter : BrowserRouter;

export function App() {
  return (
    <StoreProvider>
      <div className="ambient" aria-hidden />
      <Router>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/restaurants" element={<Restaurants />} />
          <Route path="/r/:slug" element={<PublicRestaurant />} />
          {/* THE DINER FALLBACK. Every session-less diner path lands here --
              see TableGate for why it is not '/'. */}
          <Route path="/table" element={<TableGate />} />
          {/* #P — the three doors a scan now lands on, and the two flows
              behind them. All inside the locked diner scope: no account, no
              partner link, no marketing. */}
          <Route path="/start" element={<DinerStart />} />
          <Route path="/reserve" element={<Reserve />} />
          <Route path="/buffet" element={<BuffetPick />} />
          <Route path="/scan/:token" element={<Scan />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/track/:id" element={<Track />} />
          <Route path="/bill" element={<Bill />} />
          <Route path="/partner" element={<PartnerLogin />} />
          <Route path="/partner/register" element={<Register />} />
          <Route element={<PartnerShell />}>
            <Route path="/partner/orders" element={<OrdersBoard />} />
            <Route path="/partner/menu" element={<MenuManager />} />
            <Route path="/partner/tables" element={<TablesQR />} />
            <Route path="/partner/billing" element={<Billing />} />

            <Route path="/partner/reports" element={<Reports />} />
            <Route path="/partner/buffets" element={<Buffets />} />
            <Route path="/partner/showcase" element={<Showcase />} />
            <Route path="/partner/reservations" element={<Reservations />} />
            <Route path="/partner/staff" element={<Staff />} />
            <Route path="/partner/settings" element={<Settings />} />
          </Route>
          <Route path="/partner/plan" element={<PlanScreen />} />
          {/* UNKNOWN PATHS GO TO THE TABLE GATE, not to '/'.
              '/' is the marketing landing on the deployed site, so a diner who
              mistypes a URL or follows a stale link would have been dropped on
              a page selling restaurant accounts. The gate is the safe default:
              it explains how to get to a menu and offers nothing else. Anyone
              actually after the marketing site loads '/' directly and gets it,
              because that is a real file served by Pages. */}
          <Route path="*" element={<Navigate to="/table" replace />} />
        </Routes>
      </Router>
    </StoreProvider>
  );
}
