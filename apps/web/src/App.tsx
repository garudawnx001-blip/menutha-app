import React from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider } from './store';
import { Landing } from './pages/Landing';
import { Restaurants } from './pages/Restaurants';
import { Scan } from './pages/Scan';
import { PublicRestaurant } from './pages/PublicRestaurant';
import { PartnerLogin } from './pages/partner/PartnerLogin';
import { PlanScreen } from './pages/partner/PlanScreen';
import { PartnerShell } from './pages/partner/PartnerShell';
import { Register } from './pages/partner/Register';
import { OrdersBoard } from './pages/partner/OrdersBoard';
import { MenuManager } from './pages/partner/MenuManager';
import { TablesQR } from './pages/partner/TablesQR';
import { Billing } from './pages/partner/Billing';
import { Expenses } from './pages/partner/Expenses';
import { Reservations } from './pages/partner/Reservations';
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
            <Route path="/partner/expenses" element={<Expenses />} />
            <Route path="/partner/reservations" element={<Reservations />} />
            <Route path="/partner/staff" element={<Staff />} />
            <Route path="/partner/settings" element={<Settings />} />
          </Route>
          <Route path="/partner/plan" element={<PlanScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </StoreProvider>
  );
}
