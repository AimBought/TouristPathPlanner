'use strict';

const COLLECTIONS = ['attractions', 'visits', 'services', 'offers', 'packages'];
const LABELS = {attractions: 'Atrakcje', visits: 'Wizyty', services: 'Usługi', offers: 'Oferty', packages: 'Pakiety'};
const SINGULAR = {attractions: 'atrakcję', visits: 'wizytę', services: 'usługę', offers: 'ofertę', packages: 'pakiet'};
const KINDS = {visit: 'visits', service: 'services', offer: 'offers'};
const KIND_LABELS = {visit: 'Wizyta', service: 'Usługa', offer: 'Oferta'};
const MODES = {guided: 'Z przewodnikiem', self_guided: 'Samodzielnie', audio: 'Z audioprzewodnikiem', exterior: 'Z zewnątrz'};
const DEFAULT_DRAFT = {name: 'Mój pakiet zwiedzania', description: 'Mój plan odkrywania Wawelu.', audience: 'individual', min_participants: 1, max_participants: 1, valid_from: '', valid_to: ''};
const STORAGE_KEY = 'wawel-package-cart-v1';
const isAdmin = location.pathname.replace(/\/$/, '') === '/admin';
const state = {data: {}, tab: isAdmin ? 'attractions' : 'offers', search: '', cart: [], draft: {...DEFAULT_DRAFT}, submitting: false, saved: null, archived: false, editorCollection: null, editorRecord: null};
const root = document.querySelector('#main');
const editor = document.querySelector('#editor');
const details = document.querySelector('#details');
let toastTimer;

const paths = {
  plus: '<path d="M9 3v12M3 9h12"/>',
  close: '<path d="m4 4 10 10M14 4 4 14"/>',
  search: '<circle cx="7.5" cy="7.5" r="4.5"/><path d="m11 11 4 4"/>',
  bag: '<path d="M3 6h12l1 10H2L3 6Z"/><path d="M6 6V4a3 3 0 0 1 6 0v2"/>',
  pin: '<path d="M14 7c0 4-5 8-5 8S4 11 4 7a5 5 0 1 1 10 0Z"/><circle cx="9" cy="7" r="1.5"/>',
  clock: '<circle cx="9" cy="9" r="6.5"/><path d="M9 5v4l3 2"/>',
  layers: '<path d="m2 6 7-4 7 4-7 4-7-4Zm0 4 7 4 7-4M2 14l7 4 7-4"/>',
  arrow: '<path d="M3 9h12m-5-5 5 5-5 5"/>',
  check: '<path d="m3 9 4 4 8-8"/>',
  info: '<circle cx="9" cy="9" r="7"/><path d="M9 8v5M9 5h.01"/>',
  leaf: '<path d="M15 2C6 1 1 6 4 12c4 6 12 1 11-10Z"/><path d="m3 16 8-9"/>',
  people: '<circle cx="7" cy="6" r="2.5"/><path d="M2 15v-2a5 5 0 0 1 10 0v2M12 3a3 3 0 0 1 0 6M14 11a4 4 0 0 1 2 4"/>',
  ticket: '<path d="M2 5h14v3a2 2 0 0 0 0 4v3H2v-3a2 2 0 0 0 0-4V5Z"/><path d="M11 5v2m0 2v2m0 2v2"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 18 18" aria-hidden="true">${paths[name] || paths.layers}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const find = (kind, id) => (state.data[KINDS[kind]] || []).find(item => item.id === id);
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const plainDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pl-PL') : 'Bez ograniczenia';
const normalized = (value) => String(value).toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const plural = (count, one, few, many) => `${count} ${count === 1 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many}`;

async function api(path, options = {}) {
  const response = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  let data;
  try { data = await response.json(); } catch { throw new Error('Serwer zwrócił nieprawidłową odpowiedź. Odśwież stronę i spróbuj ponownie.'); }
  if (!response.ok) throw new Error(data.error || 'Nie udało się zapisać zmian.');
  return data;
}

function toast(message, error = false) {
  const element = document.querySelector('#toast');
  clearTimeout(toastTimer);
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, error ? 6500 : 3200);
}

function restoreCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== 'object') return;
    if (Array.isArray(saved.items)) state.cart = saved.items.filter(item => item && KINDS[item.kind] && typeof item.id === 'string' && Number.isInteger(item.quantity) && item.quantity > 0).map(item => ({kind: item.kind, id: item.id, quantity: Math.min(item.quantity, 999)}));
    if (saved.draft && typeof saved.draft === 'object') for (const key of Object.keys(DEFAULT_DRAFT)) {
      if (typeof saved.draft[key] === 'string' || typeof saved.draft[key] === 'number') state.draft[key] = saved.draft[key];
    }
  } catch { /* The cart works in memory when browser storage is unavailable. */ }
}

function persistCart() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({items: state.cart, draft: state.draft})); } catch { /* Private-mode browsers may deny storage. */ }
}

async function loadData() {
  const values = await Promise.all(COLLECTIONS.map(collection => api(`/${collection}`)));
  COLLECTIONS.forEach((collection, index) => { state.data[collection] = values[index]; });
}

function selectable(kind, id, seen = new Set()) {
  const key = `${kind}:${id}`;
  if (seen.has(key)) return false;
  const item = find(kind, id);
  if (!item || item.archived) return false;
  if (kind === 'visit') return (state.data.attractions || []).some(attraction => attraction.id === item.attraction_id && !attraction.archived);
  if (kind === 'offer') return item.items.every(child => selectable(child.kind, child.id, new Set([...seen, key])));
  return true;
}

function illustration(type, hero = false) {
  const colour = type === 'tower' ? '#96715b' : type === 'service' ? '#8a8669' : '#718567';
  const buildings = `<path d="M35 146h235M53 144V89h30v55M60 89V75h16v14M68 75V61M89 144V71h77v73M94 71l32-25 35 25M113 60V35h28v25M118 35V22h18v13M127 22V10M102 144v-33a12 12 0 0 1 24 0v33M134 144V91h19v53M176 144V53h37v91M180 53V39h29v14M185 39V22h19v17M195 22V11M184 144v-21a10 10 0 0 1 20 0v21M220 144V96h35v48M226 96V84h23v12M98 83h9m5 0h9m5 0h9m5 0h9M60 103h8m6 0h5M186 68h7m5 0h7M186 81h7m5 0h7M186 94h7m5 0h7M229 109h6m6 0h6"/>`;
  const courtyard = `<path d="M32 145h240M45 145V61h215v84M45 91h215M45 119h215M61 145v-14a12 12 0 0 1 24 0v14M100 145v-14a12 12 0 0 1 24 0v14M139 145v-14a12 12 0 0 1 24 0v14M178 145v-14a12 12 0 0 1 24 0v14M217 145v-14a12 12 0 0 1 24 0v14M61 119V82a12 12 0 0 1 24 0v37M100 119V82a12 12 0 0 1 24 0v37M139 119V82a12 12 0 0 1 24 0v37M178 119V82a12 12 0 0 1 24 0v37M217 119V82a12 12 0 0 1 24 0v37M41 61l112-27 112 27M67 54V35h15v15M233 53V35h15v21"/>`;
  const service = `<path d="M42 137h221M76 121V86c0-9 7-16 16-16h119c9 0 16 7 16 16v35H76ZM76 113h151M87 121v11h19v-11M197 121v11h18v-11M88 82h32v24H88V82Zm41 0h32v24h-32V82Zm41 0h44v24h-44V82ZM83 113v-6M220 113v-6M75 90h-9v17h9M227 90h9v17h-9M135 58l13-16 13 16M148 42v23M100 50l-5-7m103 7 5-7"/><circle cx="96" cy="114" r="3"/><circle cx="207" cy="114" r="3"/>`;
  const content = type === 'service' ? service : type === 'courtyard' ? courtyard : buildings;
  return `<svg viewBox="0 0 300 170" fill="none" aria-hidden="true"><circle cx="${hero ? '165' : '147'}" cy="85" r="${hero ? '76' : '61'}" fill="${type === 'tower' ? '#d9c7b5' : '#d4ddc6'}" opacity=".7"/><path d="M21 139c25-10 56-9 83 0 49 16 83-18 171-4" stroke="${colour}" stroke-width="1" opacity=".3"/><g stroke="${colour}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${content}<path d="M19 135v-25m0 7-7-5m7 12 7-9M282 135v-19m0 8-6-4" opacity=".6"/></g><g stroke="${colour}" opacity=".5" stroke-width="1"><path d="m25 42 6 3 6-3m213-16 6 3 6-3M231 46l5 2 5-2"/></g></svg>`;
}

function clientShell() {
  root.innerHTML = `<section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><div class="eyebrow">Poznaj Wawel po swojemu</div><h1 id="hero-title">Wielka historia.<br><em>Twój własny plan.</em></h1><p>Wybierz miejsca, dodaj ulubione doświadczenia i połącz je w pakiet. Dobre zwiedzanie zaczyna się od Twojego pomysłu.</p></div><div class="hero-art">${illustration('cathedral', true)}<span class="mini-stamp">KRAKÓW<strong>Wawel</strong>ODKRYWAJ</span><span class="hero-caption">HISTORIA NA WYCIĄGNIĘCIE RĘKI</span></div></section><div class="catalog-layout"><section aria-labelledby="catalog-title"><div class="section-heading"><h2 id="catalog-title">Zacznij od odkrywania</h2><span class="muted" id="catalog-count"></span></div><div id="saved-notice"></div><div class="catalog-tools"><div class="tabs" role="tablist" aria-label="Rodzaj doświadczeń">${['offers', 'visits', 'services', 'packages'].map(collection => `<button type="button" class="tab${state.tab === collection ? ' active' : ''}" role="tab" aria-selected="${state.tab === collection}" data-tab="${collection}">${LABELS[collection]}</button>`).join('')}</div><label class="search">${icon('search')}<input type="search" id="catalog-search" placeholder="Szukaj w katalogu…" aria-label="Szukaj w katalogu" value="${esc(state.search)}"></label></div><div id="catalog-cards" class="cards" role="tabpanel" aria-label="Katalog"></div><p class="catalog-note">${icon('info')}<span>Oferty łączą wizyty i usługi. Dodawaj je do swojego pakietu, zmieniaj ilości i utwórz własną ofertę. To katalog demonstracyjny — zapis nie jest rezerwacją.</span></p></section><aside id="cart-panel" aria-label="Twój pakiet"></aside></div>`;
  renderCards();
  renderCart();
  renderSavedNotice();
}

function itemLocation(kind, item) {
  if (kind === 'visit') return (state.data.attractions || []).find(attraction => attraction.id === item.attraction_id)?.location || 'Odkryj miejsce';
  if (kind === 'service') return 'Wygodniej w drodze';
  return 'Wawel · Kraków';
}

function cardType(kind, item) {
  if (kind === 'service') return 'service';
  if (kind === 'package') return 'package';
  if (/wież|dzwon/i.test(item.name)) return 'tower';
  if (/dziedzin|zewn/i.test(item.name)) return 'courtyard';
  return 'cathedral';
}

function cardMeta(kind, item) {
  if (kind === 'visit') return `<span>${icon('clock')}${esc(item.duration_minutes)} min</span><span>${icon('ticket')}${item.admission_included ? 'Wstęp w cenie wizyty' : 'Bez biletu wstępu'}</span>`;
  if (kind === 'offer') return `<span>${icon('layers')}${plural(item.items.reduce((sum, child) => sum + child.quantity, 0), 'element', 'elementy', 'elementów')} w zestawie</span><span>${icon('leaf')}Twój wybór</span>`;
  if (kind === 'package') return `<span>${icon('people')}${item.min_participants === item.max_participants ? item.min_participants : `${item.min_participants}–${item.max_participants}`} os.</span><span>${icon('layers')}${item.audience === 'group' ? 'Dla grupy' : 'Indywidualny'}</span>`;
  return `<span>${icon('check')}Dodatek do zwiedzania</span>`;
}

function renderCards() {
  const collection = state.tab;
  const kind = Object.keys(KINDS).find(key => KINDS[key] === collection) || 'package';
  const items = (state.data[collection] || []).filter(item => !item.archived && (kind === 'package' || selectable(kind, item.id))).filter(item => normalized(`${item.name} ${item.description} ${itemLocation(kind, item)}`).includes(normalized(state.search)));
  document.querySelector('#catalog-count').textContent = plural(items.length, 'propozycja', 'propozycje', 'propozycji');
  const container = document.querySelector('#catalog-cards');
  container.innerHTML = items.length ? items.map(item => {
    const type = cardType(kind, item);
    const count = state.cart.find(child => child.kind === kind && child.id === item.id)?.quantity || 0;
    return `<article class="card"><div class="card-illustration ${type}">${illustration(type)}<span class="card-badge">${kind === 'visit' ? esc(MODES[item.mode]) : kind === 'package' ? 'Zapisany pakiet' : KIND_LABELS[kind]}</span></div><div class="card-body"><p class="location">${icon('pin')}${esc(itemLocation(kind, item))}</p><h3>${esc(item.name)}</h3><p class="card-description">${esc(item.description)}</p><div class="card-meta">${cardMeta(kind, item)}</div></div><div class="card-footer"><button type="button" class="text-button" data-details-kind="${kind}" data-details-id="${esc(item.id)}">${kind === 'package' ? 'Szczegóły i dostępność' : 'Zobacz szczegóły'} <span aria-hidden="true">↗</span></button>${kind !== 'package' ? `<button type="button" class="add-button" data-add-kind="${kind}" data-add-id="${esc(item.id)}">${icon('plus')}${count ? `Dodaj (${count} w pakiecie)` : 'Do pakietu'}</button>` : ''}</div></article>`;
  }).join('') : `<div class="empty-state">${icon('search')}<h3>${state.search ? 'Nie znaleźliśmy tej propozycji' : 'Jeszcze tu spokojnie'}</h3><p>${state.search ? 'Zmień szukaną nazwę lub wybierz inną kategorię.' : collection === 'packages' ? 'Ułóż swój pakiet, a pojawi się tutaj po zapisaniu.' : 'Administrator może dodać nowe propozycje do katalogu.'}</p></div>`;
  document.querySelectorAll('[data-tab]').forEach(button => { const active = button.dataset.tab === collection; button.classList.toggle('active', active); button.setAttribute('aria-selected', active); });
}

function field(label, name, value, options = {}) {
  const attributes = `${options.required ? ' required' : ''}${options.min !== undefined ? ` min="${options.min}"` : ''}${options.max !== undefined ? ` max="${options.max}"` : ''}${options.step ? ` step="${options.step}"` : ''}${options.placeholder ? ` placeholder="${esc(options.placeholder)}"` : ''}`;
  const input = options.textarea ? `<textarea name="${name}"${attributes}>${esc(value)}</textarea>` : `<input type="${options.type || 'text'}" name="${name}" value="${esc(value)}"${attributes}>`;
  return `<label class="field"><span>${label}</span>${input}${options.hint ? `<small>${options.hint}</small>` : ''}</label>`;
}

function selectField(label, name, value, choices, required = false) {
  return `<label class="field"><span>${label}</span><select name="${name}"${required ? ' required' : ''}>${choices.map(([key, text]) => `<option value="${esc(key)}"${String(value) === String(key) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}

function participantFields(draft) {
  return `${selectField('Dla kogo?', 'audience', draft.audience, [['individual', 'Indywidualnie'], ['group', 'Dla grupy']])}<div class="field-row">${field('Min. osób', 'min_participants', draft.min_participants, {type: 'number', required: true, min: 1, step: 1})}${field('Maks. osób', 'max_participants', draft.max_participants, {type: 'number', required: true, min: 1, step: 1})}</div><div class="field-row">${field('Ważny od', 'valid_from', draft.valid_from || '', {type: 'date'})}${field('Ważny do', 'valid_to', draft.valid_to || '', {type: 'date'})}</div>`;
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const invalid = state.cart.some(item => !selectable(item.kind, item.id));
  document.querySelector('#cart-panel').innerHTML = `<div class="cart"><div class="cart-header"><span class="cart-icon">${icon('bag')}</span><div><h2>Twój pakiet</h2><p>Mały koszyk wielkich możliwości</p></div><span class="cart-count" aria-label="${count} pozycji">${count}</span></div>${state.cart.length ? `<div class="cart-items">${state.cart.map((item, index) => { const record = find(item.kind, item.id); const valid = selectable(item.kind, item.id); return `<div class="cart-item"><span class="item-kind-icon">${icon(item.kind === 'service' ? 'leaf' : item.kind === 'visit' ? 'pin' : 'layers')}</span><div><h3>${esc(record?.name || 'Usunięta pozycja')}</h3><p${valid ? '' : ' class="error-text"'}>${valid ? KIND_LABELS[item.kind] : 'Pozycja niedostępna — usuń ją z pakietu'}</p><div class="quantity"><button type="button" data-quantity-index="${index}" data-delta="-1" aria-label="Zmniejsz ilość: ${esc(record?.name || 'pozycja')}">−</button><input type="number" min="1" max="999" step="1" value="${item.quantity}" data-cart-quantity="${index}" aria-label="Ilość: ${esc(record?.name || 'pozycja')}"><button type="button" data-quantity-index="${index}" data-delta="1" aria-label="Zwiększ ilość: ${esc(record?.name || 'pozycja')}">+</button></div></div><button type="button" class="icon-button" data-cart-remove="${index}" aria-label="Usuń: ${esc(record?.name || 'pozycja')}">${icon('close')}</button></div>`; }).join('')}</div>` : `<div class="cart-empty"><span class="empty-cart-icon">${icon('bag')}</span><h3>Tu zaczyna się Twój plan</h3><p>Dodaj ofertę, wizytę lub usługę z katalogu. Połącz je tak, jak lubisz.</p></div>`}<form id="cart-form" class="cart-form">${field('Nazwa Twojego pakietu', 'name', state.draft.name, {required: true, placeholder: 'Np. Wawel na spokojnie'})}<details${state.cart.length ? ' open' : ''}><summary>Opis, uczestnicy i termin</summary>${field('Opis', 'description', state.draft.description, {textarea: true, required: true})}${participantFields(state.draft)}</details><p id="cart-error" class="error-text" role="alert"${invalid ? '' : ' hidden'}>${invalid ? 'Usuń niedostępne pozycje, aby zapisać pakiet.' : ''}</p><button id="cart-submit" class="primary-button full-width cart-submit" type="submit"${!state.cart.length || invalid || state.submitting ? ' disabled' : ''}>${state.submitting ? 'Zapisujemy…' : 'Utwórz ofertę i pakiet'} ${icon('arrow')}</button><p class="cart-disclaimer">Zapisz wybrane pozycje jako ofertę i powiązany z nią pakiet. Zapis nie rezerwuje miejsc.</p>${state.cart.length ? '<button class="text-button cart-clear" type="button" id="cart-clear">Wyczyść pakiet</button>' : ''}</form></div>`;
}

function renderSavedNotice() {
  const container = document.querySelector('#saved-notice');
  if (!container) return;
  container.innerHTML = state.saved ? `<div class="success-box">${icon('check')}<div><strong>Twój pakiet jest gotowy</strong><p>Zapisaliśmy „${esc(state.saved.name)}” oraz ofertę z wybranymi pozycjami.</p><button type="button" class="text-button" data-details-kind="package" data-details-id="${esc(state.saved.id)}">Zobacz pakiet i sprawdź dostępność →</button></div></div>` : '';
}

function updateCart() { persistCart(); renderCart(); renderCards(); }

function addToCart(kind, id) {
  if (state.submitting) return toast('Poczekaj na zakończenie zapisu pakietu.');
  if (!selectable(kind, id)) return toast('Ta pozycja nie jest już dostępna. Odśwież katalog.', true);
  const existing = state.cart.find(item => item.kind === kind && item.id === id);
  if (existing) existing.quantity = Math.min(existing.quantity + 1, 999);
  else state.cart.push({kind, id, quantity: 1});
  updateCart();
  toast(`Dodano do pakietu: ${find(kind, id).name}`);
}

function participantBody(form) {
  const values = new FormData(form);
  const min = Number(values.get('min_participants'));
  const max = Number(values.get('max_participants'));
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) throw new Error('Maksymalna liczba osób musi być co najmniej równa minimalnej.');
  const from = values.get('valid_from') || null;
  const to = values.get('valid_to') || null;
  if (from && to && from > to) throw new Error('Data końcowa nie może poprzedzać daty początkowej.');
  return {audience: values.get('audience'), min_participants: min, max_participants: max, valid_from: from, valid_to: to};
}

async function submitCart(form) {
  if (state.submitting || !state.cart.length) return;
  const error = document.querySelector('#cart-error');
  error.hidden = true;
  try {
    const values = new FormData(form);
    const body = {name: String(values.get('name')).trim(), description: String(values.get('description')).trim(), items: state.cart.map(item => ({...item})), ...participantBody(form)};
    if (!body.name || !body.description) throw new Error('Podaj nazwę i opis pakietu.');
    if (state.cart.some(item => !selectable(item.kind, item.id))) throw new Error('Usuń niedostępne pozycje z pakietu.');
    state.submitting = true;
    form.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = true; });
    document.querySelectorAll('[data-quantity-index], [data-cart-quantity], [data-cart-remove], [data-add-kind]').forEach(control => { control.disabled = true; });
    document.querySelector('#cart-submit').disabled = true;
    document.querySelector('#cart-submit').textContent = 'Zapisujemy…';
    const result = await api('/packages/from-cart', {method: 'POST', body: JSON.stringify(body)});
    state.saved = result.package;
    state.cart = [];
    state.draft = {...DEFAULT_DRAFT};
    persistCart();
    state.data.offers.push({...result.offer, archived: false});
    state.data.packages.push({...result.package, archived: false});
    toast('Oferta i pakiet zostały zapisane.');
    renderSavedNotice();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
    state.submitting = false;
    form.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = false; });
    document.querySelectorAll('[data-quantity-index], [data-cart-quantity], [data-cart-remove], [data-add-kind]').forEach(control => { control.disabled = false; });
    document.querySelector('#cart-submit').disabled = false;
    document.querySelector('#cart-submit').innerHTML = `Utwórz ofertę i pakiet ${icon('arrow')}`;
    return;
  }
  state.submitting = false;
  renderCart();
  renderCards();
}

function adminShell() {
  root.innerHTML = `<section class="admin-hero"><div><div class="eyebrow">Miejsce na dobre doświadczenia</div><h1>Zarządzaj katalogiem</h1><p>Dbaj o atrakcje, układaj wizyty i łącz je w oferty.</p></div><span class="local-badge">Panel lokalny · widok administratora</span></section><div class="admin-toolbar"><div class="tabs" role="tablist" aria-label="Kolekcje katalogu">${COLLECTIONS.map(collection => `<button class="tab${collection === state.tab ? ' active' : ''}" type="button" role="tab" aria-selected="${state.tab === collection}" data-admin-tab="${collection}">${LABELS[collection]}</button>`).join('')}</div><label class="search">${icon('search')}<input type="search" id="admin-search" aria-label="Szukaj w katalogu" placeholder="Szukaj po nazwie…"></label><button class="primary-button" id="admin-create" type="button">${icon('plus')}<span id="admin-create-label">Dodaj ${SINGULAR[state.tab]}</span></button></div><div id="admin-records" role="tabpanel" aria-label="Wpisy katalogu"></div><div class="admin-footer"><span id="admin-count"></span><label class="admin-archive-toggle"><input type="checkbox" id="show-archived">Pokaż zarchiwizowane</label></div>`;
  renderAdminRecords();
}

function adminInfo(collection, item) {
  if (collection === 'attractions') return item.location;
  if (collection === 'visits') return `${MODES[item.mode]} · ${item.duration_minutes} min`;
  if (collection === 'services') return item.service_type;
  if (collection === 'offers') return `${item.items.length} składniki`;
  return `${item.audience === 'group' ? 'Grupowy' : 'Indywidualny'} · ${item.min_participants}–${item.max_participants} os.`;
}

function renderAdminRecords() {
  const items = (state.data[state.tab] || []).filter(item => (state.archived || !item.archived) && normalized(`${item.name} ${item.description}`).includes(normalized(state.search)));
  document.querySelector('#admin-create-label').textContent = `Dodaj ${SINGULAR[state.tab]}`;
  document.querySelector('#admin-count').textContent = `${LABELS[state.tab]} · ${items.length} wpisów · zmiany zapisują nową wersję`;
  document.querySelector('#admin-records').innerHTML = items.length ? `<div class="admin-table" role="table" aria-label="${LABELS[state.tab]}"><div class="admin-row admin-table-head" role="row"><span role="columnheader">Nazwa i opis</span><span role="columnheader">Szczegóły</span><span role="columnheader">Status</span><span role="columnheader" style="text-align:right">Działania</span></div>${items.map(item => `<div class="admin-row" role="row"><div class="admin-name" role="cell"><strong>${esc(item.name)}</strong><span>${esc(item.description)}</span></div><span class="admin-info" role="cell">${esc(adminInfo(state.tab, item))}<br><small>Wersja ${item.version}</small></span><span role="cell" class="status-badge${item.archived ? ' archived' : ''}">${item.archived ? 'Archiwum' : 'Aktywny'}</span><div class="admin-actions" role="cell">${item.archived ? '<span class="muted">Tylko odczyt</span>' : `<button type="button" data-edit-id="${esc(item.id)}">Edytuj</button><button class="archive-button" type="button" data-archive-id="${esc(item.id)}">Archiwizuj</button>`}</div></div>`).join('')}</div>` : `<div class="empty-state">${icon('layers')}<h3>${state.search ? 'Brak pasujących wpisów' : 'Zacznij od pierwszego wpisu'}</h3><p>${state.search ? 'Wpisz inną nazwę lub włącz widok archiwum.' : 'Użyj przycisku „Dodaj”, aby uzupełnić katalog.'}</p></div>`;
  document.querySelectorAll('[data-admin-tab]').forEach(button => { const active = button.dataset.adminTab === state.tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', active); });
}

function targetOptions(selected = '', exclude = '') {
  return `<option value="">Wybierz składnik…</option>${Object.entries(KINDS).map(([kind, collection]) => `<optgroup label="${LABELS[collection]}">${(state.data[collection] || []).filter(item => selectable(kind, item.id) && !(kind === 'offer' && item.id === exclude)).map(item => `<option value="${kind}:${esc(item.id)}"${selected === `${kind}:${item.id}` ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</optgroup>`).join('')}`;
}

function compositionRow(item = {}, exclude = '') {
  return `<div class="composition-row"><label class="field"><span>Składnik</span><select data-item-reference required>${targetOptions(item.kind ? `${item.kind}:${item.id}` : '', exclude)}</select></label><label class="field"><span>Ilość</span><input type="number" data-item-quantity value="${item.quantity || 1}" min="1" step="1" required></label><button type="button" class="icon-button" data-remove-row aria-label="Usuń składnik">${icon('close')}</button></div>`;
}

function closureRow(closure = {}) {
  return `<div class="closure-row">${field('Od', 'closure_start', closure.start || '', {type: 'date', required: true})}${field('Do', 'closure_end', closure.end || '', {type: 'date', required: true})}${field('Powód', 'closure_reason', closure.reason || '', {required: true})}<button type="button" class="icon-button" data-remove-row aria-label="Usuń wyłączenie">${icon('close')}</button></div>`;
}

function detailRow(key = '', value = '') {
  return `<div class="key-value-row">${field('Cecha', 'detail_key', key, {required: true})}${field('Wartość', 'detail_value', value, {required: true})}<button type="button" class="icon-button" data-remove-row aria-label="Usuń cechę">${icon('close')}</button></div>`;
}

function openEditor(collection, id = null) {
  state.editorCollection = collection;
  state.editorRecord = id ? state.data[collection].find(item => item.id === id) : null;
  const record = state.editorRecord || {};
  let fields = `${field('Nazwa', 'name', record.name || '', {required: true})}${field('Opis', 'description', record.description || '', {textarea: true, required: true})}`;
  if (collection === 'attractions') {
    fields += `<div class="field-row">${field('Lokalizacja', 'location', record.location || '', {required: true})}${selectField('Rodzaj miejsca', 'category', record.category || 'interior', [['interior', 'Wnętrze'], ['outdoor', 'Przestrzeń zewnętrzna'], ['passage', 'Przejście']])}</div>${field('Tagi', 'tags', (record.tags || []).join(', '), {hint: 'Oddziel tagi przecinkiem, np. historia, architektura.'})}${field('Dostępność', 'accessibility_note', record.accessibility_note || 'Brak informacji', {required: true})}<div class="field-row">${selectField('Wózek dziecięcy', 'stroller_allowed', record.stroller_allowed === undefined || record.stroller_allowed === null ? '' : String(record.stroller_allowed), [['', 'Brak informacji'], ['true', 'Dozwolony'], ['false', 'Niedozwolony']])}${selectField('Duży bagaż', 'large_luggage_allowed', record.large_luggage_allowed === undefined || record.large_luggage_allowed === null ? '' : String(record.large_luggage_allowed), [['', 'Brak informacji'], ['true', 'Dozwolony'], ['false', 'Niedozwolony']])}</div>`;
  } else if (collection === 'visits') {
    const attractions = (state.data.attractions || []).filter(item => !item.archived || item.id === record.attraction_id);
    fields += selectField('Atrakcja', 'attraction_id', record.attraction_id || '', [['', 'Wybierz atrakcję…'], ...attractions.map(item => [item.id, `${item.name}${item.archived ? ' (archiwum)' : ''}`])], true);
    fields += `<div class="field-row">${selectField('Sposób zwiedzania', 'mode', record.mode || 'guided', Object.entries(MODES))}${field('Czas trwania (minuty)', 'duration_minutes', record.duration_minutes || 60, {type: 'number', min: 1, step: 1, required: true})}</div><div class="field-row">${field('Język', 'language', record.language || 'pl', {required: true})}${field('Miejsce spotkania', 'meeting_point', record.meeting_point || 'Do ustalenia', {required: true})}</div><label class="checkbox-field"><input type="checkbox" name="admission_included"${record.admission_included ? ' checked' : ''}>Wizyta obejmuje bilet wstępu</label>`;
  } else if (collection === 'services') {
    fields += field('Rodzaj usługi', 'service_type', record.service_type || '', {required: true, placeholder: 'Np. transfer, ubezpieczenie'});
    const simpleDetails = Object.entries(record.details || {}).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
    fields += `<section class="form-section"><div class="form-section-heading"><h3>Szczegóły usługi</h3><button type="button" id="add-detail">+ Dodaj cechę</button></div><div id="detail-rows">${simpleDetails.map(([key, value]) => detailRow(key, value)).join('')}</div></section>`;
  } else if (collection === 'offers') {
    fields += `<section class="form-section"><div class="form-section-heading"><h3>Skład oferty</h3><button type="button" id="add-composition">+ Dodaj składnik</button></div><div id="composition-rows">${(record.items || [{}]).map(item => compositionRow(item, id)).join('')}</div><p>Połącz wizyty, usługi lub inne oferty. Ilość określa liczbę jednostek składnika.</p></section>`;
  } else if (collection === 'packages') {
    fields += `<label class="field"><span>Oferta, wizyta lub usługa</span><select name="target" required>${targetOptions(record.target ? `${record.target.kind}:${record.target.id}` : '')}</select></label><section class="form-section">${participantFields({...DEFAULT_DRAFT, ...record})}</section>`;
  }
  if (collection === 'attractions' || collection === 'services') fields += `<section class="form-section"><div class="form-section-heading"><h3>Czasowe wyłączenia</h3><button type="button" id="add-closure">+ Dodaj wyłączenie</button></div><div id="closure-rows">${(record.closures || []).map(closureRow).join('')}</div><p>Wyłączenie blokuje dostępność powiązanych pakietów w wybranym okresie.</p></section>`;
  editor.innerHTML = `<div class="dialog-header"><div><h2 id="editor-title">${id ? 'Edytuj' : 'Dodaj'} ${SINGULAR[collection]}</h2><p>${id ? `Zmiany zostaną zapisane jako wersja ${record.version + 1}.` : 'Nowy wpis pojawi się w katalogu po zapisaniu.'}</p></div><button class="icon-button" type="button" data-close-dialog aria-label="Zamknij formularz">${icon('close')}</button></div><form id="editor-form" class="dialog-form">${fields}<p id="editor-error" class="error-text" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="secondary-button" data-close-dialog>Anuluj</button><button id="editor-submit" type="submit" class="primary-button">${id ? 'Zapisz zmiany' : 'Dodaj do katalogu'} ${icon('check')}</button></div></form>`;
  editor.showModal();
}

function referenceFrom(value) {
  const split = String(value).indexOf(':');
  if (split < 1) throw new Error('Wybierz składnik z listy.');
  return {kind: value.slice(0, split), id: value.slice(split + 1)};
}

function editorBody(form) {
  const values = new FormData(form);
  const value = name => String(values.get(name) || '').trim();
  const body = {name: value('name'), description: value('description')};
  if (!body.name || !body.description) throw new Error('Podaj nazwę i opis.');
  const collection = state.editorCollection;
  if (collection === 'attractions') {
    Object.assign(body, {location: value('location'), category: value('category'), tags: value('tags').split(',').map(tag => tag.trim()).filter(Boolean), accessibility_note: value('accessibility_note'), stroller_allowed: value('stroller_allowed') === '' ? null : value('stroller_allowed') === 'true', large_luggage_allowed: value('large_luggage_allowed') === '' ? null : value('large_luggage_allowed') === 'true'});
  } else if (collection === 'visits') {
    Object.assign(body, {attraction_id: value('attraction_id'), mode: value('mode'), duration_minutes: Number(value('duration_minutes')), admission_included: values.has('admission_included'), language: value('language'), meeting_point: value('meeting_point')});
    if (body.mode === 'exterior' && body.admission_included) throw new Error('Wizyta z zewnątrz nie może obejmować biletu wstępu.');
  } else if (collection === 'services') {
    body.service_type = value('service_type');
    const original = state.editorRecord?.details || {};
    body.details = Object.fromEntries(Object.entries(original).filter(([, item]) => typeof item === 'object'));
    for (const row of form.querySelectorAll('.key-value-row')) {
      const key = row.querySelector('[name="detail_key"]').value.trim();
      if (!key) throw new Error('Podaj nazwę każdej cechy usługi.');
      if (Object.hasOwn(body.details, key)) throw new Error('Nazwy cech usługi nie mogą się powtarzać.');
      const text = row.querySelector('[name="detail_value"]').value;
      body.details[key] = typeof original[key] === 'number' && text.trim() && Number.isFinite(Number(text)) ? Number(text) : typeof original[key] === 'boolean' && ['true', 'false'].includes(text) ? text === 'true' : text;
    }
  } else if (collection === 'offers') {
    body.items = [...form.querySelectorAll('.composition-row')].map(row => ({...referenceFrom(row.querySelector('[data-item-reference]').value), quantity: Number(row.querySelector('[data-item-quantity]').value)}));
    if (!body.items.length) throw new Error('Dodaj przynajmniej jeden składnik oferty.');
    const keys = body.items.map(item => `${item.kind}:${item.id}`);
    if (keys.length !== new Set(keys).size) throw new Error('Składnik może pojawić się tylko raz. Zwiększ jego ilość.');
  } else if (collection === 'packages') {
    Object.assign(body, {target: referenceFrom(value('target')), ...participantBody(form)});
  }
  if (collection === 'attractions' || collection === 'services') body.closures = [...form.querySelectorAll('.closure-row')].map(row => ({start: row.querySelector('[name="closure_start"]').value, end: row.querySelector('[name="closure_end"]').value, reason: row.querySelector('[name="closure_reason"]').value.trim()}));
  if (state.editorRecord) body.expected_version = state.editorRecord.version;
  return body;
}

async function submitEditor(form) {
  const error = document.querySelector('#editor-error');
  const submit = document.querySelector('#editor-submit');
  error.hidden = true;
  try {
    const body = editorBody(form);
    submit.disabled = true;
    const record = state.editorRecord;
    const collection = state.editorCollection;
    const result = await api(`/${collection}${record ? `/${record.id}` : ''}`, {method: record ? 'PATCH' : 'POST', body: JSON.stringify(body)});
    const index = state.data[collection].findIndex(item => item.id === result.id);
    if (index < 0) state.data[collection].push({...result, archived: false});
    else state.data[collection][index] = {...result, archived: false};
    editor.close();
    renderAdminRecords();
    toast(record ? 'Zmiany zostały zapisane.' : 'Nowy wpis jest już w katalogu.');
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
    submit.disabled = false;
  }
}

async function archiveRecord(id) {
  const collection = state.tab;
  const record = state.data[collection].find(item => item.id === id);
  if (!confirm(`Zarchiwizować „${record.name}”? Powiązane pakiety mogą stać się niedostępne. Historia zostanie zachowana.`)) return;
  try {
    await api(`/${collection}/${id}`, {method: 'DELETE', body: JSON.stringify({expected_version: record.version})});
    record.archived = true;
    renderAdminRecords();
    toast('Wpis został przeniesiony do archiwum.');
  } catch (failure) { toast(failure.message, true); }
}

function detailPair(label, value) { return `<div class="detail-pair"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`; }

function snapshotItems(snapshot) {
  if (!snapshot) return '';
  if (snapshot.kind !== 'offer') return `<li>${esc(snapshot.name)}<span>${KIND_LABELS[snapshot.kind]}</span></li>`;
  return (snapshot.item_snapshots || []).map(item => `<li>${esc(item.snapshot.name)}<span>${item.quantity} × ${KIND_LABELS[item.snapshot.kind]}</span></li>`).join('');
}

function showDetails(kind, id) {
  const record = kind === 'package' ? state.data.packages.find(item => item.id === id) : find(kind, id);
  if (!record) return toast('Nie znaleziono tej pozycji. Odśwież stronę.', true);
  let content = `<p>${esc(record.description)}</p>`;
  if (kind === 'visit') {
    const attraction = state.data.attractions.find(item => item.id === record.attraction_id);
    content += `<dl class="detail-pairs">${detailPair('Atrakcja', attraction?.name || 'Brak atrakcji')}${detailPair('Sposób zwiedzania', MODES[record.mode])}${detailPair('Czas trwania', `${record.duration_minutes} minut`)}${detailPair('Bilet wstępu', record.admission_included ? 'Wliczony w wizytę' : 'Nie jest wliczony')}${detailPair('Język', record.language)}${detailPair('Miejsce spotkania', record.meeting_point)}</dl>`;
    if (attraction) content += `<h3>O miejscu</h3><p class="muted">${esc(attraction.description)}</p><dl class="detail-pairs">${detailPair('Dostępność', attraction.accessibility_note)}${detailPair('Wózek dziecięcy', attraction.stroller_allowed === null ? 'Brak informacji' : attraction.stroller_allowed ? 'Dozwolony' : 'Niedozwolony')}${detailPair('Duży bagaż', attraction.large_luggage_allowed === null ? 'Brak informacji' : attraction.large_luggage_allowed ? 'Dozwolony' : 'Niedozwolony')}</dl>`;
  } else if (kind === 'offer') {
    content += `<h3>W składzie oferty</h3><ul class="details-list">${record.items.map(item => `<li>${esc(find(item.kind, item.id)?.name || 'Nieznany składnik')}<span>${item.quantity} × ${KIND_LABELS[item.kind]}</span></li>`).join('')}</ul>`;
  } else if (kind === 'service') {
    content += `<dl class="detail-pairs">${Object.entries(record.details || {}).filter(([, value]) => typeof value !== 'object').map(([key, value]) => detailPair(key, value)).join('')}</dl>`;
  } else {
    content += `<h3>Skład zapisany w pakiecie</h3><ul class="details-list">${snapshotItems(record.snapshot)}</ul><dl class="detail-pairs">${detailPair('Uczestnicy', `${record.min_participants}–${record.max_participants} osób`)}${detailPair('Rodzaj', record.audience === 'group' ? 'Grupowy' : 'Indywidualny')}${detailPair('Ważny od', plainDate(record.valid_from))}${detailPair('Ważny do', plainDate(record.valid_to))}</dl><form id="availability-form" class="availability-form" data-package-id="${esc(id)}">${field('Data zwiedzania', 'date', today(), {type: 'date', required: true})}<button type="submit" class="primary-button">Sprawdź dostępność</button></form><div id="availability-result" role="status"></div>`;
  }
  if (kind !== 'package') content += `<div class="details-actions"><button type="button" class="primary-button full-width" data-add-kind="${kind}" data-add-id="${esc(id)}"${selectable(kind, id) ? '' : ' disabled'}>${icon('plus')}Dodaj do pakietu</button></div>`;
  details.innerHTML = `<div class="dialog-header"><div><p class="eyebrow">${kind === 'package' ? 'Twój zapisany plan' : KIND_LABELS[kind]}</p><h2 id="details-title">${esc(record.name)}</h2></div><button type="button" class="icon-button" data-close-dialog aria-label="Zamknij szczegóły">${icon('close')}</button></div><div class="details-content">${content}</div>`;
  details.showModal();
}

async function checkAvailability(form) {
  const output = document.querySelector('#availability-result');
  const submit = form.querySelector('button');
  submit.disabled = true;
  try {
    const day = new FormData(form).get('date');
    const result = await api(`/packages/${encodeURIComponent(form.dataset.packageId)}/availability?date=${encodeURIComponent(day)}`);
    output.innerHTML = `<div class="availability-result${result.available ? '' : ' unavailable'}"><strong>${result.available ? 'Pakiet jest dostępny w wybranym dniu.' : 'Pakiet jest niedostępny w wybranym dniu.'}</strong>${result.reasons.length ? `<ul>${result.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}</div>`;
  } catch (failure) { output.innerHTML = `<p class="error-text">${esc(failure.message)}</p>`; }
  submit.disabled = false;
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (state.submitting && (button.dataset.addKind || button.hasAttribute('data-cart-remove') || button.hasAttribute('data-quantity-index') || button.id === 'cart-clear')) return;
  if (button.hasAttribute('data-close-dialog')) return button.closest('dialog').close();
  if (button.dataset.addKind) {
    addToCart(button.dataset.addKind, button.dataset.addId);
    if (details.open) details.close();
  } else if (button.dataset.detailsKind) showDetails(button.dataset.detailsKind, button.dataset.detailsId);
  else if (button.dataset.tab) { state.tab = button.dataset.tab; renderCards(); }
  else if (button.dataset.adminTab) { state.tab = button.dataset.adminTab; renderAdminRecords(); }
  else if (button.id === 'admin-create') openEditor(state.tab);
  else if (button.dataset.editId) openEditor(state.tab, button.dataset.editId);
  else if (button.dataset.archiveId) archiveRecord(button.dataset.archiveId);
  else if (button.hasAttribute('data-cart-remove')) { state.cart.splice(Number(button.dataset.cartRemove), 1); updateCart(); }
  else if (button.hasAttribute('data-quantity-index')) {
    const index = Number(button.dataset.quantityIndex);
    state.cart[index].quantity = Math.max(1, Math.min(999, state.cart[index].quantity + Number(button.dataset.delta)));
    updateCart();
  } else if (button.id === 'cart-clear') {
    if (confirm('Usunąć wszystkie pozycje z pakietu?')) { state.cart = []; updateCart(); }
  } else if (button.id === 'add-composition') document.querySelector('#composition-rows').insertAdjacentHTML('beforeend', compositionRow({}, state.editorRecord?.id));
  else if (button.id === 'add-closure') document.querySelector('#closure-rows').insertAdjacentHTML('beforeend', closureRow());
  else if (button.id === 'add-detail') document.querySelector('#detail-rows').insertAdjacentHTML('beforeend', detailRow());
  else if (button.hasAttribute('data-remove-row')) button.parentElement.remove();
  else if (button.id === 'retry-load') start();
});

document.addEventListener('input', event => {
  const input = event.target;
  if (state.submitting && input.closest('#cart-panel')) return;
  if (input.id === 'catalog-search') { state.search = input.value; renderCards(); }
  else if (input.id === 'admin-search') { state.search = input.value; renderAdminRecords(); }
  else if (input.closest('#cart-form') && input.name) { state.draft[input.name] = input.value; persistCart(); }
});

document.addEventListener('change', event => {
  const input = event.target;
  if (state.submitting && input.closest('#cart-panel')) return;
  if (input.hasAttribute('data-cart-quantity')) {
    const quantity = Number(input.value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) { input.value = state.cart[Number(input.dataset.cartQuantity)].quantity; return toast('Ilość musi być liczbą całkowitą od 1 do 999.', true); }
    state.cart[Number(input.dataset.cartQuantity)].quantity = quantity;
    updateCart();
  } else if (input.id === 'show-archived') { state.archived = input.checked; renderAdminRecords(); }
  else if (input.closest('#cart-form') && input.name) { state.draft[input.name] = input.value; persistCart(); }
  else if (input.name === 'mode' && input.value === 'exterior') editor.querySelector('[name="admission_included"]').checked = false;
});

document.addEventListener('submit', event => {
  if (event.target.id === 'cart-form') { event.preventDefault(); submitCart(event.target); }
  else if (event.target.id === 'editor-form') { event.preventDefault(); submitEditor(event.target); }
  else if (event.target.id === 'availability-form') { event.preventDefault(); checkAvailability(event.target); }
});

for (const dialog of [editor, details]) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});

async function start() {
  root.innerHTML = '<div class="loading-state"><span class="spinner" aria-hidden="true"></span>Wczytujemy miejsca i możliwości…</div>';
  document.querySelector(isAdmin ? '#admin-link' : '#client-link').classList.add('active');
  document.querySelector(isAdmin ? '#admin-link' : '#client-link').setAttribute('aria-current', 'page');
  document.title = isAdmin ? 'Panel admina — Wawel' : 'Wawel — odkrywaj po swojemu';
  try {
    await loadData();
    if (isAdmin) adminShell(); else clientShell();
  } catch (failure) {
    root.innerHTML = `<div class="notice" role="alert"><h2>Nie udało się wczytać katalogu</h2><p>${esc(failure.message)}</p><button type="button" id="retry-load" class="secondary-button">Spróbuj ponownie</button></div>`;
  }
}

restoreCart();
start();
