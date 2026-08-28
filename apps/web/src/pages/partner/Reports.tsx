/**
 * Reports — revenue, orders and top dishes over a chosen period.
 *
 * The content is unchanged; what changed is where it lives. This was rendered
 * INSIDE the Orders board, below the live tickets, so revenue was something you
 * scrolled past while working the floor — and the partner app had it as a
 * top-level section called "Reports". Same product, two different shapes,
 * which is exactly the divergence the client kept running into when moving
 * between their phone and a laptop.
 *
 * It is now a section on both surfaces, in the same position in the same order.
 * The Orders board goes back to being only the board.
 */
import { usePartner } from './PartnerShell';
import { Growth } from './Growth';

export function Reports() {
  const { restaurant } = usePartner();
  return (
    <div className="fade-in">
      <p className="overline" style={{ marginTop: 12 }}>Reports</p>
      <h1 className="display" style={{ fontSize: 26, marginBottom: 4 }}>How the restaurant is doing</h1>
      <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
        Revenue and orders over any period, and the dishes that earn most.
      </p>
      <Growth restaurantId={restaurant.id} />
    </div>
  );
}
