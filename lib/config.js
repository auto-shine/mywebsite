// ============================================================
// AutoShine booking: everything you might want to change lives here.
// Prices, zones, durations, opening hours, booking rules.
// ============================================================

export const BUSINESS = {
  name: 'AutoShine',
  timezone: 'Europe/London',
  // Centre point for distance measurement (Kenilworth, CV8)
  origin: { lat: 52.3425, lng: -1.583 },
  whatsapp: '447999923651',
  phoneDisplay: '07999 923651',
};

// Straight-line distance from CV8. A postcode inside maxMiles of the previous
// zone and up to this zone's maxMiles belongs to this zone.
// bufferMinutes = travel/setup gap kept free either side of a job in this zone.
export const ZONES = [
  { id: 'Z1', maxMiles: 10, bufferMinutes: 30 },
  { id: 'Z2', maxMiles: 20, bufferMinutes: 45 },
  { id: 'Z3', maxMiles: 30, bufferMinutes: 60 },
];

export const SIZES = {
  S: { label: 'Small', examples: 'Fiesta, Polo, Corsa, Mini, Fiat 500' },
  M: { label: 'Medium', examples: 'Golf, Focus, A3, 3 Series, Qashqai' },
  L: { label: 'Large', examples: 'Large SUVs, estates, X5, Range Rover, vans' },
};

const grid = (z1, z2, z3) => {
  const row = (a) => ({ S: a[0], M: a[1], L: a[2] });
  return { Z1: row(z1), Z2: row(z2), Z3: row(z3) };
};

// prices: [Small, Medium, Large] for each zone.
// minutes: time on site. fullDay: blocks the whole working day. days: number of working days.
// variable: price can rise for excessive dirt, mould or pet hair, so shown as "from".
export const SERVICES = {
  EFD: {
    label: 'Essential Full Detail',
    prices: grid([90, 100, 110], [100, 110, 120], [110, 120, 130]),
    minutes: 180, fullDay: false, days: 1, variable: true,
  },
  DCD: {
    label: 'Deep Clean Detail',
    prices: grid([140, 150, 170], [150, 160, 180], [160, 170, 190]),
    minutes: 300, fullDay: false, days: 1, variable: true,
  },
  PC1: {
    label: 'Paint Correction Stage 1',
    prices: grid([250, 260, 280], [260, 270, 300], [270, 280, 310]),
    minutes: 480, fullDay: true, days: 1, variable: false,
  },
  PC2: {
    label: 'Paint Correction Stage 2',
    prices: grid([300, 320, 350], [320, 340, 370], [330, 350, 380]),
    minutes: 600, fullDay: true, days: 1, variable: false,
  },
  CC: {
    label: 'Ceramic Coating',
    prices: grid([550, 580, 620], [560, 590, 630], [570, 600, 640]),
    minutes: 600, fullDay: true, days: 2, variable: false,
  },
  // Stand-alone services (same price in every zone)
  ENGINE: {
    label: 'Engine Bay Detail (on its own)',
    flat: 50,
    minutes: 60, fullDay: false, days: 1, variable: false,
  },
  HL: {
    label: 'Headlight Restoration (on its own, pair)',
    flat: 50,
    minutes: 90, fullDay: false, days: 1, variable: true,
  },
};

// Add-ons. extraMinutes is ignored for full-day services.
// notFor / onlyFor use service ids. excludes = cannot be combined.
export const ADDONS = {
  engine: {
    label: 'Engine bay detail', price: 35, extraMinutes: 45,
    notFor: ['ENGINE'],
  },
  headlights: {
    label: 'Headlight restoration (no UV coating)', price: 40, extraMinutes: 60,
    notFor: ['HL'], excludes: ['headlights_uv'],
  },
  headlights_uv: {
    label: 'Headlight restoration + UV coating', price: 80, extraMinutes: 75,
    notFor: ['HL'], excludes: ['headlights'],
  },
  hl_uv_coating: {
    label: 'UV coating for headlights', price: 50, extraMinutes: 30,
    onlyFor: ['HL'],
  },
  softtop: {
    label: 'Soft top waterproofing', price: 50, extraMinutes: 60,
  },
};

// Opening hours by weekday: 1 = Monday ... 7 = Sunday. [openHour, closeHour]. Missing = closed.
export const WORKING_HOURS = {
  1: [8, 18], 2: [8, 18], 3: [8, 18], 4: [8, 18], 5: [8, 18], 6: [8, 18],
};

export const BOOKING_RULES = {
  minNoticeHours: 24,     // earliest bookable slot from now
  maxDaysAhead: 60,       // how far ahead customers can book
  slotStepMinutes: 60,    // start-time choices through the day
};
