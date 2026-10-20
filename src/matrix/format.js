// -----------------------------------------------------------------------------
// From the Markdown Gladys writes (the brain, the AI, the scenes) to a Matrix
// message: `body` keeps the text as typed (what clients without HTML show and
// what notifications quote), `formatted_body` carries the HTML subset of the
// Matrix specification (org.matrix.custom.html). A small converter on purpose:
// bold, italics, strikethrough, inline code, code blocks, links, headings and
// lists, everything else is escaped text.
// -----------------------------------------------------------------------------

export const MAX_BODY_LENGTH = 16_000; // well below the 64 KiB of a Matrix event

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  // Inline code first: its content is never formatted.
  const parts = text.split(/(`[^`\n]+`)/);
  return parts
    .map((part) => {
      if (/^`[^`\n]+`$/.test(part)) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part)
        .replace(
          /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
          (_, label, url) => `<a href="${url}">${label}</a>`,
        )
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
        .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
        .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    })
    .join('');
}

/**
 * Markdown to the HTML of a Matrix message.
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let list = null; // 'ul' | 'ol'
  let paragraph = [];
  let code = null;

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (/^```/.test(line)) {
      closeParagraph();
      closeList();
      code = [];
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(heading[1].length + 2, 6); // a chat message has no page title
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      closeParagraph();
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        html.push(`<${kind}>`);
        list = kind;
      }
      html.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
    } else if (line.trim() === '') {
      closeParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(line);
    }
  }
  if (code !== null) {
    html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  }
  closeParagraph();
  closeList();
  return html.join('');
}

/** The HTML a plain text would get anyway: no need to send it. */
const plainHtml = (text) => `<p>${escapeHtml(text).split('\n').join('<br>')}</p>`;

/**
 * The content of an m.room.message event for a Markdown text.
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.notice] m.notice: the bot convention, clients do not ping for it
 */
export function textContent(text, { notice = false } = {}) {
  const body = text.length > MAX_BODY_LENGTH ? `${text.slice(0, MAX_BODY_LENGTH - 1)}…` : text;
  const content = { msgtype: notice ? 'm.notice' : 'm.text', body };
  const html = markdownToHtml(body);
  if (html !== plainHtml(body.trim())) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = html;
  }
  return content;
}

/**
 * The image Gladys attaches to a message (a camera snapshot), from its
 * "image/jpg;base64,..." form. Null when it is not an image.
 * @param {unknown} file
 * @returns {{ buffer: Buffer, contentType: string, extension: string }|null}
 */
export function parseImage(file) {
  if (typeof file !== 'string') {
    return null;
  }
  const match = file.match(/^(?:data:)?(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return null;
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    return null;
  }
  // Gladys writes image/jpg: the registered type is image/jpeg.
  const contentType =
    match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const extension = contentType.split('/')[1].replace('jpeg', 'jpg').replace(/\+.*$/, '');
  return { buffer, contentType, extension };
}
