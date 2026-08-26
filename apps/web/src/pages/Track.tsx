/** Live order tracking — timeline Placed → Being cooked → Ready →
 *  Served, refreshed by polling get_order_status (guest-safe; realtime RLS
 *  hides guest rows, so polling is the reliable channel). Handles cancelled. */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchOrderStatus, fetchPaymentQr, startGatewayCheckout, type PaymentQr } from '../lib/api';
import { buildUpiUri, isValidVpa } from '../../../../packages/payments/index.js';
import type { OrderView } from '../lib/types';
import { inr } from '../lib/types';
import { useStore } from '../store';
import { Spinner, Wordmark } from '../components';

/** Dine-in, not delivery: the diner is already sitting at the table, so the
 *  courier-style five-stage timeline ("accepted", "on its way to you") was both
 *  jargon and the wrong metaphor. Four honest states, plainly worded. The
 *  kitchen's own statuses are unchanged — only the diner's wording is. */
const STEPS: { key: string; title: string; body: string }[] = [
  { key: 'placed', title: 'Order placed', body: 'The kitchen has your order.' },
  { key: 'preparing', title: 'Being cooked', body: 'Your food is on the fire.' },
  { key: 'ready', title: 'Ready', body: 'Coming to your table.' },
  { key: 'served', title: 'Served', body: 'Enjoy your meal.' },
];

const STAGE_INDEX: Record<string, number> = {
  placed: 0,
  accepted: 0,
  preparing: 1,
  ready: 2,
  served: 3,
};
