import test from 'node:test';
import assert from 'node:assert/strict';
import { priceMenu, priceQuote } from '../lib/pricing.js';

// Jake's price list, typed in independently of config.js. Order: [S, M, L].
const EXPECTED = {
  EFD: { Z1: [90, 100, 110], Z2: [100, 110, 120], Z3: [110, 120, 130] },
  DCD: { Z1: [140, 150, 170], Z2: [150, 160, 180], Z3: [160, 170, 190] },
  PC1: { Z1: [250, 260, 280], Z2: [260, 270, 300], Z3: [270, 280, 310] },
  PC2: { Z1: [300, 320, 350], Z2: [320, 340, 370], Z3: [330, 350, 380] },
  CC: { Z1: [550, 580, 620], Z2: [560, 590, 630], Z3: [570, 600, 640] },
};

test('every service x zone x size price matches the price list', () => {
  let checked = 0;
  for (const [service, zones] of Object.entries(EXPECTED)) {
    for (const [zone, prices] of Object.entries(zones)) {
      ['S', 'M', 'L'].forEach((size, i) => {
        const q = priceQuote({ service, size, zone });
        assert.equal(q.total, prices[i], `${service} ${zone} ${size}`);
        checked++;
      });
    }
  }
  assert.equal(checked, 45);
});

test('EFD and DCD are "from" prices, paint/ceramic are not', () => {
  assert.equal(priceQuote({ service: 'EFD', size: 'S', zone: 'Z1' }).isFrom, true);
  assert.equal(priceQuote({ service: 'DCD', size: 'S', zone: 'Z1' }).isFrom, true);
  assert.equal(priceQuote({ service: 'PC1', size: 'S', zone: 'Z1' }).isFrom, false);
  assert.equal(priceQuote({ service: 'CC', size: 'S', zone: 'Z1' }).isFrom, false);
});

test('add-ons: engine bay +35, headlights +40 / +80 with UV, soft top +50', () => {
  const base = 100; // EFD Z2 S
  const q = (addons) => priceQuote({ service: 'EFD', size: 'S', zone: 'Z2', addons }).total;
  assert.equal(q([]), base);
  assert.equal(q(['engine']), base + 35);
  assert.equal(q(['headlights']), base + 40);
  assert.equal(q(['headlights_uv']), base + 80);
  assert.equal(q(['softtop']), base + 50);
  assert.equal(q(['engine', 'headlights_uv', 'softtop']), base + 35 + 80 + 50);
});

test('add-ons also work on paint correction and ceramic', () => {
  assert.equal(priceQuote({ service: 'CC', size: 'L', zone: 'Z3', addons: ['engine', 'softtop'] }).total, 640 + 35 + 50);
});

test('stand-alone engine bay is £50 and headlights are £50, +£50 with UV (any zone/size)', () => {
  for (const zone of ['Z1', 'Z2', 'Z3']) {
    for (const size of ['S', 'M', 'L']) {
      assert.equal(priceQuote({ service: 'ENGINE', size, zone }).total, 50);
      assert.equal(priceQuote({ service: 'HL', size, zone }).total, 50);
      assert.equal(priceQuote({ service: 'HL', size, zone, addons: ['hl_uv_coating'] }).total, 100);
    }
  }
});

test('invalid combinations are rejected', () => {
  const bad = (args) => assert.throws(() => priceQuote({ size: 'S', zone: 'Z1', ...args }));
  bad({ service: 'ENGINE', addons: ['engine'] });
  bad({ service: 'HL', addons: ['headlights'] });
  bad({ service: 'HL', addons: ['headlights_uv'] });
  bad({ service: 'EFD', addons: ['headlights', 'headlights_uv'] });
  bad({ service: 'EFD', addons: ['hl_uv_coating'] });
  bad({ service: 'EFD', addons: ['nonsense'] });
  bad({ service: 'NOPE' });
  bad({ service: 'EFD', size: 'XL' });
  bad({ service: 'EFD', zone: 'Z9' });
  bad({ service: 'EFD', addons: 'engine' });
});

test('duplicate add-ons are only charged once', () => {
  assert.equal(priceQuote({ service: 'EFD', size: 'S', zone: 'Z1', addons: ['engine', 'engine'] }).total, 90 + 35);
});

test('price menu lists every service for the chosen size and zone', () => {
  const menu = priceMenu({ size: 'M', zone: 'Z2' });
  assert.equal(menu.EFD.price, 110);
  assert.equal(menu.CC.price, 590);
  assert.equal(menu.ENGINE.price, 50);
});
