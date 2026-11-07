/**
 * Chat formatting the way Discord writes it, pure (tests import it):
 *   **bold**  *italic* _italic_  ***both***  __underline__  ~~strike~~  ||spoiler||
 *   `code`  ```code block```  > quote  >>> quote to the end  # ## ### headings  -# small text
 *   - lists  1. numbered lists  [masked](https://links)  \*escaped\*
 * HTML a player types, Foundry's enrichers (@UUID[...]{...}) and inline rolls ([[...]] and the
 * links Foundry makes of them) pass through untouched.
 */

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
const MARK = "\u0000";

/** Set pieces aside (the placeholder survives formatting), to put back at the end. */
function stash(store, html) {
  store.push(html);
  return `${MARK}${store.length - 1}${MARK}`;
}

/** Inline formatting of one line (code, links and protected pieces are already set aside). */
function inline(text, store) {
  let s = text;
  // Escaped marks are literal.
  s = s.replace(/\\([*_~|`>#\-[\]()\\])/g, (m, c) => stash(store, escape(c)));
  s = s.replace(/\|\|(.+?)\|\|/g, (m, t) => `<span class="ncm-spoiler" tabindex="0">${t}</span>`);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<u>$1</u>");
  s = s.replace(/~~(.+?)~~/g, "<s>$1</s>");
  s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_(?!\s)(.+?)(?<!\s)_(?![_\w])/g, "$1<em>$2</em>");
  return s;
}

/**
 * Format a chat message.
 * @param {string} text - what the player typed (may hold HTML)
 * @returns {string} HTML
 */
export function format(text) {
  const store = [];
  let s = String(text ?? "").replace(/\r\n?/g, "\n");
  // Code blocks, then inline code: nothing inside them is formatted.
  s = s.replace(/```(?:([\w+-]+)\n)?([\s\S]*?)```/g, (m, lang, code) => stash(store, `<pre class="ncm-code"><code${lang ? ` data-lang="${escape(lang)}"` : ""}>${escape(code.replace(/^\n|\n$/g, ""))}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (m, code) => stash(store, `<code>${escape(code)}</code>`));
  // Inline rolls (and Foundry's links for them), enrichers, then any HTML tag.
  s = s.replace(/<a[^>]*class="[^"]*inline-roll[^"]*"[^>]*>[\s\S]*?<\/a>/g, (m) => stash(store, m));
  s = s.replace(/\[\[[\s\S]*?\]\]/g, (m) => stash(store, m));
  s = s.replace(/@\w+\[[^\]]*\](?:\{[^}]*\})?/g, (m) => stash(store, m));
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, (m) => stash(store, m));
  // Masked links (only web addresses).
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => stash(store, `<a href="${escape(url)}" target="_blank" rel="noopener nofollow">${escape(label)}</a>`));

  // Lines: headings, small text, quotes and lists are blocks; the rest are lines of text.
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^>>> ?([\s\S]*)$/))) {
      closeList();
      const rest = [m[1], ...lines.slice(i + 1)].map((l) => inline(l, store)).join("<br>");
      out.push(`<blockquote class="ncm-quote">${rest}</blockquote>`);
      break;
    }
    if ((m = line.match(/^(#{1,3}) (.+)$/))) {
      closeList();
      out.push(`<h${m[1].length + 2} class="ncm-h">${inline(m[2], store)}</h${m[1].length + 2}>`);
    } else if ((m = line.match(/^-# (.+)$/))) {
      closeList();
      out.push(`<small class="ncm-sub">${inline(m[1], store)}</small>`);
    } else if ((m = line.match(/^> ?(.*)$/)) && line.startsWith(">")) {
      closeList();
      // Consecutive quoted lines make one quote.
      const quoted = [m[1]];
      while (i + 1 < lines.length && /^> ?/.test(lines[i + 1]) && !lines[i + 1].startsWith(">>>")) quoted.push(lines[++i].replace(/^> ?/, ""));
      out.push(`<blockquote class="ncm-quote">${quoted.map((l) => inline(l, store)).join("<br>")}</blockquote>`);
    } else if ((m = line.match(/^\s*[-*] (.+)$/))) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(m[1], store)}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)] (.+)$/))) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(m[1], store)}</li>`);
    } else {
      closeList();
      out.push(`${inline(line, store)}\n`);
    }
  }
  closeList();
  let html = out.join("").replace(/\n$/, "").replace(/\n/g, "<br>");
  // Put the pieces back (a piece can hold another's placeholder: code inside a link label can't, but be safe).
  const back = new RegExp(`${MARK}(\\d+)${MARK}`, "g");
  for (let n = 0; n < 3 && back.test(html); n++) html = html.replace(back, (x, k) => store[Number(k)]);
  return html;
}

/** Does this text use any of the formatting (so a plain message is left exactly as typed)? */
export function hasFormatting(text) {
  return /\*|__|~~|\|\||`|^>|^#{1,3} |^-# |^\s*[-*] |^\s*\d+[.)] |\]\(https?:|\\[*_~|`]/m.test(String(text ?? "")) || /(^|\W)_\S/.test(String(text ?? ""));
}
