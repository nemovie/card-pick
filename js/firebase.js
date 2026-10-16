// Firebase를 "나중에" 불러오는 얇은 껍데기.
//  - 앱 코드(app.js)는 이 파일만 import 하므로 Firebase SDK(수백 KB)를 기다리지 않고 바로 실행되어 화면을 먼저 그릴 수 있다.
//  - 아래 export 이름들은 ready가 끝나면 채워진다(live binding). 반드시 `await ready` 이후에 사용할 것.
//  - Auth는 initializeAuth로 시작한다: getAuth()는 모바일 브라우저에서 시작할 때 로그인용 iframe까지 먼저 불러오느라 첫 화면이 늦어진다.
//    로그인 팝업/리다이렉트가 필요한 순간에만 resolver를 넘긴다.
import { firebaseConfig } from "./firebase-config.js";

export const configured = !firebaseConfig.apiKey.startsWith("YOUR_");

const BASE = "https://www.gstatic.com/firebasejs/10.12.2/"; // index.html의 modulepreload 주소와 같아야 미리 받아 둔 파일을 재사용한다

export let auth, db, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  collection, doc, onSnapshot, query, where, orderBy, writeBatch, addDoc, serverTimestamp, deleteDoc, updateDoc, deleteField, getDocs;

export const ready = configured ? (async () => {
  const [A, Au, F] = await Promise.all([
    import(BASE + "firebase-app.js"), import(BASE + "firebase-auth.js"), import(BASE + "firebase-firestore.js")]);
  const app = A.initializeApp(firebaseConfig);
  auth = Au.initializeAuth(app, { persistence: [Au.indexedDBLocalPersistence, Au.browserLocalPersistence] });
  // 오프라인 캐시: 지하철 등에서도 마지막 데이터를 볼 수 있음
  db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  const resolver = Au.browserPopupRedirectResolver;
  GoogleAuthProvider = Au.GoogleAuthProvider; onAuthStateChanged = Au.onAuthStateChanged; signOut = Au.signOut;
  signInWithPopup = (a, p) => Au.signInWithPopup(a, p, resolver);
  signInWithRedirect = (a, p) => Au.signInWithRedirect(a, p, resolver);
  getRedirectResult = a => Au.getRedirectResult(a, resolver);
  ({ collection, doc, onSnapshot, query, where, orderBy, writeBatch, addDoc, serverTimestamp, deleteDoc, updateDoc, deleteField, getDocs } = F);
})() : Promise.resolve();
