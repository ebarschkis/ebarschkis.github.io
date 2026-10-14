/* RHO / LAB — exact arithmetic for deliberately small prime-field curves.
 * No dependencies. Browser: EC.*; Node: require('./core.js').
 * Points are treated as immutable {x, y} records; null denotes the identity O.
 * Field arithmetic is mod p; scalar coefficients are mod ord(P), never mod p.
 */
(function (root) {
  'use strict';
  const MAX_P = 2003;
  const mod = (a, m) => ((a % m) + m) % m;
  const equal = (P, Q) => P === null ? Q === null : Q !== null && P.x === Q.x && P.y === Q.y;
  const key = P => P === null ? 'O' : `${P.x},${P.y}`;
  const format = P => P === null ? '𝒪' : `(${P.x}, ${P.y})`;
  function integer(x, label) {
    if (!Number.isSafeInteger(x)) throw new TypeError(`${label} must be a safe integer.`);
    return x;
  }
  function prime(n) {
    if (!Number.isSafeInteger(n) || n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  }
  function inverse(a, m) {
    integer(a, 'Value'); integer(m, 'Modulus');
    if (m < 2) throw new RangeError('Modulus must be at least 2.');
    let r = m, s = mod(a, m), t = 0, u = 1;
    while (s !== 0) {
      const q = Math.floor(r / s);
      [r, s] = [s, r - q * s];
      [t, u] = [u, t - q * u];
    }
    if (r !== 1) throw new RangeError('This value has no modular inverse.');
    return mod(t, m);
  }
  class Curve {
    constructor(p, a, b) {
      if (!prime(p) || p < 5 || p > MAX_P) throw new RangeError(`p must be a prime between 5 and ${MAX_P}.`);
      integer(a, 'a'); integer(b, 'b');
      this.p = p; this.a = mod(a, p); this.b = mod(b, p);
      if (mod(4 * this.a ** 3 + 27 * this.b ** 2, p) === 0)
        throw new RangeError('Singular curve: 4a³ + 27b² is 0 modulo p. Choose different coefficients.');
      Object.freeze(this);
    }
    contains(P) {
      if (P === null) return true;
      if (!P || !Number.isInteger(P.x) || !Number.isInteger(P.y) || P.x < 0 || P.y < 0 || P.x >= this.p || P.y >= this.p) return false;
      return mod(P.y * P.y - P.x ** 3 - this.a * P.x - this.b, this.p) === 0;
    }
    negate(P) { return P === null ? null : {x: P.x, y: mod(-P.y, this.p)}; }
    add(P, Q) {
      // Internal inputs must be validated curve points (Domain/Problem do this).
      if (P === null) return Q;
      if (Q === null) return P;
      const p = this.p;
      if (P.x === Q.x && mod(P.y + Q.y, p) === 0) return null;
      const slope = equal(P, Q)
        ? mod((3 * P.x * P.x + this.a) * inverse(2 * P.y, p), p)
        : mod((Q.y - P.y) * inverse(Q.x - P.x, p), p);
      const x = mod(slope * slope - P.x - Q.x, p);
      return {x, y: mod(slope * (P.x - x) - P.y, p)};
    }
    multiply(k, P) {
      integer(k, 'Scalar');
      if (k < 0) return this.multiply(-k, this.negate(P));
      let R = null, B = P;
      while (k > 0) {
        if (k % 2 === 1) R = this.add(R, B);
        k = Math.floor(k / 2);
        if (k > 0) B = this.add(B, B);
      }
      return R;
    }
    points() {
      const roots = Array.from({length: this.p}, () => []);
      for (let y = 0; y < this.p; y++) roots[y * y % this.p].push(y);
      const out = [];
      for (let x = 0; x < this.p; x++) {
        for (const y of roots[mod(x ** 3 + this.a * x + this.b, this.p)]) out.push({x, y});
      }
      return out;
    }
  }
  class Domain {
    constructor(curve, P) {
      if (!(curve instanceof Curve)) throw new TypeError('Expected a validated Curve.');
      if (P === null || !curve.contains(P)) throw new RangeError('P must be a finite point on the curve, with coordinates in 0…p−1.');
      this.curve = curve; this.P = Object.freeze({...P});
      this.points = curve.points(); this.size = this.points.length + 1;
      this.subgroup = []; this.members = new Set();
      let R = null;
      do {
        this.subgroup.push(R); this.members.add(key(R)); R = curve.add(R, P);
        if (this.subgroup.length > this.size) throw new Error('Point-order computation exceeded the group size.');
      } while (R !== null);
      this.n = this.subgroup.length; this.cofactor = this.size / this.n;
      if (!prime(this.n)) throw new RangeError(`P has composite order ${this.n}. This lab requires a prime-order base point.`);
    }
  }
  class Problem {
    constructor(domain, Q) {
      if (!(domain instanceof Domain)) throw new TypeError('Expected a validated Domain.');
      if (!domain.curve.contains(Q)) throw new RangeError('Q must be on the curve, with coordinates in 0…p−1 (or 𝒪).');
      if (!domain.members.has(key(Q))) throw new RangeError('Q is outside ⟨P⟩. There is no scalar k with Q = kP for this base point.');
      this.curve = domain.curve; this.P = domain.P;
      this.Q = Q === null ? null : Object.freeze({...Q}); this.n = domain.n;
      Object.freeze(this);
    }
  }
  function mix32(x) {
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function partition(P, seed, kind = 'hash') {
    if (P === null) return 0; // The identity must not become trapped by doubling.
    if (kind === 'xmod') return P.x % 3;
    if (kind !== 'hash') throw new RangeError('Unknown partition function.');
    return mix32((P.x ^ Math.imul(P.y, 0x9e3779b1) ^ seed) >>> 0) % 3;
  }
  class RhoSolver {
    constructor(problem, seed = 7, kind = 'hash') {
      if (!(problem instanceof Problem)) throw new TypeError('Expected a validated Problem.');
      integer(seed, 'Seed');
      if (seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be in 0…4294967295.');
      if (!['hash', 'xmod'].includes(kind)) throw new RangeError('Unknown partition function.');
      // Copy only public inputs. No hidden scalar, point table, or orbit history.
      this.curve = problem.curve; this.P = problem.P; this.Q = problem.Q; this.n = problem.n;
      this.seed = seed; this.kind = kind; this.round = 0; this.evaluations = 0;
      const rng = random(seed);
      let alpha = Math.floor(rng() * this.n), beta = Math.floor(rng() * this.n);
      if (alpha === 0 && beta === 0) alpha = 1;
      const R = this.curve.add(this.curve.multiply(alpha, this.P), this.curve.multiply(beta, this.Q));
      this.T = {R, alpha, beta, index: 0, op: null}; this.H = {...this.T}; this.mid = null;
      this.status = this.Q === null ? 'trivial' : 'running';
      this.result = this.Q === null ? {k: 0, verified: true, trivial: true} : null;
    }
    advance(S) {
      const op = partition(S.R, this.seed, this.kind);
      let R, alpha, beta;
      if (op === 0) { R = this.curve.add(S.R, this.P); alpha = S.alpha + 1; beta = S.beta; }
      else if (op === 1) { R = this.curve.add(S.R, S.R); alpha = 2 * S.alpha; beta = 2 * S.beta; }
      else { R = this.curve.add(S.R, this.Q); alpha = S.alpha; beta = S.beta + 1; }
      return {R, alpha: mod(alpha, this.n), beta: mod(beta, this.n), index: S.index + 1, op};
    }
    step() {
      if (this.status !== 'running') return this.snapshot();
      this.T = this.advance(this.T);
      this.mid = this.advance(this.H); this.H = this.advance(this.mid);
      this.round++; this.evaluations += 3;
      if (equal(this.T.R, this.H.R)) {
        const numerator = mod(this.T.alpha - this.H.alpha, this.n);
        const denominator = mod(this.H.beta - this.T.beta, this.n);
        if (denominator === 0) {
          this.status = 'degenerate';
          this.result = {numerator, denominator, verified: false};
        } else {
          const inv = inverse(denominator, this.n);
          const k = mod(numerator * inv, this.n);
          const verified = equal(this.curve.multiply(k, this.P), this.Q);
          if (!verified) throw new Error('Collision verification failed.');
          this.result = {numerator, denominator, inverse: inv, k, verified};
          this.status = 'found';
        }
      }
      if (this.status === 'running' && this.round > this.n) throw new Error('Floyd cycle detection exceeded the finite subgroup size.');
      return this.snapshot();
    }
    snapshot() {
      return {round: this.round, evaluations: this.evaluations, T: {...this.T}, H: {...this.H},
        mid: this.mid ? {...this.mid} : null, status: this.status, result: this.result ? {...this.result} : null};
    }
  }
  function additionDetail(curve, A, B) {
    const S = curve.add(A, B), p = curve.p;
    if (A === null || B === null) return {S, type: 'identity'};
    if (A.x === B.x && mod(A.y + B.y, p) === 0) return {S, type: 'vertical', x: A.x};
    const doubling = equal(A, B);
    const numerator = mod(doubling ? 3 * A.x * A.x + curve.a : B.y - A.y, p);
    const denominator = mod(doubling ? 2 * A.y : B.x - A.x, p);
    const inv = inverse(denominator, p), slope = mod(numerator * inv, p);
    return {S, type: doubling ? 'double' : 'add', numerator, denominator, inverse: inv, slope,
      intercept: mod(A.y - slope * A.x, p), reflected: curve.negate(S)};
  }
  const API = {MAX_P, mod, inverse, prime, equal, key, format, Curve, Domain, Problem, RhoSolver, partition, additionDetail, random};
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.EC = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
