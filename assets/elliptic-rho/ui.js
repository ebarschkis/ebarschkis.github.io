/* RHO / LAB — display and interaction layer.
 * Rendering intentionally keeps history; the RhoSolver itself does not.
 * Every plotted curve point is computed, not sampled from a real-valued curve.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const E = window.EC;
  const C = {mint:'#315e50', orange:'#986025', purple:'#942c36', text:'#222b3d', muted:'#655e4d', dim:'#726953',
    buckets:['#44766b','#8b536c','#98772d'], bg:'#faf5e8', grid:'#ded4bd'};
  const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',monospace";
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const presets = {
    default: {p:211,a:0,b:7,P:{x:3,y:33},k:121},
    small: {p:97,a:0,b:7,P:{x:1,y:28},k:47},
    cofactor: {p:223,a:1,b:1,P:{x:0,y:1},k:37},
    large: {p:1009,a:0,b:11,P:{x:1,y:298},k:613},
    largest: {p:2003,a:1,b:20,P:{x:1,y:45},k:1417},
    degenerate: {p:211,a:0,b:7,P:{x:3,y:33},k:121,seed:2,kind:'xmod'}
  };
  let domain, problem, solver, frames = [], view = 0, mode = 'rho';
  let playing = false, nextTick = 0, attempt = 1, dirty = true;
  let selected, hover, keyboardPoint = -1, plot = null, orbit = null, addition = null;
  let transitionStart = -1e6, transitionDuration = 400, previousFrame = null;
  const surfaces = {
    field: {canvas:$('fieldCanvas'),context:$('fieldCanvas').getContext('2d'),w:0,h:0},
    orbit: {canvas:$('orbitCanvas'),context:$('orbitCanvas').getContext('2d'),w:0,h:0}
  };
  const opName = i => ['+ P','× 2','+ Q'][i];
  const current = () => frames[view];
  const point = P => E.format(P);
  const htmlPoint = P => point(P);
  const fmt = n => n.toLocaleString('en-US');
  const setText = (id, str) => { $(id).textContent = str; };
  const announce = str => { setText('announcement',str); };
  function fail(error) { playing = false; if(solver) $('partition').value=solver.kind; setText('error',error.message || String(error)); updateUI(); }
  function numberInput(id, name) {
    const raw = $(id).value.trim();
    if (raw === '') throw new Error(`${name} is required.`);
    const n = Number(raw);
    if (!Number.isSafeInteger(n)) throw new Error(`${name} must be an integer.`);
    return n;
  }
  function seedInput() {
    const s = numberInput('seed','Walk seed');
    if (s < 0 || s > 0xffffffff) throw new Error('Walk seed must be in 0…4294967295.');
    return s;
  }
  function syncForm() {
    const c = domain.curve;
    $('customP').value=c.p; $('customA').value=c.a; $('customB').value=c.b;
    $('baseX').value=domain.P.x; $('baseY').value=domain.P.y;
    $('targetX').value=problem.Q?.x ?? 0; $('targetY').value=problem.Q?.y ?? 0;
    $('targetInfinity').checked=problem.Q===null;
    $('targetX').disabled=$('targetY').disabled=problem.Q===null;
    setText('heroP',point(problem.P)); setText('heroQ',point(problem.Q));
    $('targetReadout').value=point(problem.Q);
    setText('domainBadge',`p = ${c.p}  ·  #E = ${domain.size}  ·  n = ${domain.n}  ·  h = ${domain.cofactor}`);
    const ax = c.a === 0 ? '' : ` + ${c.a===1?'':c.a}x`;
    const b = c.b === 0 ? '' : ` + ${c.b}`;
    setText('curveEquation',`y² ≡ x³${ax}${b} (mod ${c.p})  ·  ${domain.points.length} finite points + 𝒪`);
    for (const id of ['uSlider','vSlider','uNumber','vNumber']) $(id).max=domain.n-1;
    setScalars(Math.min(7,domain.n-1),Math.min(11,domain.n-1));
    setText('coefficientMod',`coefficients mod ${domain.n}`);
    setText('sqrtN',Math.sqrt(domain.n).toFixed(1));
    $('fieldCanvas').setAttribute('aria-label',`Elliptic curve over F ${c.p}, ${domain.points.length} finite points plus the identity. Base P ${point(problem.P)}, target Q ${point(problem.Q)}. Arrow keys inspect points; Enter selects a subgroup point as Q.`);
  }
  function commitProblem(d, Q, resetAttempts=true) {
    // Validate before replacing any current curve or walk.
    const p = new E.Problem(d,Q);
    const s = new E.RhoSolver(p,seedInput(),$('partition').value);
    domain=d; problem=p; solver=s; playing=false;
    if(resetAttempts) attempt=1;
    frames=[solver.snapshot()]; view=0; previousFrame=null;
    selected=undefined; hover=undefined; keyboardPoint=-1; $('tooltip').hidden=true;
    setText('error',''); syncForm(); refresh();
    announce(`Loaded a curve over F ${d.curve.p}; base point has order ${d.n}. Target ${point(Q)}.`);
  }
  function loadPreset(name) {
    const v = presets[name]; if (!v) return;
    try {
      $('seed').value=v.seed??7; $('partition').value=v.kind??'hash';
      const curve = new E.Curve(v.p,v.a,v.b), d = new E.Domain(curve,v.P);
      // The demo generator computes Q, but the solver is never given k.
      const Q = curve.multiply(v.k,v.P);
      commitProblem(d,Q); $('preset').value=name;
    } catch (error) { fail(error); }
  }
  function resetWalk(resetAttempts=true) {
    try {
      const next = new E.RhoSolver(problem,seedInput(),$('partition').value);
      playing=false; solver=next; frames=[next.snapshot()]; view=0; previousFrame=null;
      if(resetAttempts) attempt=1;
      setText('error',''); refresh();
    } catch(error) { fail(error); }
  }
  function newWalk() {
    $('seed').value=(solver.seed+1)>>>0; attempt++; resetWalk(false);
    announce(`New walk, seed ${solver.seed}, attempt ${attempt}.`);
  }
  function interval() { return 720 / Number($('speed').value); }
  function advance(animate=true) {
    const before=current();
    if(view < frames.length-1) view++;
    else if(solver.status==='running') { frames.push(solver.step()); view++; }
    else return false;
    previousFrame=before; transitionStart=animate ? performance.now() : -1e6;
    transitionDuration=Math.min(480,interval()*.78);
    if(current().status!=='running') {
      playing=false;
      if(current().status==='found') announce(`Collision at round ${current().round}. Recovered scalar k equals ${current().result.k}, verified by scalar multiplication.`);
      else if(current().status==='degenerate') announce('Degenerate collision: the denominator is zero. Retry with a new seed.');
    }
    refresh(); return true;
  }
  function playPause() {
    if(mode!=='rho') return;
    if(playing) { playing=false; updateUI(); return; }
    if(current().status==='degenerate') newWalk();
    else if(view===frames.length-1 && current().status!=='running') {
      if(current().status==='trivial') return;
      view=0; previousFrame=null; refresh();
    }
    playing=true; nextTick=performance.now()+70; updateUI();
  }
  function finish() {
    playing=false;
    if(solver.status==='running') {
      // Run one attempt only. A degenerate collision remains visible, not hidden.
      while(solver.status==='running') frames.push(solver.step());
    }
    view=frames.length-1; previousFrame=null; transitionStart=-1e6; refresh();
    if(current().status==='found') announce(`Recovered k = ${current().result.k} in ${current().round} Floyd rounds.`);
    else if(current().status==='degenerate') announce('A collision was found, but it gives zero denominator. Restart with a new seed.');
  }
  function setMode(next) {
    mode=next; playing=false; previousFrame=null; $('tooltip').hidden=true;
    const rho=mode==='rho';
    for(const id of ['rhoPanel','rhoControls','topologyCard','trailLabel','traceDetails']) $(id).hidden=!rho;
    for(const id of ['arithPanel','additionControls','lineLabel']) $(id).hidden=rho;
    $('colorPartitions').closest('label').hidden=!rho;
    $('rhoTab').classList.toggle('active',rho); $('addTab').classList.toggle('active',!rho);
    $('rhoTab').setAttribute('aria-selected',String(rho)); $('addTab').setAttribute('aria-selected',String(!rho));
    $('rhoTab').tabIndex=rho?0:-1; $('addTab').tabIndex=rho?-1:0;
    $('plotLegend').innerHTML=rho
      ? '<span class="legend-item"><i class="diamond"></i>Base P</span><span class="legend-item purple"><i class="ring"></i>Target Q</span><span class="legend-item mint"><i class="dot"></i>Tortoise</span><span class="legend-item orange"><i class="dot"></i>Hare</span>'
      : '<span class="legend-item mint"><i class="dot"></i>A</span><span class="legend-item orange"><i class="dot"></i>B</span><span class="legend-item purple"><i class="ring"></i>A + B</span><span class="legend-item"><i class="dot"></i>Modular line</span>';
    setText('legendHint',rho?'Trails are algorithm jumps, not a continuous curve.':'A line over 𝔽p is a set of discrete points.');
    refresh(); requestAnimationFrame(resizeAll);
  }
  function setScalars(u,v) {
    const n=domain.n;
    u=E.mod(u,n); v=E.mod(v,n);
    $('uSlider').value=$('uNumber').value=u; $('vSlider').value=$('vNumber').value=v;
    const A=domain.curve.multiply(u,domain.P), B=domain.curve.multiply(v,domain.P);
    addition={u,v,A,B,...E.additionDetail(domain.curve,A,B)};
    if(mode==='add') updateAddition(); dirty=true;
  }
  function updateAddition() {
    const a=addition, c=domain.curve, p=c.p, S=a.S;
    setText('aLabel',`A = ${a.u}P`); setText('bLabel',`B = ${a.v}P`);
    setText('aPoint',point(a.A)); setText('bPoint',point(a.B));
    setText('sumScalar',`${E.mod(a.u+a.v,domain.n)}P`);
    let d='', note='';
    if(a.type==='identity') {
      d=`<div class="derivation-label">The identity rule</div><p>𝒪 + B = B · A + 𝒪 = A</p><p><span class="purple">A + B = ${htmlPoint(S)}</span></p>`;
      note='The point at infinity 𝒪 is the additive identity. It has no finite x or y coordinate and is shown in its own chip, outside the coordinate plane.';
    } else if(a.type==='vertical') {
      d=`<div class="derivation-label">Inverse points / vertical line</div><p>x<sub>A</sub> = x<sub>B</sub> = ${a.A.x}<br>y<sub>A</sub> + y<sub>B</sub> ≡ 0 (mod ${p})</p><p class="purple">A + B = 𝒪</p>`;
      note='A point and its inverse sum to the identity. When y = 0, the point is its own inverse, so doubling also gives 𝒪. No denominator is inverted in this case.';
    } else {
      const top=a.type==='double'?'3x<sub>A</sub>² + a':'y<sub>B</sub> − y<sub>A</sub>';
      const bot=a.type==='double'?'2y<sub>A</sub>':'x<sub>B</sub> − x<sub>A</sub>';
      d=`<div class="derivation-label">${a.type==='double'?'Doubling / tangent slope':'Addition / secant slope'} · modulo ${p}</div><p>λ = (${top}) · (${bot})<sup>−1</sup><br>λ ≡ ${a.numerator} · ${a.denominator}<sup>−1</sup><br>λ ≡ ${a.numerator} · ${a.inverse} ≡ <span class="mint">${a.slope}</span></p><div class="derivation-label">Result coordinates · modulo ${p}</div><p>x<sub>S</sub> = λ² − x<sub>A</sub> − x<sub>B</sub> ≡ ${S.x}<br>y<sub>S</sub> = λ(x<sub>A</sub> − x<sub>S</sub>) − y<sub>A</sub> ≡ ${S.y}</p><p class="purple">A + B = ${htmlPoint(S)}</p>`;
      note=`The faint dots are the finite-field line y ≡ ${a.slope}x + ${a.intercept} (mod ${p}). Its third intersection is −S = ${point(a.reflected)}; reflect with y ↦ −y mod ${p} to get S. Repeated intersections count with multiplicity.`;
    }
    $('additionDerivation').innerHTML=d; setText('arithmeticNote',note);
  }
  function buildOrbit() {
    const sequence=[frames[0].T.R];
    for(let j=1;j<=view;j++) { sequence.push(frames[j].mid.R); sequence.push(frames[j].H.R); }
    const seen=new Map(), unique=[]; let mu=null,lambda=null;
    for(const R of sequence) {
      const k=E.key(R);
      if(seen.has(k)) { mu=seen.get(k); lambda=unique.length-mu; break; }
      seen.set(k,unique.length); unique.push(R);
    }
    return {sequence,unique,seen,mu,lambda,visited:new Set(sequence.map(E.key))};
  }
  function updateInspector() {
    if(selected===undefined) {
      setText('inspectorText',domain.cofactor>1?'Dim dots lie outside ⟨P⟩. Click a point to inspect it.':'Click a dot to inspect its coordinates and next move.');
      $('useTarget').hidden=true; $('clearPoint').hidden=true; return;
    }
    const inside=domain.members.has(E.key(selected));
    const op=E.partition(selected,solver.seed,solver.kind);
    $('inspectorText').innerHTML=`<b>${htmlPoint(selected)}</b> · ${inside?'in ⟨P⟩':'outside ⟨P⟩'}${mode==='rho'&&inside?` · next ${opName(op)}`:''}`;
    $('useTarget').hidden=false; $('useTarget').disabled=!inside;
    $('useTarget').title=inside?'Set this point as the new target Q':'No solution exists for this point relative to P';
    $('clearPoint').hidden=false;
  }
  function updateUI() {
    if(!domain || !frames.length) return;
    const s=current(), n=domain.n;
    const done=s.status==='found'||s.status==='trivial';
    setText('heroK',done?s.result.k:'?');
    setText('problemNote',done?`Verified: k ≡ ${s.result.k} (mod ${n}).`:`Recover k modulo n = ${n}, the order of the base point P.`);
    $('heroK').style.fontSize=done&&s.result.k>999?'30px':'';
    const stat=s.status==='found'?'Collision':s.status==='trivial'?'Identity':s.status==='degenerate'?'Retry needed':playing?'Walking':s.round===0?'Ready':'Paused';
    setText('status',stat); $('status').className=`status ${s.status==='running'?(playing?'running':''):s.status}`;
    setText('tPoint',point(s.T.R)); setText('hPoint',point(s.H.R));
    setText('tExpr',`${s.T.alpha}P + ${s.T.beta}Q`); setText('hExpr',`${s.H.alpha}P + ${s.H.beta}Q`);
    $('tLast').innerHTML=s.round?`R<sub>${s.T.index}</sub> · <span>${opName(s.T.op)}</span>`:'R₀ · shared start';
    $('hLast').innerHTML=s.round?`R<sub>${s.H.index}</sub> · <span>${opName(s.mid.op)} → ${opName(s.H.op)}</span>`:'R₀ · shared start';
    setText('roundCount',fmt(s.round)); setText('opCount',fmt(s.evaluations));
    const t=E.partition(s.T.R,solver.seed,solver.kind),h=E.partition(s.H.R,solver.seed,solver.kind);
    document.querySelectorAll('.partition-row').forEach(row=>{
      const i=Number(row.dataset.bucket), active=s.status==='running'&&(i===t||i===h);
      row.classList.toggle('active',active);
      row.querySelector('.partition-next').innerHTML=s.status==='running'?`${i===t?'<span class="mint">T</span>':''}${i===h?'<span class="orange">H</span>':''}`:'';
    });
    setText('partitionHelp',solver.kind==='hash'
      ?'A seeded hash chooses the bucket from the point, never from its coefficients. 𝒪 belongs to S₀. T / H mark the next moves.'
      :'The x coordinate modulo 3 selects S₀, S₁ or S₂. 𝒪 belongs to S₀. T / H mark the next moves. This simple partition can mix poorly.');
    $('collisionCard').className='collision-card'+(done?' success':s.status==='degenerate'?' warning':'');
    $('collisionResult').hidden=!done;
    if(s.status==='found') {
      const r=s.result;
      setText('collisionTitle',`Collision: R${s.T.index} = R${s.H.index} = ${point(s.T.R)}`);
      $('collisionFormula').innerHTML=`${s.T.alpha}P + ${s.T.beta}Q = ${s.H.alpha}P + ${s.H.beta}Q<br><span class="muted">${r.numerator}P = ${r.denominator}Q</span><br>k ≡ ${r.numerator} · ${r.denominator}<sup>−1</sup><br>k ≡ ${r.numerator} · ${r.inverse} <span class="subtle">(mod ${n})</span>`;
      setText('collisionResult',`k = ${r.k}`);
      setText('collisionNote',`Verified: ${r.k}P = ${point(problem.Q)} = Q. All solutions are k ≡ ${r.k} (mod ${n}). The two β coefficients differ, so the denominator is invertible.`);
    } else if(s.status==='degenerate') {
      setText('collisionTitle','Same point. No new information.');
      $('collisionFormula').innerHTML=`${s.T.alpha}P + ${s.T.beta}Q = ${s.H.alpha}P + ${s.H.beta}Q<br><span class="orange">0 · P = 0 · Q</span><br>β<sub>H</sub> − β<sub>T</sub> ≡ 0 <span class="subtle">(mod ${n})</span>`;
      setText('collisionNote',`Zero has no inverse. This collision does not determine k. Retry with a new seed to change the initial coefficients${solver.kind==='hash'?' and the partition':''}.`);
    } else if(s.status==='trivial') {
      setText('collisionTitle','The target is the identity.');
      $('collisionFormula').innerHTML='Q = 𝒪 = 0 · P'; setText('collisionResult','k = 0');
      setText('collisionNote',`No collision search is needed. The unique scalar residue is 0 modulo ${n}.`);
    } else {
      setText('collisionTitle','A match becomes an equation.');
      $('collisionFormula').innerHTML=`<span class="muted">When R<sub>T</sub> = R<sub>H</sub>:</span><br>(α<sub>T</sub> − α<sub>H</sub>)P = (β<sub>H</sub> − β<sub>T</sub>)Q<br><span class="mint">k ≡ (α<sub>T</sub> − α<sub>H</sub>)(β<sub>H</sub> − β<sub>T</sub>)<sup>−1</sup></span><br><span class="subtle">All coefficient arithmetic modulo ${n}.</span>`;
      setText('collisionNote',s.round===0?'The shared seed is not counted as a collision. Start walking; compare only after a positive round.':'A valid match needs the full point—including y—not just a crossing of trails.');
    }
    setText('playText',playing?'Pause':s.status==='degenerate'?'Retry':s.status==='found'?'Replay':'Play');
    $('play').querySelector('.symbol').textContent=playing?'Ⅱ':'▶';
    $('play').disabled=s.status==='trivial';
    $('step').disabled=view===frames.length-1&&s.status!=='running';
    $('finish').disabled=view===frames.length-1&&s.status!=='running';
    $('timeline').max=frames.length-1; $('timeline').value=view; $('timeline').disabled=frames.length<=1;
    setText('timelineRound',view); setText('timelineNote',frames.length>1?`${frames.length-1} recorded`:'Step to record');
    setText('attempt',`ATTEMPT ${String(attempt).padStart(2,'0')}`);
    $('newWalk').disabled=s.status==='trivial';
    if(orbit) {
      setText('topologyMeta',orbit.lambda===null?`${orbit.unique.length} point${orbit.unique.length===1?'':'s'} discovered`:`tail μ = ${orbit.mu} · cycle λ = ${orbit.lambda}`);
      setText('orbitNote',orbit.lambda===null?'Same point ⇒ same next point. The drawing unfolds only as the walk is explored.':`A repeat is visible in the recorded history. Floyd still compares only Rᵢ with R₂ᵢ. This topology is a display aid, not the solver’s memory.`);
      $('orbitCanvas').setAttribute('aria-label',orbit.lambda===null?`Observed orbit with ${orbit.unique.length} distinct points; no cycle recorded yet.`:`Observed orbit with tail length ${orbit.mu} and cycle length ${orbit.lambda}. Tortoise at index ${s.T.index}, hare at index ${s.H.index}.`);
    }
    updateInspector(); if(mode==='add') updateAddition(); updateTrace(); fitReadouts(); dirty=true;
  }
  function updateTrace() {
    const rows=frames.slice(Math.max(0,view-9),view+1);
    $('traceBody').innerHTML=rows.map(s=>{
      const match=s.round>0&&E.equal(s.T.R,s.H.R);
      return `<tr${match?' class="match"':''}><td>${s.round}</td><td>${htmlPoint(s.T.R)}</td><td>(${s.T.alpha}, ${s.T.beta})</td><td>${htmlPoint(s.H.R)}</td><td>(${s.H.alpha}, ${s.H.beta})</td><td>${s.round===0?'seed':match?'YES':'—'}</td></tr>`;
    }).join('');
  }
  function refresh() { orbit=buildOrbit(); updateUI(); }
  function resizeSurface(s) {
    const r=s.canvas.getBoundingClientRect();
    if(r.width<1 || r.height<1) return;
    const dpr=Math.min(window.devicePixelRatio||1,2.5);
    const w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);
    if(s.canvas.width!==w||s.canvas.height!==h) { s.canvas.width=w;s.canvas.height=h; }
    s.w=r.width;s.h=r.height;s.dpr=dpr;dirty=true;
  }
  function fitReadouts() {
    // Keep four-digit coordinates legible without spilling into the adjacent card.
    for(const id of ['tPoint','hPoint','tExpr','hExpr']) {
      const el=$(id); if(!el.clientWidth) continue;
      el.style.fontSize='';
      const font=parseFloat(getComputedStyle(el).fontSize), range=document.createRange();
      range.selectNodeContents(el); const width=range.getBoundingClientRect().width;
      if(width>el.clientWidth-1) el.style.fontSize=Math.max(10,Math.floor(font*(el.clientWidth-1)/width))+'px';
    }
  }
  function resizeAll() { Object.values(surfaces).forEach(resizeSurface); fitReadouts(); }
  function begin(s) {
    const {context:g,w,h,dpr}=s;
    g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);g.lineCap='round';g.lineJoin='round';
    return g;
  }
  function circle(g,x,y,r,fill,stroke=null,width=1) {
    g.beginPath();g.arc(x,y,Math.max(.2,r),0,2*Math.PI);
    if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=width;g.stroke();}
  }
  function line(g,a,b,color,width=1) {
    g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.strokeStyle=color;g.lineWidth=width;g.stroke();
  }
  function arrow(g,a,b,color,width=1,at=.72) {
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<10)return;
    const p={x:a.x+at*dx,y:a.y+at*dy},ux=dx/len,uy=dy/len,size=3.6;
    g.beginPath();g.moveTo(p.x-size*ux-size*.55*uy,p.y-size*uy+size*.55*ux);g.lineTo(p.x,p.y);g.lineTo(p.x-size*ux+size*.55*uy,p.y-size*uy-size*.55*ux);g.strokeStyle=color;g.lineWidth=width;g.stroke();
  }
  function chip(g,x,y,text,color=C.text,align='left',fontSize=10) {
    g.save();g.font=`${fontSize}px ${MONO}`;const w=g.measureText(text).width+10;
    let l=align==='right'?x-w:align==='center'?x-w/2:x;
    l=Math.max(2,Math.min(l,surfaces.field.w-w-2));
    g.fillStyle='#faf5e8ed';g.fillRect(l,y-10,w,18);g.fillStyle=color;g.textAlign='left';g.textBaseline='middle';g.fillText(text,l+5,y-1);g.restore();
  }
  function curvePath(g,a,b,color,opacity=1,width=1.2,bend=1) {
    g.save();g.globalAlpha=opacity;
    if(Math.hypot(a.x-b.x,a.y-b.y)<1) {circle(g,a.x+7,a.y-7,9,null,color,width);g.restore();return;}
    const dx=b.x-a.x,dy=b.y-a.y;
    const c={x:(a.x+b.x)/2-dy*.055*bend,y:(a.y+b.y)/2+dx*.055*bend};
    g.beginPath();g.moveTo(a.x,a.y);g.quadraticCurveTo(c.x,c.y,b.x,b.y);g.strokeStyle=color;g.lineWidth=width;g.stroke();
    arrow(g,a,b,color,width,.63);g.restore();
  }
  function fieldPosition(P) {
    if(P===null) return {x:plot.l+17,y:18};
    return {x:plot.l+P.x/(domain.curve.p-1)*plot.w,y:plot.t+plot.h-P.y/(domain.curve.p-1)*plot.h};
  }
  function drawField(now) {
    const srf=surfaces.field;if(!srf.w||!domain)return;
    const g=begin(srf),w=srf.w,h=srf.h,p=domain.curve.p;
    plot={l:w<380?39:47,t:43,w:w-(w<380?56:69),h:h-77};
    // A discrete coordinate plane. The infinity chip is explicitly outside it.
    for(let i=0;i<=8;i++) {
      const x=plot.l+plot.w*i/8,y=plot.t+plot.h*i/8;
      line(g,{x,y:plot.t},{x,y:plot.t+plot.h},i===0?'#b9ad94':C.grid,i===0?1:.5);
      line(g,{x:plot.l,y},{x:plot.l+plot.w,y},i===8?'#b9ad94':C.grid,i===8?1:.5);
    }
    if(p<=223) {
      const skip=p<=97?4:10;g.fillStyle='#7269533b';
      for(let x=0;x<p;x+=skip)for(let y=0;y<p;y+=skip){const q=fieldPosition({x,y});g.fillRect(q.x-.5,q.y-.5,1,1);}
    }
    g.font=`9px ${MONO}`;g.fillStyle=C.dim;g.textBaseline='middle';
    for(let i=0;i<=4;i++) {
      const v=Math.round((p-1)*i/4),pos=fieldPosition({x:v,y:v});
      g.textAlign='center';g.fillText(String(v),pos.x,plot.t+plot.h+15);
      g.textAlign='right';g.fillText(String(v),plot.l-9,pos.y);
    }
    g.textAlign='left';g.fillText('y',plot.l-22,plot.t-13);
    g.textAlign='right';g.fillText('x',plot.l+plot.w+14,plot.t+plot.h+15);
    g.textAlign='right';g.fillText(`𝔽${p} × 𝔽${p}`,plot.l+plot.w,18);
    g.fillStyle='#eee3c9';g.fillRect(plot.l,6,39,25);g.strokeStyle='#b9ad94';g.lineWidth=.7;g.strokeRect(plot.l,6,39,25);
    g.textAlign='left';g.fillStyle=C.muted;g.font=`13px ${MONO}`;g.fillText('𝒪',plot.l+12,19);
    if(w>440){g.font=`9px ${MONO}`;g.fillStyle=C.dim;g.fillText('identity / no finite coordinates',plot.l+48,19);}
    if(mode==='rho'&&$('showTrail').checked&&view>0) {
      const start=Math.max(1,view-13), count=view-start+1;
      for(let j=start;j<=view;j++) {
        const f=frames[j],old=frames[j-1],alpha=.12+.50*(j-start+1)/count;
        curvePath(g,fieldPosition(old.H.R),fieldPosition(f.mid.R),C.orange,alpha*.75,1,-1);
        curvePath(g,fieldPosition(f.mid.R),fieldPosition(f.H.R),C.orange,alpha*.75,1,-1);
        curvePath(g,fieldPosition(old.T.R),fieldPosition(f.T.R),C.mint,alpha,1.4,1);
      }
    }
    if(mode==='add'&&$('showLine').checked) {
      const a=addition;
      if(a.type==='add'||a.type==='double') {
        for(let x=0;x<p;x++){const q=fieldPosition({x,y:E.mod(a.slope*x+a.intercept,p)});circle(g,q.x,q.y,p>1000?.9:1.3,'#243e7450');}
        const neg=fieldPosition(a.reflected),pos=fieldPosition(a.S);g.setLineDash([3,5]);line(g,neg,pos,'#942c3670',1);g.setLineDash([]);
        circle(g,neg.x,neg.y,6,null,'#942c3690',1);
      } else if(a.type==='vertical') {
        for(let y=0;y<p;y++){const q=fieldPosition({x:a.x,y});circle(g,q.x,q.y,p>223?.65:1.2,'#243e7450');}
      }
    }
    const baseRadius=p>1000?1.7:p>500?2:p>100?2.5:3.2;
    for(const P of domain.points) {
      const q=fieldPosition(P),inside=domain.members.has(E.key(P));
      const seen=mode==='rho'&&orbit.visited.has(E.key(P));
      let color=inside?'#777365':'#b5ac97';
      if(mode==='rho'&&$('colorPartitions').checked&&inside)color=C.buckets[E.partition(P,solver.seed,solver.kind)];
      g.globalAlpha=inside?(seen?1:.78):.38;
      circle(g,q.x,q.y,inside?baseRadius:Math.max(1.3,baseRadius-.6),color);
    }
    g.globalAlpha=1;
    // Mark actual states at curve points. Traveling particles are only transition cues.
    if(mode==='rho'&&!reducedMotion.matches&&previousFrame&&now-transitionStart<transitionDuration&&view>0) {
      const phase=Math.max(0,Math.min(1,(now-transitionStart)/transitionDuration));
      const f=current();
      function particle(A,B,t,col,bend){
        if(E.equal(A,B))return;
        const a=fieldPosition(A),b=fieldPosition(B),dx=b.x-a.x,dy=b.y-a.y;
        const c={x:(a.x+b.x)/2-dy*.055*bend,y:(a.y+b.y)/2+dx*.055*bend};
        const x=(1-t)**2*a.x+2*(1-t)*t*c.x+t*t*b.x,y=(1-t)**2*a.y+2*(1-t)*t*c.y+t*t*b.y;
        g.save();circle(g,x,y,3,col);g.restore();
      }
      particle(previousFrame.T.R,f.T.R,phase,C.mint,1);
      if(phase<.5)particle(previousFrame.H.R,f.mid.R,phase*2,C.orange,-1);
      else particle(f.mid.R,f.H.R,(phase-.5)*2,C.orange,-1);
    }
    const marks=mode==='rho'?
      [{P:problem.P,name:'P',color:C.text,shape:'diamond'},{P:problem.Q,name:'Q',color:C.purple,shape:'ring'},
        {P:current().T.R,name:'T',color:C.mint,shape:'walker'},{P:current().H.R,name:'H',color:C.orange,shape:'walker'}]:
      [{P:addition.A,name:'A',color:C.mint,shape:'walker'},{P:addition.B,name:'B',color:C.orange,shape:'walker'},
        {P:addition.S,name:'S',color:C.purple,shape:'ring'}];
    const grouped=new Map();
    for(const m of marks){const k=E.key(m.P);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(m);}
    for(const group of grouped.values()) {
      const q=fieldPosition(group[0].P);
      group.forEach((m,index)=>{
        if(m.shape==='diamond') {
          const r=5.6+index;g.beginPath();g.moveTo(q.x,q.y-r);g.lineTo(q.x+r,q.y);g.lineTo(q.x,q.y+r);g.lineTo(q.x-r,q.y);g.closePath();g.fillStyle=C.bg;g.fill();g.strokeStyle=m.color;g.lineWidth=1.7;g.stroke();
        } else if(m.shape==='ring') {circle(g,q.x,q.y,7+index*3,C.bg,m.color,1.7);circle(g,q.x,q.y,2.2,m.color);}
        else {g.save();circle(g,q.x,q.y,5+index*3,index===0?m.color:null,m.color,1.6);g.restore();}
      });
      const color=group.length>1?C.text:group[0].color, txt=group.map(m=>m.name).join(' · ');
      const y=q.y<plot.t+15&&group[0].P!==null?q.y+19:q.y-15;
      chip(g,q.x+(q.x>w-100?-11:11),y,txt,color,q.x>w-100?'right':'left',10);
    }
    if(selected!==undefined) {
      const q=fieldPosition(selected);g.setLineDash([2,4]);circle(g,q.x,q.y,13,null,C.text,1);g.setLineDash([]);
    }
    if(hover!==undefined) {const q=fieldPosition(hover);circle(g,q.x,q.y,6,null,'#222b3da0',1);}
    if(mode==='rho'&&current().status==='found') {
      const q=fieldPosition(current().T.R);circle(g,q.x,q.y,17,null,'#315e5040',1);circle(g,q.x,q.y,22,null,'#315e501c',1);
    }
  }
  function drawOrbit() {
    if(mode!=='rho'||!surfaces.orbit.w||!orbit)return;
    const srf=surfaces.orbit,g=begin(srf),w=srf.w,h=srf.h;
    const {unique,mu,lambda}=orbit,U=unique.length,positions=[];
    g.font=`9px ${MONO}`;g.textBaseline='middle';
    if(lambda===null) {
      for(let j=0;j<U;j++) {
        const t=U===1?0:j/(U-1);
        positions.push({x:35+t*(w-75),y:h*.47+Math.sin(t*Math.PI*1.7)*h*.15});
      }
      if(U===1) {
        g.save();g.strokeStyle='#c8bfa9';g.setLineDash([3,7]);g.lineWidth=1;
        g.beginPath();g.moveTo(60,h*.47);g.bezierCurveTo(w*.22,h*.46,w*.24,h*.74,w*.42,h*.53);g.stroke();
        g.beginPath();g.ellipse(w*.62,h*.49,h*.28,h*.28,0,.8,Math.PI*2+.4);g.stroke();g.restore();
        g.fillStyle=C.dim;g.textAlign='center';g.fillText('STEP TO DISCOVER THE ORBIT',w*.54,h-23);
      }
      for(let j=1;j<U;j++) {line(g,positions[j-1],positions[j],'#9a9781',1);if(U<60||j%Math.ceil(U/30)===0)arrow(g,positions[j-1],positions[j],'#726953',1);}
    } else {
      const radius=Math.min(h*.34,w*.26),cx=mu>0?w*.68:w*.51,cy=h*.48,entryX=cx-radius;
      for(let j=0;j<mu;j++) {
        const t=(j+0.5)/Math.max(1,mu);
        positions.push({x:25+(entryX-38)*t,y:h*.81-(h*.81-cy)*t});
      }
      for(let j=0;j<lambda;j++) {
        const a=Math.PI+2*Math.PI*j/lambda;
        positions.push({x:cx+radius*Math.cos(a),y:cy+radius*Math.sin(a)});
      }
      for(let j=1;j<U;j++) {line(g,positions[j-1],positions[j],j<=mu?'#9a9781':'#91a28b',1);if(U<70||j%Math.ceil(U/25)===0)arrow(g,positions[j-1],positions[j],j<=mu?'#726953':'#315e50',1);}
      if(lambda===1) {
        const q=positions[mu];g.beginPath();g.arc(q.x+15,q.y-10,18,.8,Math.PI*2+.25);g.strokeStyle='#315e50';g.lineWidth=1.2;g.stroke();
      } else if(lambda===2) {
        const A=positions[U-1],B=positions[mu];curvePath(g,A,B,'#315e50',.7,1.2,5);
      } else {line(g,positions[U-1],positions[mu],'#91a28b',1);arrow(g,positions[U-1],positions[mu],'#315e50',1);}
      g.textAlign='center';g.fillStyle=C.muted;g.font=`22px ${MONO}`;g.fillText('ρ',cx,cy-5);
      g.font=`9px ${MONO}`;g.fillStyle=C.dim;g.fillText(`${lambda} POINT${lambda===1?'':'S'} IN CYCLE`,cx,cy+19);
      if(mu>0){g.textAlign='left';g.fillText(`TAIL · ${mu}`,27,Math.max(18,h*.32));}
    }
    for(let j=0;j<U;j++) {
      const q=positions[j],col=C.buckets[E.partition(unique[j],solver.seed,solver.kind)];
      circle(g,q.x,q.y,U>100?1.65:U>55?2.1:3.2,C.bg,col,.9);
    }
    // Index folding refers to points, not to coefficient representations.
    const indexOf = i => lambda===null?Math.min(i,U-1):i<mu?i:mu+E.mod(i-mu,lambda);
    const ti=indexOf(current().T.index),hi=indexOf(current().H.index);
    const tp=positions[ti],hp=positions[hi];
    circle(g,tp.x,tp.y,6,C.mint,C.mint,1);
    circle(g,hp.x,hp.y,ti===hi?10:6,ti===hi?null:C.orange,C.orange,1.6);
    g.font=`10px ${MONO}`;g.textAlign='center';
    if(ti===hi){g.fillStyle=C.text;g.fillText(current().round===0?'T · H / start':'T · H',tp.x,tp.y-18);}
    else {g.fillStyle=C.mint;g.fillText('T',tp.x,tp.y-16);g.fillStyle=C.orange;g.fillText('H',hp.x,hp.y-16);}
    if(U>1&&ti!==0&&hi!==0){const q=positions[0];g.fillStyle=C.dim;g.font=`8px ${MONO}`;g.fillText('R₀',q.x,q.y+14);}
    if(lambda!==null) {
      const entry=positions[mu];if(ti!==mu&&hi!==mu){g.fillStyle=C.dim;g.textAlign='right';g.font=`8px ${MONO}`;g.fillText(`R${mu}`,entry.x-7,entry.y-10);}
    }
  }
  function loop(now) {
    if(playing&&now>=nextTick) {
      try { advance(true); nextTick=now+interval(); } catch(error){fail(error);}
    }
    const animating=!reducedMotion.matches&&now-transitionStart<transitionDuration;
    if(dirty||animating){drawField(now);drawOrbit();dirty=false;}
    requestAnimationFrame(loop);
  }
  function nearest(e) {
    if(!plot)return undefined;
    const r=$('fieldCanvas').getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    let best=undefined,dist=e.pointerType==='touch'?19:12;
    for(const P of [null,...domain.points]){const q=fieldPosition(P),d=Math.hypot(q.x-x,q.y-y);if(d<dist){dist=d;best=P;}}
    return best;
  }
  function selectPoint(P) { selected=P;playing=false;updateUI();dirty=true; }
  function useSelectedTarget() {
    if(selected===undefined||!domain.members.has(E.key(selected)))return;
    try {const Q=selected;commitProblem(domain,Q);$('preset').value='custom';setMode('rho');}catch(error){fail(error);}
  }
  function randomInt(n) {
    if(window.crypto?.getRandomValues){const v=new Uint32Array(1);window.crypto.getRandomValues(v);return v[0]%n;}
    return Math.floor(Math.random()*n);
  }
  $('preset').addEventListener('change',()=>loadPreset($('preset').value));
  $('seed').addEventListener('change',()=>resetWalk());
  $('partition').addEventListener('change',()=>resetWalk());
  $('randomTarget').addEventListener('click',()=>{
    try {
      let Q;
      for(let tries=0;tries<10;tries++) {
        const k=domain.n<=2?randomInt(domain.n):1+randomInt(domain.n-1);
        Q=domain.curve.multiply(k,domain.P);if(!E.equal(Q,problem.Q))break;
      }
      commitProblem(domain,Q);$('preset').value='custom';
    }catch(error){fail(error);}
  });
  $('editCurve').addEventListener('click',()=>{
    $('customDetails').open=!$('customDetails').open;
    if($('customDetails').open)$('customP').focus({preventScroll:true});
  });
  $('targetInfinity').addEventListener('change',()=>{
    $('targetX').disabled=$('targetY').disabled=$('targetInfinity').checked;
  });
  $('customForm').addEventListener('submit',e=>{
    e.preventDefault();
    try {
      const c=new E.Curve(numberInput('customP','p'),numberInput('customA','a'),numberInput('customB','b'));
      const P={x:numberInput('baseX','P.x'),y:numberInput('baseY','P.y')};
      const Q=$('targetInfinity').checked?null:{x:numberInput('targetX','Q.x'),y:numberInput('targetY','Q.y')};
      const d=new E.Domain(c,P);commitProblem(d,Q);$('preset').value='custom';
    }catch(error){fail(error);}
  });
  $('rhoTab').addEventListener('click',()=>setMode('rho')); $('addTab').addEventListener('click',()=>setMode('add'));
  document.querySelector('.tabs').addEventListener('keydown',e=>{
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setMode(mode==='rho'?'add':'rho');$(mode==='rho'?'rhoTab':'addTab').focus();}
  });
  $('play').addEventListener('click',playPause);
  $('step').addEventListener('click',()=>{playing=false;try{advance();}catch(error){fail(error);}});
  $('finish').addEventListener('click',()=>{try{finish();}catch(error){fail(error);}});
  $('reset').addEventListener('click',()=>resetWalk(false)); $('newWalk').addEventListener('click',newWalk);
  $('speed').addEventListener('change',()=>{nextTick=performance.now()+interval();});
  $('timeline').addEventListener('input',()=>{playing=false;view=Number($('timeline').value);previousFrame=null;transitionStart=-1e6;refresh();});
  for(const id of ['showTrail','colorPartitions','showLine'])$(id).addEventListener('change',()=>{dirty=true;});
  $('clearPoint').addEventListener('click',()=>{selected=undefined;updateInspector();dirty=true;});
  $('useTarget').addEventListener('click',useSelectedTarget);
  $('fieldCanvas').addEventListener('pointermove',e=>{
    hover=nearest(e);dirty=true;
    if(hover===undefined){$('tooltip').hidden=true;return;}
    const inside=domain.members.has(E.key(hover)),bucket=E.partition(hover,solver.seed,solver.kind);
    $('tooltip').innerHTML=`<strong>${htmlPoint(hover)}</strong><br>${inside?'In the subgroup ⟨P⟩':'Outside the subgroup ⟨P⟩'}${mode==='rho'&&inside?`<br>S${bucket} → ${opName(bucket)}`:''}`;
    const r=$('fieldCanvas').getBoundingClientRect();$('tooltip').hidden=false;
    const tw=$('tooltip').offsetWidth,th=$('tooltip').offsetHeight;
    $('tooltip').style.left=Math.max(4,Math.min(r.width-tw-4,e.clientX-r.left+13))+'px';
    $('tooltip').style.top=Math.max(3,Math.min(r.height-th-3,e.clientY-r.top-th-10))+'px';
  });
  $('fieldCanvas').addEventListener('pointerleave',()=>{hover=undefined;$('tooltip').hidden=true;dirty=true;});
  $('fieldCanvas').addEventListener('click',e=>{const P=nearest(e);if(P!==undefined)selectPoint(P);});
  $('fieldCanvas').addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){
      e.preventDefault();const n=domain.points.length+1;
      keyboardPoint=e.key==='Home'?0:E.mod(keyboardPoint+(e.key==='ArrowRight'?1:-1),n);
      selectPoint(keyboardPoint===0?null:domain.points[keyboardPoint-1]);announce(`Selected ${point(selected)}; ${domain.members.has(E.key(selected))?'in':'outside'} the subgroup.`);
    }else if(e.key==='Enter'){e.preventDefault();useSelectedTarget();}
  });
  for(const who of ['u','v']) {
    $(who+'Slider').addEventListener('input',()=>setScalars(Number($('uSlider').value),Number($('vSlider').value)));
    $(who+'Number').addEventListener('change',()=>{
      try{const v=numberInput(who+'Number',who);if(v<0||v>=domain.n)throw new Error(`${who} must be in 0…${domain.n-1}.`);setScalars(numberInput('uNumber','u'),numberInput('vNumber','v'));setText('error','');}catch(error){fail(error);}
    });
  }
  $('addP').addEventListener('click',()=>setScalars(addition.u,1));
  $('doubleA').addEventListener('click',()=>setScalars(addition.u,addition.u));
  $('inverseA').addEventListener('click',()=>setScalars(addition.u,E.mod(-addition.u,domain.n)));
  $('identityA').addEventListener('click',()=>setScalars(0,addition.v));
  $('exportTrace').addEventListener('click',()=>{
    const data={format:'rho-lab-trace-v1',curve:{p:domain.curve.p,a:domain.curve.a,b:domain.curve.b},
      fullGroupOrder:domain.size,subgroupOrder:domain.n,cofactor:domain.cofactor,P:problem.P,Q:problem.Q,
      seed:solver.seed,partition:solver.kind,attempt,
      notes:'null = identity. Coefficients mod subgroupOrder. Each round has 3 walk evaluations. Seed setup, validation, plotting and final verification are excluded. Only public inputs are supplied to the solver.',
      frames};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`rho-F${domain.curve.p}-seed${solver.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  document.addEventListener('keydown',e=>{
    if(!e.target.closest('.rho-lab')||e.code!=='Space'||e.repeat||e.altKey||e.ctrlKey||e.metaKey||mode!=='rho')return;
    if(/^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(e.target.tagName)||e.target.isContentEditable)return;
    e.preventDefault();playPause();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){playing=false;updateUI();}});
  const observer=new ResizeObserver(resizeAll);observer.observe($('fieldWrap'));observer.observe($('orbitWrap'));
  window.addEventListener('resize',resizeAll);
  // Small read-only inspection API, also used by the included browser tests.
  window.RhoLab={
    getState:()=>({mode,playing,view,frameCount:frames.length,seed:solver.seed,partition:solver.kind,attempt,
      curve:{p:domain.curve.p,a:domain.curve.a,b:domain.curve.b},n:domain.n,size:domain.size,
      P:problem.P,Q:problem.Q,snapshot:current(),orbit:{mu:orbit.mu,lambda:orbit.lambda},addition}),
    getFrames:()=>JSON.parse(JSON.stringify(frames))
  };
  loadPreset('default');setMode('rho');resizeAll();requestAnimationFrame(loop);
})();
