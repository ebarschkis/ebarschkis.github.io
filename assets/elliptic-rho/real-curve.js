/* Real-coordinate illustrations; cryptographic parameters: SEC 2 and RFC 7748.
 * These plots are not finite-field point sets. No cryptographic arithmetic uses them.
 */
(function(root) {
  'use strict';
  const P256_B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b').toString();
  const presets = {
    example:{form:'short',a:'-1',b:'1'},
    secp256k1:{form:'short',a:'0',b:'7'},
    p256:{form:'short',a:'-3',b:P256_B},
    curve25519:{form:'montgomery',a:'486662',b:'1'},
    ed25519:{form:'edwards',a:'-1',b:'-121665/121666'}
  };
  function parse(s) {
    const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
    if (!new RegExp('^'+number+'(?:/'+number+')?$').test(s.trim())) throw Error('Use numbers, fractions, or scientific notation.');
    const parts=s.trim().split('/').map(Number), v=parts[0]/(parts[1]??1);
    if (!Number.isFinite(v)||Math.abs(v)>1e90) throw Error('Use finite coefficients with magnitude at most 10⁹⁰.');
    return v;
  }
  function model(form,a,b) {
    // x = sx X, y = sy Y. Scale before evaluating to avoid huge intermediate values.
    const sx = form==='short'?Math.max(1,Math.sqrt(Math.abs(a)),Math.cbrt(Math.abs(b))):form==='montgomery'?Math.max(1,Math.abs(a)):1;
    const sy = form==='edwards'?1:Math.sqrt(sx)*sx / (form==='montgomery'?Math.sqrt(Math.abs(b)||1):1);
    const coefficients=form==='short'?[1,0,a/sx/sx,b/sx/sx/sx]:[Math.sign(b)||1,(Math.sign(b)||1)*a/sx,(Math.sign(b)||1)/sx/sx,0];
    const value=x=>form==='edwards'?(1-a*x*x)/(1-b*x*x):((coefficients[0]*x+coefficients[1])*x+coefficients[2])*x+coefficients[3];
    const singular = form==='short'?Math.abs(4*coefficients[2]**3+27*coefficients[3]**2)<1e-14:
      form==='montgomery'?(b===0||a===2||a===-2):(a===0||b===0||a===b);
    return {form,a,b,sx,sy,coefficients,value,singular};
  }
  // Split at all real roots and poles, so paths never bridge a forbidden interval.
  function breaks(m,lo,hi) {
    let points=[lo,hi];
    if(m.form==='edwards') {
      for(const c of [m.a,m.b]) if(c>0) points.push(-1/Math.sqrt(c),1/Math.sqrt(c));
    } else {
      const [a,b,c]=m.coefficients, disc=b*b-3*a*c;
      const critical=disc>=0?[(-b-Math.sqrt(disc))/(3*a),(-b+Math.sqrt(disc))/(3*a)]:[];
      const partitions=[lo,...critical.filter(x=>x>lo&&x<hi),hi].sort((x,y)=>x-y);
      for(const x of partitions) if(m.value(x)===0)points.push(x);
      for(let i=1;i<partitions.length;i++) {
        let l=partitions[i-1],r=partitions[i],fl=m.value(l),fr=m.value(r);
        if(fl*fr>=0)continue;
        for(let j=0;j<90;j++){const mid=(l+r)/2,f=m.value(mid);if(f===0){l=r=mid;break;}if((f>0)===(fl>0)){l=mid;fl=f;}else r=mid;}
        points.push((l+r)/2);
      }
    }
    return [...new Set(points.filter(x=>x>=lo&&x<=hi))].sort((a,b)=>a-b);
  }
  const api={parse,model,breaks,presets,P256_B};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id), host=$('curve-explorer');
  if(!host)return;
  const svg=$('real-curve-svg'), NS='http://www.w3.org/2000/svg';
  let current,view={x:0,y:0,span:7},drag=null;
  function node(tag,attrs,text){const el=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
  function fmt(n){return Math.abs(n)>=1e5||(Math.abs(n)>0&&Math.abs(n)<.001)?n.toExponential(2):Number(n.toPrecision(4)).toString();}
  function texNumber(s){const p=s.trim().split('/');if(p.length===2)return `\\frac{${p[0]}}{${p[1]}}`;const [a,e]=s.split(/e/i);return e?`${a}\\times10^{${Number(e)}}`:s;}
  function term(v,s,suffix){return v===0?'':`${v<0?'-':'+'}${Math.abs(v)===1&&suffix?'':texNumber(s.replace(/^[-+]/,''))}${suffix}`;}
  function renderMath(el,tex){if(root.katex)root.katex.render(tex,el,{throwOnError:false});else el.textContent=tex;}
  function equation(){
    const a=$('real-a').value,b=$('real-b').value,m=current;
    let tex=m.form==='short'?`y^2=x^3${term(m.a,a,'x')}${term(m.b,b,'')}`:
      m.form==='montgomery'?`${m.b===1?'':`(${texNumber(b)})`}y^2=x^3${term(m.a,a,'x^2')}+x`:
      `${m.a===-1?'-':m.a===1?'':`(${texNumber(a)})`}x^2+y^2=1${term(m.b,b,'x^2y^2')}`;
    if($('real-preset').value==='p256')tex='y^2=x^3-3x+b_{\\mathrm{P256}}';
    renderMath($('real-equation'),tex);
    const scaled=m.sx!==1||m.sy!==1;
    renderMath($('real-scale'),scaled?`X=x/(${texNumber(fmt(m.sx))}),\\quad Y=y/(${texNumber(fmt(m.sy))})`:'x,y\\in\\mathbb{R}');
    const name=$('real-preset').value;
    const notes={example:'Change a and b to explore the short Weierstrass equation.',custom:'Custom coefficients, interpreted over the real numbers.',secp256k1:'secp256k1: a = 0, b = 7; used over the field with p = 2²⁵⁶ − 2³² − 977.',p256:'P-256: a = −3 represents p − 3. The full b coefficient is in the field below; the graph uses scaled axes.',curve25519:'Curve25519: Montgomery form, with A = 486662 and B = 1. Axes are scaled to show the overall shape; fine features near the origin are below this resolution.',ed25519:'Ed25519 uses edwards25519, a twisted Edwards curve. Here d = −121665/121666 is interpreted as a real fraction; in cryptography it uses modular division.'};
    $('real-preset-note').textContent=notes[name];
    $('real-warning').textContent=m.singular?'These coefficients give a singular or degenerate curve, not an elliptic curve.':'';
    if(m.form==='montgomery'&&m.b===0)$('real-warning').textContent='B must be nonzero to plot this Montgomery equation.';
    svg.setAttribute('aria-label',`${name} real-coordinate curve, ${$('real-form').selectedOptions[0].textContent}. ${scaled?'Scaled X and Y axes.':'x and y axes.'} Use the coefficient fields to change the curve.`);
  }
  function draw(){
    const m=current;if(!m)return;
    const width=500,height=400,pad=38,w=width-2*pad,h=height-2*pad;
    const yr=view.span*h/w,lo=view.x-view.span/2,hi=view.x+view.span/2,bottom=view.y-yr/2,top=view.y+yr/2;
    const px=x=>pad+(x-lo)/view.span*w,py=y=>pad+(top-y)/yr*h;
    const grid=$('real-grid'),axes=$('real-axes'),curves=$('real-paths');grid.replaceChildren();axes.replaceChildren();curves.replaceChildren();
    const rough=view.span/8,base=10**Math.floor(Math.log10(rough)),step=[1,2,5,10].map(x=>x*base).find(x=>x>=rough);
    for(let x=Math.ceil(lo/step)*step;x<=hi;x+=step){grid.append(node('line',{x1:px(x),x2:px(x),y1:pad,y2:height-pad}));axes.append(node('text',{x:px(x),y:height-15,'text-anchor':'middle'},fmt(x)));}
    for(let y=Math.ceil(bottom/step)*step;y<=top;y+=step){grid.append(node('line',{x1:pad,x2:width-pad,y1:py(y),y2:py(y)}));axes.append(node('text',{x:pad-7,y:py(y)+4,'text-anchor':'end'},fmt(y)));}
    if(lo<=0&&hi>=0)axes.append(node('line',{x1:px(0),x2:px(0),y1:pad,y2:height-pad}));
    if(bottom<=0&&top>=0)axes.append(node('line',{x1:pad,x2:width-pad,y1:py(0),y2:py(0)}));
    const scaled=m.sx!==1||m.sy!==1;
    axes.append(node('text',{x:width-15,y:height-15},scaled?'X':'x'),node('text',{x:14,y:22},scaled?'Y':'y'));
    if(m.form==='montgomery'&&m.b===0)return;
    const cuts=breaks(m,lo,hi);
    for(let j=1;j<cuts.length;j++){
      const l=cuts[j-1],r=cuts[j];if(!(m.value((l+r)/2)>=0))continue;
      for(const sign of [-1,1]){
        let d='',started=false;
        for(let i=0;i<=600;i++){
          let x=l+(r-l)*i/600,v=m.value(x);
          if(v<0&&v>-1e-12&&m.form!=='edwards')v=0;
          if(!Number.isFinite(v)||v<0){started=false;continue;}
          const y=sign*Math.sqrt(v),sy=Math.max(-1e6,Math.min(1e6,py(y)));
          d+=`${started?'L':'M'}${px(x).toFixed(3)},${sy.toFixed(3)} `;started=true;
        }
        curves.append(node('path',{d}));
      }
    }
  }
  function fit(){view={x:0,y:0,span:current.form==='edwards'?5:7};draw();}
  function update(reset=false){
    try {current=model($('real-form').value,parse($('real-a').value),parse($('real-b').value));$('real-input-error').textContent='';equation();if(reset)fit();else draw();}
    catch(e){$('real-input-error').textContent=e.message;}
  }
  function labels(){const form=$('real-form').value;$('real-a-label').textContent=form==='montgomery'?'A':'a';$('real-b-label').textContent=form==='edwards'?'d':form==='montgomery'?'B':'b';}
  function preset(){const p=presets[$('real-preset').value];if(!p)return;$('real-form').value=p.form;$('real-a').value=p.a;$('real-b').value=p.b;labels();update(true);}
  $('real-preset').addEventListener('change',preset);
  $('real-form').addEventListener('change',()=>{const f=$('real-form').value;$('real-preset').value='custom';$('real-a').value=f==='edwards'?'-1':'1';$('real-b').value=f==='edwards'?'-0.5':'1';labels();update(true);});
  for(const id of ['real-a','real-b'])$(id).addEventListener('input',()=>{$('real-preset').value='custom';update(true);});
  function zoom(f){view.span=Math.max(.0001,Math.min(1e5,view.span*f));draw();}
  $('real-zoom-in').addEventListener('click',()=>zoom(.7));$('real-zoom-out').addEventListener('click',()=>zoom(1/.7));$('real-reset').addEventListener('click',fit);
  svg.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();zoom(e.deltaY>0?1.1:1/1.1);},{passive:false});
  svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,v:{...view}};svg.setPointerCapture(e.pointerId);});
  svg.addEventListener('pointermove',e=>{if(!drag)return;const bounds=svg.getBoundingClientRect(),scale=500/bounds.width*drag.v.span/424;view.x=drag.v.x-(e.clientX-drag.x)*scale;view.y=drag.v.y+(e.clientY-drag.y)*scale;draw();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(event,()=>{drag=null;});
  svg.addEventListener('keydown',e=>{const delta=view.span/10;switch(e.key){case'ArrowLeft':view.x-=delta;break;case'ArrowRight':view.x+=delta;break;case'ArrowUp':view.y+=delta;break;case'ArrowDown':view.y-=delta;break;case'+':case'=':zoom(.7);break;case'-':zoom(1/.7);break;case'Home':fit();break;default:return;}e.preventDefault();draw();});
  preset();
})(typeof window==='undefined'?globalThis:window);
