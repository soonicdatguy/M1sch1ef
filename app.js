/* =========================================================================
   M1sch1ef — realtime chatroom powered by Firebase Realtime Database
   - Nickname stored in localStorage
   - Rooms + Direct Messages (unified channel model)
   - Messages synced globally via Firebase Realtime Database
   ========================================================================= */

(() => {
  // ---------- Firebase config ----------
  const firebaseConfig = {
    apiKey: "AIzaSyBe6uCVKl_6ExfQNY-iVuvppt6UofYUY44",
    authDomain: "m1sch1ef-chatroom.firebaseapp.com",
    databaseURL: "https://m1sch1ef-chatroom-default-rtdb.firebaseio.com",
    projectId: "m1sch1ef-chatroom",
    storageBucket: "m1sch1ef-chatroom.firebasestorage.app",
    messagingSenderId: "658758220188",
    appId: "1:658758220188:web:17e3abfefcb5a9841fb059",
    measurementId: "G-GSBBX9D4SD"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  const NS = "m1sch1ef";
  const ROOMS = [
    { id: "lobby",   label: "lobby" },
    { id: "pranks",  label: "pranks" },
    { id: "hacks",   label: "hacks" },
    { id: "random",  label: "random" },
    { id: "secrets", label: "secrets" }
  ];
  const MAX_MESSAGES = 200;

  // ---------- channel helpers ----------
  const roomChan = (id) => `room_${id}`;
  const dmChan   = (a, b) => `dm_${[a, b].sort().join("__")}`;
  const parseChan = (c) => {
    if (c.startsWith("room_")) return { type: "room", id: c.slice(5) };
    if (c.startsWith("dm_"))   return { type: "dm", parties: c.slice(3).split("__") };
    return { type: "room", id: "lobby" };
  };
  const chanLabel = (c, me) => {
    const p = parseChan(c);
    if (p.type === "room") return `#${p.id}`;
    return `@${p.parties.find((x) => x !== me) || p.parties[0]}`;
  };
  const dmPartner = (c, me) => {
    const p = parseChan(c);
    if (p.type !== "dm") return null;
    return p.parties.find((x) => x !== me) || p.parties[0];
  };

  // ---------- local storage (nick + DM list only) ----------
  const k = {
    nick: `${NS}:nick`,
    chan: `${NS}:chan`,
    dms:  `${NS}:dms`
  };
  const loadDMs = () => { try { return JSON.parse(localStorage.getItem(k.dms) || "[]"); } catch { return []; } };
  const saveDMs = (arr) => localStorage.setItem(k.dms, JSON.stringify(arr));

  // ---------- state ----------
  const state = {
    nick:     localStorage.getItem(k.nick) || "",
    chan:     localStorage.getItem(k.chan) || roomChan(ROOMS[0].id),
    dms:     loadDMs(),
    unread:  {},
    clientId: cryptoId(),
    listener: null   // active Firebase listener ref
  };

  // ---------- elements ----------
  const $ = (s) => document.querySelector(s);
  const els = {
    gate:      $("#nickGate"),
    nickForm:  $("#nickForm"),
    nickInput: $("#nickInput"),
    app:       $("#app"),
    tabs:      $("#tabs"),
    msgs:      $("#messages"),
    msgForm:   $("#msgForm"),
    msgInput:  $("#msgInput"),
    nickBtn:   $("#nickBtn"),
    clearBtn:  $("#clearBtn"),
    newDmBtn:  $("#newDmBtn")
  };

  // ---------- Firebase helpers ----------
  function chanRef(chan) {
    return db.ref(`chats/${chan}/messages`);
  }

  function subscribeToChannel(chan) {
    // detach previous listener
    if (state.listener) {
      state.listener.ref.off("value", state.listener.fn);
      state.listener = null;
    }

    const ref = chanRef(chan);
    // only load last MAX_MESSAGES
    const query = ref.limitToLast(MAX_MESSAGES);

    const fn = query.on("value", (snapshot) => {
      const data = snapshot.val() || {};
      const list = Object.values(data).sort((a, b) => a.ts - b.ts);
      renderMessages(list);
    });

    state.listener = { ref: query, fn };

    // track unread for other channels
    ROOMS.forEach((r) => {
      const c = roomChan(r.id);
      if (c !== chan) watchUnread(c);
    });
    state.dms.forEach((partner) => {
      const c = dmChan(state.nick, partner);
      if (c !== chan) watchUnread(c);
    });
  }

  // lightweight unread watcher — just listens for new child events
  const unreadWatchers = {};
  function watchUnread(chan) {
    if (unreadWatchers[chan]) return;
    const ref = chanRef(chan);
    // only fire for NEW messages added after now
    const sinceRef = ref.limitToLast(1);
    let initialized = false;
    sinceRef.on("child_added", (snap) => {
      if (!initialized) { initialized = true; return; } // skip initial load
      const msg = snap.val();
      if (msg && msg.from !== state.nick) {
        state.unread[chan] = (state.unread[chan] || 0) + 1;
        renderTabs();
      }
    });
    unreadWatchers[chan] = sinceRef;
  }

  function sendMessage(chan, msg) {
    chanRef(chan).push(msg);
  }

  function clearChannel(chan) {
    chanRef(chan).remove();
  }

  // ---------- init ----------
  function init() {
    if (!state.nick) showGate();
    else { hideGate(); els.nickBtn.textContent = state.nick; }
    renderTabs();
    updateComposerPlaceholder();
    subscribeToChannel(state.chan);

    els.nickForm.addEventListener("submit", onNickSubmit);
    els.msgForm.addEventListener("submit", onMsgSubmit);
    els.nickBtn.addEventListener("click", changeNick);
    els.clearBtn.addEventListener("click", clearCurrent);
    els.newDmBtn.addEventListener("click", startNewDM);
  }

  function showGate() { els.gate.style.display = "grid"; els.app.hidden = true; setTimeout(() => els.nickInput.focus(), 50); }
  function hideGate() { els.gate.style.display = "none"; els.app.hidden = false; setTimeout(() => els.msgInput.focus(), 50); }

  function onNickSubmit(e) {
    e.preventDefault();
    const v = els.nickInput.value.trim().slice(0, 20);
    if (!v) return;
    state.nick = v;
    localStorage.setItem(k.nick, v);
    els.nickBtn.textContent = v;
    hideGate();
    renderTabs();
    updateComposerPlaceholder();
    pushSystem(`${v} slipped into ${chanLabel(state.chan, state.nick)}`);
  }

  function changeNick() {
    const next = prompt("change alias:", state.nick);
    if (!next || !next.trim()) return;
    state.nick = next.trim().slice(0, 20);
    localStorage.setItem(k.nick, state.nick);
    els.nickBtn.textContent = state.nick;
    renderTabs();
    updateComposerPlaceholder();
  }

  function clearCurrent() {
    if (!confirm(`clear all messages in ${chanLabel(state.chan, state.nick)}?`)) return;
    clearChannel(state.chan);
  }

  function startNewDM() {
    const who = prompt("DM whom? (alias):");
    if (!who) return;
    const partner = who.trim().slice(0, 20);
    if (!partner) return;
    if (partner === state.nick) { alert("you can't DM yourself."); return; }
    if (!state.dms.includes(partner)) {
      state.dms.push(partner);
      saveDMs(state.dms);
    }
    switchChan(dmChan(state.nick, partner));
  }

  function switchChan(chan) {
    state.chan = chan;
    localStorage.setItem(k.chan, chan);
    delete state.unread[chan];
    renderTabs();
    updateComposerPlaceholder();
    els.msgInput.focus();
    subscribeToChannel(chan);
  }

  function onMsgSubmit(e) {
    e.preventDefault();
    const text = els.msgInput.value.trim();
    if (!text) return;
    const msg = {
      id: cryptoId(),
      from: state.nick,
      clientId: state.clientId,
      text,
      ts: Date.now()
    };
    sendMessage(state.chan, msg);
    els.msgInput.value = "";
  }

  function pushSystem(text) {
    const msg = { id: cryptoId(), from: "__system__", text, ts: Date.now(), system: true };
    sendMessage(state.chan, msg);
  }

  // ---------- render ----------
  function renderTabs() {
    els.tabs.innerHTML = "";

    ROOMS.forEach((r) => {
      const chan = roomChan(r.id);
      const btn = makeTab({
        label: r.label,
        prefix: "#",
        active: state.chan === chan,
        unread: state.unread[chan] || 0,
        testid: `tab-${r.id}`,
        onClick: () => switchChan(chan)
      });
      els.tabs.appendChild(btn);
    });

    if (state.dms.length > 0) {
      const sep = document.createElement("span");
      sep.className = "tab-sep";
      sep.setAttribute("aria-hidden", "true");
      els.tabs.appendChild(sep);
    }

    state.dms.forEach((partner) => {
      const chan = dmChan(state.nick, partner);
      const btn = makeTab({
        label: partner,
        prefix: "@",
        active: state.chan === chan,
        unread: state.unread[chan] || 0,
        testid: `dm-${partner}`,
        onClick: () => switchChan(chan),
        onClose: () => closeDM(partner)
      });
      btn.classList.add("tab-dm");
      els.tabs.appendChild(btn);
    });
  }

  function makeTab({ label, prefix, active, unread, testid, onClick, onClose }) {
    const btn = document.createElement("button");
    btn.className = "tab" + (active ? " active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("data-testid", testid);
    btn.innerHTML = `<span class="hash">${prefix}</span>${escapeHtml(label)}${
      unread ? `<span class="unread">${unread}</span>` : ""
    }`;
    btn.addEventListener("click", onClick);
    if (onClose) {
      const x = document.createElement("span");
      x.className = "tab-close";
      x.textContent = "×";
      x.title = "close DM";
      x.addEventListener("click", (ev) => { ev.stopPropagation(); onClose(); });
      btn.appendChild(x);
    }
    return btn;
  }

  function closeDM(partner) {
    state.dms = state.dms.filter((p) => p !== partner);
    saveDMs(state.dms);
    if (state.chan === dmChan(state.nick, partner)) {
      switchChan(roomChan(ROOMS[0].id));
    } else {
      renderTabs();
    }
  }

  function updateComposerPlaceholder() {
    const p = parseChan(state.chan);
    els.msgInput.placeholder = p.type === "dm"
      ? `whisper to @${dmPartner(state.chan, state.nick)}...`
      : "type something mischievous...";
  }

  function renderMessages(list = []) {
    els.msgs.innerHTML = "";

    if (list.length === 0) {
      const p = parseChan(state.chan);
      const empty = document.createElement("div");
      empty.className = "empty";
      const glyph = p.type === "dm"
        ? `@${dmPartner(state.chan, state.nick)}`
        : `#${p.id}`;
      const hint = p.type === "dm"
        ? "just you two. say something."
        : "no messages yet — say something mischievous.";
      empty.innerHTML = `<span class="glyph">${escapeHtml(glyph)}</span>${hint}`;
      els.msgs.appendChild(empty);
      return;
    }

    list.forEach((m) => {
      const wrap = document.createElement("div");
      if (m.system) {
        wrap.className = "msg system";
        wrap.innerHTML = `<div class="bubble">${escapeHtml(m.text)}</div>`;
      } else {
        const self = m.from === state.nick && m.clientId === state.clientId;
        wrap.className = "msg" + (self ? " self" : "");
        wrap.innerHTML = `
          <div class="meta">
            <span class="name">${escapeHtml(m.from)}</span>
            <span class="time">${fmtTime(m.ts)}</span>
          </div>
          <div class="bubble">${linkify(escapeHtml(m.text))}</div>
        `;
      }
      els.msgs.appendChild(wrap);
    });

    els.msgs.scrollTop = els.msgs.scrollHeight;
  }

  // ---------- utils ----------
  function cryptoId() {
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint8Array(8);
      crypto.getRandomValues(a);
      return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function linkify(s) {
    return s.replace(/(https?:\/\/[^\s<]+)/g,
      (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer" style="color:var(--acid);">${m}</a>`);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
