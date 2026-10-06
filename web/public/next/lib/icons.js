// 线性图标（24×24，描边 1.8）。只用于装饰或配合可见文字 / aria-label。
import { svg } from "./dom.js?v=n15";

const PATHS = {
  plaza: '<path d="M3 10.6 12 4l9 6.6"/><path d="M5 9.4V20h14V9.4"/><path d="M9.5 20v-5.5h5V20"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 9.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 16 18 9.5"/><path d="M10.2 21a2 2 0 0 0 3.6 0"/>',
  user: '<circle cx="12" cy="8" r="4.2"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  book: '<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v17H7.5A2.5 2.5 0 0 0 5 21.5z"/><path d="M5 21.5V4.5M9 7h7M9 10.5h5"/>',
  heart: '<path d="M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8 2.6c0 5.9-8 10.6-8 10.6z"/>',
  comment: '<path d="M20.5 11.6a8.2 8.2 0 0 1-12 7.3L3.5 20.5l1.6-4.6a8.2 8.2 0 1 1 15.4-4.3z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6.5"/>',
  bookmark: '<path d="M18.5 21 12 16.6 5.5 21V4.8A1.8 1.8 0 0 1 7.3 3h9.4a1.8 1.8 0 0 1 1.8 1.8z"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  back: '<path d="M15 18.5 8.5 12 15 5.5"/>',
  chevronRight: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  chevronDown: '<path d="m5.5 9 6.5 6.5L18.5 9"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6.5 9.2 17.3 4 12.1"/>',
  send: '<path d="M12 19.5V5M5.5 11.5 12 5l6.5 6.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.2"/>',
  sparkle: '<path d="M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5L10.1 13l-5.6-2 5.6-2z"/><path d="M19 3.5v3M17.5 5h3"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5V4.8a1.5 1.5 0 0 1 3 0v6.7"/><path d="M14 11.5V6.3a1.5 1.5 0 0 1 3 0v7.2c0 4.2-2.7 7.5-6.6 7.5-2.2 0-3.8-.9-5.1-2.8L3.5 15a1.5 1.5 0 0 1 2.4-1.8L8 15.4"/>',
  flame: '<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-3.6-2.3-5.6-3.7-7.8-.5 1.9-1.4 3-2.6 3.6.2-3-1-5.6-3.4-7.3.2 3.4-1.4 5.3-2.9 7.2A7 7 0 0 0 5.5 14.5 6.5 6.5 0 0 0 12 21z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  refresh: '<path d="M20 11.5A8 8 0 1 0 17.7 17"/><path d="M20.5 4.5v5h-5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 5.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h.5"/>',
  thumbUp: '<path d="M7.5 20.5H5a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 5 10.5h2.5z"/><path d="M7.5 10.5 11 3.5a2.4 2.4 0 0 1 2.4 2.7l-.5 3.6h5.4a2 2 0 0 1 2 2.3l-1.2 6.7a2 2 0 0 1-2 1.7H7.5"/>',
  thumbDown: '<path d="M16.5 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-2.5z"/><path d="M16.5 13.5 13 20.5a2.4 2.4 0 0 1-2.4-2.7l.5-3.6H5.7a2 2 0 0 1-2-2.3l1.2-6.7a2 2 0 0 1 2-1.7h9.6"/>',
  logout: '<path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5"/><path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9.5"/>',
  swap: '<path d="M4 8h13.5l-3.5-3.5M20 16H6.5l3.5 3.5"/>',
  moon: '<path d="M20.5 13.4A8.5 8.5 0 1 1 10.6 3.5a6.6 6.6 0 0 0 9.9 9.9z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  pin: '<path d="M12 21s-6.5-5.9-6.5-11a6.5 6.5 0 0 1 13 0c0 5.1-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  edit: '<path d="M4 20h4L19.3 8.7a2.3 2.3 0 0 0-3.2-3.2L4.8 16.8z"/><path d="m14.5 7 3.2 3.2"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l.8 13a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5l.8-13"/>',
  coins: '<ellipse cx="9" cy="7" rx="5.5" ry="2.8"/><path d="M3.5 7v4.5c0 1.5 2.5 2.8 5.5 2.8s5.5-1.3 5.5-2.8V7"/><path d="M9.5 16.9c.9 1.2 3.1 2.1 5.5 2.1 3 0 5.5-1.3 5.5-2.8V11.7c0-1.3-1.9-2.4-4.4-2.7"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5h11.5l-2 4 2 4H5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  wallet: '<path d="M4 7.5h14.5A2.5 2.5 0 0 1 21 10v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18V6.5A2.5 2.5 0 0 1 5.5 4H17"/><path d="M16.5 14h1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13"/><path d="M18 14v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h4.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  message: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 3 13.5z" transform="translate(.5 0)"/>',
  reply: '<path d="M9.5 8.5 4.5 13l5 4.5"/><path d="M4.5 13H14a5.5 5.5 0 0 1 5.5 5.5v1"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.6 13.4-1.6 7.1 5-2.6 5 2.6-1.6-7.1"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5" opacity=".55"/>',
  gua: '<path d="M4 5.5h16M4 9.8h6.5M13.5 9.8H20M4 14.2h16M4 18.5h6.5M13.5 18.5H20"/>',
  pillars: '<path d="M5 4v16M10 4v16M14 4v16M19 4v16"/><path d="M3.5 4h17M3.5 20h17"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.5 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.5-3.6-8.5s1.1-5.9 3.6-8.5z"/>',
  users: '<circle cx="9" cy="8.5" r="3.6"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M15.5 5.2a3.6 3.6 0 0 1 0 6.6M17.5 14.4a6.2 6.2 0 0 1 3.7 5.6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".9"/><circle cx="15" cy="15" r=".9"/><circle cx="15" cy="9" r=".9"/><circle cx="9" cy="15" r=".9"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  feather: '<path d="M20 4.5c-6.5 0-12 3.5-13.5 11l-2 4.5"/><path d="M6.5 15.5c5.5 0 9.5-2.5 11-7"/><path d="M9.5 12h6"/>',
};

export function icon(name, className = "") {
  const body = PATHS[name] || PATHS.info;
  return svg(`<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`);
}

export function iconMarkup(name, className = "") {
  const body = PATHS[name] || PATHS.info;
  return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

// 品牌标：六条爻线组成的方印，上三爻为阳、下三爻为阴阳相间（取「既济」之意的简化）。
export function brandMark() {
  return svg(`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--brand)"/>
    <g fill="var(--on-brand)">
      <rect x="8" y="7.5" width="16" height="2.4" rx="1.2"/>
      <rect x="8" y="11.3" width="6.8" height="2.4" rx="1.2"/><rect x="17.2" y="11.3" width="6.8" height="2.4" rx="1.2"/>
      <rect x="8" y="15.1" width="16" height="2.4" rx="1.2"/>
      <rect x="8" y="18.9" width="6.8" height="2.4" rx="1.2"/><rect x="17.2" y="18.9" width="6.8" height="2.4" rx="1.2"/>
      <rect x="8" y="22.7" width="16" height="2.4" rx="1.2" opacity=".72"/>
    </g>
  </svg>`);
}
