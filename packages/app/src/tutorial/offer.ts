import * as SecureStore from 'expo-secure-store';
import { warnOnce } from '../warnOnce.ts';

const KEY = 'atlas.tutorial-offer';
let choice: 'started' | 'skipped' | undefined;

export function shouldOfferTutorial(): boolean {
  if (choice) return false;
  try {
    const saved = SecureStore.getItem(KEY);
    return saved !== 'started' && saved !== 'skipped';
  } catch {
    warnOnce('tutorial-offer', 'Could not read tutorial preference.');
    return true;
  }
}

export function dismissTutorialOffer(decision: 'started' | 'skipped'): void {
  choice = decision;
  try {
    SecureStore.setItem(KEY, decision);
  } catch {
    warnOnce('tutorial-offer', 'Could not save tutorial preference.');
  }
}
