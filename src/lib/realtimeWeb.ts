/** Realtime channels for the portal — mirrors apps/mobile/src/lib/realtime.ts
 *  channel names so web and apps stay on the same wire. */
import { supabase } from './supabase';

export function subscribeOrders(restaurantId: string, onChange: () => void) {
  return supabase
    .channel(`orders:${restaurantId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'food_order', filter: `restaurant_id=eq.${restaurantId}` },
      () => onChange())
    .subscribe();
}
