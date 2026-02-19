// CDP expression builders for browser automation tools
const _deep = `function _dqa(s,r){r=r||document;var o=Array.from(r.querySelectorAll(s));` +
  `r.querySelectorAll('*').forEach(function(e){if(e.shadowRoot)o=o.concat(_dqa(s,e.shadowRoot))});return o}` +
  `function _dq(s,r){r=r||document;var e=r.querySelector(s);if(e)return e;` +
  `var a=r.querySelectorAll('*');for(var i=0;i<a.length;i++){if(a[i].shadowRoot){e=_dq(s,a[i].shadowRoot);if(e)return e}}return null}`;
const frameRoot = (frame) => frame != null ? `window.frames[${frame}].document` : `document`;
const _vis = `var a=_dqa(S,ROOT);var el=a.find(function(e){return e.offsetParent!==null&&e.getBoundingClientRect().width>0});`;
const _frOff = (frame) => frame != null
  ? `var _fr=document.querySelectorAll('iframe')[${frame}],_fo=_fr?_fr.getBoundingClientRect():{left:0,top:0};`
  : ``;
const _sxsy = (frame) => frame != null
  ? `sx:Math.round(r.left+_fo.left+r.width/2+window.screenX),sy:Math.round(r.top+_fo.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight))`
  : `sx:Math.round(r.left+r.width/2+window.screenX),sy:Math.round(r.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight))`;
const retCoords = (frame, extra = ``) =>
  `${_frOff(frame)}var r=el.getBoundingClientRect();return JSON.stringify({${_sxsy(frame)}${extra}})`;

export const COORD_EXPR = (sel, frame) =>
  `(function(){${_deep}var ROOT=${frameRoot(frame)};var S=${JSON.stringify(sel)};${_vis}if(!el)return null;${retCoords(frame)}})()`;
export const CLICK_EXPR = (sel, frame) =>
  `(function(){${_deep}var ROOT=${frameRoot(frame)};var S=${JSON.stringify(sel)};${_vis}if(!el)return null;el.scrollIntoView({block:'nearest'});el.click();${retCoords(frame)}})()`;

const _norm = `var norm=s=>s.replace(/[\\u00a0]/g,' ').replace(/[\\u2018\\u2019]/g,"'").replace(/[\\u201c\\u201d]/g,'"').replace(/[\\u2013\\u2014]/g,'-').toLowerCase()`;
const _textSel = `'a,button,input[type=submit],input[type=button],summary,span,[role=button],[role=tab],[role=menuitem],[role=option],[role=link],[aria-haspopup],[role=combobox]'`;
export const TEXT_CLICK_EXPR = (text, idx, frame) =>
  `(function(){${_deep}${_norm};var ROOT=${frameRoot(frame)};var t=norm(${JSON.stringify(text)}),i=${idx};` +
  `var inVP=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.bottom>0&&r.top<window.innerHeight&&r.right>0&&r.left<window.innerWidth};` +
  `var els=_dqa(${_textSel},ROOT).filter(function(e){return e.offsetParent!==null});` +
  `var _txt=function(e){return norm(e.innerText||e.value||e.getAttribute('aria-label')||'')};` +
  `var exact=els.filter(function(e){return _txt(e).trim()===t});` +
  `var matches=exact.length?exact:t.length>3?els.filter(function(e){return _txt(e).includes(t)}):[];` +
  `matches.sort(function(a,b){return inVP(b)-inVP(a)});` +
  `var modal=document.querySelector('dialog,[role=dialog],[role=alertdialog],.oo-ui-dialog');` +
  `if(modal&&matches.some(function(e){return modal.contains(e)})){matches=matches.filter(function(e){return modal.contains(e)})}` +
  `if(!matches.length){` +
    `var allVis=[...ROOT.querySelectorAll('*')].filter(function(e){return e.offsetParent!==null&&norm(e.innerText||'').trim().includes(t)&&e.children.length===0});` +
    `allVis.forEach(function(leaf){var e=leaf;while(e&&e!==ROOT){var c=window.getComputedStyle(e).cursor;if(e.onclick||e.getAttribute('onclick')||c==='pointer'||e.getAttribute('role')||e.matches('[class*="-control"],[class*="__control"],[data-testid]')){matches.push(e);break;}e=e.parentElement;}});` +
  `}` +
  `var el=matches[i];if(!el)return JSON.stringify({error:'No match',count:matches.length});` +
  `el.scrollIntoView({block:'nearest'});` +
  `if(el.matches('[class*="-control"],[class*="__control"]')||el.closest('[class*="-control"],[class*="__control"]')){el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));}else{el.click();}` +
  `${retCoords(frame, `,text:(el.innerText||el.value||'').trim().substring(0,50),count:matches.length`)}})()`;

const _setSV = `var _sv=function(e,v){var p=e.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;var d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set)d.set.call(e,v);else e.value=v};`;
export const TYPE_EXPR = (sel, text, submit, frame) =>
  `(function(){${_deep}var ROOT=${frameRoot(frame)};var el=_dq(${JSON.stringify(sel)},ROOT);if(!el)return 'not found';` +
  `el.scrollIntoView({block:'nearest'});el.focus();` +
  `if(el.contentEditable==='true'){var r=document.createRange();r.selectNodeContents(el);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,${JSON.stringify(text)});return el.innerText.slice(-50)}` +
  `${_setSV}_sv(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));` +
  (submit ? `el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));var f=el.closest('form');if(f)f.submit();` : ``) +
  `return el.value})()`;
export const TYPE_SLOW_EXPR = (sel, text, submit, frame) =>
  `(function(){${_deep}var ROOT=${frameRoot(frame)};var el=_dq(${JSON.stringify(sel)},ROOT);` +
  `if(!el)return Promise.resolve('not found');el.focus();${_setSV}_sv(el,'');var t=${JSON.stringify(text)};` +
  `return new Promise(function(res){var i=0;(function next(){if(i>=t.length){` +
  (submit ? `el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));var f=el.closest('form');if(f)f.submit();` : ``) +
  `return res(el.value)}var c=t[i++];_sv(el,el.value+c);` +
  `el.dispatchEvent(new KeyboardEvent('keydown',{key:c,bubbles:true}));el.dispatchEvent(new KeyboardEvent('keypress',{key:c,bubbles:true}));` +
  `el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{key:c,bubbles:true}));` +
  `setTimeout(next,20)})()})})()`;

export const WAIT_EXPR = (sel, timeoutMs) =>
  `(function(){${_deep}return new Promise(function(res,rej){var t=Date.now(),limit=${timeoutMs};` +
  `(function poll(){var el=_dq(${JSON.stringify(sel)});if(el&&el.offsetParent!==null)return res('found');` +
  `if(Date.now()-t>limit)return rej('timeout');setTimeout(poll,100)})()})})()`;

export { _deep, frameRoot };
