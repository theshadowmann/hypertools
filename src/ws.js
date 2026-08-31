import { HL_WS } from "./api.js";

function keyOf(sub) {
  return JSON.stringify(sub);
}

function channelOf(sub) {
  if (!sub) return "";
  if (sub.type === "userEvents") return "user";
  return sub.type;
}

export function createHlWs() {
  let ws = null;
  const want = new Map();
  let reconnectTimer = null;
  let pingTimer = null;
  let closed = false;

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function match(msg, sub) {
    if (!msg || !sub) return false;
    const ch = msg.channel;
    if (ch === "subscriptionResponse" || ch === "pong") return false;
    if (ch !== channelOf(sub) && !(sub.type === "l2Book" && ch === "l2Book")) return false;
    const data = msg.data;
    if (sub.coin && data) {
      if (data.coin && data.coin !== sub.coin) return false;
      if (data.s && data.s !== sub.coin) return false;
      if (Array.isArray(data) && data[0] && data[0].s && data[0].s !== sub.coin) return false;
    }
    if (sub.interval && data) {
      const iv = data.i || (Array.isArray(data) && data[0] && data[0].i);
      if (iv && iv !== sub.interval) return false;
    }
    if (sub.user && data && data.user && String(data.user).toLowerCase() !== String(sub.user).toLowerCase()) {
      return false;
    }
    return true;
  }

  function connect() {
    if (closed) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(HL_WS);
    ws.onopen = () => {
      want.forEach(({ sub }) => send({ method: "subscribe", subscription: sub }));
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ method: "ping" }), 20000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      want.forEach(({ sub, handlers }) => {
        if (!match(msg, sub)) return;
        handlers.forEach((h) => {
          try {
            h(msg.data, msg);
          } catch {
            /* handler errors should not kill the socket */
          }
        });
      });
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      ws = null;
      if (closed) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1500);
    };
    ws.onerror = () => {
      try {
        ws && ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  return {
    subscribe(sub, handler) {
      const k = keyOf(sub);
      if (!want.has(k)) {
        want.set(k, { sub, handlers: new Set() });
        send({ method: "subscribe", subscription: sub });
      }
      want.get(k).handlers.add(handler);
      connect();
      return () => this.unsubscribe(sub, handler);
    },
    unsubscribe(sub, handler) {
      const k = keyOf(sub);
      const entry = want.get(k);
      if (!entry) return;
      if (handler) entry.handlers.delete(handler);
      else entry.handlers.clear();
      if (entry.handlers.size === 0) {
        want.delete(k);
        send({ method: "unsubscribe", subscription: sub });
      }
    },
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      try {
        ws && ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
      want.clear();
    },
  };
}
