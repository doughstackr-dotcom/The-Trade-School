// Trade Simulator — module styles (private helper of js/games/trade-simulator.js). Injected as one
// <style> element while the game is mounted, scoped under .trade-sim, colours from tokens only.

export const CSS = `
.trade-sim .game[data-state="play"] .hud__cell:not(.hud__lives):not(.hud__extra) { display: none; }
.trade-sim .hud__extra { gap: 0; padding: 0; }
.trade-sim .ts-hud { display: flex; align-items: stretch; min-width: 0; }
.trade-sim .ts-hud__cell { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 4px 16px; border-right: 1px solid var(--line); }
.trade-sim .ts-hud__cell:last-child { border-right: 0; }
.trade-sim .ts-hud__v { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 19px; font-weight: 600; line-height: 1.25; white-space: nowrap; }
.trade-sim .ts-hud__v small { font-size: 13px; font-weight: 600; margin-left: 6px; }

.trade-sim .ts { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.trade-sim .ts-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; min-height: 24px; }
.trade-sim .ts-head__market { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; color: var(--text-2); font-size: 14px; }
.trade-sim .ts-nfa { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 12.5px; }
.trade-sim .ts-note { margin: 0; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--text); font-size: 14px; }

.trade-sim .ts-grid { display: grid; grid-template-columns: minmax(0, 1fr) 328px; gap: 16px; align-items: start; min-width: 0; }
.trade-sim .ts-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.trade-sim .ts-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.trade-sim .ts-card { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); padding: 12px 14px; min-width: 0; }
.trade-sim .ts-card__h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 8px; font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-3); }

/* toolbar */
.trade-sim .ts-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; min-width: 0; }
.trade-sim .ts-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.trade-sim .ts-group__label { color: var(--text-3); font-size: 11.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; margin-right: 2px; }
.trade-sim .ts-tog { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text-2); font-size: 13px; font-weight: 600; white-space: nowrap; transition: background-color .15s, border-color .15s, color .15s; }
@media (hover: hover) { .trade-sim .ts-tog:hover { color: var(--text); border-color: color-mix(in oklab, var(--line), var(--text) 18%); } }
.trade-sim .ts-tog[aria-pressed="true"] { background: var(--surface-2); color: var(--text); border-color: color-mix(in oklab, var(--c, var(--accent)) 55%, var(--line)); }
.trade-sim .ts-tog .ts-sw { width: 10px; height: 10px; border-radius: 3px; background: var(--c, var(--accent)); opacity: .35; }
.trade-sim .ts-tog[aria-pressed="true"] .ts-sw { opacity: 1; }
.trade-sim .ts-tog .kbd { height: 18px; min-width: 18px; font-size: 10.5px; padding: 0 4px; }
.trade-sim .ts-tog.is-drawing { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }

/* chart */
.trade-sim .ts-chart-wrap { position: relative; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); padding: 6px 4px 2px; min-width: 0; }
.trade-sim .ts-chart { min-width: 0; }
.trade-sim .ts-float { position: absolute; left: 50%; top: 40px; z-index: 3; translate: -50% 0; display: flex; flex-direction: column; align-items: center; gap: 2px; max-width: calc(100% - 24px); padding: 8px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); box-shadow: var(--shadow); color: var(--text); font-weight: 600; text-align: center; pointer-events: none; animation: ts-float 2.6s var(--ease-out) forwards; }
.trade-sim .ts-float strong { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 17px; white-space: nowrap; }
.trade-sim .ts-float span { font-size: 13px; font-weight: 500; color: var(--text-2); }
.trade-sim .ts-float.is-win { background: var(--bull-soft); border-color: color-mix(in oklab, var(--bull) 45%, transparent); }
.trade-sim .ts-float.is-win strong { color: var(--bull-strong); }
.trade-sim .ts-float.is-loss { background: var(--bear-soft); border-color: color-mix(in oklab, var(--bear) 45%, transparent); }
.trade-sim .ts-float.is-loss strong { color: var(--bear-strong); }
@keyframes ts-float { 0% { opacity: 0; transform: translateY(8px) scale(.96); } 10% { opacity: 1; transform: none; } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px); } }
.trade-sim .ts-follow { position: absolute; right: 64px; bottom: 34px; z-index: 2; }
.trade-sim .ts-drawhint { position: absolute; left: 12px; bottom: 34px; z-index: 2; max-width: calc(100% - 24px); padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--text); font-size: 12.5px; font-weight: 600; pointer-events: none; }
.trade-sim .ts-endcard { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; padding: 16px; background: color-mix(in oklab, var(--surface) 72%, transparent); border-radius: var(--radius); animation: route-in .3s var(--ease-out); }
.trade-sim .ts-endcard__box { display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 360px; padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-lg); text-align: center; }
.trade-sim .ts-endcard__box h3 { margin: 0; font-size: 20px; }
.trade-sim .ts-endcard__box p { margin: 0; color: var(--text-2); font-size: 14px; }

/* playback controls */
.trade-sim .ts-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
.trade-sim .ts-play { min-width: 112px; }
.trade-sim .ts-speed button { min-height: 34px; padding: 0 12px; font-family: var(--font-mono); }
.trade-sim .ts-progress { display: flex; flex-direction: column; gap: 4px; flex: 1 1 140px; min-width: 120px; }
.trade-sim .ts-progress__text { display: flex; justify-content: space-between; gap: 8px; color: var(--text-2); font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.trade-sim .ts-progress__bar { position: relative; height: 5px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.trade-sim .ts-progress__fill { position: absolute; inset: 0; background: var(--accent); transform-origin: left center; transform: scaleX(0); transition: transform .2s linear; }
.trade-sim .ts-keys { display: flex; flex-wrap: wrap; gap: 4px 12px; }

/* ticket */
.trade-sim .ts-quick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.trade-sim .ts-side-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 54px; padding: 6px 8px; border: 2px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font-weight: 700; font-size: 16px; line-height: 1.1; transition: background-color .15s, border-color .15s, color .15s, transform .08s; }
.trade-sim .ts-side-btn small { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12.5px; font-weight: 500; color: var(--text-2); }
.trade-sim .ts-side-btn .kbd { height: 17px; min-width: 17px; font-size: 10px; padding: 0 4px; margin-left: 4px; }
.trade-sim .ts-side-btn--buy { color: var(--bull-strong); border-color: color-mix(in oklab, var(--bull) 45%, var(--line)); }
.trade-sim .ts-side-btn--sell { color: var(--bear-strong); border-color: color-mix(in oklab, var(--bear) 45%, var(--line)); }
.trade-sim .ts-side-btn--buy[aria-pressed="true"] { background: var(--bull-soft); border-color: var(--bull); }
.trade-sim .ts-side-btn--sell[aria-pressed="true"] { background: var(--bear-soft); border-color: var(--bear); }
@media (hover: hover) {
  .trade-sim .ts-side-btn--buy:not([aria-disabled="true"]):hover { background: var(--bull-soft); border-color: var(--bull); }
  .trade-sim .ts-side-btn--sell:not([aria-disabled="true"]):hover { background: var(--bear-soft); border-color: var(--bear); }
}
.trade-sim .ts-side-btn:active { transform: translateY(1px); }
.trade-sim .ts-side-btn[aria-disabled="true"] { opacity: .45; background: var(--surface); border-color: var(--line); color: var(--text-3); }
.trade-sim .ts-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 10px; min-width: 0; }
.trade-sim .ts-row { display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: center; gap: 8px; }
.trade-sim .ts-row__label { display: flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 13px; font-weight: 600; }
.trade-sim .ts-row__label input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
.trade-sim .ts-field { display: flex; align-items: center; gap: 6px; min-width: 0; }
.trade-sim .ts-field .input, .trade-sim .ts-num { width: 100%; min-width: 0; min-height: 36px; padding: 0 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 14px; }
.trade-sim .ts-num:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.trade-sim .ts-num:disabled { opacity: .5; }
.trade-sim .ts-num.is-bad { border-color: var(--bear); }
.trade-sim .ts-step { flex: 0 0 auto; width: 34px; min-height: 36px; padding: 0; }
.trade-sim .ts-aside { flex: 0 0 auto; min-width: 56px; color: var(--text-3); font-family: var(--font-mono); font-size: 12px; text-align: right; white-space: nowrap; }
.trade-sim .ts-sum { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); }
.trade-sim .ts-sum div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.trade-sim .ts-sum dt { color: var(--text-3); font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.trade-sim .ts-sum dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trade-sim .ts-msg { display: flex; flex-direction: column; gap: 3px; height: 58px; overflow-y: auto; margin: 0; padding: 0; font-size: 12.5px; line-height: 1.35; }
.trade-sim .ts-msg li { display: flex; gap: 6px; align-items: flex-start; color: var(--text-2); }
.trade-sim .ts-msg li .icon { flex: 0 0 auto; margin-top: 1px; }
.trade-sim .ts-msg li.is-error { color: var(--bear-strong); }
.trade-sim .ts-msg li.is-warn .icon { color: var(--warn); }
.trade-sim .ts-msg li.is-ok { color: var(--text-3); }
.trade-sim .ts-reasons { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
.trade-sim .ts-reasons legend { padding: 0; margin-bottom: 6px; color: var(--text-2); font-size: 13px; font-weight: 600; }
.trade-sim .ts-reason { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text-2); font-size: 13px; font-weight: 600; white-space: nowrap; }
@media (hover: hover) { .trade-sim .ts-reason:hover { color: var(--text); } }
.trade-sim .ts-reason[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
.trade-sim .ts-reason .ts-rk { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-3); }
.trade-sim .ts-confirm { width: 100%; min-width: 0; min-height: 48px; white-space: normal; text-align: center; font-size: 15.5px; }
.trade-sim .ts-confirm-row { display: flex; align-items: center; gap: 8px; }
.trade-sim .ts-confirm-row .ts-confirm { flex: 1 1 auto; }
.trade-sim .ts-ticket.is-locked .ts-form { opacity: .55; }
.trade-sim .ts-sheet-toggle, .trade-sim .ts-quick-pos { display: none; }

/* position */
.trade-sim .ts-pos { min-height: 176px; }
.trade-sim .ts-pos__empty { margin: 4px 0 0; color: var(--text-3); font-size: 14px; }
.trade-sim .ts-pos__top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; }
.trade-sim .ts-pos__pnl { display: flex; align-items: baseline; gap: 8px; margin: 8px 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 24px; font-weight: 600; }
.trade-sim .ts-pos__pnl small { font-size: 15px; }
.trade-sim .ts-pos__lv { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: 0 0 10px; font-size: 12.5px; }
.trade-sim .ts-pos__lv dt { color: var(--text-3); font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.trade-sim .ts-pos__lv dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 14px; font-weight: 600; }
.trade-sim .ts-pos__btns { display: flex; flex-wrap: wrap; gap: 8px; }
.trade-sim .ts-pos__btns .btn { flex: 1 1 auto; }

/* stats */
.trade-sim .ts-stats dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin: 0; }
.trade-sim .ts-stats dt { color: var(--text-3); font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.trade-sim .ts-stats dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 16px; font-weight: 600; white-space: nowrap; }
.trade-sim .ts-coach__text { height: 96px; overflow-y: auto; margin: 0 0 8px; color: var(--text); font-size: 13.5px; line-height: 1.45; }

/* journal */
.trade-sim .ts-journal .data-table { font-size: 13.5px; }
.trade-sim .ts-journal .data-table th, .trade-sim .ts-journal .data-table td { padding: 8px 10px; }
.trade-sim .ts-journal td.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.trade-sim .ts-journal tr.is-new td { animation: ts-row 1.4s var(--ease-out); }
@keyframes ts-row { from { background: var(--accent-soft); } }
.trade-sim .ts-journal__empty { margin: 0; color: var(--text-3); font-size: 14px; }
.trade-sim .ts-help { color: var(--text-2); font-size: 14px; }
.trade-sim .ts-help summary { cursor: pointer; color: var(--text); font-weight: 600; min-height: 32px; display: flex; align-items: center; }
.trade-sim .ts-help ul { margin: 6px 0 0; padding-left: 20px; list-style: disc; display: grid; gap: 4px; }

/* report card */
.trade-sim .tsr { display: flex; flex-direction: column; gap: 18px; margin-top: 8px; text-align: left; }
.trade-sim .tsr h3 { margin: 0 0 8px; font-size: 18px; }
.trade-sim .tsr__market { display: flex; flex-direction: column; gap: 8px; }
.trade-sim .tsr__market p { margin: 0; color: var(--text-2); font-size: 14px; }
.trade-sim .tsr__score { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.trade-sim .tsr__meter { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; }
.trade-sim .tsr__meter-top { display: flex; justify-content: space-between; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-2); }
.trade-sim .tsr__meter-top b { font-family: var(--font-mono); color: var(--text); }
.trade-sim .tsr__meter small { color: var(--text-3); font-size: 12px; }
.trade-sim .tsr__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; border: 1px solid var(--line); border-radius: 8px; background: var(--line); overflow: hidden; }
.trade-sim .tsr__stats .stat { padding: 10px 12px; background: var(--surface); }
.trade-sim .tsr__stats .stat__value { font-size: 18px; }
.trade-sim .tsr__stats .stat__label { font-size: 10.5px; }
.trade-sim .tsr__curve svg { display: block; width: 100%; height: auto; }
.trade-sim .tsr__curve figcaption { margin-top: 6px; color: var(--text-3); font-size: 12.5px; }
.trade-sim .tsr__fb { display: grid; gap: 8px; margin: 0; padding: 0; }
.trade-sim .tsr__fb li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; background: var(--surface-2); font-size: 14px; }
.trade-sim .tsr__fb li .icon { flex: 0 0 auto; margin-top: 2px; }
.trade-sim .tsr__fb li strong { display: block; color: var(--text); }
.trade-sim .tsr__fb li span { color: var(--text-2); }
.trade-sim .tsr__fb li.is-flag { background: var(--bear-soft); }
.trade-sim .tsr__fb li.is-flag .icon { color: var(--bear-strong); }
.trade-sim .tsr__fb li.is-good { background: var(--bull-soft); }
.trade-sim .tsr__fb li.is-good .icon { color: var(--bull-strong); }
.trade-sim .tsr__fb li.is-note .icon { color: var(--info); }
.trade-sim .tsr details summary { cursor: pointer; font-weight: 600; min-height: 32px; display: flex; align-items: center; }
.trade-sim .tsr__nfa { margin: 0; color: var(--text-3); font-size: 12.5px; }

/* intro preview */
.trade-sim .ts-preview { display: flex; flex-direction: column; gap: 0; }
.trade-sim .ts-preview svg { display: block; width: 100%; height: auto; }
.trade-sim .ts-preview__cap { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 8px 12px 10px; border-top: 1px solid var(--line); color: var(--text-2); font-size: 13px; }
.trade-sim .ts-preview__cap b { font-family: var(--font-mono); color: var(--text); }
.trade-sim .ts-intro-note { margin: 4px 0 0; font-size: 14px; }
.trade-sim .game-intro__modes.is-muted .segmented { opacity: .55; }

/* tablets (portrait) and small laptops: chart full width, the panels side by side below it */
@media (max-width: 999.98px) {
  .trade-sim .ts-grid { grid-template-columns: minmax(0, 1fr); }
  .trade-sim .ts-side { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: start; }
  .trade-sim .ts-ticket { grid-row: span 3; }
}

/* phones: the ticket becomes a bottom sheet above the tab bar */
@media (max-width: 719.98px) {
  body:has(.trade-sim .game[data-state="play"]) { padding-bottom: calc(var(--tabbar-h) + 84px + env(safe-area-inset-bottom, 0px)); }
  .trade-sim .ts-head__market { display: none; }
  .trade-sim .ts-head { min-height: 0; }
  .trade-sim .ts-hud__cell { padding: 4px 10px; }
  .trade-sim .ts-hud__v { font-size: 16px; }
  .trade-sim .ts-hud__v small { font-size: 11.5px; margin-left: 4px; }
  .trade-sim .ts-hud__cell--bar { display: none; }
  .trade-sim .ts-side { display: flex; align-items: stretch; }
  .trade-sim .ts-tools { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
  .trade-sim .ts-tools::-webkit-scrollbar { display: none; }
  .trade-sim .ts-group { flex: 0 0 auto; flex-wrap: nowrap; }
  .trade-sim .ts-group__label { display: none; }
  .trade-sim .ts-controls { gap: 8px; }
  .trade-sim .ts-play { min-width: 0; flex: 1 1 0; padding: 0 10px; }
  .trade-sim .ts-step-btn { flex: 1 1 0; padding: 0 10px; }
  .trade-sim .ts-speed button { padding: 0 10px; }
  .trade-sim .ts-progress { order: 5; flex: 1 1 auto; min-width: 0; }
  .trade-sim .ts-end { order: 6; min-height: 40px; padding: 0 8px; font-size: 14px; }
  .trade-sim .ts-keys { display: none; }
  .trade-sim .ts-follow { right: 56px; }
  .trade-sim .ts-ticket { position: fixed; left: 0; right: 0; bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px)); z-index: 50; max-height: calc(100dvh - var(--tabbar-h) - 120px); overflow-y: auto; overscroll-behavior: contain; margin: 0; padding: 10px max(12px, env(safe-area-inset-left, 0px)) 10px max(12px, env(safe-area-inset-right, 0px)); border-width: 1px 0 0; border-radius: 16px 16px 0 0; box-shadow: var(--shadow-lg); }
  .trade-sim .ts-ticket .ts-card__h { display: none; }
  .trade-sim .ts-quick { grid-template-columns: 1fr 1fr auto; }
  .trade-sim .ts-side-btn { min-height: 48px; flex-direction: row; gap: 8px; font-size: 15px; }
  .trade-sim .ts-sheet-toggle { display: inline-flex; width: 44px; min-height: 48px; padding: 0; }
  .trade-sim .ts-sheet-toggle .icon { transition: transform .2s; }
  .trade-sim .ts-ticket.is-open .ts-sheet-toggle .icon { transform: rotate(180deg); }
  .trade-sim .ts-ticket:not(.is-open) .ts-form { display: none; }
  .trade-sim .ts:not(.is-armed) .ts-sheet-toggle { display: none; }
  .trade-sim .ts.has-pos .ts-quick .ts-side-btn { display: none; }
  .trade-sim .ts.has-pos .ts-quick-pos { display: flex; }
  .trade-sim .ts-quick-pos { grid-column: 1 / 3; align-items: center; justify-content: space-between; gap: 8px; min-height: 48px; }
  .trade-sim .ts-quick-pos__txt { display: flex; flex-direction: column; min-width: 0; font-size: 13px; color: var(--text-2); }
  .trade-sim .ts-quick-pos__txt b { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 16px; color: var(--text); }
  .trade-sim .ts-form { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .trade-sim .ts-form > .ts-row { grid-template-columns: minmax(0, 1fr); gap: 4px; align-items: start; }
  .trade-sim .ts-form > .ts-row .ts-aside { text-align: left; min-width: 0; }
  .trade-sim .ts-form > .ts-row .ts-field { flex-wrap: wrap; }
  .trade-sim .ts-form > .ts-row--risk .ts-field { flex-wrap: nowrap; }
  .trade-sim .ts-form > .ts-row--risk .ts-step { display: none; }
  .trade-sim .ts-form > :not(.ts-row) { grid-column: 1 / -1; }
  .trade-sim .ts-reasons { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
  .trade-sim .ts-reasons legend { float: left; margin: 0 4px 0 0; }
  .trade-sim .ts-reason { min-height: 40px; }
  .trade-sim .ts-msg { height: 40px; }
  .trade-sim .ts-sum { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .trade-sim .ts-pos { min-height: 0; }
  .trade-sim .tsr__score { grid-template-columns: minmax(0, 1fr); }
  .trade-sim .tsr__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (pointer: coarse) {
  .trade-sim .kbd, .trade-sim .ts-rk { display: none; }
}

@media (pointer: coarse) {
  .trade-sim .ts-tog, .trade-sim .ts-reason, .trade-sim .ts-speed button, .trade-sim .ts-num, .trade-sim .ts-step { min-height: 44px; }
  .trade-sim .ts-step { width: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .trade-sim .ts-float { animation-duration: 2.6s; animation-name: ts-fade; }
  .trade-sim .ts-journal tr.is-new td, .trade-sim .ts-endcard { animation: none; }
  .trade-sim .ts-progress__fill { transition: none; }
}
@keyframes ts-fade { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
`;
