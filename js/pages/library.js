// Pattern Library — placeholder. Another contributor replaces this page.
import { h, icon } from '../core/ui.js';

export default {
  id: 'library',
  mount(root) {
    root.append(h('div', { class: 'container page-stub' },
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Reference'),
        h('h1', null, 'Pattern Library'),
        h('p', { class: 'lead' }, 'Every candlestick and chart pattern with an annotated diagram, the psychology behind it and how to trade it. Coming soon.')),
      h('div', { class: 'callout callout--tip' }, icon('info'),
        h('p', null, 'While the library is being built, the patterns are covered in the lessons: ',
          h('a', { href: '#l.candle-patterns' }, 'Candlestick patterns'), ' and ',
          h('a', { href: '#l.chart-patterns' }, 'Reversal & continuation patterns'), '.'))));
  },
};
