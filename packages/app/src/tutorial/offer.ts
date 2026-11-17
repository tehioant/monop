import * as SecureStore from 'expo-secure-store';
import { warnOnce } from '../warnOnce.ts';

const KEY = 'atlas.tutorial-offer';
let choice: 'started' | 'skipped' | undefined;

export function shouldOfferTutorial(): boolean {
  if (choice) return false;
  try {
    const saved = SecureStore.getItem(KEY);
    if (saved === 'started' || saved === 'skipped') choice = saved;
  } catch {
    warnOnce('tutorial-offer', 'Could not read tutorial preference.');
  }
  return choice === undefined;
}

export function dismissTutorialOffer(decision: 'started' | 'skipped'): void {
  choice = decision;
  try {
    SecureStore.setItem(KEY, decision);
  } catch {
    warnOnce('tutorial-offer', 'Could not save tutorial preference.');
  }
}
