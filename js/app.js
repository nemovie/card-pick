import {
  configured, ready, auth, db, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, collection, doc, onSnapshot, query, where, orderBy, writeBatch, addDoc, serverTimestamp, deleteDoc, updateDoc, deleteField, getDocs
} from "./firebase.js";
import { CARD_SEED, SEED_VERSION, CARD_IMG, CARD_THUMB, calcCard, byEntry, benefitMax, slotCap, PERIOD_UNIT, monthKey, prevMonthKey, won,
  draftToBenefit, draftToCard, benefitIssues, cardDraftIssues, previewBenefit, cardToDraft } from "./data.js";

const $ = id => document.getElementById(id);
// 한 달치 계산: 전월 사용액(prevMin 조건)까지 같이 넘겨준다
const spentOf = (pool, m, cardId) => pool.filter(t => t.month === m && t.cardId === cardId).reduce((s, t) => s + (t.amount || 0), 0);
const calcFor = (card, pool, m) => calcCard(card, pool.filter(t => t.cardId === card.id && t.month <= m), { month: m, prevSpent: spentOf(pool, shiftMonth(m, -1), card.id) });
const thumbOf = c => CARD_THUMB[c.id] || imgOf(c); // 목록용 작은 이미지
const imgOf = c => CARD_IMG[c.id] || c.img || ""; // 기본 카드는 파일, 직접 추가한 카드는 저장된 이미지
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { user: null, cards: null, txs: [], unsubs: [], tab: "home", detail: null,
  month: monthKey(), listTab: "card", histTxs: null, histUnsub: null, histKey: null, form: null, cform: null, delCard: null, cardView: null, modal: null,
  synced: false }; // synced: Firebase 로그인 확인·연결이 끝났는지 (끝나기 전에는 저장류 동작을 막는다)

/* ---------- 내비게이션 (모바일 하단 탭 + PC 사이드바 공용) ---------- */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cards: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  list: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'
};
const NAV = [["home", "홈"], ["cards", "내 카드"], ["list", "사용내역"], ["more", "더보기"]];
const ENABLED = ["home", "cards", "list", "more"]; // 구현 완료된 탭
function renderNav() {
  const html = NAV.map(([k, label]) =>
    `<button class="nav-btn ${state.tab === k ? "on" : ENABLED.includes(k) ? "" : "off"}" data-nav="${k}" type="button">
       <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span>${label}</span></button>`).join("");
  $("nav-side").innerHTML = html;
  $("nav-tab").innerHTML = html;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-nav]");
  if (b) {
    const k = b.dataset.nav;
    if (ENABLED.includes(k)) { resetNav(); state.tab = k; state.detail = null; state.form = null; state.cform = null; state.cardView = null; state.modal = null; if (k === "list") ensureHist(); renderNav(); render(); window.scrollTo(0, 0); }
    else toast("이 화면은 다음 단계에서 구현해요");
  }
  const mb = e.target.closest("[data-month]");
  if (mb && !mb.disabled) { state.month = shiftMonth(state.month, +mb.dataset.month); subscribeHist(); render(); }
  const lt = e.target.closest("[data-ltab]");
  if (lt) { state.listTab = lt.dataset.ltab; render(); }
  const ad = e.target.closest("[data-add]");
  if (ad) openForm(ad.dataset.add || null);
  if (e.target.closest("[data-save]")) saveForm();
  const cd = e.target.closest("[data-card]");
  if (cd) openDetail(cd.dataset.card);
  if (e.target.closest("[data-back]")) history.back();
  if (e.target.closest("[data-soon]")) toast("다음 단계에서 구현해요");
  const cv = e.target.closest("[data-cardview]");
  if (cv) openCardView(cv.dataset.cardview);
  const txb = e.target.closest("[data-tx]");
  if (txb) openModal(txb.dataset.tx);
  if (e.target.closest("[data-modal-close]")) closeModal();
  if (e.target.closest("[data-tx-edit]")) openEdit(state.modal?.id);
  if (e.target.closest("[data-tx-del]")) { state.modal.del = true; renderModal(); }
  if (e.target.closest("[data-tx-del-no]")) { state.modal.del = false; renderModal(); }
  if (e.target.closest("[data-tx-del-yes]")) deleteTx(state.modal?.id);
  if (e.target.closest("[data-logout]") && !needSync()) { clearCache(); signOut(auth); }
});
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

/* ---------- 인증 ---------- */
$("btn-google").addEventListener("click", async () => {
  $("login-msg").textContent = "";
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" }); // 로그인된 계정이 있어도 항상 계정 선택 화면 표시
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === "auth/popup-blocked") { sessionStorage.setItem("cpn:redirect", "1"); return signInWithRedirect(auth, provider); }
    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
    $("login-msg").textContent = "로그인에 실패했어요: " + err.code;
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && state.modal) closeModal(); });

/* ---------- 빠른 첫 화면 ----------
 * Firebase SDK를 다 받을 때까지 기다리지 않고, 기기에 저장해 둔 마지막 데이터로 화면을 먼저 그린다.
 * SDK가 준비되고 로그인이 확인되면 진짜 데이터로 자연스럽게 바뀐다. 로그아웃하면 저장본은 지운다. */
const CACHE_KEY = "cpn:cache:v1", AUTHED_KEY = "cpn:authed";
let fromCache = false, cacheTimer;
function readCache() {
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY)); return c && c.v === 1 && c.uid && Array.isArray(c.cards) && Array.isArray(c.txs) ? c : null; } catch { return null; }
}
function saveCache() { // 데이터가 바뀔 때마다 0.4초 뒤 한 번만 저장
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    if (!state.synced || !state.user || !state.cards) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, uid: state.user.uid, user: { email: state.user.email, displayName: state.user.displayName },
        cards: state.cards.map(({ img, ...c }) => c), // 직접 올린 카드 이미지는 용량이 커서 제외 (Firebase에서 받으면 표시됨)
        txs: state.txs.map(t => ({ ...t, createdAt: t.createdAt?.toMillis?.() ?? null })) }));
    } catch { /* 저장 공간 부족 등은 무시 */ }
  }, 400);
}
function clearCache() { clearTimeout(cacheTimer); try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(AUTHED_KEY); } catch { /* 무시 */ } }
function bootFromCache() {
  const c = readCache();
  if (!c) return false;
  state.user = { uid: c.uid, email: c.user?.email, displayName: c.user?.displayName };
  state.cards = c.cards;
  state.txs = c.txs.map(t => ({ ...t, createdAt: t.createdAt == null ? null : { toMillis: () => t.createdAt } })); // 입력 순서 정렬용
  fromCache = true;
  $("login").hidden = true; $("app").hidden = false; $("boot")?.remove();
  render();
  return true;
}
// Firebase가 아직 준비 안 됐을 때 저장·삭제를 누르면 안내만 하고 막는다
const needSync = () => { if (state.synced) return false; toast("동기화 중이에요. 잠시 후 다시 시도해 주세요"); return true; };

async function start() {
  resetNav(); // 새로고침/앱 복원 후 남아있는 상세·폼 기록 정리
  renderNav();
  if (!configured) {
    $("boot")?.remove();
    $("login").hidden = false;
    $("login-msg").textContent = "js/firebase-config.js에 Firebase 설정값을 먼저 넣어주세요.";
    $("btn-google").disabled = true;
    return;
  }
  const hasCache = bootFromCache();
  // 로그인한 적이 없거나 로그아웃한 상태면 SDK를 기다리지 않고 로그인 화면부터 보여준다
  if (!hasCache && !localStorage.getItem(AUTHED_KEY)) { $("boot")?.remove(); $("login").hidden = false; }
  $("btn-google").disabled = true; // SDK가 준비되기 전에 누르면 팝업이 막히므로 잠깐 비활성
  try { await ready; } catch {
    if (hasCache) toast("연결이 안 돼서 저장된 화면을 보여드려요");
    else { $("boot")?.remove(); $("login").hidden = false; $("login-msg").textContent = "Firebase를 불러오지 못했어요. 네트워크를 확인하고 새로고침해 주세요."; }
    return;
  }
  $("btn-google").disabled = false;
  if (sessionStorage.getItem("cpn:redirect")) { sessionStorage.removeItem("cpn:redirect"); try { await getRedirectResult(auth); } catch { /* 결과는 아래 onAuthStateChanged로 확인 */ } }
  onAuthStateChanged(auth, user => {
    const keep = fromCache && !!user && user.uid === state.user?.uid; // 저장본으로 먼저 보여준 같은 사용자면 화면을 그대로 둔다
    const wasCached = fromCache;
    fromCache = false;
    state.unsubs.forEach(u => u()); state.unsubs = [];
    if (wasCached && !keep) clearCache(); // 저장본이 다른 사용자 것이거나 로그아웃 상태면 지운다
    if (!keep) {
      state.histUnsub?.(); state.histUnsub = null; state.histTxs = null; state.histKey = null; state.form = null; state.cform = null; state.delCard = null; state.cardView = null; state.modal = null;
      state.cards = null; state.txs = [];
    }
    state.user = user; state.synced = !!user;
    $("login").hidden = !!user;
    $("app").hidden = !user;
    $("boot")?.remove();
    if (!user) { clearCache(); render(); return; }
    try { localStorage.setItem(AUTHED_KEY, "1"); } catch { /* 무시 */ }
    render();
    subscribe(user.uid);
    if (state.tab === "list") ensureHist(); // 저장본으로 보는 동안 못 받은 월별 기록 구독
  });
}

/* ---------- Firestore 구독 ---------- */
// users/{uid}/cards/{cardId}          카드 정의
// users/{uid}/transactions/{txId}     사용 내역 { cardId, month:"YYYY-MM", date, place, amount, benefitIdx, memoAmt?, memoText? }
function subscribe(uid) {
  const cardsQ = query(collection(db, "users", uid, "cards"), orderBy("order"));
  state.unsubs.push(onSnapshot(cardsQ, snap => {
    state.cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    migrate(uid);
    render();
    saveCache();
  }, err => toast("카드 불러오기 실패: " + err.code)));

  const txQ = query(collection(db, "users", uid, "transactions"),
    where("month", ">=", shiftMonth(monthKey(), -7))); // 반기 혜택까지 계산하려고 최근 8개월을 불러옴
  state.unsubs.push(onSnapshot(txQ, snap => {
    state.txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
    saveCache();
  }, err => toast("내역 불러오기 실패: " + err.code)));
}

// 카드 기본 규칙(혜택 목록)이 새 버전이면 한 번만 갱신
let migrating = false;
async function migrate(uid) {
  if (migrating) return;
  const stale = CARD_SEED.filter(sd => { const c = state.cards.find(x => x.id === sd.id); return c && (c.v || 0) < SEED_VERSION; });
  if (!stale.length) return;
  migrating = true;
  try {
    const batch = writeBatch(db);
    stale.forEach(sd => { const { id, ...rest } = sd; batch.set(doc(db, "users", uid, "cards", id), rest, { merge: true }); });
    await batch.commit();
  } catch (err) { toast("카드 정보 갱신 실패: " + err.code); }
  finally { migrating = false; }
}

async function seedCards() {
  if (needSync()) return;
  const btn = $("btn-seed"); btn.disabled = true;
  try {
    const batch = writeBatch(db);
    CARD_SEED.forEach((c, i) => batch.set(doc(db, "users", state.user.uid, "cards", c.id), { ...c, order: i }));
    await batch.commit();
  } catch (err) { toast("저장 실패: " + err.code); btn.disabled = false; }
}

/* ---------- 대시보드 ---------- */
// 오늘 기준으로 실제 받을 수 있는 혜택만 골라, 카드별 최고 혜택 1개씩 상위 3개를 돌려준다
function recommendation(rows) {
  const prev = prevMonthKey(), td = today(), out = [];
  rows.forEach(({ card, r }) => {
    const prevTxs = state.txs.filter(t => t.month === prev && t.cardId === card.id);
    const prevSpent = prevTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
    // 전월 기록이 있는데 전월 실적에 못 미친 카드는 이번 달 혜택이 적용되지 않음
    if (prevTxs.length && prevSpent < card.target) return;
    let best = null;
    card.benefits.forEach((b, i) => {
      if (b.all || b.addon || b.memo) return;                // 자동 적용형·추가 혜택·기록용 혜택은 제외
      if (b.prevMin != null && prevSpent < b.prevMin) return; // 전월 사용액 조건 미달
      const max = benefitMax(b), rem = slotCap(b) - r.used[i];
      if (max === Infinity || rem <= 0) return;
      if (b.daily && r.days[i].has(td)) return;               // 오늘 이미 쓴 일 1회 혜택
      let left = max - r.per[i];
      if (b.group && b.groupMax != null) left = Math.min(left, b.groupMax - (r.grp[b.group] || 0)); // 통합 한도
      if (left > 0 && (!best || left > best.left)) best = { card, b, left, rem };
    });
    if (best) out.push(best);
  });
  return out.sort((x, y) => y.left - x.left).slice(0, 3);
}

function renderDashboard() {
  const v = $("view");
  if (state.cards === null) { v.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>'; return; }
  if (!state.cards.length) {
    v.innerHTML = `<div class="box empty"><div class="empty-ico"><img src="images/credit-card.png" alt=""></div>
      <h2>등록된 카드가 없어요</h2>
      <p>엑셀에서 쓰던 5개 카드와 혜택 규칙을 기본값으로 불러올 수 있어요.<br>(사용 내역은 포함되지 않습니다)</p>
      <button id="btn-seed" class="btn" type="button">기본 카드 불러오기</button></div>`;
    $("btn-seed").addEventListener("click", seedCards);
    return;
  }
  const cur = monthKey(), prev = prevMonthKey();
  const byCard = (m, id) => state.txs.filter(t => t.month === m && t.cardId === id);
  const rows = state.cards.map(card => ({ card, r: calcFor(card, state.txs, cur) }));

  const total = rows.reduce((s, x) => s + x.r.sum, 0);
  const done = rows.filter(x => x.r.spent >= x.card.target).length;
  const remain = rows.reduce((s, x) => s + Math.max(0, x.card.target - x.r.spent), 0);
  const hasPrev = state.txs.some(t => t.month === prev);
  const prevTotal = state.cards.reduce((s, c) => s + calcFor(c, state.txs, prev).sum, 0);
  const diff = total - prevTotal;

  v.innerHTML = `
  <section class="summary">
    <div class="box hero">
      <div class="label">${Number(cur.slice(5))}월 예상 혜택 합계</div>
      <div class="big">${won(total)}<span style="font-size:22px">원</span></div>
      ${hasPrev
        ? `<span class="chip ${diff >= 0 ? "ok" : "wn"}">${diff >= 0 ? "+" : "-"} ${won(Math.abs(diff))}원 (지난달 대비)</span>`
        : `<span class="chip ac">지난달 기록이 쌓이면 비교해 드려요</span>`}
    </div>
    <div class="box"><div class="label">전월 실적 달성 카드</div><div class="stat-v">${done} / ${rows.length}</div></div>
    <div class="box"><div class="label">남은 실적 합계</div><div class="stat-v">${won(remain)}원</div></div>
  </section>

  <h2 class="sec">카드별 실적 현황</h2>
  <section class="cards">${rows.map(({ card, r }) => {
    const pct = Math.min(100, r.spent / card.target * 100);
    const need = card.target - r.spent;
    return `<article class="box tap" data-card="${esc(card.id)}">
      <div class="cc-head">
        <div class="cc-ico" style="background:${esc(card.color)}"><img src="images/credit-card.png" alt=""></div>
        <div class="cc-name">${esc(card.name)}<span class="cc-type">${esc(card.type)}</span></div>
        <div class="cc-pct">${Math.round(pct)}%</div>
      </div>
      <div class="bar"><i style="width:${pct}%;background:${esc(card.color)}"></i></div>
      <div class="cc-foot">
        <span>${won(r.spent)} / ${won(card.target)}원</span>
        ${need > 0 ? `<span class="chip wn">${won(need)}원 필요</span>` : `<span class="chip ok">달성</span>`}
      </div>
      <div class="cc-foot" style="margin-top:8px"><span>이번 달 혜택</span><b>${won(r.sum)}원</b></div>
    </article>`;
  }).join("")}</section>`;
}

/* 추천 결제 박스 (더보기 탭에서 사용) */
function recoBox(rows) {
  const recos = recommendation(rows);
  if (!recos.length) return "";
  return `<div class="box reco"><div class="ico">💡</div><div class="reco-body">
      <small>이번 달 추천 결제 · 오늘 기준</small>
      ${recos.map(x => `<div class="reco-row"><i class="dot" style="background:${esc(x.card.color)}"></i>
        <div class="rn"><b>${esc(x.card.name)}</b><span>${esc(x.b.n)}${x.rem !== Infinity ? ` · 남은 ${x.rem}회` : ""}</span></div>
        <b class="ra">최대 ${won(x.left)}원</b></div>`).join("")}
    </div></div>`;
}

/* ---------- 화면 전환 ---------- */
// 뒤로가기 기록 관리: 화면을 쌓을 때마다 깊이(d)를 기록해 두고, 탭 이동/새로고침 때 쌓인 만큼 한 번에 되돌린다
const navDepth = () => history.state?.d || 0;
function resetNav() { const d = navDepth(); if (d) history.go(-d); }
function openDetail(id) {
  state.detail = id; history.pushState({ detail: id, d: navDepth() + 1 }, "");
  render(); window.scrollTo(0, 0);
}
window.addEventListener("popstate", e => {
  state.detail = e.state?.detail ?? null;
  state.cardView = e.state?.cardView ?? null;
  state.form = e.state?.form ? state.form : null;
  state.cform = e.state?.cform ? state.cform : null;
  state.modal = e.state?.modal ? state.modal : null;
  render();
  renderModal(); // 팝업이 닫혀야 하면 숨김 처리
});

function render() {
  document.body.classList.toggle("syncing", !state.synced);
  const card = state.detail && state.cards ? state.cards.find(c => c.id === state.detail) : null;
  const cview = state.cardView && state.cards ? state.cards.find(c => c.id === state.cardView) : null;
  const formOpen = !!state.form && !!state.cards?.length;
  const cformOpen = !!state.cform && !!state.cards?.length;
  document.body.dataset.tab = card || cview || formOpen || cformOpen ? "detail" : state.tab;
  $("page-title").textContent = { cards: "내 카드", list: "월별 기록", more: "더보기" }[state.tab] || "카드 피킹 노트";
  // 로딩/빈 상태는 대시보드 렌더러가 공통 처리
  if (state.cards === null || !state.cards.length) renderDashboard();
  else if (cformOpen) renderCardForm();
  else if (formOpen) renderForm();
  else if (card) renderDetail(card);
  else if (cview) renderCardView(cview);
  else if (state.tab === "home") renderDashboard();
  else if (state.tab === "list") renderHistory();
  else if (state.tab === "more") renderMore();
  else renderCards();
  if (state.modal) renderModal();
  // 플로팅 + 버튼: 폼 화면·더보기·카드 없음일 때는 숨김, 카드 화면에서는 그 카드가 미리 선택됨
  const fab = $("fab");
  fab.hidden = formOpen || cformOpen || !state.cards?.length || (state.tab === "more" && !card && !cview);
  fab.dataset.add = card?.id || cview?.id || "";
}

/* ---------- 내 카드 목록 ---------- */
function renderCards() {
  const cur = monthKey();
  $("view").innerHTML = `<div class="list-wrap">
    <section class="rows">${state.cards.map(card => {
      const r = calcFor(card, state.txs, cur);
      const pct = Math.min(100, r.spent / card.target * 100);
      const need = card.target - r.spent;
      return `<article class="box row-card" data-card="${esc(card.id)}">
        ${imgOf(card) ? `<img class="thumb" src="${esc(thumbOf(card))}" width="68" height="43" decoding="async" alt="">` : `<div class="cc-ico" style="background:${esc(card.color)}"><img src="images/credit-card.png" alt=""></div>`}
        <div class="mid">
          <div class="nm">${esc(card.name)}</div>
          <div class="meta">${esc(card.type)}카드 · ${Math.round(pct)}%</div>
        </div>
        <div class="rt ${need <= 0 ? "ok" : ""}">${need > 0 ? won(need) + "원" : "달성"}</div>
        <span class="chev" aria-hidden="true">›</span>
      </article>`;
    }).join("")}</section>
    <button class="add-card" type="button" data-cf-new>+ 카드 추가하기</button>
    <p class="note">카드별 실적과 혜택은 매월 1일 기준으로 갱신됩니다.</p>
  </div>`;
}

/* ---------- 사용내역 탭: 월별 기록 ---------- */
const SHORT = { sam: "삼성", shin: "신한", woo: "우리", nori: "KB노리2", pang: "KB팡팡" };
const DOW = "일월화수목금토";
const shortName = c => c.short || SHORT[c.id] || c.name;
const shiftMonth = (key, d) => monthKey(new Date(+key.slice(0, 4), +key.slice(5) - 1 + d, 1));
const dateLabel = d => d ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일 (${DOW[new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay()]})` : "날짜 없음";

// 선택한 달 + 그 전달(지난달 대비용) 내역을 구독. 달을 바꿀 때마다 다시 구독
function ensureHist() { if (!state.synced) return; if (!state.histUnsub || state.histKey !== state.month) subscribeHist(); }
function subscribeHist() {
  state.histUnsub?.(); state.histUnsub = null; state.histTxs = null;
  if (!state.user || !state.synced) return;
  state.histKey = state.month;
  const q = query(collection(db, "users", state.user.uid, "transactions"),
    where("month", ">=", shiftMonth(state.month, -7)), where("month", "<=", state.month));
  state.histUnsub = onSnapshot(q, snap => {
    state.histTxs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.tab === "list" && !state.detail) render();
  }, err => toast("내역 불러오기 실패: " + err.code));
}

function renderHistory() {
  const sel = state.month, prev = shiftMonth(sel, -1), isCur = sel >= monthKey();
  const nav = `<div class="month-nav">
    <button type="button" data-month="-1" aria-label="이전 달">‹</button>
    <b>${sel.slice(0, 4)}년 ${Number(sel.slice(5))}월</b>
    <button type="button" data-month="1" aria-label="다음 달" ${isCur ? "disabled" : ""}>›</button></div>`;
  if (state.histTxs === null) { $("view").innerHTML = `<div class="list-wrap">${nav}<div class="skeleton"></div><div class="skeleton"></div></div>`; return; }

  const inMonth = m => state.histTxs.filter(t => t.month === m);
  const selTxs = inMonth(sel), prevTxs = inMonth(prev);
  const rows = state.cards.map(card => {
    const txs = selTxs.filter(t => t.cardId === card.id);
    return { card, txs, r: calcFor(card, state.histTxs, sel) };
  });
  const total = rows.reduce((s, x) => s + x.r.sum, 0);
  const prevTotal = state.cards.reduce((s, c) => s + calcFor(c, state.histTxs, prev).sum, 0);
  const diff = total - prevTotal;
  const maxSum = Math.max(1, ...rows.map(x => x.r.sum));

  const hero = `<div class="box">
    <div class="hist-sum">
      <div><div class="label">총 혜택 합계</div><div class="big" style="margin-bottom:0">${won(total)}<span style="font-size:22px">원</span></div></div>
      <div class="hist-diff"><div class="label">지난달 대비</div>${prevTxs.length
        ? `<span class="chip ${diff >= 0 ? "ok" : "wn"}">${diff >= 0 ? "+" : "-"} ${won(Math.abs(diff))}원</span>`
        : `<span class="chip ac">지난달 기록 없음</span>`}</div>
    </div>
    <div class="chart">${rows.map(({ card, r }) => `<div class="col">
      <span class="val">${won(r.sum)}</span>
      <i style="height:${Math.round(6 + r.sum / maxSum * 84)}px;background:${esc(card.color)}"></i>
      <span class="nm">${esc(shortName(card))}</span></div>`).join("")}</div>
  </div>`;

  const tabs = `<div class="seg" role="tablist">
    <button type="button" data-ltab="card" class="${state.listTab === "card" ? "on" : ""}">카드별 요약</button>
    <button type="button" data-ltab="date" class="${state.listTab === "date" ? "on" : ""}">날짜별 내역</button></div>`;

  let body;
  if (state.listTab === "card") {
    body = `<section class="rows" style="margin-top:14px">${rows.map(({ card, txs, r }) => `<article class="box row-card" data-cardview="${esc(card.id)}">
      ${imgOf(card) ? `<img class="thumb" src="${esc(thumbOf(card))}" width="68" height="43" decoding="async" alt="">` : `<div class="cc-ico" style="background:${esc(card.color)}"><img src="images/credit-card.png" alt=""></div>`}
      <div class="mid"><div class="nm">${esc(card.name)}</div>
        <div class="meta">사용 ${won(r.spent)}원 · ${txs.length}건</div></div>
      <div class="rt ${r.sum > 0 ? "ok" : ""}">${won(r.sum)}원</div><span class="chev" aria-hidden="true">›</span></article>`).join("")}</section>`;
  } else {
    const cardOf = Object.fromEntries(state.cards.map(c => [c.id, c]));
    const byTx = {}; rows.forEach(({ r }) => Object.assign(byTx, r.by));
    const groups = {};
    selTxs.filter(t => cardOf[t.cardId]).forEach(t => (groups[t.date || ""] ||= []).push(t));
    Object.values(groups).forEach(g => g.sort((x, y) => byEntry(y, x)));
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    body = dates.length ? dates.map(d => `<div class="day-h"><span>${dateLabel(d)}</span><span>${won(groups[d].reduce((s, t) => s + (t.amount || 0), 0))}원 사용</span></div>
      <div class="box">${groups[d].map(t => {
        const c = cardOf[t.cardId], bn = c.benefits[t.benefitIdx]?.n;
        return txRow(t, shortName(c) + (bn ? " · " + bn : ""), byTx[t.id] || 0, c);
      }).join("")}</div>`).join("")
      : '<div class="box empty" style="margin-top:14px"><p style="margin:0">이 달에는 사용 내역이 없어요</p></div>';
  }
  $("view").innerHTML = `<div class="list-wrap">${nav}${hero}${tabs}${body}</div>`;
}

/* ---------- 결제 내역 행 / 카드별 내역 화면 / 더보기 ---------- */
const txRow = (t, sub, gain, card) => {
  if (t.memoText && card?.benefits[t.benefitIdx]?.memo) sub += " · " + t.memoText; // 직접 입력형 혜택의 메모
  return `<div class="tx-row tap" data-tx="${esc(t.id)}"><div class="tx-l"><b>${esc(t.place || "사용처 없음")}</b>
  <div class="label">${esc(sub)}</div></div>
  <div class="tx-r"><b>${won(t.amount || 0)}원</b>${gain > 0 ? `<div class="gain">+${won(gain)}원 혜택</div>` : ""}</div></div>`;
};

function openCardView(id) {
  state.cardView = id; history.pushState({ cardView: id, d: navDepth() + 1 }, "");
  render(); window.scrollTo(0, 0);
}

// 사용내역 탭에서 고른 달의, 카드 하나의 결제 내역
function renderCardView(card) {
  ensureHist();
  const sel = state.month;
  const head = `<div class="d-head"><button class="back" type="button" data-back aria-label="뒤로">‹</button>
    <h2>${esc(card.name)}</h2><span class="chip ac">${sel.slice(0, 4)}년 ${Number(sel.slice(5))}월</span></div>`;
  if (state.histTxs === null) { $("view").innerHTML = `<div class="detail">${head}<div class="skeleton"></div><div class="skeleton"></div></div>`; return; }
  const r = calcFor(card, state.histTxs, sel);
  const txs = state.histTxs.filter(t => t.month === sel && t.cardId === card.id)
    .sort((a, b) => byEntry(b, a));
  $("view").innerHTML = `<div class="detail">${head}
    <section class="summary">
      <div class="box"><div class="label">사용 금액</div><div class="stat-v">${won(r.spent)}원</div><div class="label">${txs.length}건</div></div>
      <div class="box"><div class="label">받은 혜택</div><div class="stat-v" style="color:${r.sum > 0 ? "var(--ok)" : "var(--tx)"}">${won(r.sum)}원</div></div>
    </section>
    <h2 class="sec">결제 내역</h2>
    <div class="box">${txs.length ? txs.map(t => {
      const bn = card.benefits[t.benefitIdx]?.n;
      return txRow(t, (t.date || "").slice(5).replace("-", ".") + (bn ? " · " + bn : ""), r.by[t.id] || 0, card);
    }).join("") : '<div class="label" style="text-align:center;padding:8px 0">이 달에는 결제 내역이 없어요</div>'}</div>
  </div>`;
}

function renderMore() {
  const u = state.user;
  const rows = state.cards.map(card => ({ card, r: calcFor(card, state.txs, monthKey()) }));
  $("view").innerHTML = `<div class="list-wrap">${recoBox(rows)}<section class="rows">
    <button class="box row-card more-row" type="button" data-logout>
      <div class="more-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg></div>
      <div class="mid"><div class="nm">로그아웃</div><div class="meta">${esc(u?.email || u?.displayName || "")}</div></div>
      <span class="chev" aria-hidden="true">›</span>
    </button></section></div>`;
}

/* ---------- 결제 내역 팝업 (상세 / 수정 / 삭제) ---------- */
function allTxs() {
  const m = new Map();
  [...state.txs, ...(state.histTxs || [])].forEach(t => m.set(t.id, t));
  return [...m.values()];
}
// 팝업도 뒤로가기 기록에 한 칸 쌓아서, 뒤로가기를 누르면 팝업만 닫히게 함
function openModal(id) {
  state.modal = { id, del: false };
  history.pushState({ detail: state.detail, cardView: state.cardView, modal: true, d: navDepth() + 1 }, "");
  renderModal();
}
function closeModal() {
  const had = history.state?.modal;
  state.modal = null; renderModal(); // 화면부터 닫고
  if (had) history.back();           // 쌓아둔 기록 한 칸 제거
}
function renderModal() {
  const el = $("modal"), mo = state.modal;
  const pool = allTxs();
  const t = mo && pool.find(x => x.id === mo.id), card = t && state.cards?.find(c => c.id === t.cardId);
  if (!t || !card) { state.modal = null; if (mo && history.state?.modal) history.back(); el.hidden = true; el.innerHTML = ""; document.body.classList.remove("no-scroll"); return; }
  const gain = calcFor(card, pool, t.month).by[t.id] || 0;
  const b = card.benefits[t.benefitIdx], eb = t.extraIdx != null ? card.benefits[t.extraIdx] : null;
  const listPrice = b && b.ticket != null ? (t.list ?? b.list) : null;
  const kv = [
    ["카드", card.name],
    ["결제일", t.date ? `${t.date.slice(0, 4)}.${t.date.slice(5, 7)}.${t.date.slice(8, 10)}` : "-"],
    ["결제 금액", `${won(t.amount || 0)}원`],
    ["적용 혜택", b ? b.n : "적용 안 함"],
    ...(eb ? [["추가 혜택", eb.n]] : []),
    ...(listPrice != null ? [["영화 정가", `${won(listPrice)}원`]] : []),
    ...(b?.memo ? [["할인 내용", t.memoText || "-"]] : []),
    ["받은 혜택", `${gain > 0 ? "+" : ""}${won(gain)}원`]
  ];
  const noGain = (b || eb) && !b?.memo && gain === 0 ? '<div class="f-hint" style="margin-top:8px">조건이나 한도 때문에 혜택이 적용되지 않았어요.</div>' : "";
  el.innerHTML = `<div class="modal-back" data-modal-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="결제 내역">
      <div class="sheet-h"><b>${esc(t.place || "사용처 없음")}</b>
        <button class="back" type="button" data-modal-close aria-label="닫기">✕</button></div>
      <dl class="kv">${kv.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      ${noGain}
      ${mo.del
        ? `<p class="f-hint" style="margin-top:16px;text-align:center">이 결제 내역을 삭제할까요? 되돌릴 수 없어요.</p>
           <div class="sheet-actions"><button class="btn-o" type="button" data-tx-del-no>취소</button><button class="btn danger" type="button" data-tx-del-yes>삭제</button></div>`
        : `<div class="sheet-actions"><button class="btn-o danger" type="button" data-tx-del>삭제</button><button class="btn" type="button" data-tx-edit>수정</button></div>`}
    </div>`;
  el.hidden = false; document.body.classList.add("no-scroll");
}
function deleteTx(id) {
  if (!id || needSync()) return;
  deleteDoc(doc(db, "users", state.user.uid, "transactions", id)).catch(err => toast("삭제 실패: " + err.code));
  closeModal(); toast("삭제했어요");
}

/* ---------- 사용 내역 추가 ---------- */
// state.form: { cardId, place, amount(숫자 문자열), date, benefitOn, benefitIdx, list(영화 정가), extra, area }
const today = () => { const d = new Date(); return monthKey(d) + "-" + String(d.getDate()).padStart(2, "0"); };
const cardById = id => state.cards.find(c => c.id === id);
// 기본 혜택 선택 목록: 자동 적용(all)·추가 혜택(addon, card.extra)은 제외
const mainBenefits = card => {
  const ex = new Set((card.extra?.options || []).map(o => o.idx));
  return card.benefits.map((b, i) => ({ b, i })).filter(({ b, i }) => !b.all && !b.addon && !ex.has(i));
};
const syncList = (f, card) => { const b = card.benefits[f.benefitIdx]; f.list = b && b.ticket != null ? String(b.list ?? "") : ""; };
function newForm(cardId) {
  const card = cardById(cardId) || state.cards[0];
  const f = { cardId: card.id, place: "", amount: "", date: today(), benefitOn: mainBenefits(card).length > 0, benefitIdx: mainBenefits(card)[0]?.i ?? -1, list: "", memoAmt: "", memoText: "", extra: false, area: 0 };
  syncList(f, card);
  return f;
}
// 기존 결제 내역을 폼에 채워서 수정 모드로 연다
function openEdit(id) {
  const t = allTxs().find(x => x.id === id), card = t && cardById(t.cardId);
  if (!card) return;
  const mains = mainBenefits(card), isMain = mains.some(m => m.i === t.benefitIdx);
  const f = newForm(card.id);
  Object.assign(f, { editId: id, place: t.place || "", amount: String(t.amount || ""), date: t.date || today(),
    benefitOn: isMain, benefitIdx: isMain ? t.benefitIdx : (mains[0]?.i ?? -1), extra: t.extraIdx != null, area: 0,
    memoAmt: t.memoAmt != null ? String(t.memoAmt) : "", memoText: t.memoText || "" });
  if (t.extraIdx != null && card.extra) f.area = Math.max(0, card.extra.options.findIndex(o => o.idx === t.extraIdx));
  const b = card.benefits[f.benefitIdx];
  f.list = isMain && b && b.ticket != null ? String(t.list ?? b.list ?? "") : "";
  const fromModal = !!history.state?.modal;
  state.modal = null; renderModal();
  state.form = f;
  const fs = { detail: state.detail, cardView: state.cardView, form: true, d: navDepth() + (fromModal ? 0 : 1) };
  if (fromModal) history.replaceState(fs, ""); else history.pushState(fs, "");
  render(); window.scrollTo(0, 0);
}
function openForm(cardId) {
  if (!state.cards?.length) return toast("먼저 카드를 불러와 주세요");
  state.form = newForm(cardId);
  history.pushState({ detail: state.detail, cardView: state.cardView, form: true, d: navDepth() + 1 }, "");
  render(); window.scrollTo(0, 0);
}
// 이 결제에 실제로 붙일 추가 혜택 번호 (없으면 null)
function formExtraIdx(f, card) {
  const ex = card.extra;
  if (!ex || !f.extra) return null;
  const opt = ex.options.length > 1 ? ex.options[f.area] : ex.options[0];
  const b = card.benefits[opt.idx];
  if (b.needs != null && !(f.benefitOn && f.benefitIdx === b.needs)) return null;
  return opt.idx;
}
const formValid = (f, card) => !!card && /^\d+$/.test(f.amount) && +f.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && (!f.benefitOn || f.benefitIdx >= 0);
const updateSave = () => { const f = state.form, b = $("f-save"); if (f && b) b.disabled = !formValid(f, cardById(f.cardId)); };

function renderForm() {
  const f = state.form, card = cardById(f.cardId) || state.cards[0];
  const ae = document.activeElement, aid = ae && ae.id, pos = ae && ae.selectionStart;
  const sel = card.benefits[f.benefitIdx];

  const benefitBlock = f.benefitOn ? `<div class="f-sub">
      <label class="f-label" for="f-benefit">혜택 선택</label>
      <select id="f-benefit" class="f-in" data-f="benefitIdx">${mainBenefits(card).map(({ b, i }) =>
        `<option value="${i}" ${i === f.benefitIdx ? "selected" : ""}>${esc(b.n)}</option>`).join("")}</select>
      ${sel ? `<div class="f-hint">${esc(benefitDesc(sel))}</div>` : ""}
      ${sel && sel.ticket != null ? `<label class="f-label" for="f-list">영화 정가 (원)</label>
        <input id="f-list" class="f-in" data-f="list" inputmode="numeric" value="${f.list ? won(+f.list) : ""}" autocomplete="off">
        <div class="f-hint">${won(sel.ticket)}원에 결제한 티켓의 원래 가격이에요. 정가와의 차액이 혜택이 돼요.</div>` : ""}
      ${sel && sel.memo ? `<label class="f-label" for="f-memo-amt">할인 금액 (원)</label>
        <input id="f-memo-amt" class="f-in" data-f="memoAmt" inputmode="numeric" placeholder="0" value="${f.memoAmt ? won(+f.memoAmt) : ""}" autocomplete="off">
        <label class="f-label" for="f-memo-text">할인 내용 (메모)</label>
        <input id="f-memo-text" class="f-in" data-f="memoText" type="text" maxlength="100" placeholder="어떤 내용으로 할인받았는지 적어두세요" value="${esc(f.memoText)}" autocomplete="off">
        <div class="f-hint">자동 계산 없이 입력한 금액이 그대로 받은 혜택에 더해져요.</div>` : ""}
    </div>` : "";

  let extraBlock = "";
  const ex = card.extra;
  if (ex) {
    const multi = ex.options.length > 1, opt = ex.options[multi ? f.area : 0], eb = card.benefits[opt.idx];
    const ok = eb.needs == null || (f.benefitOn && f.benefitIdx === eb.needs);
    const on = f.extra && ok;
    let note = "";
    if (!ok) note = `<div class="f-hint">${esc(card.benefits[eb.needs].n)} 혜택을 선택하면 사용할 수 있어요</div>`;
    else if (on && eb.prevMin != null && /^\d{4}-\d{2}-\d{2}$/.test(f.date)) {
      const pm = shiftMonth(f.date.slice(0, 7), -1);
      if ([monthKey(), prevMonthKey(), shiftMonth(monthKey(), -2)].includes(pm)) {
        const p = spentOf(state.txs, pm, card.id), good = p >= eb.prevMin;
        note = `<div class="f-hint ${good ? "good" : "bad"}">전월(${Number(pm.slice(5))}월) 사용액 ${won(p)}원 · ${good ? "기준 충족" : won(eb.prevMin) + "원 미만이라 추가 혜택이 적용되지 않아요"}</div>`;
      }
    }
    extraBlock = `<div class="f-row"><div><b>${esc(ex.label)}</b><div class="f-hint">${esc(ex.hint)}</div></div>
        <label class="switch"><input type="checkbox" data-f="extra" ${on ? "checked" : ""} ${ok ? "" : "disabled"}><span></span></label></div>
      ${on && multi ? `<select id="f-area" class="f-in" data-f="area" style="margin-top:10px">${ex.options.map((o, k) =>
        `<option value="${k}" ${k === f.area ? "selected" : ""}>${esc(o.label)} 가맹점</option>`).join("")}</select>` : ""}
      ${note}`;
  }

  $("view").innerHTML = `<div class="form">
    <div class="d-head">
      <button class="back" type="button" data-back aria-label="뒤로">‹</button>
      <h2>${f.editId ? "사용 내역 수정" : "사용 내역 추가"}</h2>
    </div>
    <div class="box f-box">
      <label class="f-label" for="f-card">카드 선택</label>
      <select id="f-card" class="f-in" data-f="cardId">${state.cards.map(c =>
        `<option value="${esc(c.id)}" ${c.id === card.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>

      <label class="f-label" for="f-place">사용처</label>
      <input id="f-place" class="f-in" data-f="place" type="text" maxlength="40" placeholder="예: CGV, 배달의민족, 쿠팡 등" value="${esc(f.place)}" autocomplete="off">

      <label class="f-label" for="f-amount">결제 금액</label>
      <div class="f-money"><input id="f-amount" class="f-in" data-f="amount" inputmode="numeric" placeholder="0" value="${f.amount ? won(+f.amount) : ""}" autocomplete="off"><span>원</span></div>

      <label class="f-label" for="f-date">결제일</label>
      <input id="f-date" class="f-in" data-f="date" type="date" value="${esc(f.date)}">

      <div class="f-row"><b>혜택 적용 여부</b>
        <label class="switch"><input type="checkbox" data-f="benefitOn" ${f.benefitOn ? "checked" : ""} ${mainBenefits(card).length ? "" : "disabled"}><span></span></label></div>
      ${benefitBlock}
      ${extraBlock}
    </div>
    <button id="f-save" class="btn f-save" type="button" data-save ${formValid(f, card) ? "" : "disabled"}>${f.editId ? "수정 저장" : "저장하기"}</button>
  </div>`;

  if (aid) { const el = $(aid); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* select/date 등은 무시 */ } } }
}

// 글자 입력: 화면을 다시 그리지 않고 값만 저장 (포커스 유지)
document.addEventListener("input", e => {
  const el = e.target.closest?.("[data-f]");
  if (!el || !state.form) return;
  const f = state.form, k = el.dataset.f;
  if (k === "place") f.place = el.value;
  else if (k === "amount") { f.amount = el.value.replace(/\D/g, "").slice(0, 10); el.value = f.amount ? won(+f.amount) : ""; }
  else if (k === "list") { f.list = el.value.replace(/\D/g, "").slice(0, 7); el.value = f.list ? won(+f.list) : ""; }
  else if (k === "memoAmt") { f.memoAmt = el.value.replace(/\D/g, "").slice(0, 9); el.value = f.memoAmt ? won(+f.memoAmt) : ""; }
  else if (k === "memoText") f.memoText = el.value;
  else return;
  updateSave();
});
// 선택/토글: 구조가 바뀌므로 다시 그림
document.addEventListener("change", e => {
  const el = e.target.closest?.("[data-f]");
  if (!el || !state.form) return;
  const f = state.form, k = el.dataset.f, card = cardById(f.cardId);
  if (k === "cardId") { const c = cardById(el.value); Object.assign(f, { cardId: c.id, benefitIdx: mainBenefits(c)[0]?.i ?? -1, extra: false, area: 0, memoAmt: "", memoText: "" }); syncList(f, c); if (!mainBenefits(c).length) f.benefitOn = false; }
  else if (k === "date") f.date = el.value;
  else if (k === "benefitOn") { f.benefitOn = el.checked; if (el.checked && !f.list) syncList(f, card); }
  else if (k === "benefitIdx") { f.benefitIdx = +el.value; syncList(f, card); }
  else if (k === "extra") f.extra = el.checked;
  else if (k === "area") f.area = +el.value;
  else return;
  renderForm();
});

function saveForm() {
  const f = state.form, card = f && cardById(f.cardId);
  if (!card || !formValid(f, card) || f.saving || needSync()) return;
  f.saving = true; // 연타해도 한 번만 저장/뒤로가기
  const tx = { cardId: card.id, month: f.date.slice(0, 7), date: f.date, place: f.place.trim(), amount: +f.amount,
    benefitIdx: f.benefitOn ? f.benefitIdx : -1, createdAt: serverTimestamp() };
  const ei = formExtraIdx(f, card);
  if (ei != null) tx.extraIdx = ei;
  const b = card.benefits[f.benefitIdx];
  if (f.benefitOn && b && b.ticket != null && f.list) tx.list = +f.list;
  if (f.benefitOn && b && b.memo) { if (f.memoAmt) tx.memoAmt = +f.memoAmt; if (f.memoText.trim()) tx.memoText = f.memoText.trim(); } // 기록용 혜택의 금액·메모
  // 오프라인에서도 막히지 않도록 저장 완료를 기다리지 않음 (로컬 캐시에 먼저 반영됨)
  if (f.editId) {
    const { createdAt, ...patch } = tx;
    patch.extraIdx = ei != null ? ei : deleteField();
    patch.list = tx.list != null ? tx.list : deleteField();
    patch.memoAmt = tx.memoAmt != null ? tx.memoAmt : deleteField();
    patch.memoText = tx.memoText != null ? tx.memoText : deleteField();
    updateDoc(doc(db, "users", state.user.uid, "transactions", f.editId), patch).catch(err => toast("수정 실패: " + err.code));
    toast("수정했어요");
  } else {
    addDoc(collection(db, "users", state.user.uid, "transactions"), tx).catch(err => toast("저장 실패: " + err.code));
    toast("사용 내역을 저장했어요");
  }
  history.back();
}

/* ---------- 카드 추가 ---------- */
// state.cform: { name, short, type, color, target, poolOn, poolMax, benefits: [혜택 초안] }  (숫자는 모두 문자열)
// 초안 → 카드 규칙 변환·검증·미리 계산은 data.js (draftToCard, cardDraftIssues, previewBenefit)
const CF_COLORS = ["#3b6df0", "#14b8a6", "#22c55e", "#eab308", "#f59e0b", "#ec5b7a", "#8b5cf6", "#64748b"];
const CF_KINDS = [
  ["fixed", "정액 할인·캐시백", "예: 1만원 이상 결제 시 3천원"],
  ["rate", "% 할인·캐시백", "예: 20% (1회 최대 1천원)"],
  ["auto", "모든 결제 자동 할인", "예: 결제할 때마다 0.7%"],
  ["ticket", "정가 차액형", "예: 6천원에 영화 관람"]];
const CF_PERIODS = [[1, "매월"], [3, "분기마다 (1~3월, 4~6월…)"], [6, "반기마다 (1~6월, 7~12월)"], [12, "매년 (1~12월)"]];
const CF_NUM_KEYS = ["fixed", "rate", "per", "ticket", "list", "min", "lt", "max", "slots", "prevMin", "sumMin", "test"];
const newBenefit = () => ({ kind: "fixed", n: "", fixed: "", rate: "", per: "", ticket: "", list: "", min: "", lt: "", max: "", slots: "1",
  unlimited: false, period: 1, daily: false, prevMin: "", sumMin: "", pool: true, s: "", test: "", open: true, adv: false });
const newCardForm = () => ({ name: "", short: "", type: "신용", color: CF_COLORS[state.cards.length % CF_COLORS.length],
  target: "", poolOn: false, poolMax: "", benefits: [newBenefit()], img: "", imgEl: null, imgRot: 0 });

// 이미지가 없는 카드(직접 추가한 카드)용 카드 그림
const cardFace = c => c.img ? `<img class="card-img" src="${esc(c.img)}" alt="">` : `<div class="card-face" style="--c:${esc(c.color)}"><div class="cface-chip"></div>
  <div class="cface-name">${esc(c.name || "카드 이름")}</div><div class="cface-type">${esc(c.type)}카드</div></div>`;

// ---- 카드 이미지: 브라우저에서 가로 카드 비율(640×404)로 가운데를 잘라 줄인 뒤 카드 정보에 문자열로 저장한다 (Firebase Storage 불필요)
const loadImg = file => new Promise((res, rej) => {
  const im = new Image(), url = URL.createObjectURL(file);
  im.onload = () => { URL.revokeObjectURL(url); res(im); };
  im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
  im.src = url;
});
// rot: 시계방향 90도 횟수 (0~3). 가득 채우도록(cover) 자른다
function renderCardImg(im, rot, w = 640, h = 404) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d"), sw = im.naturalWidth, sh = im.naturalHeight, quarter = rot % 2 === 1;
  const s = Math.max(w / (quarter ? sh : sw), h / (quarter ? sw : sh));
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2); ctx.rotate(rot * Math.PI / 2); ctx.scale(s, s); ctx.drawImage(im, -sw / 2, -sh / 2);
  let q = 0.86, out = cv.toDataURL("image/jpeg", q);
  while (out.length > 220000 && q > 0.5) { q -= 0.1; out = cv.toDataURL("image/jpeg", q); } // 문서 크기 제한(1MB)을 넘지 않게
  return out;
}
const autoRot = im => im.naturalHeight > im.naturalWidth ? 3 : 0; // 세로 사진은 반시계 방향으로 눕힘
async function cfSetImage(file) {
  const f = state.cform; if (!f) return;
  try {
    const im = await loadImg(file);
    f.imgEl = im; f.imgRot = autoRot(im); f.img = renderCardImg(im, f.imgRot);
    renderCardForm();
  } catch { toast("이미지를 불러오지 못했어요"); }
}
// 직접 추가한 카드의 이미지 변경/삭제 (카드 상세 화면)
const isCustomCard = c => !CARD_SEED.some(sd => sd.id === c.id);
function customCardImgRow(card) {
  if (!isCustomCard(card)) return "";
  return `<div class="img-row"><label class="img-btn">${card.img ? "이미지 변경" : "카드 이미지 추가"}<input type="file" accept="image/*" data-card-file="${esc(card.id)}" hidden></label>
    ${card.img ? `<button type="button" class="img-btn del" data-card-imgdel="${esc(card.id)}">이미지 삭제</button>` : ""}</div>`;
}
async function changeCardImg(id, file) {
  if (needSync()) return;
  try {
    const im = await loadImg(file), img = renderCardImg(im, autoRot(im));
    updateDoc(doc(db, "users", state.user.uid, "cards", id), { img }).catch(err => toast("저장 실패: " + err.code));
    toast("카드 이미지를 바꿨어요");
  } catch { toast("이미지를 불러오지 못했어요"); }
}

function openCardForm() {
  if (!state.cards) return;
  state.cform = newCardForm();
  history.pushState({ cform: true, d: navDepth() + 1 }, "");
  render(); window.scrollTo(0, 0);
}

function cfBenefit(f, d, i) {
  const p = `cb${i}`, k = d.kind, u = PERIOD_UNIT[d.period] || "월";
  const shown = (key, v) => key === "rate" || key === "slots" ? v : (v ? won(+v) : "");
  const money = (key, label, ph, hint = "", unit = "원") => `<label class="f-label" for="${p}-${key}">${label}</label>
    <div class="f-money"><input id="${p}-${key}" class="f-in" data-cb="${i}:${key}" inputmode="${key === "rate" ? "decimal" : "numeric"}" placeholder="${ph}" value="${esc(shown(key, d[key]))}" autocomplete="off"><span>${unit}</span></div>
    ${hint ? `<div class="f-hint">${hint}</div>` : ""}`;
  const sw = (key, label, hint, on, dis = false) => `<div class="f-row"><div><b>${label}</b>${hint ? `<div class="f-hint">${hint}</div>` : ""}</div>
    <label class="switch"><input type="checkbox" data-cb="${i}:${key}" ${on ? "checked" : ""} ${dis ? "disabled" : ""}><span></span></label></div>`;

  const kinds = CF_KINDS.map(([id, t, ex]) => `<button type="button" class="kind ${k === id ? "on" : ""}" data-cb-kind="${i}:${id}"><b>${t}</b><span>${ex}</span></button>`).join("");
  const amount = k === "fixed" ? money("fixed", "혜택 금액", "3,000", "조건을 채울 때마다 받는 할인·캐시백 금액")
    : k === "rate" ? money("rate", "혜택률", "5", "", "%") + money("per", "1회 최대 혜택 (선택)", "1,000", "결제 한 건당 받을 수 있는 최대 금액")
    : k === "auto" ? money("rate", "혜택률", "0.7", "소수점 둘째 자리까지 입력할 수 있어요", "%")
    : money("ticket", "실제 결제 금액", "6,000", "예: 6천원에 영화를 볼 수 있다면 6,000") + money("list", "기본 정가 (선택)", "16,000", "비워두면 결제할 때마다 정가를 입력해요. 정가와의 차액이 혜택이에요.");
  const cond = k === "auto"
    ? money("min", "결제금액 조건: 이상 (선택)", "100,000", "한 번에 이 금액 이상 결제할 때만 적용") + money("lt", "결제금액 조건: 미만 (선택)", "100,000", "한 번에 이 금액 미만 결제할 때만 적용")
    : k === "ticket" ? "" : money("min", "최소 결제금액 (선택)", "10,000", "이 금액 이상 결제해야 혜택이 적용돼요");
  const limits = k === "auto" ? "" : `
    <label class="f-label" for="${p}-period">한도·횟수를 세는 기간</label>
    <select id="${p}-period" class="f-in" data-cb="${i}:period">${CF_PERIODS.map(([v, t]) => `<option value="${v}" ${v === d.period ? "selected" : ""}>${t}</option>`).join("")}</select>
    ${d.unlimited ? "" : money("slots", `${u} 사용 가능 횟수`, "1", "", "회")}
    ${sw("unlimited", "횟수 제한 없음", "", d.unlimited)}
    ${money("max", `${u} 최대 혜택 한도 (선택)`, "5,000", "이 혜택으로 받을 수 있는 합계 상한")}
    ${sw("daily", "하루 1회만 적용", "같은 날 두 번째 결제부터는 혜택이 없어요", d.daily)}
    ${f.poolOn ? sw("pool", "통합 월 한도에 포함", d.period > 1 ? "기간 혜택은 통합 월 한도에서 제외돼요" : "", d.pool && d.period === 1, d.period > 1) : ""}`;
  const adv = !d.adv ? "" : `<div class="f-sub">
      ${k === "auto" ? "" : money("prevMin", "전월 사용액 조건 (선택)", "300,000", "전월 사용액이 이 금액 이상일 때만 적용")}
      ${k === "fixed" || k === "rate" ? money("sumMin", `${u} 이용금액 합산 조건 (선택)`, "50,000", "이 혜택으로 고른 결제금액의 합이 이 금액 이상이 되면 적용 (대중교통처럼)") : ""}
      <label class="f-label" for="${p}-s">설명 (선택)</label>
      <input id="${p}-s" class="f-in" data-cb="${i}:s" maxlength="80" value="${esc(d.s)}" placeholder="비워두면 입력한 조건으로 자동 생성" autocomplete="off"></div>`;
  const pv = `<div class="cb-pv"><label class="f-label" for="${p}-test">${k === "ticket" ? "정가로 미리 계산" : "결제 금액으로 미리 계산"}</label>
      <div class="f-money"><input id="${p}-test" class="f-in" data-cb="${i}:test" inputmode="numeric" placeholder="${k === "ticket" ? "16,000" : "20,000"}" value="${esc(shown("test", d.test))}" autocomplete="off"><span>원</span></div>
      <div id="${p}-pv" class="pv-res">${esc(previewBenefit(f, i))}</div></div>`;

  const ok = !benefitIssues(d).length;
  const sub = d.open ? CF_KINDS.find(x => x[0] === k)[1] : (ok ? benefitDesc(draftToBenefit(d, f)) : "입력 중");
  return `<article class="box cb" id="cbk-${i}">
    <button type="button" class="cb-head" data-cb-toggle="${i}" aria-expanded="${d.open}">
      <span class="cb-num">${i + 1}</span>
      <span class="cb-t"><b>${esc(d.n.trim() || "새 혜택")}</b><span class="f-hint" style="display:block">${esc(sub)}</span></span>
      <span class="chev" aria-hidden="true">${d.open ? "⌃" : "⌄"}</span></button>
    ${d.open ? `<div class="cb-body">
      <div class="kinds">${kinds}</div>
      <label class="f-label" for="${p}-n">혜택 이름</label>
      <input id="${p}-n" class="f-in" data-cb="${i}:n" maxlength="60" placeholder="예: CU·GS25 20% 캐시백" value="${esc(d.n)}" autocomplete="off">
      ${amount}${cond}${limits}
      <button type="button" class="cb-link" data-cb-adv="${i}">${d.adv ? "고급 조건 접기" : "고급 조건 더 보기 (전월 사용액·합산 조건·설명)"}</button>
      ${adv}${pv}
      <button type="button" class="cb-del" data-cb-del="${i}">이 혜택 삭제</button>
      ${d.idx != null ? '<div class="f-hint">저장된 혜택이에요. 삭제하면 이 혜택으로 기록한 사용 내역은 ‘혜택 없음’으로 바뀌어요.</div>' : ""}
    </div>` : ""}</article>`;
}

function renderCardForm() {
  const f = state.cform;
  const ae = document.activeElement, aid = ae && ae.id, pos = ae && ae.selectionStart;
  const card = { name: f.name.trim(), type: f.type, color: f.color, img: f.img };
  $("view").innerHTML = `<div class="form cform">
    <div class="d-head"><button class="back" type="button" data-back aria-label="뒤로">‹</button><h2>${f.editId ? "카드 수정" : "카드 추가"}</h2></div>
    <div id="cf-face">${cardFace(card)}</div>
    <div class="img-row"><label class="img-btn">${f.img ? "이미지 변경" : "카드 이미지 추가"}<input type="file" accept="image/*" data-cf-file hidden></label>
      ${f.img ? `${f.imgEl ? `<button type="button" class="img-btn" data-cf-rot>회전</button>` : ""}<button type="button" class="img-btn del" data-cf-imgdel>삭제</button>` : ""}</div>
    <div class="f-hint" style="text-align:center">가로 카드 비율로 가운데를 잘라서 써요. 세로 카드는 자동으로 눕혀요. (선택)</div>
    <div class="box f-box" style="margin-top:16px">
      <label class="f-label" for="cf-name">카드 이름</label>
      <input id="cf-name" class="f-in" data-cf="name" maxlength="30" placeholder="예: 현대카드 ZERO" value="${esc(f.name)}" autocomplete="off">
      <label class="f-label" for="cf-short">짧은 이름 (선택)</label>
      <input id="cf-short" class="f-in" data-cf="short" maxlength="8" placeholder="예: 현대" value="${esc(f.short)}" autocomplete="off">
      <div class="f-hint">월별 기록처럼 좁은 곳에 쓰여요. 비워두면 카드 이름을 써요.</div>
      <label class="f-label">카드 종류</label>
      <div class="seg">${["신용", "체크"].map(t => `<button type="button" class="${f.type === t ? "on" : ""}" data-cf-type="${t}">${t}카드</button>`).join("")}</div>
      <label class="f-label" for="cf-target">전월 실적 (원)</label>
      <div class="f-money"><input id="cf-target" class="f-in" data-cf="target" inputmode="numeric" placeholder="300,000" value="${f.target ? won(+f.target) : ""}" autocomplete="off"><span>원</span></div>
      <div class="f-hint">혜택을 받으려면 전월에 이만큼 써야 하는 금액이에요.</div>
      <label class="f-label">카드 색상</label>
      <div class="swatches">${CF_COLORS.map(c => `<button type="button" class="sw ${f.color === c ? "on" : ""}" style="--c:${c}" data-cf-color="${c}" aria-label="색상 ${c}"></button>`).join("")}</div>
      <div class="f-row"><div><b>통합 월 할인한도</b><div class="f-hint">카드 전체 혜택을 합쳐서 월 한도가 있을 때 켜세요</div></div>
        <label class="switch"><input type="checkbox" data-cf="poolOn" ${f.poolOn ? "checked" : ""}><span></span></label></div>
      ${f.poolOn ? `<div class="f-money" style="margin-top:10px"><input id="cf-poolMax" class="f-in" data-cf="poolMax" inputmode="numeric" placeholder="20,000" value="${f.poolMax ? won(+f.poolMax) : ""}" autocomplete="off"><span>원</span></div>` : ""}
    </div>
    <h2 class="sec">혜택</h2>
    <section class="cb-list">${f.benefits.map((d, i) => cfBenefit(f, d, i)).join("")}</section>
    <button class="add-card" type="button" data-cb-add>+ 혜택 추가하기</button>
    <div id="cf-issue" class="f-hint bad" style="margin-top:14px"></div>
    <button id="cf-save" class="btn f-save" type="button" data-cf-save disabled>${f.editId ? "수정 저장" : "카드 저장"}</button>
  </div>`;
  cfRefresh();
  if (f.focus) { $(f.focus)?.focus(); f.focus = null; }
  else if (aid) { const el = $(aid); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* select 등은 무시 */ } } }
}

// 화면을 다시 그리지 않고 저장 버튼·안내·카드 그림·미리 계산만 갱신 (입력 중 포커스 유지)
function cfRefresh() {
  const f = state.cform; if (!f) return;
  const iss = cardDraftIssues(f), btn = $("cf-save"), hint = $("cf-issue"), face = $("cf-face");
  if (btn) { btn.disabled = iss.length > 0 || !!f.saving; btn.textContent = f.saving ? "저장 중…" : f.editId ? "수정 저장" : "카드 저장"; }
  if (hint) hint.textContent = iss.length ? "저장하려면 · " + iss[0] : "";
  const fk = [f.name.trim(), f.type, f.color, f.img.length].join("|");
  if (face && f.faceKey !== fk) { face.innerHTML = cardFace({ name: f.name.trim(), type: f.type, color: f.color, img: f.img }); f.faceKey = fk; }
  f.benefits.forEach((d, i) => { const el = $(`cb${i}-pv`); if (el) el.textContent = previewBenefit(f, i); });
}

// 카드 수정 저장. 혜택이 지워지거나 번호가 바뀌면, 그 카드의 사용 내역이 기억하는 혜택 번호도 같이 고친다.
async function saveCardEdit(f) {
  const old = cardById(f.editId), card = draftToCard(f);
  const patch = { name: card.name, type: card.type, color: card.color, target: card.target, benefits: card.benefits,
    short: card.short ?? deleteField(), img: card.img ?? deleteField(), pools: card.pools ?? deleteField() };
  const ref = doc(db, "users", state.user.uid, "cards", f.editId);
  const map = {}; let remap = false;                       // 저장돼 있던 번호 → 새 번호
  f.benefits.forEach((d, ni) => { if (d.idx != null) { map[d.idx] = ni; if (d.idx !== ni) remap = true; } });
  if (old.benefits.some((_, i) => !(i in map))) remap = true;
  if (!remap) { updateDoc(ref, patch).catch(err => toast("저장 실패: " + err.code)); toast("카드를 수정했어요"); history.back(); return; }
  cfRefresh();
  try {
    const snap = await getDocs(query(collection(db, "users", state.user.uid, "transactions"), where("cardId", "==", f.editId)));
    const ops = [];
    snap.forEach(sn => {
      const t = sn.data(), upd = {};
      const nb = typeof t.benefitIdx === "number" && t.benefitIdx >= 0 ? (map[t.benefitIdx] ?? -1) : -1;
      if (nb !== t.benefitIdx) upd.benefitIdx = nb;
      if (t.extraIdx != null) { const ne = map[t.extraIdx]; if (ne !== t.extraIdx) upd.extraIdx = ne == null ? deleteField() : ne; }
      if (Object.keys(upd).length) ops.push([sn.ref, upd]);
    });
    for (let i = 0; i < ops.length || i === 0; i += 400) {   // 마지막 묶음에 카드 수정을 같이 넣어 한꺼번에 반영
      const b = writeBatch(db), part = ops.slice(i, i + 400);
      part.forEach(([r, u]) => b.update(r, u));
      if (i + 400 >= ops.length) b.update(ref, patch);
      await b.commit();
    }
    toast(ops.length ? `카드를 수정했어요 (사용 내역 ${ops.length}건 정리)` : "카드를 수정했어요");
    history.back();
  } catch (err) { f.saving = false; cfRefresh(); toast("저장 실패: " + (err.code || "연결을 확인하세요")); }
}

function openCardEdit(id) {
  const card = cardById(id);
  if (!card || !isCustomCard(card)) return;
  state.cform = cardToDraft(card);
  history.pushState({ cform: true, d: navDepth() + 1 }, "");
  render(); window.scrollTo(0, 0);
}

/* 카드 삭제: 이 카드의 사용 내역까지 함께 지운다 */
const cardTxQuery = id => query(collection(db, "users", state.user.uid, "transactions"), where("cardId", "==", id));
function openDelCard(id) {
  if (!cardById(id) || needSync()) return;
  state.delCard = { id, n: null, busy: false };
  renderDelCard();
  getDocs(cardTxQuery(id)).then(snap => { if (state.delCard?.id === id) { state.delCard.n = snap.size; renderDelCard(); } })
    .catch(() => { if (state.delCard?.id === id) { state.delCard.n = -1; renderDelCard(); } });
}
function renderDelCard() {
  const el = $("dialog"), dc = state.delCard, card = dc && cardById(dc.id);
  if (!card) { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("no-scroll"); return; }
  const msg = dc.n == null ? "사용 내역을 확인하고 있어요…" : dc.n < 0 ? "사용 내역 수를 확인하지 못했어요. 이 카드의 사용 내역도 모두 삭제돼요."
    : dc.n === 0 ? "이 카드에는 사용 내역이 없어요." : `이 카드의 사용 내역 ${dc.n}건도 함께 삭제돼요.`;
  el.innerHTML = `<div class="modal-back" data-dialog-close></div>
    <div class="sheet" role="alertdialog" aria-modal="true" aria-label="카드 삭제">
      <div class="sheet-h"><b>‘${esc(card.name)}’ 삭제</b><button class="back" type="button" data-dialog-close aria-label="닫기">✕</button></div>
      <p class="f-hint" style="margin-top:8px;font-size:14px;line-height:1.6">${msg}<br>삭제하면 되돌릴 수 없어요.</p>
      <div class="sheet-actions"><button class="btn-o" type="button" data-dialog-close ${dc.busy ? "disabled" : ""}>취소</button>
        <button class="btn danger" type="button" data-del-yes ${dc.busy || dc.n == null ? "disabled" : ""}>${dc.busy ? "삭제 중…" : "삭제"}</button></div>
    </div>`;
  el.hidden = false; document.body.classList.add("no-scroll");
}
function closeDelCard() { if (state.delCard?.busy) return; state.delCard = null; renderDelCard(); }
async function confirmDelCard() {
  const dc = state.delCard;
  if (!dc || dc.busy) return;
  dc.busy = true; renderDelCard();
  try {
    const snap = await getDocs(cardTxQuery(dc.id)), refs = snap.docs.map(d => d.ref);
    for (let i = 0; i < refs.length; i += 450) { const b = writeBatch(db); refs.slice(i, i + 450).forEach(r => b.delete(r)); await b.commit(); } // 내역 먼저
    await deleteDoc(doc(db, "users", state.user.uid, "cards", dc.id));                                                                       // 카드는 마지막에
    state.delCard = null; renderDelCard();
    toast("카드를 삭제했어요");
    if (history.state?.detail === dc.id || history.state?.cardView === dc.id) history.back(); else render();
  } catch (err) { dc.busy = false; renderDelCard(); toast("삭제 실패: " + (err.code || "연결을 확인하세요")); }
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && state.delCard) closeDelCard(); });

function saveCardForm() {
  const f = state.cform;
  if (!f || f.saving || cardDraftIssues(f).length || needSync()) return;
  f.saving = true; // 연타해도 한 번만 저장/뒤로가기
  if (f.editId) return saveCardEdit(f);
  const card = draftToCard(f);
  card.order = state.cards.reduce((m, c) => Math.max(m, c.order ?? 0), -1) + 1;
  addDoc(collection(db, "users", state.user.uid, "cards"), card).catch(err => toast("저장 실패: " + err.code));
  toast("카드를 추가했어요");
  history.back();
}

// 글자 입력: 값만 저장하고 필요한 부분만 갱신
document.addEventListener("input", e => {
  const f = state.cform, el = f && e.target.closest?.("[data-cf],[data-cb]");
  if (!el) return;
  const TEXT = ["name", "short", "n", "s"];
  const clean = (k, v) => k === "rate" ? v.replace(/[^\d.]/g, "").replace(/^(\d*\.?\d{0,2}).*$/, "$1").slice(0, 6)
    : v.replace(/\D/g, "").slice(0, k === "slots" ? 3 : 10);
  const fmt = (k, v) => k === "rate" || k === "slots" ? v : (v ? won(+v) : "");
  if (el.dataset.cf) {
    const k = el.dataset.cf;
    if (TEXT.includes(k)) f[k] = el.value;
    else if (k === "target" || k === "poolMax") { f[k] = clean(k, el.value); el.value = fmt(k, f[k]); }
    else return;
  } else {
    const [i, k] = el.dataset.cb.split(":"), d = f.benefits[+i];
    if (!d) return;
    if (TEXT.includes(k)) d[k] = el.value;
    else if (CF_NUM_KEYS.includes(k)) { d[k] = clean(k, el.value); el.value = fmt(k, d[k]); }
    else return;
  }
  cfRefresh();
});
// 선택/토글: 구조가 바뀌므로 다시 그림
document.addEventListener("change", e => {
  const t = e.target;
  if (t.matches?.("[data-cf-file],[data-card-file]")) {          // 이미지 파일 선택
    const file = t.files?.[0], cardId = t.dataset.cardFile;
    t.value = "";
    if (file) { if (cardId) changeCardImg(cardId, file); else cfSetImage(file); }
    return;
  }
  const f = state.cform, el = f && t.closest?.("[data-cf],[data-cb]");
  if (!el) return;
  if (el.dataset.cf) { if (el.dataset.cf === "poolOn") f.poolOn = el.checked; else return; }
  else {
    const [i, k] = el.dataset.cb.split(":"), d = f.benefits[+i];
    if (!d) return;
    if (k === "period") { d.period = +el.value; if (d.period > 1) d.pool = false; }
    else if (["unlimited", "daily", "pool"].includes(k)) d[k] = el.checked;
    else return;
  }
  renderCardForm();
});
document.addEventListener("click", e => {
  if (e.target.closest("[data-cf-new]")) return openCardForm();
  const ce = e.target.closest("[data-card-edit]"), cdl = e.target.closest("[data-card-del]");
  if (ce) return openCardEdit(ce.dataset.cardEdit);
  if (cdl) return openDelCard(cdl.dataset.cardDel);
  if (e.target.closest("[data-del-yes]")) return confirmDelCard();
  if (e.target.closest("[data-dialog-close]")) return closeDelCard();
  const di = e.target.closest("[data-card-imgdel]");
  if (di) { if (needSync()) return; updateDoc(doc(db, "users", state.user.uid, "cards", di.dataset.cardImgdel), { img: deleteField() }).catch(err => toast("삭제 실패: " + err.code)); toast("카드 이미지를 지웠어요"); return; }
  const f = state.cform, t = f && e.target.closest("[data-cf-type],[data-cf-color],[data-cb-kind],[data-cb-toggle],[data-cb-adv],[data-cb-add],[data-cb-del],[data-cf-save],[data-cf-rot],[data-cf-imgdel]");
  if (!t) return;
  const d = t.dataset;
  if (d.cfSave != null) return saveCardForm();
  if (d.cfRot != null) { f.imgRot = (f.imgRot + 1) % 4; f.img = renderCardImg(f.imgEl, f.imgRot); }
  else if (d.cfImgdel != null) { f.img = ""; f.imgEl = null; f.imgRot = 0; }
  else if (d.cfType) f.type = d.cfType;
  else if (d.cfColor) f.color = d.cfColor;
  else if (d.cbKind) { const [i, k] = d.cbKind.split(":"); f.benefits[+i].kind = k; }
  else if (d.cbToggle != null) f.benefits[+d.cbToggle].open = !f.benefits[+d.cbToggle].open;
  else if (d.cbAdv != null) f.benefits[+d.cbAdv].adv = !f.benefits[+d.cbAdv].adv;
  else if (d.cbAdd != null) { f.benefits.push(newBenefit()); f.focus = `cb${f.benefits.length - 1}-n`; }
  else if (d.cbDel != null) f.benefits.splice(+d.cbDel, 1);
  renderCardForm();
});

/* ---------- 카드 상세 ---------- */
function benefitDesc(b) {
  if (b.s) return b.s;
  const u = PERIOD_UNIT[b.period || 1] || "월", p = [];
  const cond = [];
  if (b.min != null) cond.push(`${won(b.min)}원 이상 결제 시`);
  if (b.lt != null) cond.push(`${won(b.lt)}원 미만 결제 시`);
  const what = b.ticket != null ? `${won(b.ticket)}원에 결제 · 정가와의 차액이 혜택`
    : b.fixed != null ? `${won(b.fixed)}원` : `${+(b.rate * 100).toFixed(2)}%`;
  p.push([...cond, what].join(" "));
  if (b.all) p.push("한도 없음 · 자동 적용");
  if (b.prevMin != null) p.push(`전월 ${won(b.prevMin)}원 이상 시`);
  if (b.sumMin != null) p.push(`${u} 이용금액 합산 ${won(b.sumMin)}원 이상 시`);
  if (b.per) p.push(`1회 최대 ${won(b.per)}원`);
  if (b.daily) p.push("하루 1회");
  if (!b.all) {
    if (b.max) p.push(`${u} 최대 ${won(b.max)}원`);
    p.push(b.slots == null ? "횟수 제한 없음" : `${u} ${b.slots}회`);
  }
  return p.join(" · ");
}

/* 통합 월 한도 박스: 한도가 1개면 그대로, 여러 개면 합산해서 한 줄 + 색만 다른 막대 */
function poolBoxes(card, r) {
  const pools = card.pools || [];
  if (!pools.length) return "";
  const rows = pools.map((pl, k) => ({ ...pl, u: r.grp[pl.group] || 0, c: pl.color || (k === 0 ? card.color : "#0ea5e9") }));
  const max = rows.reduce((s, x) => s + x.max, 0), u = rows.reduce((s, x) => s + x.u, 0);
  const title = pools.length > 1 ? (card.poolTitle || "월 혜택 한도") : pools[0].label;
  const note = pools.length > 1
    ? rows.map(x => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${esc(x.c)};margin-right:4px"></i>${esc(x.label)} ${won(x.u)}원</span>`).join(' ')
    : `<span>${esc(pools[0].note || "")}</span>`;
  return `<div class="box" style="margin-top:12px"><div class="bene-top"><b class="bene-name">${esc(title)}</b><b class="bene-amt">${won(u)} / ${won(max)}원</b></div>
    <div class="bar sm" style="display:flex">${rows.map(x => `<i style="width:${Math.min(100, x.u / max * 100)}%;background:${esc(x.c)};border-radius:0"></i>`).join("")}</div>
    <div class="bene-foot"><span style="display:flex;gap:10px;flex-wrap:wrap">${note}</span>${u >= max ? '<span class="chip ok">한도 소진</span>' : `<span>${won(max - u)}원 남음</span>`}</div></div>`;
}

function renderDetail(card) {
  const cur = monthKey();
  const txs = state.txs.filter(t => t.month === cur && t.cardId === card.id);
  const r = calcFor(card, state.txs, cur);
  const need = card.target - r.spent;
  const pct = Math.min(100, r.spent / card.target * 100);
  const recent = [...txs].sort((a, b) => byEntry(b, a));

  $("view").innerHTML = `<div class="detail" style="--c:${esc(card.color)}">
    <div class="d-head">
      <button class="back" type="button" data-back aria-label="뒤로">‹</button>
      <h2>${esc(card.name)}</h2>
      <span class="chip ac">${esc(card.type)}카드</span>
    </div>
    ${imgOf(card) ? `<img class="card-img" src="${esc(imgOf(card))}" width="380" height="240" decoding="async" alt="${esc(card.name)}">` : cardFace(card)}
    ${customCardImgRow(card)}

    <section class="summary" style="margin-top:16px">
      <div class="box"><div class="label">이번 달 사용액</div><div class="stat-v">${won(r.spent)}원</div><div class="label">/ ${won(card.target)}원</div></div>
      <div class="box"><div class="label">남은 실적</div>
        <div class="stat-v" style="color:${need > 0 ? "var(--tx)" : "var(--ok)"}">${need > 0 ? won(need) + "원" : "달성"}</div>
        <div class="label">(달성률 ${Math.round(pct)}%)</div></div>
    </section>
    <div class="bar" style="margin:14px 2px 4px"><i style="width:${pct}%;background:${esc(card.color)}"></i></div>
    <div class="label" style="margin-left:2px">실적 달성률 ${Math.round(pct)}%</div>

    <div class="box row-sum"><b>이번 달 예상 혜택</b><b class="amt">${won(r.sum)}원</b></div>

    ${poolBoxes(card, r)}

    <h2 class="sec">혜택별 한도 및 사용 현황</h2>
    <section class="rows">${card.benefits.map((b, i) => {
      if (b.memo) { // 직접 입력형 혜택: 이번 달 기록 건수와 입력한 할인 합계
        const rec = txs.filter(t => t.benefitIdx === i), recSum = rec.reduce((s, t) => s + (t.memoAmt || 0), 0);
        return `<article class="box bene">
        <div class="bene-ico">✎</div>
        <div class="bene-main">
          <div class="bene-top"><b class="bene-name">${esc(b.n)}</b><b class="bene-amt">${won(recSum)}원</b></div>
          <div class="label">${esc(benefitDesc(b))}</div>
          <div class="bene-foot"><span>이번 달 ${rec.length}건</span><span class="chip ac">직접 입력</span></div>
        </div></article>`;
      }
      const M = benefitMax(b), finite = M !== Infinity;
      const used = r.used[i], earned = r.per[i];
      const p = b.all ? 0 : Math.min(100, finite ? earned / M * 100 : (used / slotCap(b) * 100));
      const full = !b.all && (used >= slotCap(b) || (finite && earned >= M));
      return `<article class="box bene">
        <div class="bene-ico">${b.fixed != null || b.ticket != null ? "₩" : "%"}</div>
        <div class="bene-main">
          <div class="bene-top"><b class="bene-name">${esc(b.n)}</b><b class="bene-amt">${won(earned)}원</b></div>
          <div class="label">${esc(benefitDesc(b))}</div>
          ${b.all ? `<div class="bene-foot"><span class="chip ac">자동 적용</span></div>` : `
          <div class="bar sm"><i style="width:${p}%;background:${esc(card.color)}"></i></div>
          <div class="bene-foot"><span>사용 ${used}회${b.slots == null ? "" : ` / ${b.slots}회`}</span>${full ? '<span class="chip ok">한도 소진</span>' : b.sumMin != null ? `<span>이달 누적 ${won(r.sums[i])} / ${won(b.sumMin)}원</span>` : finite ? `<span>${won(earned)} / ${won(M)}원</span>` : ""}</div>`}
        </div></article>`;
    }).join("")}</section>

    <h2 class="sec">이달의 사용 내역</h2>
    <div class="box">${recent.length ? recent.map(t => {
      const bn = card.benefits[t.benefitIdx]?.n;
      return txRow(t, (t.date || "").slice(5).replace("-", ".") + (bn ? " · " + bn : ""), r.by[t.id] || 0, card);
    }).join("") : '<div class="label" style="text-align:center;padding:8px 0">이번 달 내역이 없어요</div>'}</div>

    <div class="card-actions">${isCustomCard(card) ? `<button class="btn-o" type="button" data-card-edit="${esc(card.id)}">카드 수정</button>` : ""}<button class="btn-o danger" type="button" data-card-del="${esc(card.id)}">카드 삭제</button></div>
    ${isCustomCard(card) ? "" : '<p class="f-hint" style="margin-top:10px;text-align:center">기본 카드의 혜택 규칙은 코드(data.js)에서 관리돼요. 수정은 직접 추가한 카드만 할 수 있어요.</p>'}
  </div>`;
}

start();
