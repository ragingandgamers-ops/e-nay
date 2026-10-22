// Small code-native outline icons; no image library or generated artwork.
const paths={
 overview:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 mothers:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
 children:'<path d="M9 3a3 3 0 0 1 6 0M6 7a8 8 0 1 0 12 0"/><path d="M8.5 15a4.5 4.5 0 0 0 7 0"/><path d="M8 11h.01M16 11h.01"/>',
 visits:'<rect x="5" y="4" width="14" height="18" rx="3"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h6M9 19h3"/>',
 vaccines:'<path d="m17 3 4 4M15 5l4 4M5 15l4 4M7 13l4 4M3 21l3-3M9 17l10-10M7 15l10-10"/>',
 growth:'<path d="M4 3v17h17M7 15l4-5 4 2 5-7M16 5h4v4"/>',
 inventory:'<path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10M7 5l10 4"/>',
 guides:'<path d="M12 5c-4-3-8-2-10-1v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15"/>',
 backup:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
 access:'<rect x="4" y="10" width="16" height="12" rx="3"/><path d="M8 10V6a4 4 0 1 1 8 0v4M12 15v3"/>'
};
export const icon=name=>`<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]??paths.overview}</svg>`;
