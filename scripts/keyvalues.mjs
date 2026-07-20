// Minimal Valve KeyValues (KV1) parser for items_game.txt.
// Handles: quoted keys/values, nested blocks, // comments, [$conditional] tags (ignored),
// duplicate object keys (deep-merged, matching the game's behavior).
export function parseKeyValues(text) {
  let i = 0;
  const n = text.length;

  function skipWs() {
    for (;;) {
      while (i < n && ' \t\r\n'.includes(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
      } else break;
    }
  }

  function readToken() {
    skipWs();
    if (i >= n) return null;
    const c = text[i];
    if (c === '{' || c === '}') { i++; return c; }
    if (c === '"') {
      i++;
      let s = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) { s += text[i + 1]; i += 2; }
        else s += text[i++];
      }
      i++;
      return { str: s, quoted: true };
    }
    // unquoted token
    let s = '';
    while (i < n && !' \t\r\n{}"'.includes(text[i])) s += text[i++];
    return { str: s, quoted: false };
  }

  function merge(target, key, value) {
    if (typeof value === 'object' && value !== null && typeof target[key] === 'object' && target[key] !== null) {
      for (const [k, v] of Object.entries(value)) merge(target[key], k, v);
    } else {
      target[key] = value;
    }
  }

  function parseBlock() {
    const obj = {};
    for (;;) {
      let tok = readToken();
      if (tok === null || tok === '}') return obj;
      if (tok === '{') throw new Error(`beklenmeyen '{' @${i}`);
      const key = tok.str;
      tok = readToken();
      // conditional tag like [$WIN32] between key and value (only unquoted tokens)
      if (tok && tok.str !== undefined && !tok.quoted && tok.str.startsWith('[')) tok = readToken();
      if (tok === '{') merge(obj, key, parseBlock());
      else if (tok && tok.str !== undefined) merge(obj, key, tok.str);
      else throw new Error(`'${key}' için değer yok @${i}`);
    }
  }

  return parseBlock();
}
