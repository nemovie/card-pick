// 카드 기본 정의 (엑셀의 혜택 규칙). 사용 내역은 포함하지 않습니다.
// 혜택 계산 필드
//  fixed: 정액 혜택(원)   min: 최소 결제 금액   rate: 혜택률   per: 1회 한도
//  max: 월 합계 한도     slots: 월 혜택 가능 횟수
//  group/groupMax: 같은 group끼리 합산해서 적용하는 월 한도
//  all: true → 혜택 선택 없이 모든 결제에 자동 적용 (min: 이상, lt: 미만 결제에만)
//  sumMin: 이 혜택으로 고른 결제금액의 월 누적 합이 이 금액 이상이 되면 적용 (대중교통처럼 합산 조건일 때)
//  slots: null → 횟수 제한 없음
//  period: 한도(max)·횟수(slots)·일 1회·합산 한도를 세는 기간(개월). 생략=1(매월), 3=분기, 6=반기(1~6월/7~12월), 12=연(1~12월). 달력 기준
//  addon: true → 다른 혜택에 덧붙는 추가 혜택. 결제 내역에서 extraIdx로 지정하면 benefitIdx(기본 혜택)와 함께 적용
//  prevMin: 전월 사용액이 이 금액 이상일 때만 적용 (calcCard의 opts.prevSpent로 판단)
//  needs: 결제 내역의 기본 혜택(benefitIdx)이 이 번호일 때만 적용 (추가 혜택용)
//  card.extra: 내역 추가 화면의 추가 혜택 토글 { label, hint, options: [{ label?, idx }] } (idx = 추가 혜택 번호, 2개 이상이면 선택 박스 표시)
//  daily: true → 같은 날짜에는 1회만 적용 (같은 날 두 번째 결제부터는 혜택·횟수 차감 없음)
//  ticket: 결제금액(원) / list: 기본 정가(원) → 혜택 = 정가 - 실제 결제금액 (결제 내역에 list 값이 있으면 그 값 우선)
//  card.pools: 카드 상세에 보여줄 통합 한도 [{ group, label, max, color? }] (2개 이상이면 poolTitle로 한 줄 합산, 색 구분 막대) (혜택에는 group/groupMax를 같이 지정)
export const SEED_VERSION = 14; // 카드 기본 규칙을 바꿀 때 올리면 기존 카드가 자동 갱신됨
export const CARD_SEED = [
  { id: "sam", name: "삼성 iD Simple", type: "신용", color: "#3b6df0", target: 300000, benefits: [
    { n: "영화 할인 (CGV·롯데시네마·메가박스)", fixed: 3000, min: 10000, slots: 1 },
    { n: "쿠팡 와우 멤버십 50% 할인", s: "네이버 멤버십과 합산 월 최대 5,000원", rate: 0.5, groupMax: 5000, group: "member", slots: 1 },
    { n: "네이버 멤버십 50% 할인", s: "쿠팡 와우와 합산 월 최대 5,000원", rate: 0.5, groupMax: 5000, group: "member", slots: 1 },
    { n: "결제 시 0.7% 할인", s: "10만원 미만 결제 · 한도 없음", rate: 0.007, all: true, lt: 100000, slots: 0 },
    { n: "10만원 이상 결제 시 1% 할인", s: "1회 10만원 이상 결제 · 한도 없음", rate: 0.01, min: 100000, all: true, slots: 0 } ] },
  { id: "shin", name: "신한 나라사랑카드", type: "체크", color: "#14b8a6", target: 200000,
    pools: [{ group: "total", label: "통합 월 할인한도", max: 20000, note: "영화 혜택은 제외" }], benefits: [
    { n: "CGV 일반 2D 6천원 관람", s: "6,000원에 결제 · 정가와의 차액이 혜택 · 통합 한도 제외", ticket: 6000, list: 16000, slots: 1 },
    { n: "광역교통(고속버스·철도) 10% 캐시백", s: "월 최대 3,000원 · 횟수 제한 없음", rate: 0.1, max: 3000, slots: null, group: "total", groupMax: 20000 },
    { n: "카카오T 택시 10% 캐시백", s: "월 최대 2,000원 · 횟수 제한 없음", rate: 0.1, max: 2000, slots: null, group: "total", groupMax: 20000 },
    { n: "CU·GS25 20% 캐시백", s: "일 1회 최대 1,000원 · 월 5회 최대 5,000원", rate: 0.2, per: 1000, max: 5000, slots: 5, daily: true, group: "total", groupMax: 20000 },
    { n: "스타벅스·이디야·메가커피·컴포즈커피·매머드커피·빽다방 5% 캐시백", s: "일 1회 최대 2,000원 · 월 3회 · 월 최대 5,000원", rate: 0.05, per: 2000, max: 5000, slots: 3, daily: true, group: "total", groupMax: 20000 },
    { n: "배달의민족 5% 캐시백", s: "일 1회 최대 1,000원 · 월 5회 최대 5,000원", rate: 0.05, per: 1000, max: 5000, slots: 5, daily: true, group: "total", groupMax: 20000 },
    { n: "알뜰폰 자동이체 5% 캐시백", s: "월 1회 · 최대 5,000원", rate: 0.05, max: 5000, slots: 1, group: "total", groupMax: 20000 } ] },
  { id: "woo", name: "우리 K-패스 Cookie", type: "체크", color: "#f59e0b", target: 200000,
    extra: { label: "간편결제 여부", hint: "네이버페이·카카오페이·PAYCO 결제 시 1천원 추가 캐시백", options: [{ idx: 4 }] },
    poolTitle: "월 혜택 한도", pools: [{ group: "basic", label: "기본서비스", max: 8000 }, { group: "extra", label: "추가서비스", max: 2000, color: "#0ea5e9" }], benefits: [
    { n: "대중교통 3천원 캐시백", s: "월 대중교통 이용금액 합산 5만원 이상 시 · 월 1회", fixed: 3000, sumMin: 50000, slots: 1, group: "basic", groupMax: 8000 },
    { n: "CGV·롯데시네마 5천원 캐시백", s: "결제금액 15,000원 이상 시 · 월 1회", fixed: 5000, min: 15000, slots: 1, group: "basic", groupMax: 8000 },
    { n: "쿠팡·G마켓·11번가 2천원 캐시백", s: "결제금액 20,000원 이상 시 · 월 3회", fixed: 2000, min: 20000, slots: 3, group: "basic", groupMax: 8000 },
    { n: "CU·GS25·세븐일레븐·올리브영 1천원 캐시백", s: "결제금액 10,000원 이상 시 · 월 2회", fixed: 1000, min: 10000, slots: 2, group: "basic", groupMax: 8000 },
    { n: "네이버페이·카카오페이·PAYCO 1천원 추가 캐시백", s: "건당 10,000원 이상 결제 시 · 월 2회 · 추가서비스", fixed: 1000, min: 10000, slots: 2, group: "extra", groupMax: 2000 } ] },
  { id: "nori", name: "KB 노리2 Check", type: "체크", color: "#eab308", target: 200000,
    extra: { label: "KB Pay 결제 여부", hint: "전월 30만원 이상일 때 2% 추가 할인", options: [{ label: "온라인", idx: 5 }, { label: "오프라인", idx: 6 }] },
    pools: [{ group: "total", label: "통합 월 할인한도", max: 20000, note: "KB Pay 추가 혜택 포함" }], benefits: [
    { n: "CGV 4천원 할인", s: "건당 10,000원 이상 결제 시 · 월 2회 · 월 최대 8,000원", fixed: 4000, min: 10000, slots: 2, group: "total", groupMax: 20000 },
    { n: "CU·GS25 5% 할인", s: "월 최대 2,000원 · 횟수 제한 없음", rate: 0.05, max: 2000, slots: null, group: "total", groupMax: 20000 },
    { n: "배달의민족·요기요 1천원 할인", s: "건당 10,000원 이상 결제 시 · 월 1회", fixed: 1000, min: 10000, slots: 1, group: "total", groupMax: 20000 },
    { n: "올리브영·미용실 5% 할인", s: "월 최대 2,000원 · 횟수 제한 없음", rate: 0.05, max: 2000, slots: null, group: "total", groupMax: 20000 },
    { n: "스타벅스 10% 할인", s: "월 최대 3,000원 · 횟수 제한 없음", rate: 0.1, max: 3000, slots: null, group: "total", groupMax: 20000 },
    { n: "온라인 KB Pay 결제 2% 추가 할인", s: "전월 30만원 이상 시 · 다른 혜택에 추가 · 월 최대 2,000원", rate: 0.02, max: 2000, slots: null, addon: true, prevMin: 300000, group: "total", groupMax: 20000 },
    { n: "오프라인 KB Pay 결제 2% 추가 할인", s: "전월 30만원 이상 시 · 다른 혜택에 추가 · 월 최대 3,000원", rate: 0.02, max: 3000, slots: null, addon: true, prevMin: 300000, group: "total", groupMax: 20000 } ] },
  { id: "pang", name: "KB 팡팡 check", type: "체크", color: "#ec5b7a", target: 200000,
    extra: { label: "KB Pay 결제 여부", hint: "G마켓·11번가·SSG.COM 혜택일 때 10% 추가 할인", options: [{ idx: 1 }] },
    pools: [{ group: "total", label: "통합 월 할인한도", max: 20000, note: "KB Pay 추가 혜택 포함" }], benefits: [
    { n: "G마켓·11번가·SSG.COM 10% 할인", s: "월 최대 7,000원 · 횟수 제한 없음", rate: 0.1, max: 7000, slots: null, group: "total", groupMax: 20000 },
    { n: "G마켓·11번가·SSG.COM KB Pay 결제 10% 추가 할인", s: "다른 혜택에 추가 · 월 최대 3,000원 · 횟수 제한 없음", rate: 0.1, max: 3000, slots: null, addon: true, needs: 0, group: "total", groupMax: 20000 },
    { n: "롯데마트·이마트·홈플러스 10% 할인", s: "월 최대 3,000원 · 횟수 제한 없음", rate: 0.1, max: 3000, slots: null, group: "total", groupMax: 20000 },
    { n: "CGV·롯데시네마·메가박스 4천원 할인", s: "건당 10,000원 이상 결제 시 · 월 2회 · 월 최대 8,000원", fixed: 4000, min: 10000, slots: 2, group: "total", groupMax: 20000 },
    { n: "스타벅스 10% 할인", s: "월 최대 4,000원 · 횟수 제한 없음", rate: 0.1, max: 4000, slots: null, group: "total", groupMax: 20000 } ] }
];

CARD_SEED.forEach(c => { c.v = SEED_VERSION; });

// 카드 이미지 (가로형 통일)
export const CARD_IMG = {
  sam: "images/cards/sam.webp", pang: "images/cards/pang.webp", shin: "images/cards/shin.webp",
  nori: "images/cards/nori.webp", woo: "images/cards/woo.webp"
};

const pad = n => String(n).padStart(2, "0");
export const monthKey = (d = new Date()) => d.getFullYear() + "-" + pad(d.getMonth() + 1);
export const prevMonthKey = (d = new Date()) => monthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1));
export const won = n => Math.round(n).toLocaleString("ko-KR");

// 월 혜택 가능 횟수 (null/미지정이면 무제한)
export const slotCap = b => b.slots ?? Infinity;

// 혜택 하나가 받을 수 있는 최대 금액 (무제한이면 Infinity)
export const benefitMax = b => {
  if (b.all) return Infinity;
  const each = b.ticket != null ? Math.max(0, (b.list ?? b.ticket) - b.ticket) : (b.fixed ?? b.per ?? Infinity);
  return Math.min(b.groupMax ?? Infinity, b.max ?? Infinity, each * slotCap(b));
};

const qualifies = (b, amount) => (b.min == null || amount >= b.min) && (b.lt == null || amount < b.lt);
const cut = x => Math.floor(x + 1e-9); // 원 단위 절사 (부동소수 오차 보정)

// ---- 기간(period) 계산 도우미 ----
export const PERIOD_UNIT = { 1: "월", 3: "분기", 6: "반기", 12: "연" };
const pOf = b => b.period || 1;
const mo = t => t.month || (t.date || "").slice(0, 7);
// 같은 기간이면 같은 키. period=6 → 1~6월은 "2026|0", 7~12월은 "2026|1"
export const periodKey = (month, p) => p === 1 ? month : month.slice(0, 4) + "|" + Math.floor((+month.slice(5, 7) - 1) / p);
// month가 속한 기간의 시작월 ('YYYY-MM')
export const periodStart = (month, p) => month.slice(0, 4) + "-" + String(Math.floor((+month.slice(5, 7) - 1) / p) * p + 1).padStart(2, "0");

/**
 * 카드 하나의 계산.
 * txs: 이 카드의 사용 내역 (opts.month 이하의 달들, 기간 혜택을 위해 이전 달 포함 가능)
 *      [{ id, month, date, amount, benefitIdx(-1이면 혜택 선택 없음), extraIdx?(추가 혜택) }]
 * opts.month: 계산 기준 달 ('YYYY-MM'). 생략하면 txs 중 가장 늦은 달
 * opts.prevSpent: 이 카드의 전월 사용액 (prevMin 조건 판단용, 없으면 조건 무시. 기준 달의 결제에만 적용)
 * 규칙
 *  - 결제를 날짜순으로 처리 (한도는 먼저 쓴 결제가 먼저 소진)
 *  - 횟수·한도·일 1회·합산 한도·sumMin은 혜택의 기간(period)마다 따로 센다 (기본 매월)
 *  - 선택한 혜택: 최소 결제금액(min)을 못 넘으면 적용도, 횟수(slots) 차감도 없음
 *  - daily 혜택은 같은 날짜에 한 번만 적용
 *  - sumMin 혜택은 선택한 결제금액의 누적 합이 조건을 넘는 순간 적용
 *  - ticket 혜택은 (결제 내역의 list || 혜택의 list) - 실제 결제금액이 혜택
 *  - 1회 한도(per) → 혜택 한도(max) → 그룹 합산 한도(groupMax) 순으로 제한
 *  - all:true 혜택은 조건(min/lt)에 맞는 기준 달 결제에 자동 적용 (단, 선택한 혜택이 적용된 결제는 제외)
 *  - 할인액은 결제 건마다 원 단위 버림
 * 반환: spent(기준 달 실적), sum(기준 달 혜택 합계), per[i]/used[i]/sums[i]/days[i](기준 달이 속한 기간의 값),
 *       by[txId](결제별 혜택), grp(그룹별 누적 혜택)
 */
// 정렬 기준: 날짜 → 입력 순서(createdAt) → id
// createdAt이 아직 확정 전(저장 직후/오프라인)이면 가장 최근 입력으로 취급
const seqOf = t => t.createdAt?.toMillis?.() ?? Infinity;
export const byEntry = (a, b) =>
  (a.date || "").localeCompare(b.date || "") ||
  (seqOf(a) === seqOf(b) ? 0 : seqOf(a) < seqOf(b) ? -1 : 1) ||
  String(a.id).localeCompare(String(b.id));

export function calcCard(card, txs, opts = {}) {
  const cm = opts.month || txs.reduce((a, t) => (mo(t) > a ? mo(t) : a), "");
  const scope = txs.filter(t => mo(t) && mo(t) <= cm);
  const inMonth = scope.filter(t => mo(t) === cm);
  const spent = inMonth.reduce((s, t) => s + (t.amount || 0), 0);
  const U = new Map(), R = new Map(), S = new Map(), D = new Map(), G = new Map();
  const g0 = (m, k) => m.get(k) ?? 0;
  const by = {}, autoPer = {};
  const key = (i, month) => i + "|" + periodKey(month, pOf(card.benefits[i]));
  const add = (t, x) => { by[t.id] = (by[t.id] || 0) + x; };

  // 결제 t에 혜택 i를 적용해 본다. 실제로 적용되면 true
  const grant = (t, i) => {
    const b = card.benefits[i];
    if (!b || b.all) return false;
    if (b.prevMin != null && opts.prevSpent != null && mo(t) === cm && opts.prevSpent < b.prevMin) return false;
    if (b.needs != null && t.benefitIdx !== b.needs) return false;
    const k = key(i, mo(t));
    if (b.sumMin != null) S.set(k, g0(S, k) + (t.amount || 0)); // 합산 조건: 선택한 결제금액을 누적
    const days = D.get(k) || new Set();
    if (!((b.sumMin == null || g0(S, k) >= b.sumMin) && qualifies(b, t.amount) && g0(U, k) < slotCap(b) && !(b.daily && t.date && days.has(t.date)))) return false;
    if (b.daily && t.date) { days.add(t.date); D.set(k, days); }
    let x = b.ticket != null ? Math.max(0, (t.list ?? b.list ?? b.ticket) - t.amount)
      : b.fixed != null ? b.fixed : cut(Math.min(t.amount * b.rate, b.per ?? Infinity));
    x = Math.min(x, (b.max ?? Infinity) - g0(R, k));
    const gk = b.group ? b.group + "|" + periodKey(mo(t), pOf(b)) : null;
    if (gk) x = Math.min(x, (b.groupMax ?? Infinity) - g0(G, gk));
    x = Math.max(0, x);
    U.set(k, g0(U, k) + 1); R.set(k, g0(R, k) + x);
    if (gk) G.set(gk, g0(G, gk) + x);
    add(t, x);
    return true;
  };

  [...scope].sort(byEntry)
    .forEach(t => {
      const applied = grant(t, t.benefitIdx); // 선택한 혜택이 실제로 적용된 결제인지
      if (t.extraIdx != null && t.extraIdx !== t.benefitIdx) grant(t, t.extraIdx); // 추가 혜택(KB Pay 등)
      if (mo(t) !== cm) return;
      card.benefits.forEach((ab, j) => {
        if (ab.all && !applied && qualifies(ab, t.amount)) { const x = cut(t.amount * ab.rate); autoPer[j] = (autoPer[j] || 0) + x; add(t, x); }
      });
    });

  const at = i => key(i, cm);
  const grp = {};
  card.benefits.forEach(b => { if (b.group) grp[b.group] = g0(G, b.group + "|" + periodKey(cm, pOf(b))); });
  return {
    spent, by, grp,
    per: card.benefits.map((b, i) => b.all ? (autoPer[i] || 0) : g0(R, at(i))),
    used: card.benefits.map((b, i) => g0(U, at(i))),
    sums: card.benefits.map((b, i) => g0(S, at(i))),
    days: card.benefits.map((b, i) => D.get(at(i)) || new Set()),
    sum: inMonth.reduce((s, t) => s + (by[t.id] || 0), 0)
  };
}
