import { es } from '../i18n/es.js';

const KEY = 'tts-language';
const ATTRS = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt'];
const textState = new WeakMap();
const attrState = new WeakMap();
const listeners = new Set();
const numeric = new Map();

for (const [english, spanish] of Object.entries(es)) {
  if (/\d/.test(english)) numeric.set(english.replace(/\d+(?:[.,]\d+)*/g, '\u0001'), spanish.replace(/\d+(?:[.,]\d+)*/g, '\u0001'));
}

function savedLanguage() {
  try { return localStorage.getItem(KEY) === 'es' ? 'es' : 'en'; }
  catch { return 'en'; }
}

let language = savedLanguage();
let observer;

export function getLanguage() { return language; }

export function translate(value) {
  if (language !== 'es' || !value) return value;
  const exact = es[value];
  if (exact) return exact;
  const detail = value.match(/^(.*?) — interactive (lesson|game) in The Trade School: learn to read the market by playing\. Educational only, not financial advice\.$/);
  if (detail) return `${translate(detail[1])} — ${detail[2] === 'lesson' ? 'lección' : 'juego'} interactivo de The Trade School para aprender a leer el mercado jugando. Solo contenido educativo; no constituye asesoramiento financiero.`;
  if (value.includes(' · ')) {
    const parts = value.split(' · ');
    const translated = parts.map((part) => es[part] || part);
    if (translated.some((part, index) => part !== parts[index])) return translated.join(' · ');
  }
  const numbers = value.match(/\d+(?:[.,]\d+)*/g);
  if (numbers?.length) {
    const match = numeric.get(value.replace(/\d+(?:[.,]\d+)*/g, '\u0001'));
    if (match) {
      let index = 0;
      return match.replace(/\u0001/g, () => numbers[index++] ?? '');
    }
  }
  const labeledNumber = value.match(/^([A-Za-z][A-Za-z ]{1,24}) (\d[\d.,%+-]*)$/);
  if (labeledNumber && es[labeledNumber[1]]) return `${es[labeledNumber[1]]} ${labeledNumber[2]}`;
  return value;
}

function ignored(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !element || !!element.closest('script, style, noscript, [data-i18n-ignore], [contenteditable]:not([contenteditable="false"])');
}

function updateText(node) {
  if (ignored(node)) return;
  const current = node.nodeValue;
  if (!current?.trim()) return;
  let state = textState.get(node);
  if (!state) state = { english: current, applied: null };
  else if (current !== state.applied && current !== state.english) state.english = current;
  const source = state.english;
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  const body = source.trim().replace(/\s+/g, ' ');
  const result = language === 'es' ? `${leading}${translate(body)}${trailing}` : source;
  state.applied = result;
  textState.set(node, state);
  if (current !== result) node.nodeValue = result;
}

function updateAttrs(element) {
  if (ignored(element)) return;
  let state = attrState.get(element);
  if (!state) state = new Map();
  const names = element.matches('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"], meta[property="og:title"], meta[name="twitter:title"]')
    ? [...ATTRS, 'content'] : ATTRS;
  for (const name of names) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name);
    let item = state.get(name);
    if (!item) item = { english: current, applied: null };
    else if (current !== item.applied && current !== item.english) item.english = current;
    const result = language === 'es' ? translate(item.english) : item.english;
    item.applied = result;
    state.set(name, item);
    if (current !== result) element.setAttribute(name, result);
  }
  if (element.matches('input[type="submit"], input[type="button"], input[type="reset"]') && element.hasAttribute('value')) {
    const name = 'value';
    const current = element.value;
    let item = state.get(name);
    if (!item) item = { english: current, applied: null };
    else if (current !== item.applied && current !== item.english) item.english = current;
    const result = language === 'es' ? translate(item.english) : item.english;
    item.applied = result;
    state.set(name, item);
    if (current !== result) element.value = result;
  }
  attrState.set(element, state);
}

function updateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) return updateText(root);
  if (root.nodeType !== Node.ELEMENT_NODE || ignored(root)) return;
  updateAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.nodeType === Node.TEXT_NODE) updateText(walker.currentNode);
    else updateAttrs(walker.currentNode);
  }
}

export function setLanguage(next) {
  if (next !== 'en' && next !== 'es') return;
  language = next;
  try { localStorage.setItem(KEY, next); } catch { /* private browsing */ }
  document.documentElement.lang = next;
  document.documentElement.dataset.language = next;
  updateTree(document.documentElement);
  for (const listener of listeners) listener(next);
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function installI18n() {
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
  updateTree(document.documentElement);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') updateText(record.target);
      else if (record.type === 'attributes') updateAttrs(record.target);
      else for (const node of record.addedNodes) updateTree(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS, 'value', 'content'],
  });
}
