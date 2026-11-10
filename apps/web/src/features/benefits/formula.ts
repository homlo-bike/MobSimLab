/**
 * A small, safe formula language for the benefit tables (ADR-0040): numbers, named variables, + − × ÷, ^,
 * parentheses and the functions ln, log10, exp, sqrt, abs, min and max. Formulas are parsed once and
 * compiled to a JavaScript closure; nothing is ever evaluated as code.
 */

export type Vars = Record<string, number>;
export type Compiled = (v: Vars) => number;

/** Thrown for a formula that cannot be read, with the position of the problem. */
export class FormulaError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

type Tok =
  | { t: "num"; v: number; at: number }
  | { t: "id"; v: string; at: number }
  | { t: "op"; v: string; at: number }
  | { t: "end"; at: number };

const FUNCS: Record<string, { n: [number, number]; f: (...a: number[]) => number }> = {
  ln: { n: [1, 1], f: Math.log },
  log10: { n: [1, 1], f: Math.log10 },
  exp: { n: [1, 1], f: Math.exp },
  sqrt: { n: [1, 1], f: Math.sqrt },
  abs: { n: [1, 1], f: Math.abs },
  min: { n: [1, 20], f: Math.min },
  max: { n: [1, 20], f: Math.max },
};

/** The functions a formula may call. */
export const FUNCTION_NAMES = Object.keys(FUNCS);

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ t: "id", v: id[0], at: i });
      i += id[0].length;
      continue;
    }
    if ("+-*/^(),×÷".includes(c)) {
      out.push({ t: "op", v: c === "×" ? "*" : c === "÷" ? "/" : c, at: i });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected "${c}"`, i);
  }
  out.push({ t: "end", at: src.length });
  return out;
}

/**
 * Purpose: compile a formula over the given variable names.
 * Output: the compiled function and the variables it uses. Throws FormulaError for a syntax error, an
 * unknown variable or function, or a wrong number of arguments.
 */
export function compile(src: string, allowed: readonly string[]): { fn: Compiled; uses: string[] } {
  if (src.length > 2000) throw new FormulaError("The formula is too long", 0);
  const toks = tokens(src);
  const known = new Set(allowed);
  const uses = new Set<string>();
  let p = 0;
  const peek = () => toks[p]!;
  const isOp = (v: string) => {
    const t = peek();
    return t.t === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"`, peek().at);
    p++;
  };

  // expr := term (("+"|"-") term)*
  const expr = (): Compiled => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      const a = left;
      const b = term();
      left = op === "+" ? (v) => a(v) + b(v) : (v) => a(v) - b(v);
    }
    return left;
  };
  // term := unary (("*"|"/") unary)*
  const term = (): Compiled => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[p++] as { v: string }).v;
      const a = left;
      const b = unary();
      left = op === "*" ? (v) => a(v) * b(v) : (v) => a(v) / b(v);
    }
    return left;
  };
  // unary := ("-"|"+") unary | power
  const unary = (): Compiled => {
    if (isOp("-")) {
      p++;
      const a = unary();
      return (v) => -a(v);
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return power();
  };
  // power := atom ("^" unary)?   (right associative)
  const power = (): Compiled => {
    const a = atom();
    if (isOp("^")) {
      p++;
      const b = unary();
      return (v) => a(v) ** b(v);
    }
    return a;
  };
  const atom = (): Compiled => {
    const t = peek();
    if (t.t === "num") {
      p++;
      const n = t.v;
      return () => n;
    }
    if (t.t === "id") {
      p++;
      if (isOp("(")) {
        const f = FUNCS[t.v];
        if (!f) throw new FormulaError(`Unknown function "${t.v}"`, t.at);
        p++;
        const args: Compiled[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            p++;
            args.push(expr());
          }
        }
        expect(")");
        if (args.length < f.n[0] || args.length > f.n[1])
          throw new FormulaError(
            `"${t.v}" takes ${f.n[0] === f.n[1] ? f.n[0] : `${f.n[0]} or more`} values`,
            t.at,
          );
        return (v) => f.f(...args.map((a) => a(v)));
      }
      if (!known.has(t.v)) throw new FormulaError(`Unknown variable "${t.v}"`, t.at);
      uses.add(t.v);
      const name = t.v;
      return (v) => v[name] ?? NaN;
    }
    if (isOp("(")) {
      p++;
      const a = expr();
      expect(")");
      return a;
    }
    throw new FormulaError(
      t.t === "end" ? "The formula ends too early" : "Expected a number or a name",
      t.at,
    );
  };

  const fn = expr();
  if (peek().t !== "end") throw new FormulaError("Unexpected text after the formula", peek().at);
  return { fn, uses: [...uses] };
}

/** Purpose: the error message of a formula, or null when it compiles. */
export function formulaProblem(src: string, allowed: readonly string[]): string | null {
  try {
    compile(src, allowed);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? `${e.message} (at character ${e.at + 1})` : String(e);
  }
}
