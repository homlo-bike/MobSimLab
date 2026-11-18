/**
 * A small XML reader for OGC capabilities documents (WMS and WMTS GetCapabilities). It reads elements, attributes
 * and text, skips comments, processing instructions and the document type, and decodes only the five predefined
 * entities and character references: no entity in a DTD is ever expanded and nothing outside the document is
 * read, so a hostile document cannot pull in files or grow itself. Namespace prefixes are dropped from names
 * (`ows:Identifier` is `Identifier`), which is all the capabilities readers need.
 */

/** One element: its local name, attributes (local names too), child elements and its own text. */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Purpose: decode the predefined entities and character references of a text or attribute value. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref.startsWith("#x")) return safeChar(parseInt(ref.slice(2), 16)) ?? whole;
    if (ref.startsWith("#")) return safeChar(parseInt(ref.slice(1), 10)) ?? whole;
    return ENTITIES[ref] ?? whole;
  });
}

function safeChar(code: number): string | null {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

const localName = (qname: string) => qname.slice(qname.indexOf(":") + 1);

/** Most elements a capabilities document may have; large services list a few thousand layers at most. */
const MAX_ELEMENTS = 500_000;
const MAX_DEPTH = 64;

/**
 * Purpose: parse an XML document into its root element.
 * Inputs: the document text. Output: the root element. Throws `XmlError` when it is not well-formed enough to read.
 */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let i = 0;
  let count = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) {
      top.text += decodeEntities(text.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(text.slice(i, lt));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end < 0) throw new XmlError("an XML comment is not closed");
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end < 0) throw new XmlError("a CDATA section is not closed");
      top.text += text.slice(lt + 9, end);
      i = end + 3;
    } else if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end < 0) throw new XmlError("a processing instruction is not closed");
      i = end + 2;
    } else if (text.startsWith("<!", lt)) {
      // The document type, with any internal subset in brackets: skipped, never expanded.
      let j = lt + 2;
      let depth = 0;
      for (; j < n; j++) {
        const c = text[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      i = j + 1;
    } else if (text[lt + 1] === "/") {
      const end = text.indexOf(">", lt);
      if (end < 0) throw new XmlError("an XML end tag is not closed");
      const name = localName(text.slice(lt + 2, end).trim());
      if (stack.length < 2 || top.name !== name) throw new XmlError(`unexpected end tag </${name}>`);
      stack.pop();
      i = end + 1;
    } else {
      // A start tag: find its end outside quoted attribute values.
      let j = lt + 1;
      let quote: string | null = null;
      for (; j < n; j++) {
        const c = text[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (j >= n) throw new XmlError("an XML start tag is not closed");
      let body = text.slice(lt + 1, j);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(body);
      if (!m) throw new XmlError("an XML tag has no name");
      const el: XmlElement = { name: localName(m[1]!), attrs: {}, children: [], text: "" };
      const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      const rest = body.slice(m[1]!.length);
      while ((a = attrRe.exec(rest))) {
        const key = a[1]!;
        if (key === "xmlns" || key.startsWith("xmlns:")) continue;
        el.attrs[localName(key)] = decodeEntities(a[2] ?? a[3] ?? "");
      }
      if (++count > MAX_ELEMENTS) throw new XmlError("the XML document is too large");
      top.children.push(el);
      if (!selfClosing) {
        if (stack.length > MAX_DEPTH) throw new XmlError("the XML document is nested too deeply");
        stack.push(el);
      }
      i = j + 1;
    }
  }
  if (stack.length !== 1)
    throw new XmlError(`the XML element <${stack[stack.length - 1]!.name}> is not closed`);
  const elements = root.children;
  if (elements.length !== 1) throw new XmlError("the document is not XML");
  return elements[0]!;
}

/** Purpose: the first child element with a local name, or undefined. */
export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => c.name === name);
}

/** Purpose: every child element with a local name. */
export function childrenOf(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

/** Purpose: the trimmed text of the first child element with a local name, or "". */
export function childText(el: XmlElement | undefined, name: string): string {
  return child(el, name)?.text.trim() ?? "";
}

/** Purpose: the element at a path of local names below `el` (first match at each step). */
export function path(el: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let at = el;
  for (const name of names) at = child(at, name);
  return at;
}
