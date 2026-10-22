import {messages,elementKeys} from './i18n.js?v=20261022.4';
import {filterRecords,validateCatalog,safeUrl,slug,families,types,bonusSource} from './catalog-core.js?v=20261022.4';
import {config} from './config.js?v=20261022.4';
import {readCatalogLocation,catalogLocationUrl} from './catalog-location.js?v=20261022.4';

const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
function readStorage(key,fallback=''){try{return sessionStorage.getItem(key)||fallback;}catch{return fallback;}}
function writeStorage(key,value){try{if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key);}catch{}}
let lang=(()=>{try{const saved=localStorage.getItem('warframe-language');return Object.hasOwn(messages,saved)?saved:'uk';}catch{return 'uk';}})();
let catalog,version=0,owner=false,connected=false,preview=false,token=readStorage('warframe-session'),section='all',selected='',view='list',detailTab='overview',editing=false,dirty=false,saving=false;
let toastTimer,inspectorCollapsed=false;
let auditRunning=false,auditResults=[];
let explicitSelection=false,historyIndex=0,pendingHistoryIndex=0,lastLocation='',restoringHistory=false,ignoreHistory=false,searchEditing=false;
const state={search:'',type:'',element:'',sort:'original'};
const t=(key,vars={})=>Object.entries(vars).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),messages[lang][key]||key);
const title=r=>r['name_'+lang]||r['title_'+lang]||r.name_en||r.title_uk;
const note=(r,key)=>r[key+'_'+lang]||r[key+'_uk']||'';
const date=s=>new Intl.DateTimeFormat(lang==='en'?'en-GB':lang,{dateStyle:'medium'}).format(new Date(s));
const dateTime=s=>new Intl.DateTimeFormat(lang==='en'?'en-GB':lang,{dateStyle:'short',timeStyle:'short'}).format(new Date(s));
const url=path=>(config.apiBase||location.origin).replace(/\/$/,'')+path;
const chip=e=>e?`<span class="element-chip ${e}"><img class="element-icon" src="./assets/elements/${e}.png" width="16" height="16" alt="" aria-hidden="true">${escape(t(e))}</span>`:'';
const httpStatus=status=>status?'HTTP '+status+([403,429].includes(status)?' · '+t('checkBlocked'):''):t('checkUnknown');
const activeCollection=()=>section==='progenitors'?'progenitors':section==='guides'?'tips':'weapons';
const findRecord=id=>[...catalog.weapons,...catalog.progenitors,...catalog.tips].find(r=>r.id===id);
function refreshIcons(){window.lucide?.createIcons({attrs:{'aria-hidden':'true'}});}
function toast(key){clearTimeout(toastTimer);$('#toast').textContent=t(key);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function showError(element,key){element.textContent=t(key);element.hidden=false;}
function status(key){$('#connection-status').hidden=!key;$('#connection-status').textContent=key?t(key):'';}
function locationState(){return {section,selected:explicitSelection?selected:'',...state,view,tab:detailTab,lang};}
function saveLocation(mode='push'){
  if(section==='tools')return;
  const route=locationState(),destination=catalogLocationUrl(location.href,route).href;
  try{localStorage.setItem('warframe-catalog-view',JSON.stringify(route));localStorage.setItem('warframe-language',lang);}catch{}
  if(mode==='replace'||destination!==lastLocation){
    if(mode==='push')historyIndex++;
    history[mode==='push'?'pushState':'replaceState']({arsenalIndex:historyIndex},'',destination);
  }
  lastLocation=destination;
}
function applyLocation(route){
  ({section,view,lang}=route);selected=route.selected;explicitSelection=Boolean(selected);detailTab=route.tab;
  for(const key of ['search','type','element','sort'])state[key]=route[key];
  const record=selected&&findRecord(selected);
  if(selected&&(!record||record.archived)){selected='';explicitSelection=false;toast('recordUnavailable');}
  $('#search').value=state.search;searchEditing=false;
  if($('#detail-dialog').open)$('#detail-dialog').close();
  if(explicitSelection)inspectorCollapsed=false;
  localize();render();
  if(explicitSelection)openMobileDetail();
}
function shareLocation(record){return catalogLocationUrl(location.href,{selected:record.id,lang,tab:detailTab}).href;}
function closeNavigation(){
  $('#sidebar').classList.remove('open');$('#sidebar').removeAttribute('role');$('#sidebar').removeAttribute('aria-modal');$('#sidebar').removeAttribute('aria-label');$('#workspace').inert=false;$('#nav-toggle').setAttribute('aria-expanded','false');document.querySelector('.nav-shade')?.remove();if(matchMedia('(max-width:600px)').matches)$('#nav-toggle').focus();
}
function toggleNavigation(){
  if($('#sidebar').classList.contains('open')){closeNavigation();return;}
  $('#sidebar').classList.add('open');$('#sidebar').setAttribute('role','dialog');$('#sidebar').setAttribute('aria-modal','true');$('#sidebar').setAttribute('aria-label',t('navigation'));$('#workspace').inert=true;$('#nav-toggle').setAttribute('aria-expanded','true');
  const shade=document.createElement('button');shade.type='button';shade.className='nav-shade active';shade.tabIndex=-1;shade.setAttribute('aria-label',t('close'));shade.addEventListener('click',closeNavigation);document.body.append(shade);$('#navigation button')?.focus();
}
async function request(path,options={}){
  const headers=new Headers(options.headers);if(token)headers.set('Authorization','Bearer '+token);
  const response=await fetch(url(path),{...options,headers,cache:'no-store'});
  if(!response.ok){const error=new Error(response.status===409?'conflict':'saveFailed');error.status=response.status;throw error;}
  return response;
}
function localize(){
  document.documentElement.lang=lang;document.title='Warframe — '+t('arsenal');
  document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));
  $('#navigation').setAttribute('aria-label',t('navigation'));$('#inspector').setAttribute('aria-label',t('details'));
  $('#detail-dialog').setAttribute('aria-label',t('details'));
  $('#search').placeholder=t(section==='progenitors'?'searchProgenitors':section==='guides'?'searchGuides':'search');$('#search').setAttribute('aria-label',$('#search').placeholder);
  $('#language').innerHTML=Object.entries(messages).map(([code,labels])=>`<option value="${code}" ${lang===code?'selected':''}>${labels.languageName}</option>`).join('');$('#language').setAttribute('aria-label',t('language'));
  $('#owner-link').innerHTML=icon(owner?'shield-check':'lock-keyhole')+`<span>${t(owner?'owner':preview?'loginPreview':'ownerLogin')}</span>`;
  const options=(list,current)=>list.map(([v,label])=>`<option value="${v}" ${v===current?'selected':''}>${escape(label)}</option>`).join('');
  $('#type-filter').innerHTML=options([['',t('allTypes')],...types.map(x=>[x,t(x)])],state.type);
  $('#element-filter').innerHTML=options([['',t('allElements')],...elementKeys.map(x=>[x,t(x)])],state.element);
  $('#sort').innerHTML=options([['original',t('originalOrder')],['name',t('nameAsc')]],state.sort);
  updateInspectorToggle();
  if(catalog)$('#snapshot-date').textContent=t('imported',{date:date(catalog.importedAt)});
  if(!connected&&catalog)status(config.apiBase?'unavailable':'fallback');else if(preview)status('draftPreview');
  refreshIcons();
}
function renderNavigation(){
  const count=key=>catalog.weapons.filter(r=>!r.archived&&(key==='all'||r.family===key)).length;
  const button=(key,label,art,n)=>`<button type="button" class="nav-button" data-section="${key}" ${section===key?'aria-current="page"':''}>${art}<span>${escape(label)}</span>${n!==undefined?`<span class="count">${n}</span>`:''}</button>`;
  $('#navigation').innerHTML=button('all',t('allWeapons'),icon('library'),count('all'))+families.map(f=>button(f,t(f),`<span class="family-icon ${f}" aria-hidden="true">${f[0]}</span>`,count(f))).join('')+'<div class="nav-separator"></div>'+button('progenitors',t('progenitors'),icon('users-round'),catalog.progenitors.filter(r=>!r.archived).length)+button('guides',t('guides'),icon('book-open'))+(owner?'<div class="nav-separator"></div>'+button('tools',t('tools'),icon('wrench')):'');
}
function image(r,large=false){return r.image?`<img src="${escape(r.image)}" alt="" ${large?'':'loading="lazy"'} decoding="async" width="256" height="256">`:`<span class="fallback-image" aria-label="${escape(t('noImage'))}">${icon(r.kind==='progenitor'?'user-round':'crosshair')}</span>`;}
function card(r){
  const meta=`<span class="card-meta">${r.type?`<span class="card-class">${t(r.type)}</span>`:''}<span class="card-bonus"><span class="sr-only">${t('bonus')}</span>${chip(r.recommended||r.element)}</span></span>`;
  return `<button type="button" class="weapon-card" data-id="${r.id}" aria-pressed="${selected===r.id}"><span class="weapon-art">${image(r)}${r.family?`<span class="family-tag">${escape(t(r.family))}</span>`:''}${view==='grid'?meta:''}</span><span class="card-text"><span class="card-name">${escape(title(r))}</span><span class="card-subtitle">${escape(lang!=='en'?r.name_en:r.name_uk)}</span></span>${view==='list'?meta:''}</button>`;
}
function updateInspectorToggle(){
  const button=$('#inspector-toggle'),label=t(inspectorCollapsed?'showDetails':'hideDetails');
  button.innerHTML=icon(inspectorCollapsed?'panel-right-open':'panel-right-close');button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-expanded',String(!inspectorCollapsed));
  $('.workspace-body').classList.toggle('inspector-collapsed',inspectorCollapsed);
}
function render(){
  if(!catalog)return;
  renderNavigation();
  const name=t(section==='all'?'allWeapons':section);$('#catalog-heading').textContent=name;
  $('#add-record').hidden=!owner||section==='tools';$('#filters').hidden=section==='guides'||section==='tools';$('#type-filter').closest('label').hidden=section==='progenitors';$('.view-controls').hidden=section==='guides'||section==='tools';
  $('#inspector-toggle').hidden=section==='guides'||section==='tools';updateInspectorToggle();
  const list=filterRecords(catalog,{section,...state,lang});
  const activeCount=[state.search.trim(),state.type,state.element,state.sort!=='original'].filter(Boolean).length;
  $('#reset-filters').hidden=activeCount===0;$('#active-filters').hidden=activeCount===0;
  $('#active-filters').textContent=t('activeFilters',{count:new Intl.NumberFormat(lang).format(activeCount)});
  for(const [id,active]of [['type-filter',state.type],['element-filter',state.element],['sort',state.sort!=='original']])$('#'+id).closest('label').classList.toggle('active',Boolean(active));
  $('#result-count').textContent=section==='tools'?t(preview?'draftPreview':'connectionReady'):t('records_'+new Intl.PluralRules(lang).select(list.length),{count:new Intl.NumberFormat(lang).format(list.length)});
  const panel=$('#catalog');panel.setAttribute('aria-busy','false');
  if(section==='tools'){panel.className='tool-list';renderTools();renderInspector();refreshIcons();return;}
  if(section==='guides'){
    panel.className='guide-list';panel.innerHTML=list.map(r=>`<article class="guide-item">${owner?`<button class="secondary-button edit-guide" type="button" data-edit="${r.id}">${icon('pencil')}${t('edit')}</button>`:''}<h2>${escape(title(r))}</h2><p ${lang!=='uk'&&!r['body_'+lang]?'lang="uk"':''}>${escape(note(r,'body'))}</p>${r.url?`<a href="${escape(r.url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right')}${t('source')}</a>`:''}</article>`).join('');
  }else{
    if(!list.some(r=>r.id===selected)){selected=list[0]?.id||'';explicitSelection=false;}
    panel.className='weapon-grid'+(view==='list'?' list-view':'');panel.innerHTML=list.map(card).join('');
  }
  if(!list.length)panel.innerHTML=`<div class="empty-state">${icon('search-x')}<h2>${t('noResults')}</h2><p>${t('noResultsHelp')}</p><button type="button" class="secondary-button" data-action="clear">${icon('rotate-ccw')}${t('clearFilters')}</button></div>`;
  $('#grid-view').setAttribute('aria-pressed',String(view==='grid'));$('#list-view').setAttribute('aria-pressed',String(view==='list'));
  renderInspector();refreshIcons();
}
function detail(r){
  const header=`<div class="inspector-head detail-head"><span>${t('details')}</span><button type="button" class="icon-button mobile-close" data-action="close-detail" aria-label="${t('close')}">${icon('x')}</button></div>`;
  if(!r||section==='guides'||section==='tools')return header+`<div class="empty-state">${icon('panel-right')}<h2>${t('selectRecord')}</h2><p>${t('selectRecordHelp')}</p></div>`;
  const sectionNote=(key,label)=>note(r,key)?`<section class="detail-section"><h3>${t(label)}</h3><p ${lang!=='uk'&&!r[key+'_'+lang]?'lang="uk"':''}>${escape(note(r,key))}</p></section>`:'';
  const source=bonusSource(r);
  const bonus=(element,label)=>`<div><span class="field-label">${t(label)}</span>${chip(element)}${source==='progenitor'?`<a class="progenitor-link" data-progenitors href="${escape(catalogLocationUrl(location.href,{section:'progenitors',element,lang,view}).href)}" aria-label="${escape(t('progenitorsFor',{element:t(element)}))}">${icon('users-round')}<span>${t('whoGivesBonus')}</span></a>`:''}</div>`;
  const bonuses=r.kind==='weapon'?`<div class="bonus-pair">${bonus(r.recommended,'recommendedBonus')}${bonus(r.alternative,'alternative')}</div>${source==='ergo'||source==='eleanor'?`<p class="detail-note bonus-source">${t(source==='ergo'?'ergoBonus':'eleanorBonus')}</p>`:''}`:`<div class="detail-section"><span class="field-label">${t('bonus')}</span>${chip(r.element)}</div>`;
  const actions=r.kind==='weapon'?`<div class="detail-actions">${r.build_url?`<a class="primary-button" href="${escape(r.build_url)}" target="_blank" rel="noopener noreferrer">${icon('external-link')}${t('build')}</a>`:`<span class="detail-note">${t('noBuild')}</span>`}${r.source_url?`<a class="secondary-button" href="${escape(r.source_url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right')}${t('source')}</a>`:''}<button type="button" class="secondary-button share-action" data-share="${r.id}">${icon('link')}${t('copyLink')}</button></div><div class="share-fallback" hidden><label>${t('copyLinkManually')}<input type="url" readonly value="${escape(shareLocation(r))}"></label></div>`:'';
  const content=r.kind==='weapon'?(detailTab==='matrix'?`<table class="matrix"><caption class="sr-only">${t('elementMatrix')}</caption><tbody>${elementKeys.map(e=>{const value=(lang==='ru'?r.matrix_ru?.[e]:undefined)||r.matrix?.[e]||'';const [grade,...rest]=value.split(' • ');return `<tr><th scope="row">${chip(e)}</th><td>${grade?`<span class="grade">${escape(grade)}</span><br><span lang="${lang==='ru'&&r.matrix_ru?.[e]?'ru':'uk'}">${escape(rest.join(' • '))}</span>`:'—'}</td></tr>`;}).join('')}</tbody></table><p class="detail-note">${t('ratingHelp')}</p>`:`${lang!=='uk'&&!r['reason_'+lang]?`<div class="source-language">${t('notesLanguage')}</div>`:''}${sectionNote('reason','reason')}${sectionNote('mechanic','mechanic')}${sectionNote('obtain','obtain')}`):sectionNote('reason','reason');
  return header+`<div class="inspector-content"><div class="detail-summary"><div><div class="inspector-family">${r.family?`<span class="family-icon ${r.family}">${r.family[0]}</span>${t(r.family)}<span> / </span>${t(r.type)}`:t('progenitors')}</div><h2>${escape(title(r))}</h2><p class="english-name">${escape(lang!=='en'?r.name_en:r.name_uk)}</p></div><div class="inspector-hero">${image(r,true)}</div></div>${bonuses}${actions}${r.kind==='weapon'?`<div class="detail-tabs"><button type="button" data-tab="overview" aria-pressed="${detailTab==='overview'}">${icon('file-text')}${t('overview')}</button><button type="button" data-tab="matrix" aria-pressed="${detailTab==='matrix'}">${icon('table-2')}${t('elementMatrix')}</button></div>`:''}${content}</div>${owner?`<div class="inspector-bottom"><button type="button" class="secondary-button" data-edit="${r.id}">${icon('pencil')}${t('edit')}</button>${r.build_url?`<button type="button" class="secondary-button" data-check="${r.id}">${icon('link')}${t('checkBuild')}</button>`:''}<p class="detail-note" id="check-result" role="status"></p></div>`:''}`;
}
function renderInspector(){if(editing)return;const html=detail(findRecord(selected));if($('#detail-dialog').open){$('#mobile-inspector').innerHTML=html;$('#inspector').innerHTML='';}else $('#inspector').innerHTML=html;}
function moveInspector(from,to){const focused=from.contains(document.activeElement)?document.activeElement:null;to.replaceChildren(...from.childNodes);return focused;}
function openMobileDetail(){if(matchMedia('(max-width:1050px)').matches){const focus=editing?moveInspector($('#inspector'),$('#mobile-inspector')):null;if(!editing){$('#mobile-inspector').innerHTML=detail(findRecord(selected));$('#inspector').innerHTML='';}if(!$('#detail-dialog').open)$('#detail-dialog').showModal();if(!editing)$('#detail-dialog').scrollTop=0;focus?.focus({preventScroll:true});refreshIcons();}}
async function confirmAction(titleKey,textKey){const dialog=$('#confirm-dialog');$('#confirm-title').textContent=t(titleKey);$('#confirm-text').textContent=t(textKey);dialog.returnValue='cancel';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
async function leaveEditor(){if(saving){toast('busy');return false;}if(dirty&&!await confirmAction('unsavedTitle','unsavedHelp'))return false;editing=false;dirty=false;return true;}
function formField(key,label,value='',textarea=false,required=false){const id='field-'+key;return `<label for="${id}">${t(label)}${required?' *':''}${textarea?`<textarea id="${id}" name="${key}" maxlength="6000" ${required?'required':''}>${escape(value)}</textarea>`:`<input id="${id}" name="${key}" value="${escape(value)}" maxlength="${key.includes('name')?'200':'2048'}" ${required?'required':''}>`}</label>`;}
function formSelect(key,label,values,value){return `<label for="field-${key}">${t(label)}<select id="field-${key}" name="${key}">${values.map(v=>`<option value="${v}" ${v===value?'selected':''}>${t(v)}</option>`).join('')}</select></label>`;}
function editor(r,isNew=false){
  let fields;
  if(r.kind==='weapon'||r.kind==='progenitor'){
    fields=formField('name_uk','nameUk',r.name_uk,false,true)+formField('name_en','nameEn',r.name_en,false,true)+formField('name_ru','nameRu',r.name_ru);
    if(r.kind==='weapon')fields+=formSelect('family','family',families,r.family)+formSelect('type','weaponType',types,r.type)+formSelect('recommended','recommended',elementKeys,r.recommended)+formSelect('alternative','alternative',elementKeys,r.alternative);
    else fields+=formSelect('element','bonus',elementKeys,r.element);
    fields+=formField('reason_uk','reasonUk',r.reason_uk,true)+formField('reason_en','reasonEn',r.reason_en,true)+formField('reason_ru','reasonRu',r.reason_ru,true);
    if(r.kind==='weapon')fields+=formField('mechanic_uk','mechanicUk',r.mechanic_uk,true)+formField('mechanic_en','mechanicEn',r.mechanic_en,true)+formField('mechanic_ru','mechanicRu',r.mechanic_ru,true)+formField('obtain_uk','obtainUk',r.obtain_uk,true)+formField('obtain_en','obtainEn',r.obtain_en,true)+formField('obtain_ru','obtainRu',r.obtain_ru,true)+formField('build_url','buildUrl',r.build_url)+formField('source_url','sourceUrl',r.source_url);
    if(r.kind==='weapon')fields+=`<fieldset><legend>${t('elementMatrix')}</legend><p class="detail-note">${t('matrixEditHelp')}</p>${elementKeys.map(e=>formField('matrix_'+e,e,(lang==='ru'?r.matrix_ru?.[e]:undefined)||r.matrix?.[e]||'')).join('')}</fieldset>`;
    fields+=formField('image','imageUrl',r.image);
  }else fields=formField('title_uk','titleUk',r.title_uk,false,true)+formField('title_en','titleEn',r.title_en)+formField('title_ru','titleRu',r.title_ru)+formField('body_uk','bodyUk',r.body_uk,true,true)+formField('body_en','bodyEn',r.body_en,true)+formField('body_ru','bodyRu',r.body_ru,true)+formField('url','sourceUrl',r.url);
  return `<div class="inspector-head"><span>${t(isNew?'newRecord':'editRecord')}</span><button type="button" class="icon-button" data-action="cancel-edit" aria-label="${t('cancel')}">${icon('x')}</button></div><form class="editor" id="editor-form" data-record="${r.id||''}" data-kind="${r.kind||'tip'}" data-new="${isNew}" data-matrix-lang="${lang==='ru'?'ru':'uk'}"><h2>${escape(isNew?t('newRecord'):title(r))}</h2>${fields}<p id="form-error" class="form-error" role="alert" hidden></p><div class="editor-buttons"><button type="submit" class="primary-button">${icon('check')}${t('save')}</button><button type="button" class="secondary-button" data-action="cancel-edit">${icon('x')}${t('cancel')}</button></div>${!isNew?`<button type="button" class="danger-button" data-archive="${r.id}">${icon('archive')}${t('archive')}</button>`:''}</form>`;
}
function showEditor(r,isNew=false){inspectorCollapsed=false;updateInspectorToggle();editing=true;dirty=false;$('#inspector').innerHTML=editor(r,isNew);openMobileDetail();refreshIcons();const container=$('#detail-dialog').open?$('#mobile-inspector'):$('#inspector');container.querySelector('input,textarea')?.focus();}
async function commit(next){validateCatalog(next);const response=await request('/api/admin/catalog',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':String(version)},body:JSON.stringify(next)});const result=await response.json();catalog=next;version=result.version;}
async function submitEditor(form){
  if(saving||!owner)return;const values=Object.fromEntries(new FormData(form));const kind=form.dataset.kind;const collection=kind==='weapon'?'weapons':kind==='progenitor'?'progenitors':'tips';const next=structuredClone(catalog);
  let item=form.dataset.new==='true'?{id:(kind==='progenitor'?'progenitor-':kind==='tip'?'tip-':'')+(slug(values.name_en||values.title_en)||crypto.randomUUID()),...(kind==='tip'?{}:{kind})}:next[collection].find(r=>r.id===form.dataset.record);
  if(!item)return;
  if(kind==='weapon'){const key=form.dataset.matrixLang==='ru'?'matrix_ru':'matrix';item[key]={};for(const e of elementKeys){item[key][e]=values['matrix_'+e]||'';delete values['matrix_'+e];}}
  Object.assign(item,values);
  if(form.dataset.new==='true')next[collection].push(item);
  const error=form.querySelector('#form-error');
  if(!safeUrl(item.build_url,{build:true})){showError(error,'wrongBuildHost');return;}
  if(!safeUrl(item.source_url)||!safeUrl(item.url)||!safeUrl(item.image,{image:true})){showError(error,'validUrl');return;}
  saving=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);form.querySelector('[type=submit]').textContent=t('saving');
  try{await commit(next);selected=item.id;explicitSelection=true;editing=false;dirty=false;if($('#detail-dialog').open)$('#detail-dialog').close();render();saveLocation('replace');toast('saved');}
  catch(e){showError(error,e.message==='conflict'?'conflict':'saveFailed');}
  finally{saving=false;if(form.isConnected){form.querySelectorAll('button').forEach(b=>b.disabled=false);form.querySelector('[type=submit]').textContent=t('save');}}
}
function renderTools(){
  if(!owner){$('#catalog').innerHTML=`<p>${t('authNeeded')}</p>`;return;}
  const archived=[...catalog.weapons,...catalog.progenitors,...catalog.tips].filter(r=>r.archived);
  // Bulk checks reuse the same owner-only endpoint as individual checks.
  $('#catalog').innerHTML=`<section class="tool-row"><h2>${t('backup')}</h2><button class="secondary-button" type="button" data-action="backup">${icon('download')}${t('backup')}</button><a class="secondary-button" href="${escape(catalog.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('viewSource')}${icon('external-link')}</a></section><section class="tool-row"><h2>${t('revisions')}</h2><button type="button" class="secondary-button" data-action="history">${icon('history')}${t('revisions')}</button><div id="history"></div></section><section class="tool-row"><h2>${t('archiveList')}</h2>${archived.map(r=>`<div class="history-item"><span>${escape(title(r))}</span><button type="button" class="secondary-button" data-restore-item="${r.id}">${icon('undo-2')}${t('restore')}</button></div>`).join('')||`<p class="detail-note">0</p>`}</section><section class="tool-row"><button class="secondary-button" type="button" data-action="logout">${icon('log-out')}${t('logout')}</button></section>`;
  $('#catalog').insertAdjacentHTML('beforeend',`<section class="tool-row"><h2>${t('auditAll')}</h2><p class="detail-note">${t('checkDisclaimer')}</p><button type="button" class="secondary-button" data-action="audit-all" ${auditRunning?'disabled':''}>${icon('scan-line')}${t('auditAll')}</button>${auditRunning?`<button type="button" class="secondary-button" data-action="audit-stop">${icon('square')}${t('stop')}</button>`:''}<div id="audit-results"></div></section>`);
  renderAudit();refreshIcons();
}
function renderAudit(){
  const panel=$('#audit-results');if(!panel)return;
  panel.innerHTML=`<p role="status">${t('auditProgress',{count:auditResults.length,total:catalog.weapons.filter(r=>!r.archived&&r.build_url).length})}</p><ul class="audit-list">${auditResults.map(x=>`<li><span>${escape(x.name)}</span><strong>${httpStatus(x.status)}</strong></li>`).join('')}</ul>`;
}
async function checkAllBuilds(){
  if(auditRunning)return;auditRunning=true;auditResults=[];renderTools();
  try{for(const r of catalog.weapons.filter(x=>!x.archived&&x.build_url)){
    if(!auditRunning||!owner)break;
    try{const response=await request('/api/admin/check-build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id})});const result=await response.json();auditResults.push({name:title(r),status:result.status});}
    catch(e){auditResults.push({name:title(r),status:null});if(e.status===429){toast('auditLimit');break;}}
    renderAudit();
  }}finally{auditRunning=false;if(section==='tools')renderTools();}
}
async function startLogin(){
  if(!connected){toast('authNotConfigured');return;}
  try{
    const bytes=crypto.getRandomValues(new Uint8Array(32));const verifier=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');writeStorage('warframe-login-verifier',verifier);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    const response=await request('/api/auth/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge})});const result=await response.json();
    if(result.preview){token=result.token;writeStorage('warframe-session',token);await loadSession();render();toast('previewEnter');return;}
    const destination=new URL(result.url);if(destination.origin!==new URL(url('/')).origin||destination.pathname!=='/auth/begin')throw Error('invalid_auth_url');location.assign(destination.href);
  }catch{toast('authNotConfigured');}
}
async function loadSession(){
  if(!token)return;
  try{const r=await request('/api/admin/session');const s=await r.json();owner=s.owner===true;preview=s.preview===true;if(!owner)throw Error('not_owner');}
  catch{token='';owner=false;writeStorage('warframe-session','');}
  localize();
}
async function bootstrap(){
  localize();
  try{
    let response;try{response=await fetch(url('/api/catalog'),{cache:'no-store'});}catch{}
    if(response?.ok){const result=await response.json();catalog=validateCatalog(result.catalog);version=result.version;connected=true;preview=result.preview===true;}
    else{const fallback=await fetch(new URL('./catalog.json',import.meta.url));if(!fallback.ok)throw Error('load');catalog=validateCatalog(await fallback.json());}
    const authCode=new URLSearchParams(location.hash.slice(1)).get('login');
    if(authCode){history.replaceState(null,'',location.pathname+location.search);const verifier=readStorage('warframe-login-verifier');writeStorage('warframe-login-verifier','');if(verifier){try{response=await request('/api/auth/exchange',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:authCode,verifier})});token=(await response.json()).token;writeStorage('warframe-session',token);}catch{toast('authNotConfigured');}}}
    await loadSession();
    let saved;try{saved=JSON.parse(localStorage.getItem('warframe-catalog-view'));}catch{}
    historyIndex=Number.isInteger(history.state?.arsenalIndex)?history.state.arsenalIndex:0;
    applyLocation(readCatalogLocation(location.search,saved,lang));saveLocation('replace');
  }catch{showError($('#connection-status'),'loadError');$('#catalog').innerHTML=`<p>${t('loadError')}</p>`;$('#catalog').setAttribute('aria-busy','false');}
}
document.addEventListener('click',async event=>{
  const b=event.target.closest('button,a');if(!b)return;
  searchEditing=false;
  if(b.id==='owner-link'){event.preventDefault();if(owner){if(!await leaveEditor())return;section='tools';render();}else await startLogin();closeNavigation();return;}
  if(!catalog)return;
  if(b.hasAttribute('data-progenitors')){
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();if(!await leaveEditor())return;
    if($('#detail-dialog').open)$('#detail-dialog').addEventListener('close',()=>$('#catalog-heading').focus(),{once:true});
    applyLocation(readCatalogLocation(new URL(b.href).search,{},lang));saveLocation();
    $('.catalog-pane').scrollTop=0;$('#catalog-heading').focus();return;
  }
  if(b.dataset.section){if(!await leaveEditor())return;section=b.dataset.section;state.type='';state.element='';state.search='';$('#search').value='';selected='';explicitSelection=false;detailTab='overview';closeNavigation();localize();render();saveLocation();}
  if(b.dataset.id){if(!await leaveEditor())return;selected=b.dataset.id;explicitSelection=true;detailTab='overview';inspectorCollapsed=false;updateInspectorToggle();document.querySelectorAll('.weapon-card').forEach(card=>card.setAttribute('aria-pressed',String(card.dataset.id===selected)));renderInspector();$('#inspector').scrollTop=0;refreshIcons();openMobileDetail();saveLocation();}
  if(b.id==='inspector-toggle'){if(!await leaveEditor())return;inspectorCollapsed=!inspectorCollapsed;updateInspectorToggle();renderInspector();refreshIcons();}
  if(b.dataset.tab){detailTab=b.dataset.tab;renderInspector();refreshIcons();const panel=$('#detail-dialog').open?$('#mobile-inspector'):$('#inspector');panel.querySelector(`[data-tab="${detailTab}"]`)?.focus({preventScroll:true});saveLocation();}
  if(b.dataset.share){try{await navigator.clipboard.writeText(shareLocation(findRecord(b.dataset.share)));toast('linkCopied');}catch{const box=b.closest('.inspector-content').querySelector('.share-fallback');box.hidden=false;const input=box.querySelector('input');input.focus();input.select();}}
  if(b.dataset.edit&&owner){if(!await leaveEditor())return;selected=b.dataset.edit;showEditor(findRecord(selected));}
  if(b.id==='add-record'&&owner){if(!await leaveEditor())return;showEditor(section==='guides'?{title_uk:'',body_uk:''}:section==='progenitors'?{kind:'progenitor',element:'magnetic'}:{kind:'weapon',family:families.includes(section)?section:'Kuva',type:'primary',recommended:'toxin',alternative:'magnetic',matrix:{}},true);}
  if(b.id==='grid-view'||b.id==='list-view'){view=b.id==='list-view'?'list':'grid';render();saveLocation();}
  if(b.id==='nav-toggle')toggleNavigation();
  if(b.dataset.action==='clear'){state.sort='original';state.search='';state.type='';state.element='';$('#search').value='';localize();render();saveLocation();$('#search').focus();}
  if(b.dataset.action==='close-detail'){explicitSelection=false;saveLocation();$('#detail-dialog').close();}
  if(b.dataset.action==='cancel-edit'){if(!await leaveEditor())return;if($('#detail-dialog').open)$('#detail-dialog').close();renderInspector();refreshIcons();}
  if(b.dataset.archive&&owner){if(await confirmAction('archiveTitle','archiveHelp')){const next=structuredClone(catalog);const r=[...next.weapons,...next.progenitors,...next.tips].find(x=>x.id===b.dataset.archive);r.archived=true;try{await commit(next);editing=false;dirty=false;$('#detail-dialog').close();render();toast('archived');}catch(e){toast(e.message==='conflict'?'conflict':'saveFailed');}}}
  if(b.dataset.restoreItem&&owner){const next=structuredClone(catalog);[...next.weapons,...next.progenitors,...next.tips].find(x=>x.id===b.dataset.restoreItem).archived=false;try{await commit(next);render();toast('restored');}catch{toast('saveFailed');}}
  if(b.dataset.action==='backup'&&owner){const blob=new Blob([JSON.stringify(catalog,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='warframe-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('exportDone');}
  if(b.dataset.action==='history'&&owner){try{const r=await request('/api/admin/history');const items=await r.json();$('#history').innerHTML=items.length?items.map(x=>`<div class="history-item"><span>${t('revision',{version:x.version})} · ${dateTime(x.created_at)}</span><button type="button" class="secondary-button" data-restore-version="${x.version}">${icon('history')}${t('restoreVersion')}</button></div>`).join(''):`<p class="detail-note">${t('noHistory')}</p>`;refreshIcons();}catch{toast('saveFailed');}}
  if(b.dataset.action==='audit-all'&&owner)await checkAllBuilds();
  if(b.dataset.action==='audit-stop'){auditRunning=false;b.disabled=true;}
  if(b.dataset.restoreVersion&&owner){if(await confirmAction('restoreTitle','restoreHelp')){try{const r=await request('/api/admin/history/'+b.dataset.restoreVersion);await commit(await r.json());render();toast('restored');}catch(e){toast(e.message==='conflict'?'conflict':'saveFailed');}}}
  if(b.dataset.check&&owner){b.disabled=true;const result=b.parentElement.querySelector('#check-result');result.textContent=t('checking');try{const r=await request('/api/admin/check-build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.check})});const x=await r.json();result.textContent=(httpStatus(x.status)+' · '+dateTime(x.checkedAt))+' '+t('checkDisclaimer');}catch{result.textContent=t('checkUnknown');}finally{b.disabled=false;}}
  if(b.dataset.action==='logout'){try{await request('/api/admin/logout',{method:'POST'});}catch{}token='';owner=false;writeStorage('warframe-session','');section='all';render();localize();}
});
$('#language').addEventListener('change',async()=>{const next=$('#language').value;if(!await leaveEditor()){$('#language').value=lang;return;}lang=next;localize();render();saveLocation();});
$('#search').addEventListener('input',()=>{state.search=$('#search').value.slice(0,200);render();saveLocation(searchEditing?'replace':'push');searchEditing=true;});
$('#search').addEventListener('blur',()=>{searchEditing=false;});
for(const [id,key]of [['type-filter','type'],['element-filter','element'],['sort','sort']])$('#'+id).addEventListener('change',()=>{state[key]=$('#'+id).value;render();saveLocation();});
window.addEventListener('popstate',async event=>{
  if(ignoreHistory){ignoreHistory=false;return;}
  if(!catalog)return;
  pendingHistoryIndex=Number.isInteger(event.state?.arsenalIndex)?event.state.arsenalIndex:historyIndex;
  if(restoringHistory)return;
  restoringHistory=true;
  if(!await leaveEditor()){
    if(pendingHistoryIndex!==historyIndex){ignoreHistory=true;history.go(historyIndex-pendingHistoryIndex);}
    else history.replaceState({arsenalIndex:historyIndex},'',lastLocation);
  }else{historyIndex=pendingHistoryIndex;applyLocation(readCatalogLocation(location.search,{},lang));saveLocation('replace');}
  restoringHistory=false;
});
document.addEventListener('submit',e=>{if(e.target.id==='editor-form'){e.preventDefault();submitEditor(e.target);}});
document.addEventListener('input',e=>{if(e.target.closest('#editor-form'))dirty=true;});
document.addEventListener('change',e=>{if(e.target.closest('#editor-form'))dirty=true;});
document.addEventListener('keydown',e=>{
  if($('#sidebar').classList.contains('open')){
    if(e.key==='Escape'){e.preventDefault();closeNavigation();return;}
    if(e.key==='Tab'){const items=[...$('#sidebar').querySelectorAll('a,button,select')].filter(x=>!x.disabled&&x.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}return;
  }
  if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!$('#detail-dialog').open){e.preventDefault();$('#search').focus();}
});
$('#detail-dialog').addEventListener('cancel',async e=>{if(editing&&dirty){e.preventDefault();if(await leaveEditor()){$('#detail-dialog').close();renderInspector();}}else if(!editing){explicitSelection=false;saveLocation();}});
$('#detail-dialog').addEventListener('close',()=>{if(!editing){$('#mobile-inspector').innerHTML='';renderInspector();refreshIcons();document.querySelector(`[data-id="${selected}"]`)?.focus({preventScroll:true});}});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('resize',()=>{
  if(!matchMedia('(max-width:600px)').matches&&$('#sidebar').classList.contains('open'))closeNavigation();
  if(matchMedia('(max-width:1050px)').matches){if(editing&&!$('#detail-dialog').open)openMobileDetail();}
  else if($('#detail-dialog').open){const focus=editing?moveInspector($('#mobile-inspector'),$('#inspector')):null;$('#detail-dialog').close();focus?.focus({preventScroll:true});}
});
bootstrap();
