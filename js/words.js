// Vocabulary list: single words, short common phrases, and verb
// conjugations, all matched the same way (one English card <-> one
// Spanish card).
//
// Fields on each entry:
//   en       - English text shown on the left card (required)
//   es       - Spanish text shown on the right card (required)
//   category - loose grouping, e.g. 'verbs', 'phrases', 'food' (required)
//   context  - short subheading shown under the English card only
//              (optional). Use it to disambiguate words with more than
//              one common sense/usage ("to be" -> ser vs. estar), or to
//              tag which verb/person/tense a conjugated form belongs to.
//   type     - 'word' | 'phrase' | 'conjugation' (optional, defaults to
//              'word'). Purely informational/for future filtering; the
//              matching logic doesn't care about it.
//
// Keep every `es` value unique across the whole list — ids are derived
// from it (see slugify below), and the matching engine's pool always
// treats one word/phrase as one pairable unit regardless of type.
// `en` values do NOT need to be unique on their own, but if two entries
// share the same `en` text, give them different `context` values so a
// player can tell them apart if both land in the active pool together
// (e.g. "to be" / ser vs. "to be" / estar).

function slugify(text) {
  // Deliberately keeps accented letters rather than stripping them down to
  // plain ASCII -- these ids are just internal object keys, never shown or
  // used as DOM/URL identifiers, and stripping accents would collide
  // distinct words that differ only by accent (e.g. the pronoun "you" vs.
  // the possessive "your").
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// Builds one conjugation entry per subject pronoun. English forms are
// spelled out explicitly (rather than derived from the infinitive) because
// several of the verbs used here are irregular (e.g. "to be" -> am/are/is,
// not "be/bes").
//
//   forms: { person: [englishPhrase, spanishForm] }
function conjugationSet(contextLabel, forms) {
  return Object.entries(forms).map(([person, [en, es]]) => ({
    en,
    es,
    category: 'verbs',
    type: 'conjugation',
    context: `${contextLabel} \u00b7 ${person} \u00b7 present tense`,
  }));
}

const RAW_WORDS = [
  // Greetings & common phrases
  { en: 'hello', es: 'hola', category: 'phrases', type: 'phrase' },
  { en: 'goodbye', es: 'adiós', category: 'phrases', type: 'phrase' },
  { en: 'please', es: 'por favor', category: 'phrases', type: 'phrase' },
  { en: 'thank you', es: 'gracias', category: 'phrases', type: 'phrase' },
  { en: "you're welcome", es: 'de nada', category: 'phrases', type: 'phrase' },
  { en: 'good morning', es: 'buenos días', category: 'phrases', type: 'phrase' },
  { en: 'good afternoon', es: 'buenas tardes', category: 'phrases', type: 'phrase' },
  { en: 'good night', es: 'buenas noches', category: 'phrases', type: 'phrase' },
  { en: 'how are you', es: 'cómo estás', category: 'phrases', type: 'phrase' },
  { en: 'excuse me', es: 'perdón', category: 'phrases', type: 'phrase' },
  { en: 'sorry', es: 'lo siento', category: 'phrases', type: 'phrase' },
  { en: 'see you later', es: 'hasta luego', category: 'phrases', type: 'phrase' },
  { en: 'nice to meet you', es: 'mucho gusto', category: 'phrases', type: 'phrase' },
  { en: 'yes', es: 'sí', category: 'phrases' },
  { en: 'no', es: 'no', category: 'phrases' },

  // More common phrases — everyday situations
  {
    en: 'where is the bathroom?',
    es: '¿dónde está el baño?',
    category: 'phrases',
    type: 'phrase',
    context: 'asking for directions',
  },
  {
    en: 'how much does it cost?',
    es: '¿cuánto cuesta?',
    category: 'phrases',
    type: 'phrase',
    context: 'shopping',
  },
  {
    en: "i don't understand",
    es: 'no entiendo',
    category: 'phrases',
    type: 'phrase',
    context: 'when you need something repeated or explained',
  },
  {
    en: 'can you help me?',
    es: '¿puedes ayudarme?',
    category: 'phrases',
    type: 'phrase',
    context: 'asking for help',
  },
  {
    en: 'what is your name?',
    es: '¿cómo te llamas?',
    category: 'phrases',
    type: 'phrase',
    context: 'small talk',
  },
  {
    en: 'i would like...',
    es: 'quisiera...',
    category: 'phrases',
    type: 'phrase',
    context: 'polite request, e.g. ordering food',
  },
  {
    en: 'i am hungry',
    es: 'tengo hambre',
    category: 'phrases',
    type: 'phrase',
    context: 'literally "I have hunger"',
  },
  {
    en: 'i am thirsty',
    es: 'tengo sed',
    category: 'phrases',
    type: 'phrase',
    context: 'literally "I have thirst"',
  },
  {
    en: 'what time is it?',
    es: '¿qué hora es?',
    category: 'phrases',
    type: 'phrase',
    context: 'asking for the time',
  },
  {
    en: 'i need help',
    es: 'necesito ayuda',
    category: 'phrases',
    type: 'phrase',
    context: 'asking for help, more urgent',
  },
  {
    en: 'the check, please',
    es: 'la cuenta, por favor',
    category: 'phrases',
    type: 'phrase',
    context: 'at a restaurant',
  },
  {
    en: "i'm lost",
    es: 'estoy perdido',
    category: 'phrases',
    type: 'phrase',
    context: 'traveling / directions',
  },
  {
    en: 'take care',
    es: 'cuídate',
    category: 'phrases',
    type: 'phrase',
    context: 'casual goodbye',
  },
  {
    en: 'have a good day',
    es: 'que tengas un buen día',
    category: 'phrases',
    type: 'phrase',
    context: 'parting well-wish',
  },
  {
    en: 'i agree',
    es: 'estoy de acuerdo',
    category: 'phrases',
    type: 'phrase',
    context: 'agreeing with someone',
  },
  {
    en: 'what does that mean?',
    es: '¿qué significa eso?',
    category: 'phrases',
    type: 'phrase',
    context: 'asking for a definition',
  },

  // Question words
  { en: 'what', es: 'qué', category: 'questions' },
  { en: 'who', es: 'quién', category: 'questions' },
  { en: 'where', es: 'dónde', category: 'questions' },
  { en: 'when', es: 'cuándo', category: 'questions' },
  { en: 'why', es: 'por qué', category: 'questions' },
  { en: 'how', es: 'cómo', category: 'questions' },
  { en: 'how much', es: 'cuánto', category: 'questions' },
  { en: 'which', es: 'cuál', category: 'questions' },

  // Pronouns
  { en: 'I', es: 'yo', category: 'pronouns' },
  { en: 'you', es: 'tú', category: 'pronouns', context: 'informal, singular' },
  { en: 'he', es: 'él', category: 'pronouns' },
  { en: 'she', es: 'ella', category: 'pronouns' },
  { en: 'we', es: 'nosotros', category: 'pronouns' },
  { en: 'they', es: 'ellos', category: 'pronouns' },
  { en: 'my', es: 'mi', category: 'pronouns' },
  { en: 'your', es: 'tu', category: 'pronouns' },

  // Numbers
  { en: 'zero', es: 'cero', category: 'numbers' },
  { en: 'one', es: 'uno', category: 'numbers' },
  { en: 'two', es: 'dos', category: 'numbers' },
  { en: 'three', es: 'tres', category: 'numbers' },
  { en: 'four', es: 'cuatro', category: 'numbers' },
  { en: 'five', es: 'cinco', category: 'numbers' },
  { en: 'six', es: 'seis', category: 'numbers' },
  { en: 'seven', es: 'siete', category: 'numbers' },
  { en: 'eight', es: 'ocho', category: 'numbers' },
  { en: 'nine', es: 'nueve', category: 'numbers' },
  { en: 'ten', es: 'diez', category: 'numbers' },
  { en: 'twenty', es: 'veinte', category: 'numbers' },
  { en: 'thirty', es: 'treinta', category: 'numbers' },
  { en: 'one hundred', es: 'cien', category: 'numbers' },

  // Days of the week
  { en: 'Monday', es: 'lunes', category: 'days' },
  { en: 'Tuesday', es: 'martes', category: 'days' },
  { en: 'Wednesday', es: 'miércoles', category: 'days' },
  { en: 'Thursday', es: 'jueves', category: 'days' },
  { en: 'Friday', es: 'viernes', category: 'days' },
  { en: 'Saturday', es: 'sábado', category: 'days' },
  { en: 'Sunday', es: 'domingo', category: 'days' },

  // Time & weather
  { en: 'today', es: 'hoy', category: 'time' },
  { en: 'tomorrow', es: 'mañana', category: 'time' },
  { en: 'yesterday', es: 'ayer', category: 'time' },
  { en: 'now', es: 'ahora', category: 'time' },
  { en: 'later', es: 'después', category: 'time' },
  { en: 'week', es: 'semana', category: 'time' },
  { en: 'year', es: 'año', category: 'time' },
  {
    en: 'time',
    es: 'la hora',
    category: 'time',
    context: 'clock time, e.g. "what time is it"',
  },
  {
    en: 'time',
    es: 'la vez',
    category: 'time',
    context: 'an occurrence/instance, e.g. "one more time"',
  },
  {
    en: 'date',
    es: 'la fecha',
    category: 'time',
    context: 'calendar day',
  },
  {
    en: 'date',
    es: 'la cita',
    category: 'time',
    context: 'a romantic outing, or an appointment',
  },
  { en: 'weather', es: 'el clima', category: 'weather' },
  { en: 'sun', es: 'el sol', category: 'weather' },
  { en: 'rain', es: 'la lluvia', category: 'weather' },
  { en: 'cold', es: 'frío', category: 'weather' },
  { en: 'hot', es: 'caliente', category: 'weather' },

  // Colors
  { en: 'red', es: 'rojo', category: 'colors' },
  { en: 'blue', es: 'azul', category: 'colors' },
  { en: 'green', es: 'verde', category: 'colors' },
  { en: 'yellow', es: 'amarillo', category: 'colors' },
  { en: 'black', es: 'negro', category: 'colors' },
  { en: 'white', es: 'blanco', category: 'colors' },
  { en: 'orange', es: 'naranja', category: 'colors', context: 'the color' },
  { en: 'purple', es: 'morado', category: 'colors' },
  { en: 'brown', es: 'marrón', category: 'colors' },
  { en: 'gray', es: 'gris', category: 'colors' },

  // Family
  { en: 'mother', es: 'la madre', category: 'family' },
  { en: 'father', es: 'el padre', category: 'family' },
  { en: 'sister', es: 'la hermana', category: 'family' },
  { en: 'brother', es: 'el hermano', category: 'family' },
  { en: 'son', es: 'el hijo', category: 'family' },
  { en: 'daughter', es: 'la hija', category: 'family' },
  { en: 'grandmother', es: 'la abuela', category: 'family' },
  { en: 'grandfather', es: 'el abuelo', category: 'family' },
  { en: 'friend', es: 'el amigo', category: 'family' },
  { en: 'family', es: 'la familia', category: 'family' },

  // Food & drink
  { en: 'water', es: 'el agua', category: 'food' },
  { en: 'bread', es: 'el pan', category: 'food' },
  { en: 'milk', es: 'la leche', category: 'food' },
  { en: 'coffee', es: 'el café', category: 'food' },
  { en: 'egg', es: 'el huevo', category: 'food' },
  { en: 'cheese', es: 'el queso', category: 'food' },
  { en: 'rice', es: 'el arroz', category: 'food' },
  { en: 'chicken', es: 'el pollo', category: 'food' },
  { en: 'fish', es: 'el pescado', category: 'food' },
  { en: 'fruit', es: 'la fruta', category: 'food' },
  { en: 'apple', es: 'la manzana', category: 'food' },
  { en: 'orange', es: 'la naranja', category: 'food', context: 'the fruit' },
  { en: 'vegetable', es: 'la verdura', category: 'food' },
  { en: 'meat', es: 'la carne', category: 'food' },
  { en: 'sugar', es: 'el azúcar', category: 'food' },
  { en: 'salt', es: 'la sal', category: 'food' },
  { en: 'breakfast', es: 'el desayuno', category: 'food' },
  { en: 'lunch', es: 'el almuerzo', category: 'food' },
  { en: 'dinner', es: 'la cena', category: 'food' },
  { en: 'restaurant', es: 'el restaurante', category: 'food' },

  // Common verbs (infinitive)
  { en: 'to be', es: 'ser', category: 'verbs', context: 'permanent trait or identity' },
  { en: 'to be', es: 'estar', category: 'verbs', context: 'temporary state or location' },
  { en: 'to have', es: 'tener', category: 'verbs' },
  { en: 'to do/make', es: 'hacer', category: 'verbs' },
  { en: 'to go', es: 'ir', category: 'verbs' },
  { en: 'to want', es: 'querer', category: 'verbs' },
  { en: 'to be able to', es: 'poder', category: 'verbs' },
  { en: 'to say', es: 'decir', category: 'verbs' },
  { en: 'to eat', es: 'comer', category: 'verbs' },
  { en: 'to drink', es: 'beber', category: 'verbs' },
  { en: 'to speak', es: 'hablar', category: 'verbs' },
  { en: 'to see', es: 'ver', category: 'verbs' },
  { en: 'to know', es: 'saber', category: 'verbs', context: 'a fact, or how to do something' },
  { en: 'to know', es: 'conocer', category: 'verbs', context: 'a person or place' },
  { en: 'to work', es: 'trabajar', category: 'verbs' },
  { en: 'to study', es: 'estudiar', category: 'verbs' },
  { en: 'to live', es: 'vivir', category: 'verbs' },
  { en: 'to sleep', es: 'dormir', category: 'verbs' },
  { en: 'to walk', es: 'caminar', category: 'verbs' },
  { en: 'to run', es: 'correr', category: 'verbs' },
  { en: 'to read', es: 'leer', category: 'verbs' },
  { en: 'to write', es: 'escribir', category: 'verbs' },
  { en: 'to listen', es: 'escuchar', category: 'verbs' },
  { en: 'to buy', es: 'comprar', category: 'verbs' },
  { en: 'to sell', es: 'vender', category: 'verbs' },
  { en: 'to open', es: 'abrir', category: 'verbs' },
  { en: 'to close', es: 'cerrar', category: 'verbs' },
  { en: 'to arrive', es: 'llegar', category: 'verbs' },
  { en: 'to leave', es: 'salir', category: 'verbs' },
  { en: 'to play', es: 'jugar', category: 'verbs' },

  // Verb conjugations — present tense, a few of the most common verbs.
  // English glosses use "he/she" for the third person and skip formal
  // "usted" to keep the pool from getting too crowded with near-duplicates.
  ...conjugationSet('permanent trait or identity — ser', {
    yo: ['I am', 'soy'],
    tú: ['you are', 'eres'],
    'él/ella': ['he/she is', 'es'],
    nosotros: ['we are', 'somos'],
    ellos: ['they are', 'son'],
  }),
  ...conjugationSet('temporary state or location — estar', {
    yo: ['I am', 'estoy'],
    tú: ['you are', 'estás'],
    'él/ella': ['he/she is', 'está'],
    nosotros: ['we are', 'estamos'],
    ellos: ['they are', 'están'],
  }),
  ...conjugationSet('tener (to have)', {
    yo: ['I have', 'tengo'],
    tú: ['you have', 'tienes'],
    'él/ella': ['he/she has', 'tiene'],
    nosotros: ['we have', 'tenemos'],
    ellos: ['they have', 'tienen'],
  }),
  ...conjugationSet('hablar (to speak)', {
    yo: ['I speak', 'hablo'],
    tú: ['you speak', 'hablas'],
    'él/ella': ['he/she speaks', 'habla'],
    nosotros: ['we speak', 'hablamos'],
    ellos: ['they speak', 'hablan'],
  }),
  ...conjugationSet('comer (to eat)', {
    yo: ['I eat', 'como'],
    tú: ['you eat', 'comes'],
    'él/ella': ['he/she eats', 'come'],
    nosotros: ['we eat', 'comemos'],
    ellos: ['they eat', 'comen'],
  }),
  ...conjugationSet('ir (to go)', {
    yo: ['I go', 'voy'],
    tú: ['you go', 'vas'],
    'él/ella': ['he/she goes', 'va'],
    nosotros: ['we go', 'vamos'],
    ellos: ['they go', 'van'],
  }),

  // Adjectives
  { en: 'big', es: 'grande', category: 'adjectives' },
  { en: 'small', es: 'pequeño', category: 'adjectives' },
  { en: 'good', es: 'bueno', category: 'adjectives' },
  { en: 'bad', es: 'malo', category: 'adjectives' },
  { en: 'happy', es: 'feliz', category: 'adjectives' },
  { en: 'sad', es: 'triste', category: 'adjectives' },
  { en: 'beautiful', es: 'hermoso', category: 'adjectives' },
  { en: 'new', es: 'nuevo', category: 'adjectives' },
  { en: 'old', es: 'viejo', category: 'adjectives' },
  { en: 'fast', es: 'rápido', category: 'adjectives' },
  { en: 'slow', es: 'lento', category: 'adjectives' },
  { en: 'easy', es: 'fácil', category: 'adjectives' },
  { en: 'difficult', es: 'difícil', category: 'adjectives' },
  { en: 'tall', es: 'alto', category: 'adjectives' },
  { en: 'short', es: 'bajo', category: 'adjectives' },
  { en: 'strong', es: 'fuerte', category: 'adjectives' },
  { en: 'tired', es: 'cansado', category: 'adjectives' },
  { en: 'important', es: 'importante', category: 'adjectives' },
  { en: 'right', es: 'correcto', category: 'adjectives', context: 'correct, not wrong' },
  { en: 'right', es: 'derecha', category: 'adjectives', context: 'opposite of left' },

  // Places
  { en: 'house', es: 'la casa', category: 'places' },
  { en: 'school', es: 'la escuela', category: 'places' },
  { en: 'city', es: 'la ciudad', category: 'places' },
  { en: 'country', es: 'el país', category: 'places' },
  { en: 'street', es: 'la calle', category: 'places' },
  { en: 'store', es: 'la tienda', category: 'places' },
  { en: 'hospital', es: 'el hospital', category: 'places' },
  { en: 'park', es: 'el parque', category: 'places' },
  { en: 'beach', es: 'la playa', category: 'places' },
  { en: 'airport', es: 'el aeropuerto', category: 'places' },

  // Body parts
  { en: 'head', es: 'la cabeza', category: 'body' },
  { en: 'hand', es: 'la mano', category: 'body' },
  { en: 'eye', es: 'el ojo', category: 'body' },
  { en: 'foot', es: 'el pie', category: 'body' },
  { en: 'heart', es: 'el corazón', category: 'body' },
  { en: 'mouth', es: 'la boca', category: 'body' },

  // Clothing & animals
  { en: 'shirt', es: 'la camisa', category: 'clothing' },
  { en: 'shoes', es: 'los zapatos', category: 'clothing' },
  { en: 'dog', es: 'el perro', category: 'animals' },
  { en: 'cat', es: 'el gato', category: 'animals' },
  { en: 'bird', es: 'el pájaro', category: 'animals' },
  { en: 'horse', es: 'el caballo', category: 'animals' },
];

export const WORDS = RAW_WORDS.map((w) => ({ type: 'word', ...w, id: slugify(w.es) }));

// Fail fast in development if two entries collide on their derived id
// (i.e. share the same `es` text) — that would make them unpairable.
const seen = new Map();
for (const w of WORDS) {
  if (seen.has(w.id)) {
    throw new Error(
      `Duplicate Spanish text produces the same id "${w.id}": "${seen.get(w.id)}" and "${w.es}"`
    );
  }
  seen.set(w.id, w.es);
}
