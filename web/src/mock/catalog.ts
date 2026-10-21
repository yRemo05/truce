/**
 * A hand-written stand-in for Qloo's catalogue, for the mock only. Film and
 * artist names are public titles; restaurants, addresses and every score in
 * the mock are invented. Nothing here comes from a Qloo response.
 */
import type { Food, Slot } from '@contract';

interface MockEntity {
  id: string;
  slot: Slot;
  name: string;
  disambiguation: string | null;
  year: number | null;
  blurb: string | null;
  imageUrl: string | null;
  popularity: number;
  facts: Record<string, string>;
}

function fnv(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const hashOf = (text: string) => fnv(text, 2166136261);

/** A stable, UUID-shaped id (the server only accepts those as seeds). */
function idOf(text: string): string {
  const hex = [1, 2, 3, 4]
    .map((n) => fnv(text, 2166136261 + n * 7919).toString(16).padStart(8, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const PALETTES: [string, string, string][] = [
  ['#2f4858', '#f2b134', '#ed553b'],
  ['#1d3557', '#a8dadc', '#f1faee'],
  ['#3d2c2e', '#e9c46a', '#b5838d'],
  ['#264653', '#e76f51', '#f4a261'],
  ['#283618', '#dda15e', '#fefae0'],
  ['#3a0ca3', '#f72585', '#4cc9f0'],
  ['#0b132b', '#5bc0be', '#fbe9d0'],
  ['#582f0e', '#b6ad90', '#ede0d4'],
];

/** An abstract stand-in for a poster or press photo, so the mock exercises real image layout. */
function artwork(name: string, shape: 'tall' | 'square'): string {
  const h = hashOf(name);
  const [bg, fg, accent] = PALETTES[h % PALETTES.length]!;
  const w = 200;
  const ht = shape === 'tall' ? 300 : 200;
  const cx = 40 + (h % 120);
  const cy = 60 + ((h >> 7) % (ht - 120));
  const r = 40 + ((h >> 13) % 50);
  const band = 30 + ((h >> 17) % (ht - 60));
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${ht}'>` +
    `<rect width='${w}' height='${ht}' fill='${bg}'/>` +
    `<rect y='${band}' width='${w}' height='${12 + (h % 30)}' fill='${accent}' opacity='.55'/>` +
    `<circle cx='${cx}' cy='${cy}' r='${r}' fill='${fg}'/>` +
    `<circle cx='${w - cx / 2}' cy='${ht - cy / 3}' r='${r / 3}' fill='none' stroke='${accent}' stroke-width='3'/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type Raw = [name: string, disambiguation: string | null, year: number | null, blurb: string, art: boolean, facts?: Record<string, string>];

function build(slot: Slot, rows: Raw[]): MockEntity[] {
  return rows.map(([name, disambiguation, year, blurb, art, facts], i) => ({
    id: idOf(`${slot}:${name}`),
    slot,
    name,
    disambiguation,
    year,
    blurb,
    imageUrl: art ? artwork(name, slot === 'film' ? 'tall' : 'square') : null,
    popularity: 0.95 - (i % 7) * 0.08,
    facts: facts ?? {},
  }));
}

const FILMS = build('film', [
  ['In the Mood for Love', '2000', 2000, "Two neighbours in 1960s Hong Kong find out about their spouses' affair and drift into something of their own.", true, { genres: 'Romance, Drama', minutes: '98' }],
  ['Lost in Translation', '2003', 2003, 'A fading actor and a restless young woman keep each other company through a sleepless Tokyo.', true, { genres: 'Drama, Comedy', minutes: '102' }],
  ['Mad Max: Fury Road', '2015', 2015, 'A desert chase on wheels, with a war rig, a warlord and very little small talk.', true, { genres: 'Action, Adventure', minutes: '120' }],
  ['John Wick', '2014', 2014, 'A retired hitman goes back to work over a stolen car and a puppy.', false, { genres: 'Action, Thriller', minutes: '101' }],
  ['Chungking Express', '1994', 1994, 'Two lovesick Hong Kong cops, one snack bar and a great deal of California Dreamin\'.', true, { genres: 'Romance, Comedy', minutes: '102' }],
  ['Past Lives', '2023', 2023, 'Childhood sweethearts meet again across two decades and two continents.', true, { genres: 'Romance, Drama', minutes: '106' }],
  ['Drive', '2011', 2011, 'A quiet stunt driver moonlights as a getaway man in neon-lit Los Angeles.', true, { genres: 'Crime, Drama', minutes: '100' }],
  ['The Raid', '2011', 2011, "A police squad fights floor by floor up a crime lord's tower block.", false, { genres: 'Action, Thriller', minutes: '101' }],
  ['Edge of Tomorrow', '2014', 2014, 'A soldier relives the same battle every day until he gets it right.', true, { genres: 'Sci-fi, Action', minutes: '113' }],
  ['Baby Driver', '2017', 2017, 'A getaway driver times every heist to the song in his earbuds.', true, { genres: 'Action, Crime', minutes: '113' }],
  ['Portrait of a Lady on Fire', '2019', 2019, 'On an island in 18th-century Brittany, a painter falls for the woman she has been hired to paint in secret.', true, { genres: 'Romance, Drama', minutes: '122' }],
  ['Arrival', '2016', 2016, 'A linguist races to understand visitors from elsewhere before the world loses its nerve.', false, { genres: 'Sci-fi, Drama', minutes: '116' }],
  ['Spirited Away', '2001', 2001, 'A girl working in a bathhouse for spirits tries to free her parents.', true, { genres: 'Animation, Fantasy' }],
  ['Heat', '1995', 1995, 'A detective and a master thief circle each other across Los Angeles.', true, { genres: 'Crime, Thriller' }],
  ['Before Sunrise', '1995', 1995, 'Two strangers on a train spend one night walking and talking in Vienna.', false, { genres: 'Romance, Drama' }],
  ['Paddington 2', '2017', 2017, 'A polite bear is framed for theft and wins over a prison.', true, { genres: 'Comedy, Family' }],
  ['Moonlight', '2016', 2016, 'Three chapters in the life of a young man growing up in Miami.', true, { genres: 'Drama' }],
  ['Amélie', '2001', 2001, 'A shy waitress in Montmartre quietly rearranges the lives around her.', true, { genres: 'Comedy, Romance' }],
  ['Parasite', '2019', 2019, 'A broke family talks its way into a wealthy household, one job at a time.', true, { genres: 'Thriller, Comedy' }],
  ['Everything Everywhere All at Once', '2022', 2022, 'A laundromat owner fights across universes while doing her taxes.', true, { genres: 'Sci-fi, Comedy' }],
  ['Ratatouille', '2007', 2007, 'A rat with a gift for cooking hides under a chef\'s hat in Paris.', true, { genres: 'Animation, Comedy' }],
  ['Top Gun: Maverick', '2022', 2022, 'A veteran pilot trains a squad for an impossible mission.', false, { genres: 'Action' }],
  ['The Grand Budapest Hotel', '2014', 2014, 'A concierge and his lobby boy are caught up in a theft and a family feud.', true, { genres: 'Comedy, Adventure' }],
  ['Moonrise Kingdom', '2012', 2012, 'Two twelve-year-olds run away together on a New England island.', false, { genres: 'Comedy, Romance' }],
  ['The Dark Knight', '2008', 2008, 'Batman, a district attorney and a clown who wants to watch Gotham burn.', true, { genres: 'Action, Crime', minutes: '152' }],
  ['Dune', '2021', 2021, 'A young heir is sent to the desert planet everyone wants, and the desert has plans of its own.', true, { genres: 'Sci-fi, Adventure', minutes: '155' }],
  ['Inception', '2010', 2010, 'A thief who steals secrets from dreams is hired to plant one instead.', true, { genres: 'Sci-fi, Action', minutes: '148' }],
]);

const PLACE = (neighborhood: string, cuisineType: string, price: string, ambience: string) => ({
  neighborhood,
  cuisineType,
  price,
  ambience,
});

const RESTAURANTS = build('restaurant', [
  ['Osteria Lume', '41 Perry St, New York, NY', null, 'Candlelit Venetian small plates and a very long wine list.', false, PLACE('West Village', 'Italian', '$$$', 'Romantic, dim')],
  ['Kisa Izakaya', '12 Bond St, New York, NY', null, 'Yakitori, highballs and a counter that fills by eight.', true, PLACE('NoHo', 'Japanese', '$$', 'Lively, counter seating')],
  ['Smokehouse 41', '410 W 41st St, New York, NY', null, 'Brisket by the pound and sauces on every table.', false, PLACE("Hell's Kitchen", 'Barbecue', '$$', 'Loud, communal tables')],
  ['Brass Lantern Noodle Bar', '88 E 7th St, New York, NY', null, 'Hand-pulled noodles and chilli oil you will think about tomorrow.', false, PLACE('East Village', 'Chinese', '$$', 'Cosy, buzzy')],
  ['Café Meridian', '150 Sullivan St, New York, NY', null, 'A slow French bistro with a zinc bar and a good omelette.', true, PLACE('SoHo', 'French', '$$$', 'Quiet, classic')],
  ['Neon Taquería', '97 Orchard St, New York, NY', null, 'Al pastor off the spit and mezcal flights until late.', false, PLACE('Lower East Side', 'Mexican', '$', 'Loud, late-night')],
  ['Ostra & Pine', '23 N Moore St, New York, NY', null, 'Oysters, crudo and a tasting menu that changes weekly.', true, PLACE('Tribeca', 'Seafood', '$$$$', 'Elegant, hushed')],
  ['Golden Hour Diner', '201 8th Ave, New York, NY', null, 'Stacks, shakes and a griddle that never cools.', false, PLACE('Chelsea', 'American', '$', 'Casual, bright')],
  ['Trattoria Sole', '214 Mott St, New York, NY', null, 'Red-sauce classics and a tiramisu with a reputation.', false, PLACE('Nolita', 'Italian', '$$', 'Warm, crowded')],
  ['Patty Wagon', '15 W 28th St, New York, NY', null, 'Smash burgers, crinkle fries and a frozen custard machine.', false, PLACE('NoMad', 'Burgers', '$', 'Quick, casual')],
  ['Mangal House', 'Kadıköy, İstanbul', null, 'Charcoal grills, meze and a loud Friday night.', false, PLACE('Kadıköy', 'Turkish', '$$', 'Lively')],
  ['Noodle Theory', '320 Grand St, Brooklyn, NY', null, 'Bowls of ramen and natural wine in Williamsburg.', true, PLACE('Williamsburg', 'Japanese', '$$', 'Casual')],
  ['Dumpling Society', '52 Bayard St, New York, NY', null, 'Soup dumplings by the dozen.', false, PLACE('Chinatown', 'Chinese', '$', 'Fast, friendly')],
  ['Green Fig', '7 Rue des Martyrs, Paris', null, 'Vegetable-led small plates in a tiny dining room.', false, PLACE('Pigalle', 'Modern European', '$$', 'Intimate')],
  ['Sushi Kaze', '118 W 22nd St, New York, NY', null, 'An eight-seat omakase counter.', true, PLACE('Chelsea', 'Japanese', '$$$$', 'Hushed')],
  ['Lantern & Lark', '67 Bedford St, New York, NY', null, 'A candlelit wine bar with handmade pasta, and a burger that regulars swear by.', true, PLACE('West Village', 'Italian', '$$', 'Cosy, candlelit')],
  // Istanbul: invented places in real neighbourhoods.
  ['Kuzguncuk Bostan', 'Üsküdar, İstanbul', null, 'Garden vegetables, olive-oil dishes and a long table under a fig tree.', false, PLACE('Kuzguncuk', 'Turkish', '$$', 'Leafy, quiet')],
  ['Etçi Mehmet', 'Şişli, İstanbul', null, 'Dry-aged cuts, grilled over charcoal and carved at the table.', false, PLACE('Nişantaşı', 'Steakhouse', '$$$', 'Smart, busy')],
  ['Karaköy Lokanta Evi', 'Beyoğlu, İstanbul', null, 'Tiled walls, daily home-style dishes and rakı by the glass.', true, PLACE('Karaköy', 'Turkish', '$$', 'Bright, lively')],
  ['Yeşil Masa', 'Beyoğlu, İstanbul', null, 'A vegetarian kitchen with mezze, lentil köfte and a terrace.', true, PLACE('Cihangir', 'Vegetarian', '$$', 'Cosy, plants everywhere')],
  ['Moda İskele Meyhanesi', 'Kadıköy, İstanbul', null, 'Meze, grilled fish and fasıl music by the ferry pier.', true, PLACE('Moda', 'Meyhane', '$$', 'Loud, festive')],
  ['Ocakbaşı Kömür', 'Kadıköy, İstanbul', null, 'Adana kebab off the grill, eaten at the counter round it.', false, PLACE('Kadıköy', 'Grill', '$$', 'Smoky, crowded')],
  ['Galata Mantı Evi', 'Beyoğlu, İstanbul', null, 'Tiny dumplings with garlic yoghurt and chilli butter.', false, PLACE('Galata', 'Turkish', '$', 'Small, friendly')],
  ['Bostan Sofrası', 'Beyoğlu, İstanbul', null, 'Seasonal home cooking, mostly from the market that morning.', false, PLACE('Cihangir', 'Turkish', '$$', 'Warm, homely')],
  ['Balat Kahvaltı Evi', 'Fatih, İstanbul', null, 'An all-day breakfast spread in a painted wooden house.', true, PLACE('Balat', 'Breakfast', '$', 'Colourful, relaxed')],
  ['Tünel Pide Salonu', 'Beyoğlu, İstanbul', null, 'Boat-shaped pide from a wood oven, open late.', false, PLACE('Beyoğlu', 'Pide', '$', 'Casual, late-night')],
  ['Nişantaşı Steak Club', 'Şişli, İstanbul', null, 'Tomahawks, truffle fries and a dress code.', true, PLACE('Nişantaşı', 'Steakhouse', '$$$$', 'Glossy')],
  ['Cihangir Sofrası', 'Beyoğlu, İstanbul', null, 'Vegetable mezze and a charcoal grill on a cosy side street.', true, PLACE('Cihangir', 'Turkish', '$$', 'Cosy, candlelit')],
]);

const ARTISTS = build('music', [
  ['Radiohead', 'English rock band', null, 'Oxford band behind OK Computer and In Rainbows.', true, { genres: 'Alternative rock' }],
  ['Bad Bunny', 'Puerto Rican singer', null, 'Reggaeton and Latin trap superstar.', true, { genres: 'Reggaeton, Latin trap' }],
  ['Massive Attack', 'English trip-hop collective', null, 'Bristol collective who made trip-hop a mood.', false, { genres: 'Trip-hop' }],
  ['Rosalía', 'Spanish singer', null, 'Flamenco roots, pop ambitions.', true, { genres: 'Pop, Flamenco' }],
  ['Burna Boy', 'Nigerian singer', null, 'Afrofusion at stadium volume.', false, { genres: 'Afrobeats' }],
  ['Khruangbin', 'Texan instrumental trio', null, 'Psychedelic soul from Houston, mostly without words.', true, { genres: 'Psychedelic soul, Funk' }],
  ['Björk', 'Icelandic singer', null, 'Shape-shifting art-pop.', false, { genres: 'Art pop, Electronic' }],
  ['Rauw Alejandro', 'Puerto Rican singer', null, 'Glossy reggaeton with dance moves to match.', false, { genres: 'Reggaeton, Pop' }],
  ['Frank Ocean', 'American singer', null, 'Channel Orange, Blonde and a lot of waiting.', true, { genres: 'R&B, Soul' }],
  ['The xx', 'English indie trio', null, 'Whispered duets over very empty rooms.', false, { genres: 'Indie pop' }],
  ['Nina Simone', 'American singer and pianist', null, 'Jazz, soul and civil-rights anthems.', true, { genres: 'Jazz, Soul' }],
  ['Daft Punk', 'French electronic duo', null, 'Helmets, disco and robots.', true, { genres: 'House, Electronic' }],
  ['Mitski', 'American singer-songwriter', null, 'Big feelings in small songs.', false, { genres: 'Indie rock' }],
  ['Fleetwood Mac', 'British-American rock band', null, 'Rumours and everything after.', true, { genres: 'Rock' }],
  ['Kendrick Lamar', 'American rapper', null, 'Compton storyteller.', true, { genres: 'Hip-hop' }],
  ['Tame Impala', 'Australian psychedelic project', null, "Kevin Parker's one-man band.", false, { genres: 'Psychedelic pop' }],
  ['Sade', 'English band', null, 'Smooth operators since 1984.', true, { genres: 'Soul, Quiet storm' }],
  ['Barış Manço', 'Turkish rock musician', null, 'Anatolian rock pioneer.', false, { genres: 'Anatolian rock' }],
  ['Phoebe Bridgers', 'American singer-songwriter', null, 'Sad songs, skeleton suits.', false, { genres: 'Indie folk' }],
  ['LCD Soundsystem', 'American dance-punk band', null, 'Dance music for people who overthink.', false, { genres: 'Dance-punk' }],
  ['Norah Jones', 'American singer-songwriter', null, 'Jazz-tinged songs for a slow evening.', true, { genres: 'Jazz, Pop' }],
  ['Duman', 'Turkish rock band', null, 'Istanbul rock with big choruses.', false, { genres: 'Rock' }],
]);

export const CATALOG: Record<Slot, MockEntity[]> = { film: FILMS, restaurant: RESTAURANTS, music: ARTISTS };

export const byName = (slot: Slot, name: string) => CATALOG[slot].find((e) => e.name === name)!;

/** Invented food tags, with the words that find them: "Lazanya" finds Lasagna, as the server's translation does. */
const FOODS: (Food & { words: string[] })[] = [
  { name: 'Lasagna', kind: 'dish', tags: ['mock:dish:lasagna'], words: ['lasagna', 'lasagne', 'lazanya'] },
  { name: 'Lasagna Bolognese', kind: 'dish', tags: ['mock:dish:lasagna-bolognese'], words: ['lasagna', 'lazanya', 'bolognese'] },
  { name: 'Italian', kind: 'cuisine', tags: ['mock:cuisine:italian'], words: ['italian', 'pasta', 'lasagna', 'lazanya', 'trattoria'] },
  { name: 'Sushi', kind: 'cuisine', tags: ['mock:cuisine:sushi', 'mock:dish:sushi'], words: ['sushi'] },
  { name: 'Japanese', kind: 'cuisine', tags: ['mock:cuisine:japanese'], words: ['japanese', 'sushi', 'ramen', 'izakaya'] },
  { name: 'Ramen', kind: 'dish', tags: ['mock:dish:ramen'], words: ['ramen', 'noodle'] },
  { name: 'Manti', kind: 'dish', tags: ['mock:dish:manti'], words: ['manti', 'mantı'] },
  { name: 'Meze', kind: 'dish', tags: ['mock:dish:meze'], words: ['meze', 'mezze'] },
  { name: 'Turkish', kind: 'cuisine', tags: ['mock:cuisine:turkish'], words: ['turkish', 'kebab', 'meze'] },
  { name: 'Vegetarian', kind: 'cuisine', tags: ['mock:cuisine:vegetarian'], words: ['vegetarian', 'vegan'] },
  { name: 'Pizza', kind: 'dish', tags: ['mock:dish:pizza'], words: ['pizza'] },
  { name: 'Burgers', kind: 'dish', tags: ['mock:dish:burgers'], words: ['burger', 'burgers'] },
];

/** Up to three foods a restaurant search names; `fold` is the caller's accent-free lower case. */
export function findFoods(query: string): Food[] {
  if (query.length < 3) return [];
  return FOODS.filter((f) => f.words.some((w) => w.startsWith(query) || query.startsWith(w)))
    .slice(0, 3)
    .map(({ name, kind, tags }) => ({ name, kind, tags }));
}

/** What each mock restaurant serves, by food name: invented, like the places. */
export const SERVES: Record<string, string[]> = {
  'Osteria Lume': ['Lasagna', 'Lasagna Bolognese', 'Italian'],
  'Lantern & Lark': ['Lasagna', 'Italian', 'Burgers'],
  'Trattoria Sole': ['Lasagna', 'Italian', 'Pizza'],
  'Kisa Izakaya': ['Ramen', 'Japanese', 'Sushi'],
  'Brass Lantern Noodle Bar': ['Ramen'],
  'Sushi Kaze': ['Sushi', 'Japanese'],
  'Ostra & Pine': ['Sushi'],
  'Golden Hour Diner': ['Burgers'],
  'Smokehouse 41': ['Burgers'],
  'Patty Wagon': ['Burgers'],
  'Yeşil Masa': ['Meze', 'Vegetarian'],
  'Moda İskele Meyhanesi': ['Meze', 'Turkish'],
  'Cihangir Sofrası': ['Meze', 'Turkish', 'Vegetarian'],
  'Galata Mantı Evi': ['Manti', 'Turkish'],
  'Bostan Sofrası': ['Turkish', 'Vegetarian'],
  'Mangal House': ['Turkish'],
  'Ocakbaşı Kömür': ['Turkish'],
  'Tünel Pide Salonu': ['Turkish', 'Pizza'],
  'Balat Kahvaltı Evi': ['Turkish'],
};

export const foodByName = (name: string): Food => {
  const { kind, tags } = FOODS.find((f) => f.name === name)!;
  return { name, kind, tags };
};
