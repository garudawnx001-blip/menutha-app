import { useEffect, useState } from 'react';

/** Diner-facing translations.
 *
 *  SCOPE, stated plainly: this translates the app's own wording — buttons,
 *  labels, headings, status text. It does NOT translate the menu itself.
 *  Dish names, descriptions and category names are the restaurant's own data,
 *  typed by the restaurant, and only they can supply a Kannada or Hindi
 *  version of "Chicken Biriyani". Machine-translating a menu would produce
 *  confident nonsense on a printed bill, so we don't.
 *
 *  The partner portal stays in English: staff are trained on it once, and a
 *  half-translated admin surface is worse than a consistent one.
 *
 *  Adding a language is one entry in LANGS plus one block in STRINGS.
 */
export type Lang = 'en' | 'kn' | 'hi';

export const LANGS: { key: Lang; label: string; native: string }[] = [
  { key: 'en', label: 'English', native: 'English' },
  { key: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { key: 'hi', label: 'Hindi', native: 'हिंदी' },
];

type Dict = Record<string, string>;

const EN: Dict = {
  'menu.search': 'Search dishes',
  'menu.all': 'All',
  'menu.veg': 'Veg',
  'menu.nonveg': 'Non-veg',
  'menu.add': 'Add',
  'menu.choose': 'Choose',
  'menu.viewCart': 'View cart',
  'menu.item': 'item',
  'menu.items': 'items',
  'menu.none': 'No dishes match — try clearing the search or filters.',
  'menu.bill': 'Table bill',
  'gate.title': 'Who is ordering?',
  'gate.name': 'Your name',
  'gate.phone': 'Phone number',
  'gate.start': 'Start ordering',
  'cart.title': 'Your order',
  'cart.empty': 'Your cart is empty.',
  'cart.browse': 'Browse the menu',
  'cart.place': 'Place order',
  'cart.back': 'Menu',
  'track.placed': 'Order placed',
  'track.placedBody': 'The kitchen has your order.',
  'track.cooking': 'Being cooked',
  'track.cookingBody': 'Your food is on the fire.',
  'track.ready': 'Ready',
  'track.readyBody': 'Coming to your table.',
  'track.served': 'Served',
  'track.servedBody': 'Enjoy your meal.',
  'bill.title': 'Table bill',
  'bill.whole': 'Whole table',
  'bill.split': 'Split by person',
  'bill.subtotal': 'Subtotal',
  'bill.packing': 'Packing charge',
  'bill.service': 'Service charge',
  'bill.total': 'Total',
  'bill.orderMore': 'Order more',
  'bill.save': 'Save bill',
  'bill.none': 'No open orders at this table yet.',
};

const KN: Dict = {
  'menu.search': 'ಖಾದ್ಯ ಹುಡುಕಿ',
  'menu.all': 'ಎಲ್ಲಾ',
  'menu.veg': 'ಸಸ್ಯಾಹಾರಿ',
  'menu.nonveg': 'ಮಾಂಸಾಹಾರಿ',
  'menu.add': 'ಸೇರಿಸಿ',
  'menu.choose': 'ಆಯ್ಕೆ ಮಾಡಿ',
  'menu.viewCart': 'ಕಾರ್ಟ್ ನೋಡಿ',
  'menu.item': 'ಐಟಂ',
  'menu.items': 'ಐಟಂಗಳು',
  'menu.none': 'ಯಾವುದೇ ಖಾದ್ಯ ಹೊಂದಿಕೆಯಾಗಲಿಲ್ಲ.',
  'menu.bill': 'ಟೇಬಲ್ ಬಿಲ್',
  'gate.title': 'ಯಾರು ಆರ್ಡರ್ ಮಾಡುತ್ತಿದ್ದಾರೆ?',
  'gate.name': 'ನಿಮ್ಮ ಹೆಸರು',
  'gate.phone': 'ಫೋನ್ ಸಂಖ್ಯೆ',
  'gate.start': 'ಆರ್ಡರ್ ಪ್ರಾರಂಭಿಸಿ',
  'cart.title': 'ನಿಮ್ಮ ಆರ್ಡರ್',
  'cart.empty': 'ನಿಮ್ಮ ಕಾರ್ಟ್ ಖಾಲಿಯಾಗಿದೆ.',
  'cart.browse': 'ಮೆನು ನೋಡಿ',
  'cart.place': 'ಆರ್ಡರ್ ಮಾಡಿ',
  'cart.back': 'ಮೆನು',
  'track.placed': 'ಆರ್ಡರ್ ಸ್ವೀಕರಿಸಲಾಗಿದೆ',
  'track.placedBody': 'ಅಡುಗೆಮನೆಗೆ ನಿಮ್ಮ ಆರ್ಡರ್ ತಲುಪಿದೆ.',
  'track.cooking': 'ತಯಾರಾಗುತ್ತಿದೆ',
  'track.cookingBody': 'ನಿಮ್ಮ ಊಟ ಒಲೆಯ ಮೇಲಿದೆ.',
  'track.ready': 'ಸಿದ್ಧವಾಗಿದೆ',
  'track.readyBody': 'ನಿಮ್ಮ ಟೇಬಲ್‌ಗೆ ಬರುತ್ತಿದೆ.',
  'track.served': 'ಬಡಿಸಲಾಗಿದೆ',
  'track.servedBody': 'ಊಟ ಸವಿಯಿರಿ.',
  'bill.title': 'ಟೇಬಲ್ ಬಿಲ್',
  'bill.whole': 'ಇಡೀ ಟೇಬಲ್',
  'bill.split': 'ವ್ಯಕ್ತಿವಾರು',
  'bill.subtotal': 'ಒಟ್ಟು ಮೊತ್ತ',
  'bill.packing': 'ಪ್ಯಾಕಿಂಗ್ ಶುಲ್ಕ',
  'bill.service': 'ಸೇವಾ ಶುಲ್ಕ',
  'bill.total': 'ಒಟ್ಟು',
  'bill.orderMore': 'ಇನ್ನಷ್ಟು ಆರ್ಡರ್',
  'bill.save': 'ಬಿಲ್ ಉಳಿಸಿ',
  'bill.none': 'ಈ ಟೇಬಲ್‌ನಲ್ಲಿ ಇನ್ನೂ ಆರ್ಡರ್ ಇಲ್ಲ.',
};

const HI: Dict = {
  'menu.search': 'व्यंजन खोजें',
  'menu.all': 'सभी',
  'menu.veg': 'शाकाहारी',
  'menu.nonveg': 'मांसाहारी',
  'menu.add': 'जोड़ें',
  'menu.choose': 'चुनें',
  'menu.viewCart': 'कार्ट देखें',
  'menu.item': 'वस्तु',
  'menu.items': 'वस्तुएँ',
  'menu.none': 'कोई व्यंजन नहीं मिला।',
  'menu.bill': 'टेबल बिल',
  'gate.title': 'ऑर्डर कौन कर रहा है?',
  'gate.name': 'आपका नाम',
  'gate.phone': 'फ़ोन नंबर',
  'gate.start': 'ऑर्डर शुरू करें',
  'cart.title': 'आपका ऑर्डर',
  'cart.empty': 'आपका कार्ट खाली है।',
  'cart.browse': 'मेन्यू देखें',
  'cart.place': 'ऑर्डर करें',
  'cart.back': 'मेन्यू',
  'track.placed': 'ऑर्डर मिल गया',
  'track.placedBody': 'रसोई के पास आपका ऑर्डर है।',
  'track.cooking': 'बन रहा है',
  'track.cookingBody': 'आपका खाना चूल्हे पर है।',
  'track.ready': 'तैयार',
  'track.readyBody': 'आपकी टेबल पर आ रहा है।',
  'track.served': 'परोसा गया',
  'track.servedBody': 'भोजन का आनंद लें।',
  'bill.title': 'टेबल बिल',
  'bill.whole': 'पूरी टेबल',
  'bill.split': 'व्यक्ति अनुसार',
  'bill.subtotal': 'उप-योग',
  'bill.packing': 'पैकिंग शुल्क',
  'bill.service': 'सेवा शुल्क',
  'bill.total': 'कुल',
  'bill.orderMore': 'और ऑर्डर करें',
  'bill.save': 'बिल सहेजें',
  'bill.none': 'इस टेबल पर अभी कोई ऑर्डर नहीं है।',
};

const STRINGS: Record<Lang, Dict> = { en: EN, kn: KN, hi: HI };

const KEY = 'menutha-web:lang';

export function getLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && STRINGS[saved]) return saved;
    // Kannada and Hindi speakers usually already have the phone set that way.
    const nav = (navigator.language || 'en').slice(0, 2);
    if (nav === 'kn' || nav === 'hi') return nav as Lang;
  } catch { /* private mode */ }
  return 'en';
}

export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  document.documentElement.lang = l;
  window.dispatchEvent(new Event('menutha:lang'));
}

/** Falls back to English, then to the key itself, so a missing translation
 *  degrades to readable English rather than a blank button. */
export function translate(l: Lang, key: string): string {
  return STRINGS[l]?.[key] ?? EN[key] ?? key;
}

/** Re-renders the calling component when the language changes. Kept here so a
 *  component only ever imports one thing to become translatable. */
export function useT(): (key: string) => string {
  const [lang, setL] = useState<Lang>(getLang);
  useEffect(() => {
    const on = () => setL(getLang());
    window.addEventListener('menutha:lang', on);
    return () => window.removeEventListener('menutha:lang', on);
  }, []);
  return (key: string) => translate(lang, key);
}
