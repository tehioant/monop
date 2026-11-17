import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { english } from '../src/i18n/strings.ts';

export const englishLocale = { useTranslation: () => english };
const { transformSync } = createRequire(import.meta.url)('@babel/core');

// Execute the actual TSX entry point; only React hooks and native I/O are replaced.
export function loadComponent(path: string, mocks: Record<string, any>): any {
  return componentLoader(mocks)(path);
}

export function componentLoader(mocks: Record<string, any>) {
  const cache = new Map<string, any>();
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    cache.set(file, mod.exports);
    const source = transformSync(readFileSync(file, 'utf8'), { filename: file, configFile: false, babelrc: false, plugins: [
      ['@babel/plugin-transform-typescript', { isTSX: file.endsWith('.tsx') }],
      ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
      '@babel/plugin-transform-modules-commonjs',
    ] }).code;
    const require = (name: string): any => {
      if (name in mocks) return mocks[name];
      if (name.endsWith('.wav')) return name;
      if (name.startsWith('.')) return load(resolve(dirname(file), name));
      return createRequire(file)(name);
    };
    new Function('require', 'module', 'exports', source)(require, mod, mod.exports);
    return mod.exports;
  }
  return (path: string) => load(resolve(path));
}

export function hooks() {
  let slots: any[] = [], index = 0, dirty = false;
  const effects = new Map<number, () => void>();
  const react = {
    Fragment: Symbol('Fragment'),
    useState(initial: any) {
      const key = index++;
      if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial;
      return [slots[key], (change: any) => {
        const value = typeof change === 'function' ? change(slots[key]) : change;
        if (!Object.is(value, slots[key])) { slots[key] = value; dirty = true; }
      }];
    },
    useRef(initial: any) { const key = index++; return slots[key] ??= { current: initial }; },
    useEffect(effect: () => any, deps: any[]) {
      const key = index++;
      if (!slots[key] || deps.some((value, i) => !Object.is(value, slots[key].deps[i]))) {
        effects.set(key, () => { slots[key]?.cleanup?.(); slots[key] = { deps, cleanup: effect() }; });
      }
    },
  };
  return {
    react,
    render<T>(component: () => T): T {
      let value: T;
      do { dirty = false; index = 0; value = component(); } while (dirty);
      return value;
    },
    flush() { const pending = [...effects.values()]; effects.clear(); pending.forEach((effect) => effect()); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); slots = []; effects.clear(); },
  };
}

export const native = { View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', StyleSheet: { create: (styles: any) => styles } };
export const animated = { __esModule: true, default: { createAnimatedComponent: (component: any) => component }, ZoomIn: { delay: () => ({ duration: () => ({}) }) } };
export function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
