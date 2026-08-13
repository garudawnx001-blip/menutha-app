/** Razorpay hosted Checkout loader — shared by the Plan screen (platform
 *  subscriptions) and diner gateway checkout (restaurant's own account). */
declare global {
  interface Window { Razorpay?: any }
}

export function loadCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay checkout.'));
    document.head.appendChild(s);
  });
}
