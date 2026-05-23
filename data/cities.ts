// City landing-page content. Each entry powers /sf, /nyc, /austin, etc.
// Pre-seeded restaurants act as the dining-index "Eve Originals" for that
// metro before the local restaurant supply organically kicks in.

export interface CityFeaturedRestaurant {
  name: string;
  cuisine: string;
  area: string;          // neighborhood
  blurb: string;          // one-line copy in Eve's voice
  signatureDish: string;
}

export interface CityContent {
  slug: string;          // url path segment, e.g. "sf"
  fullName: string;      // "San Francisco, CA"
  shortName: string;     // "San Francisco"
  metro: string;         // "Bay Area"
  hero: string;          // hero subtitle
  defaultStartArea: string; // dropdown default for the diner planner
  featured: CityFeaturedRestaurant[];
  // SEO metadata
  title: string;
  description: string;
}

export const CITIES: CityContent[] = [
  {
    slug: 'sf',
    fullName: 'San Francisco, CA',
    shortName: 'San Francisco',
    metro: 'Bay Area',
    hero: 'A city built for slow evenings. Eve plans them.',
    defaultStartArea: 'Mission, San Francisco',
    title: 'Eve · San Francisco evenings, planned',
    description:
      'AI evening concierge for San Francisco. Tell Eve where you are and what kind of night you want — dinner, dessert, drinks, a walk. She pulls together a real, walkable, multi-stop evening in 30 seconds.',
    featured: [
      {
        name: 'Foreign Cinema',
        cuisine: 'Californian',
        area: 'Mission',
        blurb: 'Black-and-white films projected on the courtyard wall while the brunch hits',
        signatureDish: 'Fried chicken and waffles',
      },
      {
        name: 'Liholiho Yacht Club',
        cuisine: 'Hawaiian / Filipino',
        area: 'Lower Nob Hill',
        blurb: 'Family-style plates, the most generous tuna poke in the city',
        signatureDish: 'Spicy tuna poke',
      },
      {
        name: 'Tartine Manufactory',
        cuisine: 'Bakery / Cafe',
        area: 'Mission',
        blurb: 'A loaf of bread that justifies the wait — start the evening here, not finish it',
        signatureDish: 'Country loaf, smoked tofu sandwich',
      },
      {
        name: 'Burma Superstar',
        cuisine: 'Burmese',
        area: 'Inner Richmond',
        blurb: 'Tea-leaf salad you mix at the table — if you know, you know',
        signatureDish: 'Tea-leaf salad',
      },
    ],
  },
  {
    slug: 'nyc',
    fullName: 'New York, NY',
    shortName: 'New York',
    metro: 'NYC',
    hero: 'Eve plans Manhattan evenings the way New Yorkers actually walk them.',
    defaultStartArea: 'West Village, NY',
    title: 'Eve · New York evenings, planned',
    description:
      'AI evening concierge for New York. Greenwich Village dinner to a Lower East Side dessert to a rooftop walk. Real venues, real timing, in 30 seconds.',
    featured: [
      {
        name: 'Via Carota',
        cuisine: 'Italian',
        area: 'West Village',
        blurb: 'Romantic without trying. The svizzerina is the order',
        signatureDish: 'Svizzerina',
      },
      {
        name: 'Lilia',
        cuisine: 'Italian',
        area: 'Williamsburg',
        blurb: 'Pasta-driven, gold-lit, the kind of room a Tuesday night deserves',
        signatureDish: 'Mafaldini with pink peppercorns',
      },
      {
        name: 'Atoboy',
        cuisine: 'Korean',
        area: 'NoMad',
        blurb: 'Three-course tasting that costs less than its peers and beats most',
        signatureDish: 'Soy-glazed eggplant',
      },
      {
        name: 'Estela',
        cuisine: 'Modern American',
        area: 'NoLita',
        blurb: 'A bar seat at Estela is one of the great New York gifts to yourself',
        signatureDish: 'Burrata with salsa verde',
      },
    ],
  },
  {
    slug: 'austin',
    fullName: 'Austin, TX',
    shortName: 'Austin',
    metro: 'Austin',
    hero: 'Eve plans Austin evenings without sending you to the same five places on every list.',
    defaultStartArea: 'East 6th, Austin',
    title: 'Eve · Austin evenings, planned',
    description:
      'AI evening concierge for Austin. East 6th BBQ, Rainey Street drinks, a walk along Lady Bird Lake. Real venues, real timing, in 30 seconds.',
    featured: [
      {
        name: 'Suerte',
        cuisine: 'Modern Mexican',
        area: 'East Austin',
        blurb: 'The masa program is reason enough — go for the suadero, stay for the mezcal',
        signatureDish: 'Suadero tacos',
      },
      {
        name: 'Uchiko',
        cuisine: 'Japanese',
        area: 'North Loop',
        blurb: 'Tyson Cole still gets it right — the omakase is worth the booking',
        signatureDish: 'Hama chili',
      },
      {
        name: 'Fonda San Miguel',
        cuisine: 'Mexican',
        area: 'Allandale',
        blurb: 'Old-school dining room, no shortcuts — Sunday brunch is mandatory once',
        signatureDish: 'Cochinita pibil',
      },
      {
        name: 'Veracruz All Natural',
        cuisine: 'Tacos',
        area: 'East Austin',
        blurb: 'A migas taco from the trailer is the right way to start any evening here',
        signatureDish: 'Migas taco',
      },
    ],
  },
  {
    slug: 'la',
    fullName: 'Los Angeles, CA',
    shortName: 'Los Angeles',
    metro: 'LA',
    hero: 'Eve plans LA evenings that don\u2019t require an hour on the freeway between stops.',
    defaultStartArea: 'Silver Lake, Los Angeles',
    title: 'Eve · Los Angeles evenings, planned',
    description:
      'AI evening concierge for Los Angeles. Silver Lake dinner, a walk through Echo Park, a closer in Frogtown. Real venues, real timing, in 30 seconds.',
    featured: [
      {
        name: 'Bavel',
        cuisine: 'Middle Eastern',
        area: 'Arts District',
        blurb: 'Lamb neck shawarma is the headline; the bread program is the real story',
        signatureDish: 'Lamb neck shawarma',
      },
      {
        name: 'Republique',
        cuisine: 'French / Bakery',
        area: 'Hancock Park',
        blurb: 'A grand dining room hidden behind one of the city\u2019s best bakeries',
        signatureDish: 'Roasted chicken for two',
      },
      {
        name: 'Kismet',
        cuisine: 'Mediterranean',
        area: 'Los Feliz',
        blurb: 'Vegetable-forward and confidently weird in the best way',
        signatureDish: 'Carrot juice cavatelli',
      },
      {
        name: 'Sushi Note',
        cuisine: 'Japanese',
        area: 'Sherman Oaks',
        blurb: 'A wine-pairing sushi bar that respects the fish and the bottle equally',
        signatureDish: 'Omakase + wine flight',
      },
    ],
  },
  {
    slug: 'seattle',
    fullName: 'Seattle, WA',
    shortName: 'Seattle',
    metro: 'Seattle',
    hero: 'Eve plans Seattle evenings around water, fog, and very serious cocktails.',
    defaultStartArea: 'Capitol Hill, Seattle',
    title: 'Eve · Seattle evenings, planned',
    description:
      'AI evening concierge for Seattle. Capitol Hill dinner to a Pike Place dessert to a walk along the waterfront. Real venues, real timing, in 30 seconds.',
    featured: [
      {
        name: 'Canlis',
        cuisine: 'Pacific Northwest',
        area: 'Queen Anne',
        blurb: 'The view alone could carry a lesser kitchen — this one doesn\u2019t need it to',
        signatureDish: 'Wagyu tenderloin',
      },
      {
        name: 'Sushi Kashiba',
        cuisine: 'Japanese',
        area: 'Pike Place',
        blurb: 'Twenty-seat counter, Shiro Kashiba behind it — book early',
        signatureDish: 'Omakase counter seat',
      },
      {
        name: 'Spinasse',
        cuisine: 'Italian',
        area: 'Capitol Hill',
        blurb: 'Hand-cut tajarin under a butter and sage that ruins all other tajarin',
        signatureDish: 'Tajarin al ragu',
      },
      {
        name: 'Local 360',
        cuisine: 'American',
        area: 'Belltown',
        blurb: 'Local-everything menu in a room that feels like an old friend\u2019s living room',
        signatureDish: 'Pacific Northwest cheese plate',
      },
    ],
  },
  {
    slug: 'chicago',
    fullName: 'Chicago, IL',
    shortName: 'Chicago',
    metro: 'Chicago',
    hero: 'Eve plans Chicago evenings the way the city actually eats them.',
    defaultStartArea: 'West Loop, Chicago',
    title: 'Eve · Chicago evenings, planned',
    description:
      'AI evening concierge for Chicago. West Loop dinner to a Wicker Park dessert to a walk along the lakefront. Real venues, real timing, in 30 seconds.',
    featured: [
      {
        name: 'Avec',
        cuisine: 'Mediterranean / Small Plates',
        area: 'West Loop',
        blurb: 'Communal benches, the best chorizo-stuffed Medjool dates in the city',
        signatureDish: 'Chorizo-stuffed dates',
      },
      {
        name: 'Smyth',
        cuisine: 'Modern American',
        area: 'West Loop',
        blurb: 'The chef\u2019s table is theatre, the tasting menu is fine craftsmanship',
        signatureDish: 'Egg yolk filled with caviar',
      },
      {
        name: 'Pequod\u2019s Pizza',
        cuisine: 'Pizza',
        area: 'Lincoln Park',
        blurb: 'Caramelized cheese crust. There is the right answer to deep dish, this is it',
        signatureDish: 'Pan-style sausage pizza',
      },
      {
        name: 'Lula Cafe',
        cuisine: 'Cafe / American',
        area: 'Logan Square',
        blurb: 'Farm dinners that taste like the chef called the farmers personally that morning',
        signatureDish: 'Farm dinner Monday',
      },
    ],
  },
];

export function findCity(slug: string): CityContent | null {
  return CITIES.find((c) => c.slug === slug) || null;
}
