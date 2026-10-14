import {
  configured, auth, db, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut, collection, doc, onSnapshot, query, where, orderBy, writeBatch, addDoc, serverTimestamp, deleteDoc, updateDoc, deleteField
} from "./firebase.js";
import { CARD_SEED, SEED_VERSION, CARD_IMG, calcCard, benefitMax, slotCap, PERIOD_UNIT, monthKey, prevMonthKey, won } from "./data.js";

const $ = id => document.getElementById(id);
// 한 달치 계산: 전월 사용액(prevMin 조건)까지 같이 넘겨준다
const spentOf = (pool, m, cardId) => pool.filter(t => t.month === m && t.cardId === cardId).reduce((s, t) => s + (t.amount || 0), 0);
const calcFor = (card, pool, m) => calcCard(card, pool.filter(t => t.cardId === card.id && t.month <= m), { month: m, prevSpent: spentOf(pool, shiftMonth(m, -1), card.id) });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { user: null, cards: null, txs: [], unsubs: [], tab: "home", detail: null,
  month: monthKey(), listTab: "card", histTxs: null, histUnsub: null, histKey: null, form: null, cardView: null, modal: null };

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
    if (ENABLED.includes(k)) { state.tab = k; state.detail = null; state.form = null; state.cardView = null; state.modal = null; if (k === "list") ensureHist(); renderNav(); render(); window.scrollTo(0, 0); }
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
  if (e.target.closest("[data-logout]")) signOut(auth);
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
    if (err.code === "auth/popup-blocked") return signInWithRedirect(auth, provider);
    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
    $("login-msg").textContent = "로그인에 실패했어요: " + err.code;
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && state.modal) closeModal(); });

function start() {
  renderNav();
  if (!configured) {
    $("login").hidden = false;
    $("login-msg").textContent = "js/firebase-config.js에 Firebase 설정값을 먼저 넣어주세요.";
    $("btn-google").disabled = true;
    return;
  }
  onAuthStateChanged(auth, user => {
    state.unsubs.forEach(u => u()); state.unsubs = [];
    state.histUnsub?.(); state.histUnsub = null; state.histTxs = null; state.histKey = null; state.form = null; state.cardView = null; state.modal = null;
    state.user = user; state.cards = null; state.txs = [];
    $("login").hidden = !!user;
    $("app").hidden = !user;
    if (!user) return;
    render();
    subscribe(user.uid);
  });
}

/* ---------- Firestore 구독 ---------- */
// users/{uid}/cards/{cardId}          카드 정의
// users/{uid}/transactions/{txId}     사용 내역 { cardId, month:"YYYY-MM", date, place, amount, benefitIdx, memo }
function subscribe(uid) {
  const cardsQ = query(collection(db, "users", uid, "cards"), orderBy("order"));
  state.unsubs.push(onSnapshot(cardsQ, snap => {
    state.cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    migrate(uid);
    render();
  }, err => toast("카드 불러오기 실패: " + err.code)));

  const txQ = query(collection(db, "users", uid, "transactions"),
    where("month", ">=", shiftMonth(monthKey(), -7))); // 반기 혜택까지 계산하려고 최근 8개월을 불러옴
  state.unsubs.push(onSnapshot(txQ, snap => {
    state.txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
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
      if (b.all || b.addon) return;                          // 자동 적용형·추가 혜택은 제외
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
    v.innerHTML = `<div class="box empty"><div style="font-size:40px"><img src="images/credit-card.png" alt=""></div>
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
function openDetail(id) {
  state.detail = id; history.pushState({ detail: id }, "");
  render(); window.scrollTo(0, 0);
}
window.addEventListener("popstate", e => {
  state.detail = e.state?.detail ?? null;
  state.cardView = e.state?.cardView ?? null;
  state.form = e.state?.form ? (state.form || (state.cards?.length ? newForm(null) : null)) : null;
  render();
});

function render() {
  const card = state.detail && state.cards ? state.cards.find(c => c.id === state.detail) : null;
  const cview = state.cardView && state.cards ? state.cards.find(c => c.id === state.cardView) : null;
  const formOpen = !!state.form && !!state.cards?.length;
  document.body.dataset.tab = card || cview || formOpen ? "detail" : state.tab;
  $("page-title").textContent = { cards: "내 카드", list: "월별 기록", more: "더보기" }[state.tab] || "카드 피킹 노트";
  // 로딩/빈 상태는 대시보드 렌더러가 공통 처리
  if (state.cards === null || !state.cards.length) renderDashboard();
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
  fab.hidden = formOpen || !state.cards?.length || (state.tab === "more" && !card && !cview);
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
        ${CARD_IMG[card.id] ? `<img class="thumb" src="${CARD_IMG[card.id]}" alt="">` : `<div class="cc-ico" style="background:${esc(card.color)}"><img src="images/credit-card.png" alt=""></div>`}
        <div class="mid">
          <div class="nm">${esc(card.name)}</div>
          <div class="meta">${esc(card.type)}카드 · ${Math.round(pct)}%</div>
        </div>
        <div class="rt ${need <= 0 ? "ok" : ""}">${need > 0 ? won(need) + "원" : "달성"}</div>
        <span class="chev" aria-hidden="true">›</span>
      </article>`;
    }).join("")}</section>
    <button class="add-card" type="button" data-soon>+ 카드 추가하기</button>
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
function ensureHist() { if (!state.histUnsub || state.histKey !== state.month) subscribeHist(); }
function subscribeHist() {
  state.histUnsub?.(); state.histUnsub = null; state.histTxs = null;
  if (!state.user) return;
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
      ${CARD_IMG[card.id] ? `<img class="thumb" src="${CARD_IMG[card.id]}" alt="">` : `<div class="cc-ico" style="background:${esc(card.color)}"><img src="images/credit-card.png" alt=""></div>`}
      <div class="mid"><div class="nm">${esc(card.name)}</div>
        <div class="meta">사용 ${won(r.spent)}원 · ${txs.length}건</div></div>
      <div class="rt ${r.sum > 0 ? "ok" : ""}">${won(r.sum)}원</div><span class="chev" aria-hidden="true">›</span></article>`).join("")}</section>`;
  } else {
    const cardOf = Object.fromEntries(state.cards.map(c => [c.id, c]));
    const byTx = {}; rows.forEach(({ r }) => Object.assign(byTx, r.by));
    const groups = {};
    selTxs.filter(t => cardOf[t.cardId]).forEach(t => (groups[t.date || ""] ||= []).push(t));
    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    body = dates.length ? dates.map(d => `<div class="day-h"><span>${dateLabel(d)}</span><span>${won(groups[d].reduce((s, t) => s + (t.amount || 0), 0))}원 사용</span></div>
      <div class="box">${groups[d].map(t => {
        const c = cardOf[t.cardId], bn = c.benefits[t.benefitIdx]?.n;
        return txRow(t, shortName(c) + (bn ? " · " + bn : ""), byTx[t.id] || 0);
      }).join("")}</div>`).join("")
      : '<div class="box empty" style="margin-top:14px"><p style="margin:0">이 달에는 사용 내역이 없어요</p></div>';
  }
  $("view").innerHTML = `<div class="list-wrap">${nav}${hero}${tabs}${body}</div>`;
}

/* ---------- 결제 내역 행 / 카드별 내역 화면 / 더보기 ---------- */
const txRow = (t, sub, gain) => `<div class="tx-row tap" data-tx="${esc(t.id)}"><div class="tx-l"><b>${esc(t.place || "사용처 없음")}</b>
  <div class="label">${esc(sub)}</div></div>
  <div class="tx-r"><b>${won(t.amount || 0)}원</b>${gain > 0 ? `<div class="gain">+${won(gain)}원 혜택</div>` : ""}</div></div>`;

function openCardView(id) {
  state.cardView = id; history.pushState({ cardView: id }, "");
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
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.id).localeCompare(String(a.id)));
  $("view").innerHTML = `<div class="detail">${head}
    <section class="summary">
      <div class="box"><div class="label">사용 금액</div><div class="stat-v">${won(r.spent)}원</div><div class="label">${txs.length}건</div></div>
      <div class="box"><div class="label">받은 혜택</div><div class="stat-v" style="color:${r.sum > 0 ? "var(--ok)" : "var(--tx)"}">${won(r.sum)}원</div></div>
    </section>
    <h2 class="sec">결제 내역</h2>
    <div class="box">${txs.length ? txs.map(t => {
      const bn = card.benefits[t.benefitIdx]?.n;
      return txRow(t, (t.date || "").slice(5).replace("-", ".") + (bn ? " · " + bn : ""), r.by[t.id] || 0);
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
function openModal(id) { state.modal = { id, del: false }; renderModal(); }
function closeModal() { state.modal = null; renderModal(); }
function renderModal() {
  const el = $("modal"), mo = state.modal;
  const pool = allTxs();
  const t = mo && pool.find(x => x.id === mo.id), card = t && state.cards?.find(c => c.id === t.cardId);
  if (!t || !card) { state.modal = null; el.hidden = true; el.innerHTML = ""; document.body.classList.remove("no-scroll"); return; }
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
    ["받은 혜택", `${gain > 0 ? "+" : ""}${won(gain)}원`]
  ];
  const noGain = (b || eb) && gain === 0 ? '<div class="f-hint" style="margin-top:8px">조건이나 한도 때문에 혜택이 적용되지 않았어요.</div>' : "";
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
  if (!id) return;
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
  const f = { cardId: card.id, place: "", amount: "", date: today(), benefitOn: true, benefitIdx: mainBenefits(card)[0]?.i ?? -1, list: "", extra: false, area: 0 };
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
    benefitOn: isMain, benefitIdx: isMain ? t.benefitIdx : (mains[0]?.i ?? -1), extra: t.extraIdx != null, area: 0 });
  if (t.extraIdx != null && card.extra) f.area = Math.max(0, card.extra.options.findIndex(o => o.idx === t.extraIdx));
  const b = card.benefits[f.benefitIdx];
  f.list = isMain && b && b.ticket != null ? String(t.list ?? b.list ?? "") : "";
  closeModal();
  state.form = f;
  history.pushState({ detail: state.detail, cardView: state.cardView, form: true }, "");
  render(); window.scrollTo(0, 0);
}
function openForm(cardId) {
  if (!state.cards?.length) return toast("먼저 카드를 불러와 주세요");
  state.form = newForm(cardId);
  history.pushState({ detail: state.detail, cardView: state.cardView, form: true }, "");
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
        <label class="switch"><input type="checkbox" data-f="benefitOn" ${f.benefitOn ? "checked" : ""}><span></span></label></div>
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
  else return;
  updateSave();
});
// 선택/토글: 구조가 바뀌므로 다시 그림
document.addEventListener("change", e => {
  const el = e.target.closest?.("[data-f]");
  if (!el || !state.form) return;
  const f = state.form, k = el.dataset.f, card = cardById(f.cardId);
  if (k === "cardId") { const c = cardById(el.value); Object.assign(f, { cardId: c.id, benefitIdx: mainBenefits(c)[0]?.i ?? -1, extra: false, area: 0 }); syncList(f, c); }
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
  if (!card || !formValid(f, card)) return;
  const tx = { cardId: card.id, month: f.date.slice(0, 7), date: f.date, place: f.place.trim(), amount: +f.amount,
    benefitIdx: f.benefitOn ? f.benefitIdx : -1, createdAt: serverTimestamp() };
  const ei = formExtraIdx(f, card);
  if (ei != null) tx.extraIdx = ei;
  const b = card.benefits[f.benefitIdx];
  if (f.benefitOn && b && b.ticket != null && f.list) tx.list = +f.list;
  // 오프라인에서도 막히지 않도록 저장 완료를 기다리지 않음 (로컬 캐시에 먼저 반영됨)
  if (f.editId) {
    const { createdAt, ...patch } = tx;
    patch.extraIdx = ei != null ? ei : deleteField();
    patch.list = tx.list != null ? tx.list : deleteField();
    updateDoc(doc(db, "users", state.user.uid, "transactions", f.editId), patch).catch(err => toast("수정 실패: " + err.code));
    toast("수정했어요");
  } else {
    addDoc(collection(db, "users", state.user.uid, "transactions"), tx).catch(err => toast("저장 실패: " + err.code));
    toast("사용 내역을 저장했어요");
  }
  history.back();
}

/* ---------- 카드 상세 ---------- */
function benefitDesc(b) {
  if (b.s) return b.s;
  const p = [];
  if (b.fixed != null) p.push(`${b.min ? won(b.min) + "원 이상 결제 시 " : ""}${won(b.fixed)}원`);
  else { p.push(`${+(b.rate * 100).toFixed(1)}%`); if (b.per) p.push(`1회 최대 ${won(b.per)}원`); }
  const u = PERIOD_UNIT[b.period || 1] || "월";
  if (b.max) p.push(`${u} 최대 ${won(b.max)}원`);
  if (b.slots > 1) p.push(`${u} ${b.slots}회`); else if (b.slots === 1 && (b.fixed != null || b.period > 1)) p.push(`${u} 1회`);
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
  const recent = [...txs].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  $("view").innerHTML = `<div class="detail" style="--c:${esc(card.color)}">
    <div class="d-head">
      <button class="back" type="button" data-back aria-label="뒤로">‹</button>
      <h2>${esc(card.name)}</h2>
      <span class="chip ac">${esc(card.type)}카드</span>
    </div>
    ${CARD_IMG[card.id] ? `<img class="card-img" src="${CARD_IMG[card.id]}" alt="${esc(card.name)}">` : ""}

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
      return txRow(t, (t.date || "").slice(5).replace("-", ".") + (bn ? " · " + bn : ""), r.by[t.id] || 0);
    }).join("") : '<div class="label" style="text-align:center;padding:8px 0">이번 달 내역이 없어요</div>'}</div>
  </div>`;
}

start();
