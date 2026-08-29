const MAX_STREAM = 2_000_000;
const URL_RE = /https?:\/\/[^\s<>"'`\\]+/gi;

export function decodeQuotedPrintable(s) {
  return s
    .replace(/=(?:\r?\n)/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

export function extractTextCandidates(raw, maxDepth = 3) {
  const out = [];
  walk(raw, maxDepth);
  return out;

  function walk(text, depth) {
    const b = text.match(/boundary="?([^"\r\n;]+)"?/i);
    if (b && depth > 0) {
      const marker = "--" + b[1];
      const chunks = text.split(marker);
      for (let i = 1; i < chunks.length; i++) {
        const c = chunks[i];
        if (c.startsWith("--")) break;
        walk(c, depth - 1);
      }
      return;
    }
    const headerEnd = text.search(/\r?\n\r?\n/);
    if (headerEnd === -1) return;
    const headers = text.slice(0, headerEnd);
    let body = text.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
    const enc =
      (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i) || [])[1] || "";
    if (/base64/i.test(enc)) {
      try {
        body = atob(body.replace(/[^A-Za-z0-9+/=]/g, ""));
      } catch {
        /* leave undecoded */
      }
    } else if (/quoted-printable/i.test(enc)) {
      body = decodeQuotedPrintable(body);
    }
    out.push({ headers, body, isHtml: /text\/html/i.test(headers) });
  }
}

function stripUrl(u) {
  return u.replace(/[.,;:!?)\]}'"]+$/, "");
}

export function extractUrlFromEmail(raw, subject = "") {
  if (subject) {
    const m = subject.match(URL_RE);
    if (m) return stripUrl(m[0]);
  }
  const parts = extractTextCandidates(raw);
  for (const p of parts) {
    if (p.isHtml) continue;
    const m = p.body.match(URL_RE);
    if (m) return stripUrl(m[0]);
  }
  for (const p of parts) {
    const m = p.body.match(URL_RE);
    if (m) return stripUrl(m[0]);
  }
  const m = raw.match(URL_RE);
  return m ? stripUrl(m[0]) : null;
}

function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildReply({ from, to, subject, text }) {
  const safeSubject = /^[\x20-\x7e]*$/.test(subject)
    ? subject
    : `=?utf-8?B?${b64utf8(subject)}?=`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");
}

async function streamToText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received > MAX_STREAM) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  text += decoder.decode();
  return text;
}

async function sendViaCloudflare(from, to, raw) {
  const { EmailMessage, sendEmail } = await import("cloudflare:email");
  await sendEmail(new EmailMessage(from, to, raw));
}

async function reply(env, to, subject, text) {
  const from = env.MAIL_FROM || "bookmarks@kaevu.dev";
  const raw = buildReply({ from, to, subject, text });
  await sendViaCloudflare(from, to, raw);
}

async function postJson(env, path, body) {
  const base = (env.BOOKMARKS_API_BASE || "").replace(/\/+$/, "");
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bookmark-token": env.BOOKMARKS_TOKEN || "",
    },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json response */
  }
  return { ok: res.ok, status: res.status, data };
}

function fmtMinutes(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function cardText(result) {
  const lines = ["saved to bookmarks", ""];
  lines.push(result.title || "(untitled)");
  const meta = [
    result.source,
    result.kind === "video" || result.reading_minutes == null
      ? null
      : fmtMinutes(result.reading_minutes),
  ]
    .filter(Boolean)
    .join(" · ");
  if (meta) lines.push(meta);
  lines.push("", result.summary || "");
  if (result.tags && result.tags.length) {
    lines.push("", "tags: " + result.tags.join("  "));
  }
  lines.push("kind: " + result.kind);
  if (result.fallback) {
    lines.push(
      "",
      "note: llm summarizer unavailable - extractive summary used; tags are best-effort"
    );
  }
  lines.push("", result.url);
  return lines.join("\n");
}

export default {
  async email(message, env) {
    const to = message.from;
    const subject = message.headers.get("subject") || "";
    try {
      const raw = await streamToText(message.raw);
      const url = extractUrlFromEmail(raw, subject);
      if (!url) {
        await reply(
          env,
          to,
          "bookmark failed: no link found",
          "no http(s) URL found in the subject or body.\r\n\r\nreply with a link in the subject or on its own line."
        );
        return;
      }
      const sum = await postJson(env, "/api/bookmarks/summarize", { url });
      if (!sum.ok) {
        const msg =
          (sum.data && (sum.data.message || sum.data.error)) ||
          `HTTP ${sum.status}`;
        await reply(
          env,
          to,
          "bookmark failed: could not summarize",
          `could not summarize ${url}\r\n\r\n${msg}`
        );
        return;
      }
      const save = await postJson(env, "/api/bookmarks", {
        url: sum.data.url,
        title: sum.data.title,
        source: sum.data.source,
        summary: sum.data.summary,
        tags: sum.data.tags,
        kind: sum.data.kind,
        reading_minutes: sum.data.reading_minutes,
      });
      if (!save.ok) {
        const msg =
          (save.data && (save.data.message || save.data.error)) ||
          `HTTP ${save.status}`;
        await reply(
          env,
          to,
          "bookmark failed: could not save",
          `summarized ok but saving failed for ${url}\r\n\r\n${msg}`
        );
        return;
      }
      await reply(env, to, `saved: ${sum.data.title || url}`, cardText(sum.data));
    } catch (e) {
      try {
        await reply(
          env,
          to,
          "bookmark failed: error",
          String((e && e.stack) || e)
        );
      } catch {
        /* reply itself failed */
      }
    }
  },
};
