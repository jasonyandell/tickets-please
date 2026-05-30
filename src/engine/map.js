// The United States board for tickets-please. See CONTRACT.md §2 for the format.
//
// This is pure data: the map geometry (cities + routes) and the destination
// ticket deck. Coordinates are tuned for a 1200x760 logical canvas, laid out
// west->east, north->south to roughly match US geography. Route colors are drawn
// from TRAIN_COLORS (constants.js) plus GRAY ("any single color").
//
// Validate with: node tools/validate-map.js  (must print "✓ map valid").
//
// Design budget (hard invariants enforced by tools/validate-map.js; the rest are
// design targets): 38 cities, 68 routes, 9 double-route pairs, all 8 train
// colors used, the whole graph one connected component, 36 destination tickets.

export const MAP = {
  name: 'United States',
  width: 1200,
  height: 760,
  cities: [
    { id: 'sea', name: 'Seattle', x: 95, y: 70 },
    { id: 'por', name: 'Portland', x: 80, y: 160 },
    { id: 'sfo', name: 'San Francisco', x: 60, y: 365 },
    { id: 'lax', name: 'Los Angeles', x: 115, y: 480 },
    { id: 'sdg', name: 'San Diego', x: 135, y: 530 },
    { id: 'lvg', name: 'Las Vegas', x: 195, y: 405 },
    { id: 'slc', name: 'Salt Lake City', x: 270, y: 300 },
    { id: 'phx', name: 'Phoenix', x: 230, y: 505 },
    { id: 'boi', name: 'Boise', x: 220, y: 205 },
    { id: 'hel', name: 'Helena', x: 335, y: 150 },
    { id: 'bil', name: 'Billings', x: 385, y: 180 },
    { id: 'den', name: 'Denver', x: 395, y: 360 },
    { id: 'abq', name: 'Albuquerque', x: 355, y: 475 },
    { id: 'elp', name: 'El Paso', x: 395, y: 560 },
    { id: 'bis', name: 'Bismarck', x: 485, y: 150 },
    { id: 'min', name: 'Minneapolis', x: 600, y: 195 },
    { id: 'oma', name: 'Omaha', x: 560, y: 320 },
    { id: 'kan', name: 'Kansas City', x: 580, y: 380 },
    { id: 'okc', name: 'Oklahoma City', x: 580, y: 470 },
    { id: 'dal', name: 'Dallas', x: 605, y: 545 },
    { id: 'sat', name: 'San Antonio', x: 580, y: 610 },
    { id: 'hou', name: 'Houston', x: 640, y: 605 },
    { id: 'chi', name: 'Chicago', x: 690, y: 265 },
    { id: 'stl', name: 'St. Louis', x: 655, y: 405 },
    { id: 'mem', name: 'Memphis', x: 695, y: 480 },
    { id: 'nol', name: 'New Orleans', x: 715, y: 600 },
    { id: 'det', name: 'Detroit', x: 800, y: 235 },
    { id: 'nsh', name: 'Nashville', x: 755, y: 450 },
    { id: 'atl', name: 'Atlanta', x: 815, y: 500 },
    { id: 'mia', name: 'Miami', x: 975, y: 705 },
    { id: 'jax', name: 'Jacksonville', x: 910, y: 580 },
    { id: 'chs', name: 'Charleston', x: 915, y: 505 },
    { id: 'pit', name: 'Pittsburgh', x: 865, y: 300 },
    { id: 'wdc', name: 'Washington', x: 945, y: 360 },
    { id: 'nyc', name: 'New York', x: 1010, y: 275 },
    { id: 'bos', name: 'Boston', x: 1070, y: 225 },
    { id: 'buf', name: 'Buffalo', x: 885, y: 250 },
    { id: 'ral', name: 'Raleigh', x: 915, y: 440 },
  ],
  routes: [
    // ---- Pacific Northwest / West Coast ----
    { id: 'sea-por', a: 'sea', b: 'por', length: 1, color: 'gray' },              // 1
    { id: 'sea-boi', a: 'sea', b: 'boi', length: 3, color: 'red' },               // 2
    { id: 'por-boi', a: 'por', b: 'boi', length: 3, color: 'green' },             // 3
    { id: 'por-sfo', a: 'por', b: 'sfo', length: 4, color: 'blue', parallel: true },   // 4  D1
    { id: 'por-sfo-2', a: 'por', b: 'sfo', length: 4, color: 'green', parallel: true },// 5  D1
    { id: 'sfo-lax', a: 'sfo', b: 'lax', length: 2, color: 'purple', parallel: true }, // 6  D2
    { id: 'sfo-lax-2', a: 'sfo', b: 'lax', length: 2, color: 'yellow', parallel: true },//7  D2
    { id: 'sfo-lvg', a: 'sfo', b: 'lvg', length: 3, color: 'orange' },            // 8
    { id: 'lax-sdg', a: 'lax', b: 'sdg', length: 1, color: 'gray' },              // 9
    { id: 'sdg-phx', a: 'sdg', b: 'phx', length: 2, color: 'gray' },              // 10
    { id: 'lax-phx', a: 'lax', b: 'phx', length: 3, color: 'white' },             // 11

    // ---- Mountain West ----
    { id: 'sea-hel', a: 'sea', b: 'hel', length: 4, color: 'yellow' },            // 12
    { id: 'boi-slc', a: 'boi', b: 'slc', length: 2, color: 'gray' },              // 13
    { id: 'boi-hel', a: 'boi', b: 'hel', length: 2, color: 'gray' },              // 14
    { id: 'slc-lvg', a: 'slc', b: 'lvg', length: 2, color: 'black' },             // 15
    { id: 'lvg-phx', a: 'lvg', b: 'phx', length: 2, color: 'gray' },              // 16
    { id: 'slc-den', a: 'slc', b: 'den', length: 3, color: 'red', parallel: true },    // 17 D3
    { id: 'slc-den-2', a: 'slc', b: 'den', length: 3, color: 'yellow', parallel: true },//18 D3
    { id: 'phx-abq', a: 'phx', b: 'abq', length: 3, color: 'gray' },              // 19
    { id: 'abq-den', a: 'abq', b: 'den', length: 2, color: 'gray' },              // 20
    { id: 'abq-elp', a: 'abq', b: 'elp', length: 2, color: 'gray' },              // 21
    { id: 'phx-elp', a: 'phx', b: 'elp', length: 3, color: 'orange' },            // 22

    // ---- Northern Plains ----
    { id: 'hel-bil', a: 'hel', b: 'bil', length: 1, color: 'gray' },              // 23
    { id: 'bil-bis', a: 'bil', b: 'bis', length: 2, color: 'gray' },              // 24
    { id: 'bil-den', a: 'bil', b: 'den', length: 4, color: 'blue' },              // 25
    { id: 'bis-min', a: 'bis', b: 'min', length: 3, color: 'gray', parallel: true },   // 26 D4
    { id: 'bis-min-2', a: 'bis', b: 'min', length: 3, color: 'orange', parallel: true },//27 D4
    { id: 'bis-oma', a: 'bis', b: 'oma', length: 3, color: 'purple' },            // 28
    { id: 'hel-den', a: 'hel', b: 'den', length: 4, color: 'green' },             // 29

    // ---- Central Plains ----
    { id: 'den-oma', a: 'den', b: 'oma', length: 4, color: 'purple' },            // 30
    { id: 'den-kan', a: 'den', b: 'kan', length: 4, color: 'black' },             // 31
    { id: 'oma-min', a: 'oma', b: 'min', length: 2, color: 'gray' },              // 32
    { id: 'oma-kan', a: 'oma', b: 'kan', length: 1, color: 'gray' },              // 33
    { id: 'oma-chi', a: 'oma', b: 'chi', length: 4, color: 'yellow' },            // 34
    { id: 'kan-stl', a: 'kan', b: 'stl', length: 2, color: 'gray', parallel: true },   // 35 D5
    { id: 'kan-stl-2', a: 'kan', b: 'stl', length: 2, color: 'blue', parallel: true }, // 36 D5
    { id: 'kan-okc', a: 'kan', b: 'okc', length: 2, color: 'gray' },              // 37
    { id: 'den-okc', a: 'den', b: 'okc', length: 5, color: 'red' },               // 38

    // ---- South Central / Texas ----
    { id: 'okc-dal', a: 'okc', b: 'dal', length: 2, color: 'gray', parallel: true },   // 39 D6
    { id: 'okc-dal-2', a: 'okc', b: 'dal', length: 2, color: 'green', parallel: true },// 40 D6
    { id: 'elp-dal', a: 'elp', b: 'dal', length: 4, color: 'red' },               // 41
    { id: 'elp-sat', a: 'elp', b: 'sat', length: 5, color: 'purple' },            // 42
    { id: 'dal-sat', a: 'dal', b: 'sat', length: 1, color: 'gray' },              // 43
    { id: 'dal-hou', a: 'dal', b: 'hou', length: 1, color: 'gray' },              // 44
    { id: 'sat-hou', a: 'sat', b: 'hou', length: 1, color: 'gray' },              // 45
    { id: 'hou-nol', a: 'hou', b: 'nol', length: 1, color: 'gray' },              // 46
    { id: 'dal-mem', a: 'dal', b: 'mem', length: 3, color: 'orange' },            // 47
    { id: 'okc-mem', a: 'okc', b: 'mem', length: 3, color: 'gray' },              // 48

    // ---- Mississippi / Southeast ----
    { id: 'stl-chi', a: 'stl', b: 'chi', length: 2, color: 'green', parallel: true },  // 49 D7
    { id: 'stl-chi-2', a: 'stl', b: 'chi', length: 2, color: 'white', parallel: true },// 50 D7
    { id: 'stl-mem', a: 'stl', b: 'mem', length: 2, color: 'gray' },              // 51
    { id: 'mem-nol', a: 'mem', b: 'nol', length: 3, color: 'white' },             // 52
    { id: 'mem-nsh', a: 'mem', b: 'nsh', length: 1, color: 'gray' },              // 53
    { id: 'nol-atl', a: 'nol', b: 'atl', length: 4, color: 'yellow' },            // 54
    { id: 'nol-jax', a: 'nol', b: 'jax', length: 4, color: 'gray' },              // 55
    { id: 'nsh-atl', a: 'nsh', b: 'atl', length: 2, color: 'gray' },              // 56
    { id: 'nsh-stl', a: 'nsh', b: 'stl', length: 2, color: 'gray' },              // 57
    { id: 'atl-jax', a: 'atl', b: 'jax', length: 2, color: 'gray' },              // 58
    { id: 'jax-mia', a: 'jax', b: 'mia', length: 3, color: 'gray' },              // 59
    { id: 'chs-jax', a: 'chs', b: 'jax', length: 2, color: 'blue' },              // 60

    // ---- Great Lakes / Midwest ----
    { id: 'chi-det', a: 'chi', b: 'det', length: 3, color: 'purple' },            // 61
    { id: 'min-chi', a: 'min', b: 'chi', length: 3, color: 'red' },               // 62
    { id: 'chi-pit', a: 'chi', b: 'pit', length: 3, color: 'orange' },            // 63
    { id: 'det-buf', a: 'det', b: 'buf', length: 2, color: 'gray' },              // 64

    // ---- Appalachia / Mid-Atlantic ----
    { id: 'pit-buf', a: 'pit', b: 'buf', length: 1, color: 'gray' },              // 65
    { id: 'pit-wdc', a: 'pit', b: 'wdc', length: 2, color: 'white' },             // 66
    { id: 'pit-nsh', a: 'pit', b: 'nsh', length: 4, color: 'black' },             // 67
    { id: 'atl-ral', a: 'atl', b: 'ral', length: 2, color: 'gray' },              // 68
    { id: 'chs-ral', a: 'chs', b: 'ral', length: 1, color: 'gray' },              // 69
    { id: 'ral-wdc', a: 'ral', b: 'wdc', length: 2, color: 'gray' },              // 70

    // ---- Northeast ----
    { id: 'buf-nyc', a: 'buf', b: 'nyc', length: 2, color: 'gray' },              // 71
    { id: 'wdc-nyc', a: 'wdc', b: 'nyc', length: 2, color: 'orange', parallel: true }, // 72 D8
    { id: 'wdc-nyc-2', a: 'wdc', b: 'nyc', length: 2, color: 'black', parallel: true },// 73 D8
    { id: 'nyc-bos', a: 'nyc', b: 'bos', length: 2, color: 'gray', parallel: true },   // 74 D9
    { id: 'nyc-bos-2', a: 'nyc', b: 'bos', length: 2, color: 'red', parallel: true },  // 75 D9
    { id: 'buf-bos', a: 'buf', b: 'bos', length: 3, color: 'blue' },              // 76
  ],
};

export const TICKETS = [
  // ---- Long transcontinental (marquee) tickets (~18-22) ----
  { id: 't-sea-mia', from: 'sea', to: 'mia', points: 22 },
  { id: 't-lax-nyc', from: 'lax', to: 'nyc', points: 21 },
  { id: 't-sfo-bos', from: 'sfo', to: 'bos', points: 22 },
  { id: 't-por-wdc', from: 'por', to: 'wdc', points: 20 },
  { id: 't-sdg-jax', from: 'sdg', to: 'jax', points: 20 },
  { id: 't-sea-hou', from: 'sea', to: 'hou', points: 18 },
  { id: 't-lax-chs', from: 'lax', to: 'chs', points: 19 },
  { id: 't-sfo-nyc', from: 'sfo', to: 'nyc', points: 21 },

  // ---- Medium cross-region tickets (~10-15) ----
  { id: 't-sea-den', from: 'sea', to: 'den', points: 12 },
  { id: 't-den-chi', from: 'den', to: 'chi', points: 11 },
  { id: 't-den-nyc', from: 'den', to: 'nyc', points: 15 },
  { id: 't-lax-den', from: 'lax', to: 'den', points: 10 },
  { id: 't-chi-mia', from: 'chi', to: 'mia', points: 14 },
  { id: 't-min-nol', from: 'min', to: 'nol', points: 13 },
  { id: 't-bos-mia', from: 'bos', to: 'mia', points: 14 },
  { id: 't-min-hou', from: 'min', to: 'hou', points: 12 },
  { id: 't-kan-atl', from: 'kan', to: 'atl', points: 10 },
  { id: 't-elp-chi', from: 'elp', to: 'chi', points: 14 },
  { id: 't-phx-min', from: 'phx', to: 'min', points: 14 },
  { id: 't-det-dal', from: 'det', to: 'dal', points: 12 },
  { id: 't-bos-pit', from: 'bos', to: 'pit', points: 10 },
  { id: 't-hel-stl', from: 'hel', to: 'stl', points: 11 },
  { id: 't-slc-kan', from: 'slc', to: 'kan', points: 10 },
  { id: 't-atl-nyc', from: 'atl', to: 'nyc', points: 11 },
  { id: 't-nol-pit', from: 'nol', to: 'pit', points: 11 },

  // ---- Short regional tickets (~5-9) ----
  { id: 't-sea-sfo', from: 'sea', to: 'sfo', points: 8 },
  { id: 't-sea-slc', from: 'sea', to: 'slc', points: 8 },
  { id: 't-lax-elp', from: 'lax', to: 'elp', points: 7 },
  { id: 't-den-okc', from: 'den', to: 'okc', points: 5 },
  { id: 't-dal-nol', from: 'dal', to: 'nol', points: 5 },
  { id: 't-chi-nsh', from: 'chi', to: 'nsh', points: 7 },
  { id: 't-min-okc', from: 'min', to: 'okc', points: 8 },
  { id: 't-atl-wdc', from: 'atl', to: 'wdc', points: 6 },
  { id: 't-bos-buf', from: 'bos', to: 'buf', points: 5 },
  { id: 't-hou-atl', from: 'hou', to: 'atl', points: 7 },
  { id: 't-pit-mem', from: 'pit', to: 'mem', points: 8 },
  { id: 't-bil-oma', from: 'bil', to: 'oma', points: 7 },
];

// Attach the ticket list to MAP so a single `map` value is self-contained: the
// engine resolves kept ticket ids via `map.tickets` (game.js), and CONTRACT.md
// §2 specifies a MAP carries { cities, routes, tickets }. TICKETS remains a
// separate named export for callers that want just the ticket deck.
MAP.tickets = TICKETS;
