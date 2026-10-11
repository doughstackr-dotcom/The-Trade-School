// Candle Credits shop (#shop): spend the credits your XP mints on cosmetics —
// cabinet skins, candle palettes, XP frames and (from Phase 5) Sensei accessories.
// Levels and badges ride lifetime XP, so spending credits never touches progression.
import { h, icon, toast, sfx, shake, fmt } from '../core/ui.js';
import { SLOT_LABEL, SLOT_BLURB, cosmeticsOf } from '../core/cosmetics.js';

export default {
  id: 'shop',
  mount(root, ctx) {
    const { store } = ctx;

    const render = () => {
      const balance = store.tokens();
      const balanceEl = h('span', { class: 'shop-balance__value mono' }, fmt(balance));

      const itemCard = (item) => {
        const owned = store.hasCosmetic(item.id);
        const equipped = store.equippedOf(item.slot) === item.id;
        const afford = balance >= item.price;
        const action = equipped
          ? h('span', { class: 'chip chip--bull chip--sm' }, icon('check', { size: 13 }), 'Equipped')
          : owned
            ? h('button', {
              type: 'button',
              class: 'btn btn--sm btn--primary',
              on: { click: () => {
                store.equipCosmetic(item.id);
                sfx.click();
                toast(`${item.name} equipped`, { type: 'info' });
              } },
            }, 'Equip')
            : h('button', {
              type: 'button',
              class: ['btn btn--sm btn--arcade', !afford && 'is-dim'],
              on: { click: () => {
                const res = store.buyCosmetic(item.id);
                if (res === true) {
                  sfx.coin();
                  toast(`${item.name} unlocked — equipped it for you.`, { type: 'badge' });
                  store.equipCosmetic(item.id);
                } else if (res === 'poor') {
                  shake(root);
                  sfx.wrong();
                  toast(`Not enough credits — ${fmt(item.price - balance)} short. Earn XP to mint more.`, { type: 'warn', duration: 3600 });
                }
              } },
            }, `Buy · ${fmt(item.price)}`);
        return h('article', {
          class: ['shop-item', equipped && 'is-equipped', owned && 'is-owned'],
          'aria-label': `${item.name}, ${owned ? 'owned' : `${item.price} credits`}`,
        },
          h('span', { class: 'shop-item__swatch', 'aria-hidden': 'true' },
            h('span', { class: 'shop-item__swatch-a', style: { background: item.swatch[0] } }),
            h('span', { class: 'shop-item__swatch-b', style: { background: item.swatch[1] } })),
          h('div', { class: 'shop-item__body' },
            h('strong', { class: 'shop-item__name' }, item.name),
            h('p', { class: 'shop-item__blurb' }, item.blurb),
            h('div', { class: 'row row--sm' },
              item.price === 0
                ? h('span', { class: 'chip chip--sm' }, 'Free')
                : h('span', { class: 'chip chip--sm shop-item__price' }, fmt(item.price), ' credits'),
              h('span', { class: 'chip chip--sm chip--outline arcade-label' }, owned ? 'Owned' : 'Locked')),
            h('div', { class: 'shop-item__action' }, action)));
      };

      const sections = ['skin', 'candles', 'frame', 'hat'].map((slot) => h('section', {
        class: 'shop-section',
        'aria-labelledby': `shop-${slot}-h`,
      },
        h('div', { class: 'section-head' },
          h('div', null,
            h('p', { class: 'eyebrow' }, SLOT_BLURB[slot]),
            h('h2', { id: `shop-${slot}-h` }, SLOT_LABEL[slot]))),
        h('div', { class: 'shop-grid' }, cosmeticsOf(slot).map(itemCard))));

      root.replaceChildren(
        h('div', { class: 'container shop-page' },
          h('header', { class: 'page-head shop-head' },
            h('div', null,
              h('p', { class: 'eyebrow eyebrow--accent' }, 'Candle Credits'),
              h('h1', { class: 'neon-title neon-title--arcade' }, 'The credit shop'),
              h('p', { class: 'lead' },
                'Every XP you earn mints one credit. Spend them here on looks — levels and badges ride your lifetime XP, so spending never slows your climb.')),
            h('div', { class: 'shop-balance neon-frame--arcade', role: 'status' },
              h('span', { class: 'arcade-label' }, 'Credits'),
              balanceEl,
              h('span', { class: 'faint shop-balance__hint' }, `${fmt(store.state.lifetimeXp)} earned · ${fmt(store.state.tokensSpent)} spent`))),
          ...sections,
          h('p', { class: 'faint shop-footnote' }, 'Cosmetics save with your progress in this browser and never affect gameplay, scores or access.')));
    };

    render();
    let queued = 0;
    const onChange = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        if (root.isConnected) render();
      });
    };
    store.on('change', onChange);
    return () => {
      store.off('change', onChange);
      if (queued) cancelAnimationFrame(queued);
    };
  },
};
