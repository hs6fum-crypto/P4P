(function () {
  'use strict';

  var STORAGE_KEY = 'phr-sh11-dashboard-v1';
  var THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  var FONT_FAMILY = '"TH SarabunIT๙", sans-serif';
  var CLAIM_BASE_FONT_PT = 14;
  var CLAIM_MIN_FONT_PT = 11;
  var claimFontPt = CLAIM_BASE_FONT_PT;
  var claimFitsA4 = true;
  var PDF_FONT_PX = CLAIM_BASE_FONT_PT * 96 / 72;
  var pdfHorizontalOverflow = false;
  var thaiSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', {granularity:'word'}) : null;
  var state = {people:[],records:[],peopleSeeded:false};
  var editingId = '';
  var editingPersonId = '';
  var editorLicenseData = '';
  var editorLicenseName = '';
  var editorLicenseWidth = 0;
  var editorLicenseHeight = 0;
  var previewRecord = null;
  var previewMode = 'claim';
  var isGas = Boolean(window.google && google.script && google.script.run);

  function byId(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function xmlEsc(value) { return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function thaiWords(text) { text=String(text==null?'':text);return thaiSegmenter?Array.from(thaiSegmenter.segment(text),function(part){return part.segment;}):(text.match(/\s+|[^\s]+/g)||[]); }
  function thaiMarkup(text) {
    return thaiWords(text).map(function (part) {
      if (/[\u0e00-\u0e7f]/.test(part) && !/^\s+$/.test(part)) return '<span class="thai-word">'+esc(part)+'</span><wbr>';
      return esc(part);
    }).join('');
  }
  function thaiNameMarkup(name) { return '<span class="thai-name" style="display:inline-block;white-space:nowrap!important;word-break:keep-all;overflow-wrap:normal">'+thaiMarkup(name)+'</span>'; }
  function thaiTextWithNameMarkup(text,record) {
    var name=personName(record);
    if(!name)return thaiMarkup(text);
    return String(text==null?'':text).split(name).map(function(part){return thaiMarkup(part);}).join(thaiNameMarkup(name));
  }
  function personIdentity(record) { return 'ชื่อ '+[record.prefix,record.firstName,'นามสกุล',record.lastName].filter(Boolean).join('\u00a0'); }
  function nonBreakingText(text) { return String(text==null?'':text).replace(/\s+/g,'\u00a0'); }
  function nonBreakingPersonName(record) { return nonBreakingText(personName(record)); }
  function thaiDigits(value) { return String(value == null ? '' : value).replace(/[0-9]/g,function(d){return '๐๑๒๓๔๕๖๗๘๙'[Number(d)];}); }
  function monthName(value) { return THAI_MONTHS[(Number(value)||1)-1] || ''; }
  function asciiDigits(value) { return String(value == null ? '' : value).replace(/[๐-๙]/g,function(d){return String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d));}); }
  function daysInMonth(year,month) { return new Date(Date.UTC(year,month,0)).getUTCDate(); }
  function parseServiceDate(value) {
    var text=asciiDigits(value).replace(/พ\.?\s*ศ\.?/g,'').trim(),match,day,month,year;
    if(!text)return null;
    match=text.match(/(\d{1,4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,4})/);
    if(match){if(Number(match[1])>31){year=Number(match[1]);month=Number(match[2]);day=Number(match[3]);}else{day=Number(match[1]);month=Number(match[2]);year=Number(match[3]);}}
    else {
      match=text.match(/(\d{1,2})\s+([\u0e00-\u0e7fA-Za-z.]+)\s+(\d{2,4})/);
      if(!match)return null;
      day=Number(match[1]);year=Number(match[3]);
      var token=match[2].replace(/\./g,'').toLowerCase();
      month=THAI_MONTHS.findIndex(function(name){return name===token;})+1;
      if(!month){var aliases={'มค':1,'มกราคม':1,'กพ':2,'กุมภาพันธ์':2,'มีค':3,'มีนาคม':3,'เมย':4,'เมษายน':4,'พค':5,'พฤษภาคม':5,'มิย':6,'มิถุนายน':6,'กค':7,'กรกฎาคม':7,'สค':8,'สิงหาคม':8,'กย':9,'กันยายน':9,'ตค':10,'ตุลาคม':10,'พย':11,'พฤศจิกายน':11,'ธค':12,'ธันวาคม':12,'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12};month=aliases[token]||0;}
    }
    if(year>2400)year-=543;else if(year<100)year+=2000;
    if(month<1||month>12||day<1||day>daysInMonth(year,month))return null;
    return {year:year,month:month,day:day};
  }
  function claimMonthEnd(record) { var year=(Number(record.yearBE)||currentBEYear())-543,month=Number(record.month)||1;return {year:year,month:month,day:daysInMonth(year,month)}; }
  function formatServiceDate(date) { return date?thaiDigits(date.day)+' '+THAI_MONTHS[date.month-1]+' '+thaiDigits(date.year+543):''; }
  function addCalendarMonths(date,amount) { var index=date.year*12+(date.month-1)+amount,year=Math.floor(index/12),month=index-year*12+1;return {year:year,month:month,day:Math.min(date.day,daysInMonth(year,month))}; }
  function dateOrder(a,b) { return a.year-b.year||a.month-b.month||a.day-b.day; }
  function durationBetween(start,end) {
    if(!start||!end||dateOrder(end,start)<0)return null;
    var monthCount=(end.year-start.year)*12+end.month-start.month;
    while(monthCount>0&&dateOrder(addCalendarMonths(start,monthCount),end)>0)monthCount--;
    var anchor=addCalendarMonths(start,monthCount),days=Math.floor((Date.UTC(end.year,end.month-1,end.day)-Date.UTC(anchor.year,anchor.month-1,anchor.day))/86400000)+1;
    if(start.day===1&&end.day===daysInMonth(end.year,end.month)){monthCount++;days=0;}
    else if(days>=30){monthCount+=Math.floor(days/30);days=days%30;}
    return {years:Math.floor(monthCount/12),months:monthCount%12,days:days};
  }
  function parseDurationText(value) {
    var text=asciiDigits(value).trim(),yearsMatch=text.match(/(\d+)\s*ปี/),monthsMatch=text.match(/(\d+)\s*เดือน/),daysMatch=text.match(/(\d+)\s*วัน/),numbers=text.match(/\d+/g)||[];
    var years=yearsMatch?Number(yearsMatch[1]):0,months=monthsMatch?Number(monthsMatch[1]):0,days=daysMatch?Number(daysMatch[1]):0;
    if(!yearsMatch&&!monthsMatch&&numbers.length){years=Number(numbers[0])||0;months=Number(numbers[1])||0;}
    return {years:years,months:months,days:days,hasValue:!!(yearsMatch||monthsMatch||daysMatch||numbers.length)};
  }
  function normalizeDuration(years,months,days) { years=Number(asciiDigits(years))||0;months=Number(asciiDigits(months))||0;days=Number(asciiDigits(days))||0;var totalMonths=years*12+months+Math.floor(days/30),leftDays=days%30;return {years:Math.floor(totalMonths/12),months:totalMonths%12,days:leftDays}; }
  function durationText(duration,includeDays) { var text=thaiDigits(duration.years)+' ปี '+thaiDigits(duration.months)+' เดือน';if(includeDays&&duration.days)text+=' '+thaiDigits(duration.days)+' วัน';return text; }
  function serviceDurationText(row) { var value=normalizeDuration(row.years,row.months,row.days);if(!row.years&&!row.months&&!row.days)return '.... ปี .... เดือน';return durationText(value,true); }
  function calculatedRecordDurations(record) {
    var endDefault=claimMonthEnd(record),totalMonths=0,totalDays=0,hasAny=false,trainingStart=parseServiceDate(record.trainingFrom),trainingEnd=record.trainingTo?parseServiceDate(record.trainingTo):endDefault,trainingDuration=trainingStart&&trainingEnd?durationBetween(trainingStart,trainingEnd):null,trainingAuto=!!trainingDuration;
    if(trainingAuto){record.trainingDuration=durationText(trainingDuration,true);record.trainingDurationAuto=true;}
    else {if(record.trainingDurationAuto)record.trainingDuration='';record.trainingDurationAuto=false;trainingDuration=parseDurationText(record.trainingDuration);}
    if(trainingDuration&&(trainingAuto||trainingDuration.hasValue)){totalMonths+=trainingDuration.years*12+trainingDuration.months;totalDays+=trainingDuration.days;hasAny=true;}
    (record.serviceHistory||[]).forEach(function(row){var start=parseServiceDate(row.from),end=row.to?parseServiceDate(row.to):endDefault,measured=start&&end?durationBetween(start,end):null,autoCalculated=!!measured;
      if(autoCalculated){row.years=String(measured.years);row.months=String(measured.months);row.days=measured.days?String(measured.days):'';row.durationAuto=true;}
      else {if(row.durationAuto){row.years='';row.months='';row.days='';}row.durationAuto=false;measured=parseDurationText((row.years||'')+' ปี '+(row.months||'')+' เดือน '+(row.days||'')+' วัน');}
      if(measured&&(autoCalculated||measured.hasValue)){totalMonths+=measured.years*12+measured.months;totalDays+=measured.days;hasAny=true;}
    });
    if(hasAny){var total=normalizeDuration(0,totalMonths,totalDays);record.networkYears=String(total.years);record.networkMonths=String(total.months);record.totalYears=String(total.years);record.totalMonths=String(total.months);record.networkDurationAuto=true;record.totalDurationAuto=true;record.networkIsRed=true;record.totalIsRed=true;}
    else if(record.networkDurationAuto||record.totalDurationAuto){record.networkYears='';record.networkMonths='';record.totalYears='';record.totalMonths='';record.networkDurationAuto=false;record.totalDurationAuto=false;record.networkIsRed=false;record.totalIsRed=false;}
    return record;
  }
  function currentBEYear() { return new Date().getFullYear()+543; }
  function amountText(record) { return String(record.amountWords || '').trim(); }
  function personName(record) { return [record.prefix,record.firstName,record.lastName].filter(Boolean).join(' ').trim(); }
  function personKey(person) { return [person.prefix,person.firstName,person.lastName].map(function(value){return String(value||'').trim().replace(/\s+/g,'').toLowerCase();}).join('|'); }
  function emptyPerson() { return {id:'',prefix:'',firstName:'',lastName:'',position:'',workplace:'',province:'',serviceLevel:'',licenseName:'',licenseNumber:'',licenseExpiry:'',licenseImageDataUrl:'',licenseImageName:'',licenseImageWidth:0,licenseImageHeight:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; }
  function normalizePerson(person) { var base=emptyPerson(),item=person||{};Object.keys(item).forEach(function(key){base[key]=item[key];});if(!base.id)base.id='person-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);if(!base.position&&base.prefix==='นางสาว'&&base.firstName==='สกาวพรรณ'&&base.lastName==='อวัสดาถาวร')base.position='นักสาธารณสุขชำนาญการ';return base; }
  function personById(id) { return state.people.find(function(person){return person.id===id;})||null; }
  function personForRecord(record) { return personById(record.personId)||state.people.find(function(person){return personKey(person)===personKey(record);})||null; }
  function hydrateState(saved) {
    saved=saved&&Array.isArray(saved.records)?saved:{records:[]};
    state={people:Array.isArray(saved.people)?saved.people.map(normalizePerson):[],records:[],peopleSeeded:!!saved.peopleSeeded,updatedAt:saved.updatedAt};
    var changed=!Array.isArray(saved.people)||!saved.peopleSeeded;
    if(!state.peopleSeeded&&Array.isArray(window.SH11_PEOPLE_SEED)){
      window.SH11_PEOPLE_SEED.forEach(function(seed){var match=state.people.find(function(person){return personKey(person)===personKey(seed);});if(!match)state.people.push(normalizePerson(seed));else if(!match.licenseImageDataUrl&&seed.licenseImageDataUrl)Object.keys(seed).forEach(function(key){if(!match[key])match[key]=seed[key];});});
      state.peopleSeeded=true;changed=true;
    }
    state.records=saved.records.map(function(raw){
      var record=normalizeRecord(raw),person=personById(record.personId)||state.people.find(function(item){return personKey(item)===personKey(record);});
      if(!person){person=normalizePerson({prefix:record.prefix,firstName:record.firstName,lastName:record.lastName,position:record.position,workplace:record.workplace,province:record.province,serviceLevel:record.serviceLevel,licenseName:record.licenseName,licenseNumber:record.licenseNumber,licenseExpiry:record.licenseExpiry,licenseImageDataUrl:record.licenseImageDataUrl,licenseImageName:record.licenseImageName,licenseImageWidth:record.licenseImageWidth,licenseImageHeight:record.licenseImageHeight});state.people.push(person);changed=true;}
      else {['prefix','firstName','lastName','position','workplace','province','serviceLevel','licenseName','licenseNumber','licenseExpiry','licenseImageDataUrl','licenseImageName','licenseImageWidth','licenseImageHeight'].forEach(function(key){if(record[key]&&(!person[key]||key.indexOf('license')===0)){person[key]=record[key];changed=true;}});}
      if(record.licenseImageDataUrl||record.licenseName||record.licenseNumber||record.licenseExpiry)changed=true;
      if(record.personId!==person.id)changed=true;record.personId=person.id;
      ['prefix','firstName','lastName','position','workplace','province','serviceLevel','licenseName','licenseNumber','licenseExpiry','licenseImageDataUrl','licenseImageName','licenseImageWidth','licenseImageHeight'].forEach(function(key){delete record[key];});
      return record;
    });
    return changed;
  }
  function emptyHistory() { return {facility:'',province:'',level:'',from:'',to:'',years:'',months:'',days:'',note:'',isRed:false,durationAuto:false}; }
  function emptyRecord() {
    var date = new Date();
    return {
      id:'',yearBE:date.getFullYear()+543,month:date.getMonth()+1,formTitle:'ใบขอรับเงินค่าตอบแทนเบี้ยเลี้ยงเหมาจ่ายสำหรับเจ้าหน้าที่',formSubtitle:'ที่ปฏิบัติงานในหน่วยบริการหรือหน่วยบริการในเครือข่าย',
      unitName:'โรงพยาบาลพรหมพิราม',prefix:'',firstName:'',lastName:'',position:'',workplace:'โรงพยาบาลพรหมพิราม',province:'พิษณุโลก',serviceLevel:'',networkYears:'',networkMonths:'',networkNote:'นับถึงวันสิ้นเดือนที่เบิกจ่าย',networkIsRed:false,
      trainingType:'รพศ./ท.',trainingFacility:'',trainingProvince:'',trainingFrom:'',trainingTo:'',trainingDuration:'',trainingNote:'',trainingIsRed:false,serviceHistory:[emptyHistory(),emptyHistory(),emptyHistory(),emptyHistory(),emptyHistory(),emptyHistory()],
      totalYears:'',totalMonths:'',totalIsRed:false,totalDurationAuto:false,networkDurationAuto:false,trainingDurationAuto:false,monthlyAmount:'3000',amountIsRed:false,redNote:'',declarationText:'ข้าพเจ้าขอรับรองว่าข้อมูลดังกล่าว เป็นความจริงทุกประการ',signerName:'',signerPosition:'',certifierName:'',certifierPosition:'',receiptText:'ข้าพเจ้า {{name}} ได้รับเงินจำนวน {{amount}} บาท ({{amountWords}} บาทถ้วน) แล้ว',receivedAmount:'3000',amountWords:'สามพัน',signatureDate:'',
      personId:'',defaultTextColor:'black',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
    };
  }
  function normalizeRecord(record) {
    var base=emptyRecord(),item=record||{};Object.keys(item).forEach(function(key){base[key]=item[key];});
    base.yearBE=Number(base.yearBE)||currentBEYear();base.month=Number(base.month)||1;
    base.defaultTextColor='black';
    base.serviceHistory=Array.isArray(base.serviceHistory)?base.serviceHistory.map(function(row){var value=emptyHistory();Object.keys(row||{}).forEach(function(key){value[key]=row[key];});return value;}):[];
    if(!base.id)base.id='sh11-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    return calculatedRecordDurations(base);
  }
  function toast(message,error) {
    var el=byId('toast');el.textContent=message;el.classList.toggle('error',!!error);el.classList.add('show');
    window.clearTimeout(toast.timer);toast.timer=window.setTimeout(function(){el.classList.remove('show');},3200);
  }
  function saveState() {
    state.updatedAt=new Date().toISOString();
    if(!isGas){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));byId('saveStatus').textContent='บันทึกในเครื่องนี้';byId('saveStatus').classList.remove('error');return Promise.resolve(true);}catch(error){byId('saveStatus').textContent='บันทึกไม่สำเร็จ';byId('saveStatus').classList.add('error');return Promise.reject(error);}}
    byId('saveStatus').textContent='กำลังบันทึกลง Google Sheets…';
    return new Promise(function(resolve,reject){google.script.run.withSuccessHandler(function(){byId('saveStatus').textContent='บันทึกลง Google Sheets แล้ว';byId('saveStatus').classList.remove('error');resolve(true);}).withFailureHandler(function(error){byId('saveStatus').textContent='บันทึกไม่สำเร็จ';byId('saveStatus').classList.add('error');reject(error);}).saveSH11State(state);});
  }
  function loadState() {
    if(!isGas){try{var saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'),changed=hydrateState(saved);renderDashboard();if(changed)saveState();return;}catch(e){state={people:[],records:[],peopleSeeded:false};hydrateState(state);renderDashboard();saveState();return;}}
    byId('saveStatus').textContent='กำลังเชื่อมต่อ Google Sheets…';
    google.script.run.withSuccessHandler(function(saved){var changed=hydrateState(saved);byId('saveStatus').textContent='เชื่อมต่อ Google Sheets แล้ว';renderDashboard();if(changed)saveState();}).withFailureHandler(function(error){state={people:[],records:[],peopleSeeded:false};hydrateState(state);byId('saveStatus').textContent='เชื่อมต่อไม่สำเร็จ';byId('saveStatus').classList.add('error');renderDashboard();toast('อ่านข้อมูลจาก Google Sheets ไม่สำเร็จ: '+error.message,true);}).getSH11State();
  }
  function setOptions(select,items,selected) {
    select.innerHTML=items.map(function(item){return '<option value="'+esc(item.value)+'">'+esc(item.label)+'</option>';}).join('');
    if(selected!=null)select.value=String(selected);
  }
  function yearItems() { var years=[];for(var year=2500;year<=2600;year++)years.push({value:year,label:String(year)});return years; }
  function monthItems(includeAll) { var items=includeAll?[{value:'all',label:'ทุกเดือน'}]:[];THAI_MONTHS.forEach(function(name,index){items.push({value:index+1,label:name});});return items; }
  function initFilters() {
    var yearValues=Array.from(new Set(state.records.map(function(record){return Number(record.yearBE);}))).filter(Boolean).sort(function(a,b){return b-a;});
    var yearOptions=[{value:'all',label:'ทุกปี'}];yearValues.forEach(function(year){yearOptions.push({value:year,label:String(year)});});
    if(!yearValues.length)yearOptions.push({value:currentBEYear(),label:String(currentBEYear())});
    var previousYear=byId('filterYear').value||'all',previousMonth=byId('filterMonth').value||'all',previousPerson=byId('filterPerson').value||'all';
    setOptions(byId('filterYear'),yearOptions,yearOptions.some(function(item){return String(item.value)===previousYear;})?previousYear:'all');
    setOptions(byId('filterMonth'),monthItems(true),previousMonth);
    var personOptions=[{value:'all',label:'ทุกบุคลากร'}].concat(state.people.slice().sort(function(a,b){return personName(a).localeCompare(personName(b),'th');}).map(function(person){return {value:person.id,label:personName(person)||'ไม่ระบุชื่อ'};}));
    setOptions(byId('filterPerson'),personOptions,personOptions.some(function(item){return String(item.value)===previousPerson;})?previousPerson:'all');
  }
  function renderDashboard() {
    initFilters();
    var search=(byId('searchInput').value||'').trim().toLowerCase(),year=byId('filterYear').value,month=byId('filterMonth').value,personFilter=byId('filterPerson').value;
    byId('peopleCount').textContent=state.people.length.toLocaleString('th-TH')+' คน';
    byId('peopleList').innerHTML=state.people.slice().sort(function(a,b){return personName(a).localeCompare(personName(b),'th');}).map(function(person){
      var claims=state.records.filter(function(record){return record.personId===person.id;}).length;
      return '<article class="person-card"><div class="person-card-main">'+(person.licenseImageDataUrl?'<img class="person-card-thumb" src="'+person.licenseImageDataUrl+'" alt="">':'<div class="person-card-thumb person-card-placeholder">ใบอนุญาต</div>')+'<div class="person-card-copy"><strong>'+esc(personName(person)||'ไม่ระบุชื่อ')+'</strong><span>'+esc([person.position,person.workplace,person.province].filter(Boolean).join(' · ')||'เพิ่มตำแหน่งและหน่วยบริการได้')+'</span><small class="'+(person.licenseImageDataUrl?'license-attached':'license-missing')+'">'+(person.licenseImageDataUrl?'แนบใบประกอบแล้ว':'ยังไม่มีใบประกอบ')+' · '+claims.toLocaleString('th-TH')+' คำขอ</small></div></div><div class="person-card-actions"><button class="btn btn-outline" data-person-action="edit" data-id="'+esc(person.id)+'">แก้ไข</button><button class="btn btn-soft" data-person-action="claim" data-id="'+esc(person.id)+'">สร้างคำขอ</button><button class="btn btn-outline-danger" data-person-action="delete" data-id="'+esc(person.id)+'">ลบ</button></div></article>';
    }).join('')||'<p class="empty-people">ยังไม่มีบุคลากร</p>';
    var filtered=state.records.filter(function(record){
      if(year!=='all'&&String(record.yearBE)!==year)return false;
      if(month!=='all'&&String(record.month)!==month)return false;
      if(personFilter!=='all'&&record.personId!==personFilter)return false;
      var person=personForRecord(record)||{};var label=[personName(person.firstName?person:record),person.position||record.position,record.unitName,person.workplace||record.workplace,person.province||record.province].join(' ').toLowerCase();return !search||label.indexOf(search)>=0;
    }).sort(function(a,b){return Number(b.yearBE)-Number(a.yearBE)||Number(b.month)-Number(a.month)||personName(personForRecord(a)||a).localeCompare(personName(personForRecord(b)||b),'th');});
    var uniquePeople=Array.from(new Set(filtered.map(function(record){return record.personId;}))).filter(Boolean).length;
    var totalAmount=filtered.reduce(function(total,record){return total+(Number(record.monthlyAmount)||0);},0);
    byId('metrics').innerHTML='<article class="metric"><div class="metric-label">รายการที่แสดง</div><div class="metric-value">'+filtered.length.toLocaleString('th-TH')+'</div></article><article class="metric"><div class="metric-label">เจ้าหน้าที่</div><div class="metric-value">'+uniquePeople.toLocaleString('th-TH')+'</div></article><article class="metric"><div class="metric-label">ยอดเงินต่อเดือนรวม</div><div class="metric-value">'+totalAmount.toLocaleString('th-TH')+' <span class="small">บาท</span></div></article>';
    byId('recordCount').textContent='แสดง '+filtered.length.toLocaleString('th-TH')+' จาก '+state.records.length.toLocaleString('th-TH')+' รายการ';
    byId('emptyState').hidden=filtered.length>0;
    byId('recordsBody').innerHTML=filtered.map(function(record){
      var person=personForRecord(record),license=person&&person.licenseImageDataUrl?'แนบภาพแล้ว':'ยังไม่มีภาพ';
      return '<tr><td>'+esc(monthName(record.month)+' '+record.yearBE)+'</td><td><strong>'+esc(personName(person||record)||'ยังไม่ระบุชื่อ')+'</strong></td><td>'+esc([person&&person.position,record.unitName||person&&person.workplace].filter(Boolean).join(' · '))+'</td><td>'+esc((record.totalYears||'—')+' ปี '+(record.totalMonths||'—')+' เดือน')+'</td><td>'+esc((Number(record.monthlyAmount)||0).toLocaleString('th-TH'))+' บาท</td><td>'+esc(license)+'</td><td><div class="actions"><button class="btn btn-soft" data-action="preview" data-id="'+esc(record.id)+'">ดูภาพ</button><button class="btn btn-outline" data-action="edit" data-id="'+esc(record.id)+'">แก้ไข</button><button class="btn btn-outline" data-action="duplicate" data-id="'+esc(record.id)+'">คัดลอก</button><button class="btn btn-outline-danger" data-action="delete" data-id="'+esc(record.id)+'">ลบ</button></div></td></tr>';
    }).join('');
  }
  function fillEditor(record) {
    calculatedRecordDurations(record);
    var form=byId('recordForm');
    Object.keys(record).forEach(function(key){var control=form.elements.namedItem(key);if(control&&control.type!=='file'&&typeof record[key]!=='object')control.value=record[key]==null?'':record[key];});
    ['networkYears','networkMonths','totalYears','totalMonths','trainingDuration'].forEach(function(name){var control=form.elements.namedItem(name);if(control)control.dataset.durationAuto=(name.indexOf('network')===0?record.networkDurationAuto:name.indexOf('total')===0?record.totalDurationAuto:record.trainingDurationAuto)?'true':'false';});
    refreshClaimPersonOptions(record.personId);
    setOptions(byId('monthSelect'),monthItems(false),record.month);setOptions(byId('yearSelect'),yearItems(),record.yearBE);
    renderHistoryRows(record.serviceHistory);byId('networkRed').checked=!!record.networkIsRed;byId('trainingRed').checked=!!record.trainingIsRed;byId('totalRed').checked=!!record.totalIsRed;byId('amountRed').checked=!!record.amountIsRed;updateClaimPersonDisplay(personById(byId('claimPersonSelect').value));
  }
  function openEditor(record,id) {
    editingId=id||'';var value=normalizeRecord(record||emptyRecord());
    if(!value.personId&&state.people.length)value.personId=state.people[0].id;
    var selectedPerson=personById(value.personId);if(selectedPerson){['prefix','firstName','lastName','position','workplace','province','serviceLevel'].forEach(function(key){value[key]=selectedPerson[key]||'';});}
    if(!value.signerName)value.signerName=personName(value);if(!value.receivedAmount)value.receivedAmount=value.monthlyAmount;if(!value.certifierName)value.certifierName='';
    fillEditor(value);byId('editorTitle').textContent=editingId?'แก้ไขใบขอรับเงิน':'สร้างใบขอรับเงิน';byId('dashboardView').hidden=true;byId('editorView').hidden=false;window.scrollTo(0,0);
  }
  function closeEditor() {byId('editorView').hidden=true;byId('dashboardView').hidden=false;editingId='';window.scrollTo(0,0);}
  function renderHistoryRows(rows) {
    byId('historyRows').innerHTML=rows.map(function(row,index){
      return '<article class="history-row" data-index="'+index+'" data-auto-duration="'+(row.durationAuto?'true':'false')+'"><div class="history-row-head"><strong>รายการ '+thaiDigits(index+2)+' · '+esc(row.facility||'สถานที่ปฏิบัติงาน')+'</strong><button type="button" class="btn btn-outline-danger" data-remove-history="'+index+'">ลบแถว</button></div><div class="field-grid"><label>หน่วยบริการ / โรงพยาบาล<input data-history="facility" value="'+esc(row.facility)+'"></label><label>จังหวัด<input data-history="province" value="'+esc(row.province)+'"></label><label>ระดับ / กลุ่ม<input data-history="level" value="'+esc(row.level)+'"></label><label>ตั้งแต่วันที่<input data-history="from" value="'+esc(row.from)+'" placeholder="วัน เดือน ปี พ.ศ."></label><label>ถึงวันที่<input data-history="to" value="'+esc(row.to)+'" placeholder="วัน เดือน ปี พ.ศ."></label><label class="red-field">ระยะเวลา (ปี)<input class="red-control auto-duration-control" data-history="years" data-duration-auto="'+(row.durationAuto?'true':'false')+'" value="'+esc(row.years)+'" inputmode="numeric"></label><label class="red-field">ระยะเวลา (เดือน)<input class="red-control auto-duration-control" data-history="months" data-duration-auto="'+(row.durationAuto?'true':'false')+'" value="'+esc(row.months)+'" inputmode="numeric"></label><label class="red-field">ระยะเวลา (วัน)<input class="red-control auto-duration-control" data-history="days" data-duration-auto="'+(row.durationAuto?'true':'false')+'" value="'+esc(row.days)+'" inputmode="numeric"></label><label class="full-width">ข้อความเพิ่มเติม<input data-history="note" value="'+esc(row.note)+'"></label></div><label class="history-red-toggle"><input type="checkbox" data-history="isRed" '+(row.isRed?'checked':'')+'>พิมพ์รายละเอียดของแถวนี้เป็นสีแดง</label></article>';
    }).join('');
  }
  function readHistoryRows() {
    return Array.prototype.slice.call(byId('historyRows').querySelectorAll('.history-row')).map(function(row){var item=emptyHistory();item.durationAuto=row.dataset.autoDuration==='true';row.querySelectorAll('[data-history]').forEach(function(control){item[control.dataset.history]=control.type==='checkbox'?control.checked:control.value.trim();});return item;});
  }
  function collectEditor() {
    var record=emptyRecord(),form=byId('recordForm');
    Array.prototype.slice.call(form.querySelectorAll('[name]')).forEach(function(control){if(control.type==='file')return;record[control.name]=control.value.trim();});
    record.id=editingId||'sh11-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);record.month=Number(record.month)||1;record.yearBE=Number(record.yearBE)||currentBEYear();record.networkIsRed=byId('networkRed').checked;record.trainingIsRed=byId('trainingRed').checked;record.totalIsRed=byId('totalRed').checked;record.amountIsRed=byId('amountRed').checked;record.networkDurationAuto=form.elements.namedItem('networkYears').dataset.durationAuto==='true';record.totalDurationAuto=form.elements.namedItem('totalYears').dataset.durationAuto==='true';record.trainingDurationAuto=form.elements.namedItem('trainingDuration').dataset.durationAuto==='true';record.serviceHistory=readHistoryRows();record.createdAt=editingId?(state.records.find(function(item){return item.id===editingId;})||{}).createdAt||new Date().toISOString():new Date().toISOString();record.updatedAt=new Date().toISOString();
    if(!record.signerName)record.signerName=personName(record);if(!record.receivedAmount)record.receivedAmount=record.monthlyAmount;
    return calculatedRecordDurations(normalizeRecord(record));
  }
  function refreshDurationInputs() {
    if(byId('editorView').hidden)return;
    var record=collectEditor(),form=byId('recordForm');
    ['networkYears','networkMonths','totalYears','totalMonths','trainingDuration'].forEach(function(name){var control=form.elements.namedItem(name),value=record[name];if(control){control.value=value==null?'':value;control.dataset.durationAuto=(name.indexOf('network')===0?record.networkDurationAuto:name.indexOf('total')===0?record.totalDurationAuto:record.trainingDurationAuto)?'true':'false';}});
    Array.prototype.slice.call(byId('historyRows').querySelectorAll('.history-row')).forEach(function(row,index){var item=record.serviceHistory[index];if(!item)return;row.dataset.autoDuration=item.durationAuto?'true':'false';['years','months','days'].forEach(function(key){var control=row.querySelector('[data-history="'+key+'"]');if(control){control.value=item[key]||'';control.dataset.durationAuto=item.durationAuto?'true':'false';}});});
    byId('networkRed').checked=!!record.networkIsRed;byId('totalRed').checked=!!record.totalIsRed;
  }
  function refreshClaimPersonOptions(selected) {
    var options=[{value:'',label:'เลือกบุคลากร'}].concat(state.people.slice().sort(function(a,b){return personName(a).localeCompare(personName(b),'th');}).map(function(person){return {value:person.id,label:personName(person)||'ไม่ระบุชื่อ'};}));
    setOptions(byId('claimPersonSelect'),options,selected||byId('claimPersonSelect').value||'');
  }
  function updateClaimPersonDisplay(person) {
    var form=byId('recordForm'),names=['prefix','firstName','lastName','position','workplace','province','serviceLevel'];
    names.forEach(function(key){var control=form.elements.namedItem(key);if(control)control.value=person&&person[key]||'';});
    byId('claimLicenseStatus').textContent=person?(person.licenseImageDataUrl?(person.licenseName||personName(person))+' · แนบใบประกอบแล้ว':'บุคลากรนี้ยังไม่มีภาพใบประกอบวิชาชีพ'):'เลือกบุคลากรเพื่อแสดงใบประกอบวิชาชีพ';
    byId('claimLicenseThumb').hidden=!(person&&person.licenseImageDataUrl);if(person&&person.licenseImageDataUrl)byId('claimLicenseThumb').src=person.licenseImageDataUrl;
    byId('editClaimPersonBtn').hidden=!person;
  }
  function upsertPersonFromRecord(record) {
    var person=personById(record.personId)||state.people.find(function(item){return personKey(item)===personKey(record);});
    if(!person){person=normalizePerson({});state.people.push(person);}
    ['prefix','firstName','lastName','position','workplace','province','serviceLevel'].forEach(function(key){person[key]=record[key]||'';});
    person.updatedAt=new Date().toISOString();record.personId=person.id;
    ['prefix','firstName','lastName','position','workplace','province','serviceLevel','licenseName','licenseNumber','licenseExpiry','licenseImageDataUrl','licenseImageName','licenseImageWidth','licenseImageHeight'].forEach(function(key){delete record[key];});
    return person;
  }
  function openPersonEditor(person) {
    var form=byId('personForm');form.reset();person=person?normalizePerson(person):emptyPerson();editingPersonId=person.id||'';
    Object.keys(person).forEach(function(key){var control=form.elements.namedItem(key);if(control&&control.type!=='file')control.value=person[key]==null?'':person[key];});
    editorLicenseData=person.licenseImageDataUrl||'';editorLicenseName=person.licenseImageName||'';editorLicenseWidth=Number(person.licenseImageWidth)||0;editorLicenseHeight=Number(person.licenseImageHeight)||0;
    byId('personModalTitle').textContent=editingPersonId?'แก้ไขข้อมูลบุคลากร':'เพิ่มบุคลากร';renderPersonLicenseThumb();byId('personModal').hidden=false;document.body.classList.add('modal-open');
  }
  function closePersonEditor() {byId('personModal').hidden=true;document.body.classList.remove('modal-open');editingPersonId='';editorLicenseData='';editorLicenseName='';editorLicenseWidth=0;editorLicenseHeight=0;byId('personLicenseFile').value='';}
  function renderPersonLicenseThumb() {
    byId('personLicenseStatus').textContent=editorLicenseData?(editorLicenseName||'แนบภาพใบประกอบวิชาชีพแล้ว'):'ยังไม่ได้แนบภาพ';byId('personLicenseThumbWrap').hidden=!editorLicenseData;
    if(editorLicenseData)byId('personLicenseThumb').src=editorLicenseData;
  }
  function savePersonFromForm() {
    var form=byId('personForm'),person=emptyPerson();Array.prototype.slice.call(form.querySelectorAll('[name]')).forEach(function(control){if(control.type!=='file')person[control.name]=control.value.trim();});
    person.id=editingPersonId||'person-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);person.licenseImageDataUrl=editorLicenseData;person.licenseImageName=editorLicenseName;person.licenseImageWidth=editorLicenseWidth;person.licenseImageHeight=editorLicenseHeight;person.updatedAt=new Date().toISOString();
    if(!person.firstName||!person.lastName){toast('กรอกชื่อและนามสกุลก่อนบันทึก',true);return;}
    var duplicate=state.people.find(function(item){return item.id!==person.id&&personKey(item)===personKey(person);});if(duplicate){toast('มีบุคลากรชื่อนี้อยู่แล้ว กรุณาแก้ไขรายการเดิม',true);return;}
    var index=state.people.findIndex(function(item){return item.id===person.id;});if(index>=0){person.createdAt=state.people[index].createdAt;state.people[index]=person;}else state.people.push(person);
    saveState().then(function(){renderDashboard();refreshClaimPersonOptions(person.id);if(!byId('editorView').hidden){byId('claimPersonSelect').value=person.id;updateClaimPersonDisplay(person);}closePersonEditor();toast('บันทึกข้อมูลบุคลากรแล้ว');}).catch(function(error){toast('บันทึกไม่สำเร็จ: '+(error.message||error),true);});
  }
  function resizeLicenseImage(file) {
    return new Promise(function(resolve,reject){
      if(!file||!/^image\/(jpeg|png|webp)$/.test(file.type)){reject(new Error('เลือกไฟล์ภาพ JPG, PNG หรือ WebP'));return;}
      var reader=new FileReader();reader.onerror=function(){reject(new Error('อ่านไฟล์ภาพไม่สำเร็จ'));};reader.onload=function(){var image=new Image();image.onerror=function(){reject(new Error('เปิดไฟล์ภาพไม่สำเร็จ'));};image.onload=function(){var maxEdge=2400,scale=Math.min(1,maxEdge/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));var ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);var data=canvas.toDataURL('image/jpeg',.84);if(data.length>1200000)data=canvas.toDataURL('image/jpeg',.70);if(data.length>1800000){reject(new Error('ภาพยังมีขนาดใหญ่เกินไป กรุณาเลือกภาพที่เล็กลง'));return;}resolve({data:data,width:canvas.width,height:canvas.height});};image.src=String(reader.result);};reader.readAsDataURL(file);
    });
  }
  function storeRecord(record) {
    upsertPersonFromRecord(record);
    var index=state.records.findIndex(function(item){return item.id===record.id;});if(index>=0)state.records[index]=record;else state.records.push(record);
    return saveState().then(function(){renderDashboard();closeEditor();toast('บันทึกใบขอรับเงินแล้ว');}).catch(function(error){toast('บันทึกไม่สำเร็จ: '+(error.message||error),true);});
  }
  function serviceRangeParts(row,index,record) {
    var first=thaiDigits(index+2)+'. ปฏิบัติงานที่ '+(row.facility||'........................................')+' จังหวัด '+(row.province||'....................')+' จัดระดับ '+(row.level||'................')+(row.note?' '+row.note:'');
    var start=parseServiceDate(row.from),endText=row.to||(row.durationAuto&&start?formatServiceDate(claimMonthEnd(record)):'....................'),secondPrefix='ตั้งแต่วันที่ '+thaiDigits(row.from||'....................')+' ถึงวันที่ '+thaiDigits(endText)+' รวม ';
    return {first:first,secondPrefix:secondPrefix,duration:serviceDurationText(row)};
  }
  function formatServiceRange(row,index,record) {
    var parts=serviceRangeParts(row,index,record);
    return [parts.first,parts.secondPrefix+parts.duration];
  }
  function renderHistoryHtml(rows,startIndex,record) {
    return rows.map(function(row,index){var css=row.isRed?' paper-history-red':'',parts=serviceRangeParts(row,index+(startIndex||0),record),auto=row.durationAuto?' paper-auto-duration':'';return '<div class="paper-history'+css+'"><div>'+thaiMarkup(parts.first)+'</div><div class="paper-history detail'+auto+'">'+thaiMarkup(parts.secondPrefix+parts.duration)+'</div></div>';}).join('');
  }
  function templateText(text,record) {
    var rawAmount=asciiDigits(String(record.receivedAmount||record.monthlyAmount||'')).replace(/,/g,'').trim(),numericAmount=Number(rawAmount),amount=rawAmount?(isFinite(numericAmount)?thaiDigits(numericAmount.toLocaleString('en-US')):thaiDigits(rawAmount)):'';
    var tokens={name:personName(record),amount:amount,amountWords:amountText(record)};
    return String(text||'').replace(/\{\{(name|amount|amountWords)\}\}/g,function(match,key){return tokens[key]||'';});
  }
  function claimPageHtml(record,rows,first,final,startIndex) {
    var html='<article class="paper paper-claim">',trainingTo=record.trainingTo||(record.trainingDurationAuto?formatServiceDate(claimMonthEnd(record)):'....................');
    if(first){
      html+='<div class="paper-ref">ฉ11</div><div class="paper-title">'+thaiMarkup(record.formTitle)+'</div><div class="paper-subtitle">'+thaiMarkup(record.formSubtitle)+'</div>';
      html+='<div class="paper-unit">หน่วยบริการ '+thaiMarkup(record.unitName)+'</div><div class="paper-period">ประจำเดือน '+thaiMarkup(monthName(record.month))+' พ.ศ. '+thaiMarkup(record.yearBE)+'</div>';
      html+='<div class="paper-person-line">ข้าพเจ้า '+thaiNameMarkup(personIdentity(record))+' ตำแหน่ง '+thaiMarkup(record.position)+'</div>';
      html+='<div class="paper-person-line">ปัจจุบันปฏิบัติงานที่ '+thaiMarkup(record.workplace)+' จังหวัด '+thaiMarkup(record.province)+' ระดับ/กลุ่ม '+thaiMarkup(record.serviceLevel)+'</div>';
      html+='<div class="paper-person-line">ปฏิบัติงานหน่วยบริการหรือหน่วยบริการในเครือข่าย <span class="'+(record.networkIsRed?'paper-red':'')+'">'+thaiMarkup(thaiDigits(record.networkYears||'....'))+' ปี '+thaiMarkup(thaiDigits(record.networkMonths||'....'))+' เดือน</span> '+thaiMarkup(record.networkNote)+'</div>';
      html+='<div class="paper-section-title">โดยมีรายละเอียดการปฏิบัติงาน ดังนี้ (เฉพาะสายแพทย์ตอบข้อ ๑ ด้วย)</div>';
      html+='<div class="paper-training'+(record.trainingIsRed?' paper-history-red':'')+(record.trainingDurationAuto?' paper-auto-duration':'')+'">๑. ฝึกเพิ่มพูนทักษะ รวมระยะเวลาการปฏิบัติงาน '+thaiMarkup(thaiDigits(record.trainingDuration||'.......... ปี .......... เดือน'))+' '+thaiMarkup(record.trainingNote)+'<br>　'+thaiMarkup(record.trainingType||'รพศ./ท.')+' '+thaiMarkup(record.trainingFacility||'................................')+' จังหวัด '+thaiMarkup(record.trainingProvince||'....................')+' ตั้งแต่ '+thaiMarkup(thaiDigits(record.trainingFrom||'....................'))+' ถึง '+thaiMarkup(thaiDigits(trainingTo))+'</div>';
    } else html+='<div class="paper-title">รายละเอียดการปฏิบัติงาน (ต่อ)</div>';
    html+=renderHistoryHtml(rows,startIndex,record);
    if(final){
      html+='<div class="paper-total'+(record.totalIsRed?' paper-red':'')+'">รวมทั้งสิ้น <span>'+thaiMarkup(thaiDigits(record.totalYears||'....'))+' ปี '+thaiMarkup(thaiDigits(record.totalMonths||'....'))+' เดือน</span> '+thaiMarkup(record.redNote)+'</div>';
      html+='<div class="paper-amount'+(record.amountIsRed?' paper-red':'')+'">เป็นเงินเดือนละ '+thaiMarkup((Number(record.monthlyAmount)||0).toLocaleString('th-TH'))+' บาท</div>';
      html+='<div class="paper-declaration">'+thaiMarkup(record.declarationText)+'</div>';
      html+='<div class="paper-applicant-signature"><div class="signature-blank"></div><div>('+thaiNameMarkup(record.signerName||personName(record))+')</div><div>ตำแหน่ง '+thaiMarkup(record.signerPosition||record.position)+'</div></div>';
      var certificationText='ขอรับรองว่า '+personName(record)+' ได้ปฏิบัติงานตามหลักเกณฑ์ในการเบิกเบี้ยเลี้ยงเหมาจ่าย ตามที่กำหนดไว้';
      var certifierSignature=record.certifierName?'<div class="paper-certifier-signature"><div class="signature-blank"></div><div>ลงชื่อ ................................ ผู้รับรอง</div><div>('+thaiNameMarkup(record.certifierName)+')</div><div>ตำแหน่ง '+thaiMarkup(record.certifierPosition||'')+'</div></div>':'';
      html+='<div class="paper-footer-grid"><div class="paper-certifier"><div class="paper-certifier-text">'+thaiTextWithNameMarkup(certificationText,record)+'</div>'+certifierSignature+'</div><div class="paper-recipient"><div class="paper-receipt">'+thaiTextWithNameMarkup(templateText(record.receiptText,record),record)+'</div><div class="signature-blank"></div><div>ลงชื่อ ................................ ผู้รับเงิน</div><div>('+thaiNameMarkup(record.signerName||personName(record))+')</div><div class="paper-date">วันที่ '+thaiMarkup(record.signatureDate||'....................')+'</div></div></div>';
    }
    return html+'</article>';
  }
  function buildClaimPreview(record) {
    return claimPageHtml(record,record.serviceHistory||[],true,true,0);
  }
  function buildLicensePreview(record) {
    if(!record.licenseImageDataUrl)return '<article class="paper paper-license"><div class="license-placeholder">แนบภาพใบประกอบวิชาชีพจริงในแบบฟอร์ม เพื่อดูภาพและพิมพ์แนวนอน</div></article>';
    return '<article class="paper paper-license"><img src="'+record.licenseImageDataUrl+'" alt="สำเนาใบประกอบวิชาชีพ '+esc(record.licenseName||personName(record))+'"></article>';
  }
  function openPreview(record,mode) {
    previewRecord=calculatedRecordDurations(normalizeRecord(record));var person=personForRecord(previewRecord);if(person){['prefix','firstName','lastName','position','workplace','province','serviceLevel','licenseName','licenseNumber','licenseExpiry','licenseImageDataUrl','licenseImageName','licenseImageWidth','licenseImageHeight'].forEach(function(key){previewRecord[key]=person[key]||'';});}byId('previewModal').hidden=false;document.body.classList.add('modal-open');renderPreview(mode||'claim');
  }
  function renderPreview(mode) {
    previewMode=mode||'claim';var record=previewRecord;if(!record)return;record=calculatedRecordDurations(record);previewRecord=record;
    byId('previewTitle').textContent=previewMode==='claim'?'ตัวอย่างใบขอรับเงิน ฉ11':'ตัวอย่างสำเนาใบประกอบวิชาชีพ';
    byId('previewSubtitle').textContent=personName(record)+' · '+monthName(record.month)+' พ.ศ. '+record.yearBE;
    byId('previewStage').innerHTML=previewMode==='claim'?buildClaimPreview(record):buildLicensePreview(record);
    if(previewMode==='claim'){
      claimFitsA4=fitClaimToA4(record);
      byId('previewSubtitle').textContent+=' · A4 หน้าเดียว · '+claimFontPt.toFixed(1)+' pt';
      if(!claimFitsA4)toast('ข้อความยาวเกินพื้นที่ A4 แม้ย่อขนาดแล้ว กรุณาย่อข้อความก่อนพิมพ์',true);
    }
    byId('previewClaimTab').classList.toggle('active',previewMode==='claim');byId('previewLicenseTab').classList.toggle('active',previewMode==='license');
    ['printClaimBtn','downloadClaimPdfBtn','downloadClaimDocxBtn'].forEach(function(id){byId(id).hidden=previewMode!=='claim';});
    ['printLicenseBtn','downloadLicensePdfBtn','downloadLicenseDocxBtn'].forEach(function(id){byId(id).hidden=previewMode!=='license';});
    var missing=previewMode==='license'&&!record.licenseImageDataUrl;['printLicenseBtn','downloadLicensePdfBtn','downloadLicenseDocxBtn'].forEach(function(id){byId(id).disabled=missing;});
    ['printClaimBtn','downloadClaimPdfBtn','downloadClaimDocxBtn'].forEach(function(id){byId(id).disabled=previewMode==='claim'&&!claimFitsA4;});
  }
  function fitClaimToA4(record) {
    var paper=byId('previewStage').querySelector('.paper-claim');
    if(!paper)return false;
    paper.style.height='297mm';
    var nodes=[paper].concat(Array.prototype.slice.call(paper.querySelectorAll('*')));
    function applyFont(size) {
      nodes.forEach(function(node){
        var isTitle=node.classList&&(node.classList.contains('paper-title')||node.classList.contains('paper-subtitle'));
        node.style.setProperty('font-size',(size+(isTitle?2:0))+'pt','important');
        node.style.setProperty('line-height','1.02','important');
      });
    }
    claimFontPt=CLAIM_BASE_FONT_PT;
    applyFont(claimFontPt);
    while((paper.scrollHeight>paper.clientHeight||paper.scrollWidth>paper.clientWidth)&&claimFontPt>CLAIM_MIN_FONT_PT){claimFontPt=Math.max(CLAIM_MIN_FONT_PT,Math.round((claimFontPt-.25)*100)/100);applyFont(claimFontPt);}
    claimFitsA4=paper.scrollHeight<=paper.clientHeight&&paper.scrollWidth<=paper.clientWidth;
    PDF_FONT_PX=claimFontPt*96/72;
    var canvas=drawClaimCanvasPage(record,record.serviceHistory||[],true,true,0);
    while((canvas.__finalY>1055||!canvas.__fitsWidth)&&claimFontPt>CLAIM_MIN_FONT_PT){claimFontPt=Math.max(CLAIM_MIN_FONT_PT,Math.round((claimFontPt-.5)*100)/100);applyFont(claimFontPt);PDF_FONT_PX=claimFontPt*96/72;canvas=drawClaimCanvasPage(record,record.serviceHistory||[],true,true,0);}
    claimFitsA4=claimFitsA4&&canvas.__finalY<=1055&&canvas.__fitsWidth;
    paper.style.overflow=claimFitsA4?'hidden':'visible';
    return claimFitsA4;
  }
  function closePreview() {byId('previewModal').hidden=true;document.body.classList.remove('modal-open');previewRecord=null;byId('previewStage').innerHTML='';}
  function printPreview(mode) {
    if(!previewRecord)return;renderPreview(mode);if(mode!=='license'&&!claimFitsA4)return;document.body.classList.remove('print-claim','print-license');document.body.classList.add(mode==='license'?'print-license':'print-claim');
    var restore=function(){document.body.classList.remove('print-claim','print-license');window.removeEventListener('afterprint',restore);};window.addEventListener('afterprint',restore,{once:true});window.setTimeout(function(){window.print();window.setTimeout(restore,1200);},100);
  }
  function showPreview(record,mode) {openPreview(record,mode);}

  function canvasForPage(landscape) {
    var width=landscape?1123:794,height=landscape?794:1123,canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;var ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.textBaseline='top';return {canvas:canvas,ctx:ctx,width:width,height:height};
  }
  function canvasFont(ctx,bold,color) {ctx.font=(bold?'700 ':'400 ')+PDF_FONT_PX+'px '+FONT_FAMILY;ctx.fillStyle=color||'#111';}
  function wrapCanvas(ctx,text,maxWidth,bold,fontSize,noBreakPhrases) {
    canvasFont(ctx,bold);if(fontSize)ctx.font=(bold?'700 ':'400 ')+fontSize+'px '+FONT_FAMILY;var lines=[],paragraphs=String(text==null?'':text).split('\n');
    function paragraphParts(paragraph){var phrases=(noBreakPhrases||[]).filter(Boolean).sort(function(a,b){return b.length-a.length;}),parts=[],cursor=0;while(cursor<paragraph.length){var found=-1,phrase='';phrases.forEach(function(candidate){var at=paragraph.indexOf(candidate,cursor);if(at>=0&&(found<0||at<found)){found=at;phrase=candidate;}});if(found<0){parts=parts.concat(thaiWords(paragraph.slice(cursor)));break;}parts=parts.concat(thaiWords(paragraph.slice(cursor,found)),[phrase]);cursor=found+phrase.length;}return parts;}
    paragraphs.forEach(function(paragraph){var line='';paragraphParts(paragraph).forEach(function(part){if(/^\s+$/.test(part)){line+=part;return;}var candidate=line+part;if(line.trim()&&ctx.measureText(candidate.trimEnd()).width>maxWidth){lines.push(line.trimEnd());line=part.trimStart();}else line=candidate;if(ctx.measureText(line).width>maxWidth&&!/[\u0e00-\u0e7f]/.test(part)){var chars=Array.from(line);line='';chars.forEach(function(char){if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line.trimEnd());line=char;}else line+=char;});}});lines.push(line.trimEnd());});return lines.length?lines:[''];
  }
  function drawParagraph(ctx,text,x,y,width,color,bold,align,fontSize,noBreakPhrases) {
    var lines=wrapCanvas(ctx,text,width,bold,fontSize,noBreakPhrases);canvasFont(ctx,bold,color);if(fontSize)ctx.font=(bold?'700 ':'400 ')+fontSize+'px '+FONT_FAMILY;var lineHeight=Math.ceil((fontSize||PDF_FONT_PX)*1.05);ctx.textAlign=align||'left';lines.forEach(function(line){if(ctx.measureText(line).width>width)pdfHorizontalOverflow=true;ctx.fillText(line,align==='center'?x+width/2:align==='right'?x+width:x,y);y+=lineHeight;});ctx.textAlign='left';return y;
  }
  function drawClaimCanvasPage(record,rows,first,final,startIndex) {
    var page=canvasForPage(false),ctx=page.ctx,x=76,width=642,y=23,claimantName=personName(record),identityName=personIdentity(record);pdfHorizontalOverflow=false;
    function text(value,color,bold,align,size) {size=size||PDF_FONT_PX;ctx.font=(bold?'700 ':'400 ')+size+'px '+FONT_FAMILY;ctx.fillStyle=color||'#111';if(ctx.measureText(String(value==null?'':value)).width>width)pdfHorizontalOverflow=true;ctx.textAlign=align||'left';ctx.fillText(String(value==null?'':value),align==='center'?x+width/2:align==='right'?x+width:x,y);ctx.textAlign='left';y+=Math.ceil(size*1.05);}
    function para(value,color,bold,align,size,noBreakPhrases) {y=drawParagraph(ctx,value,x,y,width,color,bold,align||'left',size,noBreakPhrases);}
    function columns(left,right) {var gap=30,colWidth=(width-gap)/2,top=y;function drawColumn(values,columnX){var columnY=top;values.forEach(function(value){if(value===null){columnY+=26;return;}var textValue=value&&typeof value==='object'?value.text:value,align=value&&typeof value==='object'?value.align:'center';columnY=drawParagraph(ctx,textValue,columnX,columnY,colWidth,null,false,align,undefined,[claimantName]);});return columnY;}y=Math.max(drawColumn(left,x),drawColumn(right,x+colWidth+gap));}
    if(first){
      var titleY=y;y=8;text('ฉ11',null,false,'right');y=titleY;
      para(record.formTitle,null,true,'center',PDF_FONT_PX+(2*96/72));para(record.formSubtitle,null,false,'center',PDF_FONT_PX+(2*96/72));
      y+=11;para('หน่วยบริการ '+record.unitName,null,false,'right');y+=4;text('ประจำเดือน '+monthName(record.month)+' พ.ศ. '+thaiDigits(record.yearBE),'#c71f26',true,'right');y+=11;
      para('ข้าพเจ้า '+identityName+' ตำแหน่ง '+record.position,null,false,'left',undefined,[identityName]);y+=4;
      para('ปัจจุบันปฏิบัติงานที่ '+record.workplace+' จังหวัด '+record.province+' ระดับ/กลุ่ม '+record.serviceLevel);y+=4;
      para('ปฏิบัติงานหน่วยบริการหรือหน่วยบริการในเครือข่าย '+thaiDigits(record.networkYears||'....')+' ปี '+thaiDigits(record.networkMonths||'....')+' เดือน ('+record.networkNote+')',record.networkIsRed?'#c71f26':null,false);y+=6;
      para('โดยมีรายละเอียดการปฏิบัติงาน ดังนี้ (เฉพาะสายแพทย์ตอบข้อ ๑ ด้วย)',null,true);y+=2;
      para('๑. ฝึกเพิ่มพูนทักษะ รวมระยะเวลาการปฏิบัติงาน '+thaiDigits(record.trainingDuration||'.......... ปี .......... เดือน')+' '+record.trainingNote,record.trainingIsRed||record.trainingDurationAuto?'#c71f26':null,false);
      para('　'+(record.trainingType||'รพศ./ท.')+' '+record.trainingFacility+' จังหวัด '+record.trainingProvince+' ตั้งแต่ '+record.trainingFrom+' ถึง '+(record.trainingTo||(record.trainingDurationAuto?formatServiceDate(claimMonthEnd(record)):'....................')),record.trainingIsRed||record.trainingDurationAuto?'#c71f26':null,false);
    } else {text('รายละเอียดการปฏิบัติงาน (ต่อ)',null,true,'center',28);y+=10;}
    y+=4;rows.forEach(function(row,index){var values=formatServiceRange(row,index+(startIndex||0),record);para(values[0],row.isRed?'#c71f26':null,false);para(values[1],row.isRed||row.durationAuto?'#c71f26':null,false);y+=4;});
    if(final){
      y+=6;para('รวมทั้งสิ้น '+thaiDigits(record.totalYears||'....')+' ปี '+thaiDigits(record.totalMonths||'....')+' เดือน'+(record.redNote?' '+record.redNote:''),record.totalIsRed?'#c71f26':null,true);
      y+=2;para('เป็นเงินเดือนละ '+(Number(record.monthlyAmount)||0).toLocaleString('th-TH')+' บาท',record.amountIsRed?'#c71f26':null,false,'right');
      var signerPrintName=record.signerName||claimantName,applicantSignature=['('+signerPrintName+')','ตำแหน่ง '+(record.signerPosition||record.position)],certificationText='ขอรับรองว่า '+claimantName+' ได้ปฏิบัติงานตามหลักเกณฑ์ในการเบิกเบี้ยเลี้ยงเหมาจ่าย ตามที่กำหนดไว้',leftFooter=[certificationText],receipt=templateText(record.receiptText,record),rightFooter=[receipt,null,'ลงชื่อ ................................ ผู้รับเงิน','('+signerPrintName+')',{text:'วันที่ '+(record.signatureDate||'....................'),align:'right'}];
      if(record.certifierName)leftFooter=leftFooter.concat([null,'ลงชื่อ ................................ ผู้รับรอง','('+nonBreakingText(record.certifierName)+')','ตำแหน่ง '+(record.certifierPosition||'')]);
      var colWidth=(width-30)/2,lineHeight=Math.ceil(PDF_FONT_PX*1.05),applicantHeight=applicantSignature.reduce(function(sum,value){return sum+wrapCanvas(ctx,value,width,false,undefined,[signerPrintName]).length*lineHeight;},0),declarationHeight=wrapCanvas(ctx,record.declarationText,width,false).length*lineHeight;
      function footerColumnHeight(values){return values.reduce(function(sum,value){if(value===null)return sum+45;var textValue=value&&typeof value==='object'?value.text:value;return sum+wrapCanvas(ctx,textValue,colWidth,false,undefined,[claimantName,signerPrintName]).length*lineHeight;},0);}
      var footerTextHeight=declarationHeight+45+38+applicantHeight+38+Math.max(footerColumnHeight(leftFooter),footerColumnHeight(rightFooter));
      y=Math.max(y+30,page.height-68-footerTextHeight);para(record.declarationText,null,false,'center');y+=45+38;
      applicantSignature.forEach(function(value){para(value,null,false,'center',undefined,[signerPrintName]);});y+=38;columns(leftFooter,rightFooter);
    }
    page.canvas.__finalY=y;page.canvas.__fitsWidth=!pdfHorizontalOverflow;
    return page.canvas;
  }
  function drawClaimPdfPages(record) {
    return [drawClaimCanvasPage(record,record.serviceHistory||[],true,true,0)];
  }
  function drawLicensePdfPage(record) {
    return new Promise(function(resolve,reject){var page=canvasForPage(true),ctx=page.ctx,img=new Image();img.onload=function(){var maxW=page.width-48,maxH=page.height-48,scale=Math.min(maxW/img.width,maxH/img.height),w=img.width*scale,h=img.height*scale;ctx.drawImage(img,(page.width-w)/2,(page.height-h)/2,w,h);resolve(page.canvas);};img.onerror=function(){reject(new Error('เปิดภาพใบประกอบวิชาชีพไม่สำเร็จ'));};img.src=record.licenseImageDataUrl;});
  }
  function pdfBlobFromCanvases(canvases,landscape) {
    var pageW=landscape?841.89:595.28,pageH=landscape?595.28:841.89,objects={};objects[1]='<< /Type /Catalog /Pages 2 0 R >>';var kids=[];
    canvases.forEach(function(canvas,index){var pageId=3+index*3,contentId=pageId+1,imageId=pageId+2;kids.push(pageId+' 0 R');var b64=canvas.toDataURL('image/jpeg',.93).split(',')[1],binary=atob(b64),hex='';for(var i=0;i<binary.length;i++)hex+=binary.charCodeAt(i).toString(16).padStart(2,'0');objects[pageId]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pageW+' '+pageH+'] /Resources << /XObject << /Im0 '+imageId+' 0 R >> >> /Contents '+contentId+' 0 R >>';var stream='q\n'+pageW+' 0 0 '+pageH+' 0 0 cm\n/Im0 Do\nQ';objects[contentId]='<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream';objects[imageId]='<< /Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length '+(hex.length+1)+' >>\nstream\n'+hex+'>\nendstream';});
    objects[2]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+canvases.length+' >>';var maximum=Math.max.apply(null,Object.keys(objects).map(Number)),pdf='%PDF-1.4\n',offsets=[0];for(var id=1;id<=maximum;id++){offsets[id]=pdf.length;pdf+=id+' 0 obj\n'+objects[id]+'\nendobj\n';}var xref=pdf.length;pdf+='xref\n0 '+(maximum+1)+'\n0000000000 65535 f \n';for(var n=1;n<=maximum;n++)pdf+=String(offsets[n]).padStart(10,'0')+' 00000 n \n';pdf+='trailer\n<< /Size '+(maximum+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return new Blob([pdf],{type:'application/pdf'});
  }
  function downloadBlob(blob,name) {var url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();window.setTimeout(function(){URL.revokeObjectURL(url);},1500);}
  function downloadPdf(type) {
    if(!previewRecord)return;var record=previewRecord;
    if(type!=='license'&&!claimFitsA4){toast('ข้อความยาวเกินพื้นที่ A4 กรุณาย่อข้อความก่อนส่งออก',true);return;}
    if(type!=='license'&&!claimFitsA4){toast('ข้อความยาวเกินพื้นที่ A4 กรุณาย่อข้อความก่อนส่งออก',true);return;}
    var task=type==='license'?drawLicensePdfPage(record).then(function(canvas){return [canvas];}):Promise.resolve(drawClaimPdfPages(record));
    task.then(function(pages){var name=type==='license'?'สำเนาใบประกอบวิชาชีพ-'+(personName(record)||'เจ้าหน้าที่'):'ใบขอรับเงิน-ฉ11-'+(personName(record)||'เจ้าหน้าที่')+'-'+record.yearBE+'-'+String(record.month).padStart(2,'0');downloadBlob(pdfBlobFromCanvases(pages,type==='license'),name+'.pdf');toast('สร้างไฟล์ PDF แล้ว');}).catch(function(error){toast(error.message||'สร้าง PDF ไม่สำเร็จ',true);});
  }

  function docRun(text,color,bold,size) {size=size||Math.round(claimFontPt*2);return '<w:r><w:rPr><w:rFonts w:ascii="TH SarabunIT๙" w:hAnsi="TH SarabunIT๙" w:eastAsia="TH SarabunIT๙" w:cs="TH SarabunIT๙"/><w:lang w:val="th-TH" w:eastAsia="th-TH"/><w:sz w:val="'+size+'"/><w:szCs w:val="'+size+'"/>'+(bold?'<w:b/>':'')+(color?'<w:color w:val="'+color+'"/>':'')+'</w:rPr><w:t xml:space="preserve">'+xmlEsc(text)+'</w:t></w:r>'; }
  function docParagraph(text,options) {options=options||{};return '<w:p><w:pPr>'+(options.center?'<w:jc w:val="center"/>':'')+(options.right?'<w:jc w:val="right"/>':'')+'<w:spacing w:after="'+(options.after==null?40:options.after)+'" w:line="'+(options.line||240)+'" w:lineRule="auto"/></w:pPr>'+docRun(text,options.color,options.bold,options.size||Math.round(claimFontPt*2))+'</w:p>'; }
  function docTwoColumnTable(left,right) {
    var width=9638,column=4819,borders='<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
    var rows=Array.from({length:Math.max(left.length,right.length)},function(_,index){
      function cell(input) {var item=input&&typeof input==='object'?input:{text:input,align:'center'};return '<w:tc><w:tcPr><w:tcW w:w="'+column+'" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="'+(item.align||'center')+'"/><w:spacing w:after="20" w:line="240" w:lineRule="auto"/></w:pPr>'+docRun(item.text,null,false)+'</w:p></w:tc>';}
      return '<w:tr>'+cell(left[index]||'')+cell(right[index]||'')+'</w:tr>';
    }).join('');
    return '<w:tbl><w:tblPr><w:tblW w:w="'+width+'" w:type="dxa"/><w:tblLayout w:type="fixed"/>'+borders+'</w:tblPr><w:tblGrid><w:gridCol w:w="'+column+'"/><w:gridCol w:w="'+column+'"/></w:tblGrid>'+rows+'</w:tbl>';
  }
  function docEnd(landscape) {var width=landscape?16838:11906,height=landscape?11906:16838,top=landscape?720:340,right=landscape?720:1134,bottom=landscape?720:1020,left=landscape?720:1134;return '<w:sectPr><w:pgSz w:w="'+width+'" w:h="'+height+'"'+(landscape?' w:orient="landscape"':'')+'/><w:pgMar w:top="'+top+'" w:right="'+right+'" w:bottom="'+bottom+'" w:left="'+left+'" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>';}
  function claimDocxXml(record) {
    var trainingTo=record.trainingTo||(record.trainingDurationAuto?formatServiceDate(claimMonthEnd(record)):'....................');
    var parts=[];parts.push(docParagraph('ฉ11',{right:true,after:0}));parts.push(docParagraph(record.formTitle,{center:true,bold:true,size:Math.round((claimFontPt+2)*2),after:0}));parts.push(docParagraph(record.formSubtitle,{center:true,size:Math.round((claimFontPt+2)*2),after:40}));parts.push(docParagraph('หน่วยบริการ '+record.unitName,{right:true}));parts.push(docParagraph('ประจำเดือน '+monthName(record.month)+' พ.ศ. '+thaiDigits(record.yearBE),{right:true,bold:true,color:'C71F26'}));
    parts.push(docParagraph('ข้าพเจ้า '+personIdentity(record)+' ตำแหน่ง '+record.position));parts.push(docParagraph('ปัจจุบันปฏิบัติงานที่ '+record.workplace+' จังหวัด '+record.province+' ระดับ/กลุ่ม '+record.serviceLevel));parts.push(docParagraph('ปฏิบัติงานหน่วยบริการหรือหน่วยบริการในเครือข่าย '+thaiDigits(record.networkYears||'....')+' ปี '+thaiDigits(record.networkMonths||'....')+' เดือน ('+record.networkNote+')',{color:record.networkIsRed?'C71F26':null}));parts.push(docParagraph('โดยมีรายละเอียดการปฏิบัติงาน ดังนี้ (เฉพาะสายแพทย์ตอบข้อ ๑ ด้วย)',{bold:true}));parts.push(docParagraph('๑. ฝึกเพิ่มพูนทักษะ รวมระยะเวลาการปฏิบัติงาน '+thaiDigits(record.trainingDuration||'.......... ปี .......... เดือน')+' '+record.trainingNote,{color:record.trainingIsRed||record.trainingDurationAuto?'C71F26':null}));parts.push(docParagraph((record.trainingType||'รพศ./ท.')+' '+record.trainingFacility+' จังหวัด '+record.trainingProvince+' ตั้งแต่ '+record.trainingFrom+' ถึง '+trainingTo,{color:record.trainingIsRed||record.trainingDurationAuto?'C71F26':null}));
    var history=record.serviceHistory||[];history.forEach(function(row,index){var lines=formatServiceRange(row,index,record);parts.push(docParagraph(lines[0],{color:row.isRed?'C71F26':null}));parts.push(docParagraph(lines[1],{color:row.isRed||row.durationAuto?'C71F26':null}));});
    parts.push(docParagraph('รวมทั้งสิ้น '+thaiDigits(record.totalYears||'....')+' ปี '+thaiDigits(record.totalMonths||'....')+' เดือน '+record.redNote,{color:record.totalIsRed?'C71F26':null,bold:true}));parts.push(docParagraph('เป็นเงินเดือนละ '+(Number(record.monthlyAmount)||0).toLocaleString('th-TH')+' บาท',{right:true,color:record.amountIsRed?'C71F26':null}));parts.push(docParagraph(record.declarationText,{center:true,after:200}));parts.push(docParagraph(' ',{center:true,after:160}));parts.push(docParagraph('('+nonBreakingText(record.signerName||personName(record))+')',{center:true,after:20}));parts.push(docParagraph('ตำแหน่ง '+(record.signerPosition||record.position),{center:true,after:160}));var receipt=templateText(record.receiptText,record).split(personName(record)).join(nonBreakingPersonName(record)),certificationText='ขอรับรองว่า '+nonBreakingPersonName(record)+' ได้ปฏิบัติงานตามหลักเกณฑ์ในการเบิกเบี้ยเลี้ยงเหมาจ่าย ตามที่กำหนดไว้',leftFooter=[certificationText],rightFooter=[receipt,' ','ลงชื่อ ................................ ผู้รับเงิน','('+nonBreakingText(record.signerName||personName(record))+')',{text:'วันที่ '+(record.signatureDate||'....................'),align:'right'}];if(record.certifierName)leftFooter=leftFooter.concat([' ','ลงชื่อ ................................ ผู้รับรอง','('+nonBreakingText(record.certifierName)+')','ตำแหน่ง '+(record.certifierPosition||'')]);parts.push(docTwoColumnTable(leftFooter,rightFooter));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+parts.join('')+docEnd(false)+'</w:body></w:document>';
  }
  function base64Bytes(dataUrl) {var raw=atob(String(dataUrl).split(',')[1]||''),bytes=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
  function licenseDocxXml(record) {
    var maxWidth=15704*635,maxHeight=10772*635,sourceWidth=Number(record.licenseImageWidth)||1600,sourceHeight=Number(record.licenseImageHeight)||1100,scale=Math.min(maxWidth/sourceWidth,maxHeight/sourceHeight),width=Math.round(sourceWidth*scale),height=Math.round(sourceHeight*scale);
    var drawing='<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="'+width+'" cy="'+height+'"/><wp:docPr id="1" name="สำเนาใบประกอบวิชาชีพ"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="license.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+width+'" cy="'+height+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+drawing+docEnd(true)+'</w:body></w:document>';
  }
  function exportDocx(type) {
    if(typeof JSZip==='undefined'){toast('ไม่พบตัวสร้างไฟล์ DOCX',true);return;}
    if(type!=='license'&&!claimFitsA4){toast('ข้อความยาวเกินพื้นที่ A4 กรุณาย่อข้อความก่อนส่งออก',true);return;}
    if(!previewRecord)return;var record=previewRecord,zip=new JSZip(),license=type==='license';
    var types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+(license?'<Default Extension="jpg" ContentType="image/jpeg"/>':'')+'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    zip.file('[Content_Types].xml',types);zip.folder('_rels').file('.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.folder('word').file('document.xml',license?licenseDocxXml(record):claimDocxXml(record));zip.folder('word').file('styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="TH SarabunIT๙" w:hAnsi="TH SarabunIT๙" w:eastAsia="TH SarabunIT๙" w:cs="TH SarabunIT๙"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>');
    if(license){zip.folder('word').folder('_rels').file('document.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/license.jpg"/></Relationships>');zip.folder('word').folder('media').file('license.jpg',base64Bytes(record.licenseImageDataUrl));}
    zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}).then(function(blob){var name=license?'สำเนาใบประกอบวิชาชีพ-'+(personName(record)||'เจ้าหน้าที่'):'ใบขอรับเงิน-ฉ11-'+(personName(record)||'เจ้าหน้าที่')+'-'+record.yearBE+'-'+String(record.month).padStart(2,'0');downloadBlob(blob,name+'.docx');toast('สร้างไฟล์ DOCX แล้ว');}).catch(function(error){toast('สร้าง DOCX ไม่สำเร็จ: '+error.message,true);});
  }

  function handleRecordAction(event) {
    var button=event.target.closest('[data-action]');if(!button)return;var id=button.dataset.id,record=state.records.find(function(item){return item.id===id;});if(!record)return;
    if(button.dataset.action==='edit')openEditor(record,id);
    else if(button.dataset.action==='preview')showPreview(record,'claim');
    else if(button.dataset.action==='duplicate'){var duplicate=clone(record);duplicate.id='';duplicate.createdAt=new Date().toISOString();var date=new Date(Number(record.yearBE)-543,Number(record.month),1);duplicate.month=date.getMonth()+1;duplicate.yearBE=date.getFullYear()+543;openEditor(duplicate,'');}
    else if(button.dataset.action==='delete'&&window.confirm('ลบใบขอรับเงินของ '+personName(personForRecord(record)||record)+' งวด '+monthName(record.month)+' '+record.yearBE+' หรือไม่?')){state.records=state.records.filter(function(item){return item.id!==id;});saveState().then(function(){renderDashboard();toast('ลบรายการแล้ว');}).catch(function(error){toast('ลบข้อมูลไม่สำเร็จ: '+error.message,true);});}
  }
  function handlePersonAction(event) {
    var button=event.target.closest('[data-person-action]');if(!button)return;var person=personById(button.dataset.id);if(!person)return;
    if(button.dataset.personAction==='edit')openPersonEditor(person);
    if(button.dataset.personAction==='claim'){var record=emptyRecord();record.personId=person.id;record.prefix=person.prefix;record.firstName=person.firstName;record.lastName=person.lastName;record.position=person.position;record.workplace=person.workplace;record.province=person.province;record.serviceLevel=person.serviceLevel;record.unitName=person.workplace||record.unitName;openEditor(record,'');}
    if(button.dataset.personAction==='delete'){
      if(state.records.some(function(record){return record.personId===person.id;})){toast('ลบคำขอของบุคลากรนี้ก่อน จึงจะลบข้อมูลบุคลากรได้',true);return;}
      if(window.confirm('ลบข้อมูลบุคลากร '+personName(person)+' และภาพใบประกอบวิชาชีพหรือไม่?')){state.people=state.people.filter(function(item){return item.id!==person.id;});saveState().then(function(){renderDashboard();toast('ลบข้อมูลบุคลากรแล้ว');}).catch(function(error){toast('ลบข้อมูลไม่สำเร็จ: '+error.message,true);});}
    }
  }
  function bindEvents() {
    byId('addRecordBtn').addEventListener('click',function(){openEditor(emptyRecord(),'');});
    byId('addPersonBtn').addEventListener('click',function(){openPersonEditor(null);});
    byId('cancelBtn').addEventListener('click',closeEditor);byId('cancelBottomBtn').addEventListener('click',closeEditor);
    byId('filterYear').addEventListener('change',renderDashboard);byId('filterMonth').addEventListener('change',renderDashboard);byId('filterPerson').addEventListener('change',renderDashboard);byId('searchInput').addEventListener('input',renderDashboard);
    byId('recordsBody').addEventListener('click',handleRecordAction);
    byId('peopleList').addEventListener('click',handlePersonAction);
    byId('claimPersonSelect').addEventListener('change',function(){var person=personById(this.value);updateClaimPersonDisplay(person);if(person){var signer=byId('recordForm').elements.namedItem('signerName');if(signer)signer.value=personName(person);}});
    byId('editClaimPersonBtn').addEventListener('click',function(){var person=personById(byId('claimPersonSelect').value);if(person)openPersonEditor(person);});
    byId('addHistoryBtn').addEventListener('click',function(){var record=collectEditor();record.serviceHistory.push(emptyHistory());fillEditor(record);});
    byId('historyRows').addEventListener('click',function(event){var button=event.target.closest('[data-remove-history]');if(!button)return;var record=collectEditor();record.serviceHistory.splice(Number(button.dataset.removeHistory),1);fillEditor(record);});
    byId('recordForm').addEventListener('input',function(event){var control=event.target,key=control.dataset.history;if(key==='from'||key==='to'||key==='years'||key==='months'||key==='days'||control.name==='trainingFrom'||control.name==='trainingTo'||control.name==='trainingDuration')refreshDurationInputs();});
    byId('monthSelect').addEventListener('change',refreshDurationInputs);byId('yearSelect').addEventListener('change',refreshDurationInputs);
    byId('recordForm').addEventListener('submit',function(event){event.preventDefault();var record=collectEditor();if(!record.firstName||!record.lastName){toast('กรอกชื่อและนามสกุลก่อนบันทึก',true);return;}storeRecord(record);});
    byId('personForm').addEventListener('submit',function(event){event.preventDefault();savePersonFromForm();});
    byId('personLicenseFile').addEventListener('change',function(event){var file=event.target.files&&event.target.files[0];if(!file)return;resizeLicenseImage(file).then(function(image){editorLicenseData=image.data;editorLicenseName=file.name;editorLicenseWidth=image.width;editorLicenseHeight=image.height;renderPersonLicenseThumb();toast('แนบภาพใบประกอบวิชาชีพแล้ว');}).catch(function(error){toast(error.message,true);}).then(function(){byId('personLicenseFile').value='';});});
    byId('removePersonLicenseBtn').addEventListener('click',function(){editorLicenseData='';editorLicenseName='';editorLicenseWidth=0;editorLicenseHeight=0;renderPersonLicenseThumb();});
    byId('closePersonModalBtn').addEventListener('click',closePersonEditor);byId('cancelPersonBtn').addEventListener('click',closePersonEditor);byId('personModal').addEventListener('click',function(event){if(event.target===this)closePersonEditor();});
    byId('backupBtn').addEventListener('click',function(){downloadBlob(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),'SH11-backup-'+currentBEYear()+'.json');});
    byId('restoreBtn').addEventListener('click',function(){byId('restoreFile').click();});
    byId('restoreFile').addEventListener('change',function(event){var file=event.target.files&&event.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(){try{var imported=JSON.parse(reader.result);if(!imported||!Array.isArray(imported.records))throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');hydrateState(imported);saveState().then(function(){renderDashboard();toast('นำเข้าข้อมูลแล้ว');}).catch(function(error){toast(error.message,true);});}catch(error){toast(error.message,true);}finally{event.target.value='';}};reader.readAsText(file);});
    byId('previewClaimTab').addEventListener('click',function(){renderPreview('claim');});byId('previewLicenseTab').addEventListener('click',function(){renderPreview('license');});byId('closePreviewBtn').addEventListener('click',closePreview);
    byId('previewModal').addEventListener('click',function(event){if(event.target===this)closePreview();});document.addEventListener('keydown',function(event){if(event.key==='Escape'){if(!byId('personModal').hidden)closePersonEditor();else if(!byId('previewModal').hidden)closePreview();}});
    byId('printClaimBtn').addEventListener('click',function(){printPreview('claim');});byId('downloadClaimPdfBtn').addEventListener('click',function(){downloadPdf('claim');});byId('downloadClaimDocxBtn').addEventListener('click',function(){exportDocx('claim');});
    byId('printLicenseBtn').addEventListener('click',function(){printPreview('license');});byId('downloadLicensePdfBtn').addEventListener('click',function(){downloadPdf('license');});byId('downloadLicenseDocxBtn').addEventListener('click',function(){exportDocx('license');});
  }
  function init() {
    setOptions(byId('monthSelect'),monthItems(false),new Date().getMonth()+1);setOptions(byId('yearSelect'),yearItems(),currentBEYear());bindEvents();loadState();
  }
  init();
})();
