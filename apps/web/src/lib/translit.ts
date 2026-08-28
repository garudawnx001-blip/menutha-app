/**
 * Latin → Kannada / Devanagari transliteration for menu items.
 *
 * WHAT THIS IS, AND IS NOT
 *
 * This is transliteration, not translation. "Gobi Dry" becomes "ಗೋಬಿ ಡ್ರೈ" —
 * the same words, written in the script the diner reads. It does NOT become
 * "ಒಣ ಹೂಕೋಸು". That restraint is the point: a Kannada reader sounding out
 * "ಗೋಬಿ ಡ್ರೈ" orders the right dish, whereas a machine translation of a menu
 * produces confident nonsense ("Finger Chips" → "ಬೆರಳು ಚಿಪ್ಸ್") and a
 * restaurant cannot spot the error in a script it may not read.
 *
 * It is a FALLBACK. A name the restaurant typed themselves (name_kn / name_hi)
 * always wins; this only fills the gap, so a menu is readable on day one
 * without the owner retyping four hundred dishes.
 *
 * No dependency: adding one would mean regenerating package-lock.json, and a
 * hand-built table is deterministic, inspectable, and about 4 KB.
 *
 * HOW IT WORKS
 *
 * Indic scripts are abugidas: a consonant carries an inherent "a", other
 * vowels attach as signs (matras), and a consonant with no vowel takes a
 * virama. So we scan the word into consonant/vowel tokens (longest match
 * first, so "ch" beats "c") and emit:
 *   consonant then vowel     → consonant + matra          (ಬ + ಿ = ಬಿ)
 *   consonant then consonant → virama between them        (ಕ್ಕ)
 *   consonant at word end    → virama                     (ರ್)
 *   vowel with no consonant  → the independent letter     (ಅ)
 *
 * English spelling then needs a few honest hacks, each earning its place on a
 * real menu — see SPELLING below.
 */

export type Script = 'kn' | 'hi';

/* Consonants: latin → [devanagari, kannada].
   English speakers write Indian retroflexes as plain t/d ("Tikka", "Dry"), so
   t→ಟ and d→ಡ are the right defaults here; the dental th/dh are spelled out. */
const CONS: Record<string, [string, string]> = {
  ksh: ['क्ष', 'ಕ್ಷ'],
  chh: ['छ', 'ಛ'],
  sch: ['श', 'ಶ'],
  kh: ['ख', 'ಖ'], gh: ['घ', 'ಘ'], ch: ['च', 'ಚ'], jh: ['झ', 'ಝ'],
  th: ['थ', 'ಥ'], dh: ['ध', 'ಧ'], ph: ['फ', 'ಫ'], bh: ['भ', 'ಭ'],
  sh: ['श', 'ಶ'], zh: ['झ', 'ಝ'], ny: ['ञ', 'ಞ'], ck: ['क', 'ಕ'],
  k: ['क', 'ಕ'], q: ['क', 'ಕ'], g: ['ग', 'ಗ'], j: ['ज', 'ಜ'],
  z: ['ज', 'ಜ'], t: ['ट', 'ಟ'], d: ['ड', 'ಡ'], n: ['न', 'ನ'],
  p: ['प', 'ಪ'], f: ['फ', 'ಫ'], b: ['ब', 'ಬ'], m: ['म', 'ಮ'],
  y: ['य', 'ಯ'], r: ['र', 'ರ'], l: ['ल', 'ಲ'], v: ['व', 'ವ'],
  w: ['व', 'ವ'], s: ['स', 'ಸ'], h: ['ह', 'ಹ'], c: ['क', 'ಕ'],
  x: ['क्स', 'ಕ್ಸ'],
};

/* Vowels: latin → [deva independent, deva matra, kannada independent, kannada matra].
   'o' maps long (ೋ) because Indian words written with a single o are長 — "Gobi"
   is ಗೋಬಿ, never ಗೊಬಿ. 'e' stays short, which is right for "Chettinad". */
const VOW: Record<string, [string, string, string, string]> = {
  aa: ['आ', 'ा', 'ಆ', 'ಾ'],
  ai: ['ऐ', 'ै', 'ಐ', 'ೈ'],
  ay: ['ऐ', 'ै', 'ಐ', 'ೈ'],
  au: ['औ', 'ौ', 'ಔ', 'ೌ'],
  ou: ['औ', 'ौ', 'ಔ', 'ೌ'],
  ow: ['औ', 'ौ', 'ಔ', 'ೌ'],
  ee: ['ई', 'ी', 'ಈ', 'ೀ'],
  ea: ['ई', 'ी', 'ಈ', 'ೀ'],
  ie: ['ई', 'ी', 'ಈ', 'ೀ'],
  oo: ['ऊ', 'ू', 'ಊ', 'ೂ'],
  a: ['अ', '', 'ಅ', ''],
  i: ['इ', 'ि', 'ಇ', 'ಿ'],
  u: ['उ', 'ु', 'ಉ', 'ು'],
  e: ['ए', 'े', 'ಎ', 'ೆ'],
  o: ['ओ', 'ो', 'ಓ', 'ೋ'],
};

const VIRAMA = { hi: '्', kn: '್' };
const ANUSVARA = { hi: 'ं', kn: 'ಂ' };

const CONS_KEYS = Object.keys(CONS).sort((a, b) => b.length - a.length);
const VOW_KEYS = Object.keys(VOW).sort((a, b) => b.length - a.length);

const isVowelChar = (ch: string) => 'aeiou'.includes(ch);

/**
 * A menu vocabulary, because spelling-driven transliteration has a ceiling.
 *
 * English spelling does not record vowel length, but Indic scripts must choose:
 * "Masala" is ಮಸಾಲಾ and "Sambar" is ಸಾಂಬಾರ್, yet both are just "a" on paper.
 * No rule set recovers that. Worse, these are Indian words already — they have
 * a settled, conventional spelling in Kannada and Devanagari that diners
 * recognise on sight, and deriving something merely plausible would be a step
 * down from what the restaurant's own customers expect.
 *
 * So the words that actually appear on an Indian menu are written out once,
 * checked, and looked up. Transliteration handles the long tail. This mirrors
 * CATEGORY_NAMES in i18n.ts, which solved the same problem for sections.
 *
 * Matching is per word and case-insensitive, so "Paneer Butter Masala" is three
 * lookups and any unknown word still transliterates rather than staying Latin.
 */
const WORDS: Record<string, [string, string]> = {
  // [kannada, hindi]
  paneer: ['ಪನೀರ್', 'पनीर'], masala: ['ಮಸಾಲಾ', 'मसाला'], masla: ['ಮಸಾಲಾ', 'मसाला'],
  biriyani: ['ಬಿರಿಯಾನಿ', 'बिरयानी'], biryani: ['ಬಿರಿಯಾನಿ', 'बिरयानी'],
  tandoori: ['ತಂದೂರಿ', 'तंदूरी'], tandoor: ['ತಂದೂರ್', 'तंदूर'],
  dosa: ['ದೋಸೆ', 'दोसा'], dose: ['ದೋಸೆ', 'दोसा'], idli: ['ಇಡ್ಲಿ', 'इडली'],
  vada: ['ವಡೆ', 'वड़ा'], sambar: ['ಸಾಂಬಾರ್', 'सांबर'], chutney: ['ಚಟ್ನಿ', 'चटनी'],
  roti: ['ರೊಟ್ಟಿ', 'रोटी'], naan: ['ನಾನ್', 'नान'], chapati: ['ಚಪಾತಿ', 'चपाती'],
  paratha: ['ಪರೋಟಾ', 'पराठा'], poori: ['ಪೂರಿ', 'पूरी'], puri: ['ಪೂರಿ', 'पूरी'],
  rice: ['ರೈಸ್', 'राइस'], fried: ['ಫ್ರೈಡ್', 'फ्राइड'], fry: ['ಫ್ರೈ', 'फ्राई'],
  gobi: ['ಗೋಬಿ', 'गोबी'], manchurian: ['ಮಂಚೂರಿಯನ್', 'मंचूरियन'],
  chicken: ['ಚಿಕನ್', 'चिकन'], mutton: ['ಮಟನ್', 'मटन'], egg: ['ಎಗ್', 'एग'],
  veg: ['ವೆಜ್', 'वेज'], vegetable: ['ವೆಜಿಟೇಬಲ್', 'वेजिटेबल'],
  nonveg: ['ನಾನ್‌ವೆಜ್', 'नॉनवेज'], chilli: ['ಚಿಲ್ಲಿ', 'चिली'], chili: ['ಚಿಲ್ಲಿ', 'चिली'],
  butter: ['ಬಟರ್', 'बटर'], ghee: ['ಘೀ', 'घी'], roast: ['ರೋಸ್ಟ್', 'रोस्ट'],
  curry: ['ಕರಿ', 'करी'], dal: ['ದಾಲ್', 'दाल'], dhal: ['ದಾಲ್', 'दाल'],
  gulab: ['ಗುಲಾಬ್', 'गुलाब'], jamun: ['ಜಾಮೂನ್', 'जामुन'],
  coffee: ['ಕಾಫಿ', 'कॉफ़ी'], tea: ['ಟೀ', 'टी'], filter: ['ಫಿಲ್ಟರ್', 'फ़िल्टर'],
  curd: ['ಕರ್ಡ್', 'कर्ड'], soup: ['ಸೂಪ್', 'सूप'], chips: ['ಚಿಪ್ಸ್', 'चिप्स'],
  finger: ['ಫಿಂಗರ್', 'फिंगर'], dry: ['ಡ್ರೈ', 'ड्राई'], tikka: ['ಟಿಕ್ಕಾ', 'टिक्का'],
  prawn: ['ಪ್ರಾನ್', 'प्रॉन'], fish: ['ಫಿಶ್', 'फ़िश'], noodles: ['ನೂಡಲ್ಸ್', 'नूडल्स'],
  schezwan: ['ಶೆಜ್ವಾನ್', 'शेज़वान'], pepper: ['ಪೆಪ್ಪರ್', 'पेपर'],
  lemon: ['ಲೆಮನ್', 'लेमन'], onion: ['ಆನಿಯನ್', 'ऑनियन'], plain: ['ಪ್ಲೇನ್', 'प्लेन'],
  special: ['ಸ್ಪೆಷಲ್', 'स्पेशल'], half: ['ಹಾಫ್', 'हाफ़'], full: ['ಫುಲ್', 'फ़ुल'],
  juice: ['ಜ್ಯೂಸ್', 'जूस'], lassi: ['ಲಸ್ಸಿ', 'लस्सी'], milk: ['ಮಿಲ್ಕ್', 'मिल्क'],
  sweet: ['ಸ್ವೀಟ್', 'स्वीट'], kheer: ['ಖೀರ್', 'खीर'], halwa: ['ಹಲ್ವಾ', 'हलवा'],
  pulao: ['ಪುಲಾವ್', 'पुलाव'], pulav: ['ಪುಲಾವ್', 'पुलाव'],
  kabab: ['ಕಬಾಬ್', 'कबाब'], kebab: ['ಕಬಾಬ್', 'कबाब'],
  samosa: ['ಸಮೋಸಾ', 'समोसा'], pakoda: ['ಪಕೋಡ', 'पकौड़ा'], bonda: ['ಬೋಂಡಾ', 'बोंडा'],
  upma: ['ಉಪ್ಮಾ', 'उपमा'], thali: ['ಥಾಲಿ', 'थाली'], meals: ['ಮೀಲ್ಸ್', 'मील्स'],
  combo: ['ಕಾಂಬೋ', 'कॉम्बो'], starter: ['ಸ್ಟಾರ್ಟರ್', 'स्टार्टर'],
  hot: ['ಹಾಟ್', 'हॉट'], cold: ['ಕೋಲ್ಡ್', 'कोल्ड'], water: ['ವಾಟರ್', 'वाटर'],
  soda: ['ಸೋಡಾ', 'सोडा'], salad: ['ಸಲಾಡ್', 'सलाद'], raita: ['ರಾಯ್ತಾ', 'रायता'],
  papad: ['ಪಾಪಡ್', 'पापड़'], mushroom: ['ಮಶ್ರೂಮ್', 'मशरूम'], baby: ['ಬೇಬಿ', 'बेबी'],
  corn: ['ಕಾರ್ನ್', 'कॉर्न'], crispy: ['ಕ್ರಿಸ್ಪಿ', 'क्रिस्पी'], grill: ['ಗ್ರಿಲ್', 'ग्रिल'],
  grilled: ['ಗ್ರಿಲ್ಡ್', 'ग्रिल्ड'], boiled: ['ಬಾಯ್ಲ್ಡ್', 'बॉइल्ड'],
  omelette: ['ಆಮ್ಲೆಟ್', 'ऑमलेट'], bread: ['ಬ್ರೆಡ್', 'ब्रेड'], toast: ['ಟೋಸ್ಟ್', 'टोस्ट'],
  jeera: ['ಜೀರಾ', 'जीरा'], garlic: ['ಗಾರ್ಲಿಕ್', 'गार्लिक'], mint: ['ಮಿಂಟ್', 'मिंट'],
};

/**
 * SPELLING: English orthography does not map cleanly onto sound, so a few
 * rewrites run before the scan. Each exists because a real menu needed it.
 */
function normalise(w: string): string {
  let s = w.toLowerCase();

  // "Rice" is /raɪs/, not /rik/: a c before e, i or y is an s sound. Without
  // this the silent-e rule below turned "Rice" into ರಿಕ್.
  s = s.replace(/c(?=[eiy])/g, 's');

  // Magic e — "Rice" → ರೈಸ್, "Plate" → ಪ್ಲೇಟ್. A single vowel, one consonant,
  // then a silent e lengthens that vowel. Checked before the silent-e strip.
  const magic = /^(.*?)([aiou])([^aeiou])e$/.exec(s);
  if (magic && !/[aeiou]/.test(magic[1])) {
    const long: Record<string, string> = { a: 'e', i: 'ai', o: 'o', u: 'yu' };
    s = magic[1] + long[magic[2]] + magic[3];
  }

  // "Roast" → ರೋಸ್ಟ್, not ರೋಅಸ್ಟ್.
  s = s.replace(/oa/g, 'o');

  // A vowel cannot sit on a vowel in an abugida: "Manchurian" needs the y
  // glide it is actually pronounced with — ಮಂಚೂರಿಯನ್, not ಮಂಚುರಿಅನ್.
  s = s.replace(/i([aou])/g, 'iy$1');

  // "Dry" → ಡ್ರೈ but "Curry" → ಕರಿ. A final y is the word's only vowel in the
  // first case (so it IS the vowel, "ai") and a trailing "ee" sound in the
  // second. Deciding on "does this word contain another vowel" gets both.
  if (/y$/.test(s) && s.length > 1) {
    s = /[aeiou]/.test(s.slice(0, -1)) ? s.slice(0, -1) + 'i' : s.slice(0, -1) + 'ai';
  }

  // Unstressed "-er" is a schwa: "Finger" → ಫಿಂಗರ್, not ಫಿಂಗೆರ್. The inherent
  // 'a' already sounds like that schwa, so drop the e.
  if (/er$/.test(s) && s.length > 2) s = s.slice(0, -2) + 'ar';

  // Silent final e: "Rice" → ರೈಸ್, not ರೈಸೆ. Only after a consonant, so "Ghee"
  // (ee) and bare "e" are untouched.
  //
  // Length-gated, because a final e is silent in English and SOUNDED in Kannada
  // and Tulu: "Bangude" is ಬಂಗುಡೆ and "Kane" is ಕಾಣೆ, and stripping the vowel
  // mangles the very local dishes this client sells. English silent-e words on
  // a menu are short ("rice", "sauce", "plate", "juice"), Indian ones tend to
  // be longer, so length separates them better than any letter rule. It is a
  // heuristic and it will sometimes be wrong — which is what the per-dish
  // Kannada field is for.
  if (/[^aeiou]e$/.test(s) && s.length > 2 && s.length <= 6) s = s.slice(0, -1);

  // A final 'a' is long on an Indian menu: "Tikka" → ಟಿಕ್ಕಾ, "Masala" → ಮಸಾಲಾ.
  if (/[^aeiou]a$/.test(s)) s = s.slice(0, -1) + 'aa';

  return s;
}

function word(w: string, script: Script): string {
  const s = normalise(w);
  const out: string[] = [];
  const vi = VIRAMA[script];
  let pendingVirama = false; // a consonant was emitted and still has no vowel
  let i = 0;

  while (i < s.length) {
    // A nasal directly before another consonant is written as anusvara:
    // "Finger" → ಫಿಂಗರ್, "Sambar" → ಸಂಬರ್.
    const ch = s[i];
    if ((ch === 'n' || ch === 'm') && i + 1 < s.length && !isVowelChar(s[i + 1])) {
      if (pendingVirama) { out.push(vi); pendingVirama = false; }
      out.push(ANUSVARA[script]);
      i += 1;
      continue;
    }

    const c = CONS_KEYS.find((k) => s.startsWith(k, i));
    if (c) {
      if (pendingVirama) out.push(vi);
      out.push(CONS[c][script === 'hi' ? 0 : 1]);
      pendingVirama = true;
      i += c.length;
      continue;
    }

    const v = VOW_KEYS.find((k) => s.startsWith(k, i));
    if (v) {
      const [dInd, dMat, kInd, kMat] = VOW[v];
      if (pendingVirama) {
        out.push(script === 'hi' ? dMat : kMat); // matra on the live consonant
        pendingVirama = false;
      } else {
        out.push(script === 'hi' ? dInd : kInd); // standalone vowel letter
      }
      i += v.length;
      continue;
    }

    // Anything else (digits, &, -, /) belongs to the restaurant; pass it through.
    if (pendingVirama) { out.push(vi); pendingVirama = false; }
    out.push(s[i]);
    i += 1;
  }

  if (pendingVirama) out.push(vi);
  return out.join('');
}

/** Transliterate a dish name, preserving spacing, punctuation and numerals. */
export function transliterate(text: string, script: Script): string {
  if (!text) return text;
  // Already in an Indic script (the restaurant typed it, or we ran before)?
  // Leave it exactly as it is.
  if (/[ऀ-ॿಀ-೿]/.test(text)) return text;
  return text
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok) || !/[a-z]/i.test(tok)) return tok; // spaces, "2", "+"
      // Look the word up without its punctuation, then put the punctuation back,
      // so "Masala," and "(Masala)" both hit the dictionary.
      const m = /^([^a-z]*)([a-z]+)([^a-z]*)$/i.exec(tok);
      if (m) {
        const hit = WORDS[m[2].toLowerCase()];
        if (hit) return m[1] + hit[script === 'hi' ? 1 : 0] + m[3];
      }
      return word(tok, script);
    })
    .join('');
}

/**
 * The name to show a diner, in priority order:
 *   1. what the restaurant typed for this language  (authoritative)
 *   2. a transliteration of the English name        (readable fallback)
 *   3. the English name                             (always something)
 */
export function dishName(
  item: { name: string; name_kn?: string | null; name_hi?: string | null },
  lang: string,
): string {
  if (lang === 'kn') return item.name_kn?.trim() || transliterate(item.name, 'kn');
  if (lang === 'hi') return item.name_hi?.trim() || transliterate(item.name, 'hi');
  return item.name;
}
