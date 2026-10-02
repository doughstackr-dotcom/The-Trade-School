import { FREE_IDS } from '../config.js';
import { canOpen, lockLabel, requiredPlan } from '../core/access.js';
import { h, icon } from '../core/ui.js';
import { TOOLS, hashFor } from '../registry.js';

function planLabel(tool) {
  const plan = requiredPlan(tool);
  if (plan === 'advanced') return 'Advanced';
  if (plan === 'beginner') return 'Beginner';
  return 'Free';
}

function toolCard(tool) {
  const open = canOpen(tool, { kind: 'tool', id: tool.id });
  const href = open || FREE_IDS.includes(tool.id) ? `#${hashFor(tool.id)}` : '#paywall';
  return h('article', { class: 'card card--link' },
    h('p', { class: 'eyebrow' }, `${planLabel(tool)} tool · ${tool.minutes} min`),
    h('h2', null, tool.title),
    h('p', { class: 'muted' }, tool.blurb),
    h('div', { class: 'row row--sm', style: { flexWrap: 'wrap' } },
      tool.skills.map((skill) => h('span', { class: 'chip chip--sm' }, skill))),
    h('a', { class: ['btn', open ? 'btn--primary' : 'btn--ghost'], href },
      icon(open ? 'check' : 'lock', { size: 16 }),
      open ? 'Open tool' : `Unlock ${lockLabel(tool) || 'plan'}`));
}

export default {
  id: 'tools',
  mount(root) {
    root.append(
      h('div', { class: 'container page tools-page' },
        h('header', { class: 'page-hero' },
          h('p', { class: 'eyebrow' }, 'Process tools'),
          h('h1', null, 'Tools'),
          h('p', { class: 'muted' }, 'Reusable checklists and reviews for trading discipline. These are practical tools, not games, so they do not award XP, stars or badges.')),
        h('section', { class: 'grid grid--2', 'aria-label': 'Trading tools' },
          TOOLS.map((tool) => toolCard(tool)))));
  },
};
