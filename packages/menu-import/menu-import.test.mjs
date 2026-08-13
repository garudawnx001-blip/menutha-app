import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRows, diffPlan } from './index.js';

const good = (over = {}) => ({
  'Dish Name': 'Paneer Tikka', Category: 'Starters', 'Veg/NonVeg': 'Veg',
  Price: 320, Description: 'Char-grilled', 'Available (Y/N)': 'Y', 'Image Filename': '',
  ...over,
});

test('valid rows pass with correct parsing', () => {
  const { errors, rows } = validateRows([good(), good({ 'Dish Name': 'Ghee Roast', 'Veg/NonVeg': 'NonVeg', 'Available (Y/N)': 'N' })]);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isVeg, true);
  assert.equal(rows[1].isVeg, false);
  assert.equal(rows[1].available, false);
});

test('empty file is rejected', () => {
  assert.ok(validateRows([]).errors.length === 1);
});

test('missing name reported with row number', () => {
  const { errors } = validateRows([good({ 'Dish Name': '' })]);
  assert.match(errors[0], /Row 2: Dish Name is empty/);
});

test('duplicates within the file are rejected', () => {
  const { errors } = validateRows([good(), good()]);
  assert.match(errors[0], /Row 3: duplicate dish/);
});

test('bad veg flag, price, and availability all reported (all-or-nothing)', () => {
  const { errors } = validateRows([
    good({ 'Veg/NonVeg': 'maybe', Price: 'free', 'Available (Y/N)': 'sometimes' }),
  ]);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /Veg\/NonVeg/);
  assert.match(errors[1], /Price/);
  assert.match(errors[2], /Available/);
});

test('zero or negative price rejected', () => {
  assert.match(validateRows([good({ Price: 0 })]).errors[0], /Price/);
  assert.match(validateRows([good({ Price: -5 })]).errors[0], /Price/);
});

test('diffPlan separates creates, updates, and new categories', () => {
  const { rows } = validateRows([
    good(),                                                   // update (exists)
    good({ 'Dish Name': 'New Dish', Category: 'Tandoori' }),  // create + new category
  ]);
  const plan = diffPlan(rows, [{ name: 'Starters' }], [{ name: 'paneer tikka' }]);
  assert.deepEqual(plan.newCategories, ['Tandoori']);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].name, 'New Dish');
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].row.name, 'Paneer Tikka');
});
