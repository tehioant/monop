import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en, fr, resolveLanguage, translate } from '../src/i18n/strings.ts';
import { loadSettings, saveSettings, type Storage } from '../src/settings/settings.ts';

test('system language is French only for a French primary locale; a saved choice wins', () => {
  assert.equal(resolveLanguage('system', 'fr-CA'), 'fr');
  assert.equal(resolveLanguage('system', 'FR'), 'fr');
  assert.equal(resolveLanguage('system', 'de-DE'), 'en');
  assert.equal(resolveLanguage('system', undefined), 'en');
  assert.equal(resolveLanguage('en', 'fr-FR'), 'en');
  assert.equal(resolveLanguage('fr', 'en-US'), 'fr');
});

test('language is backward compatible, validated and round-trips through settings storage', () => {
  let raw = '{"sound":false,"haptics":true}';
  const storage: Storage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
  const legacy = loadSettings(storage);
  assert.deepEqual(legacy, { sound: false, haptics: true, language: 'system' });
  saveSettings(storage, { ...legacy, language: 'fr' });
  assert.deepEqual(loadSettings(storage), { ...legacy, language: 'fr' });
  raw = '{"language":"de","sound":false}';
  assert.deepEqual(loadSettings(storage), legacy);
});

test('translations agree on keys and placeholders and keep inserted values literal', () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    assert.deepEqual(placeholders(fr[key]), placeholders(en[key]), key);
  }
  assert.equal(translate('en')('home.tagline'), 'Collect countries, city by city.');
  assert.equal(translate('fr')('home.tagline'), 'Collectionnez les pays, ville après ville.');
  assert.equal(translate('fr')('common.count', { count: '{count}' }), 'Total : {count}');
});
