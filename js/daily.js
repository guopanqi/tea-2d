const water=document.querySelector('#daily-water');
const dateKey=()=>{const d=new Date();return [d.getFullYear(),d.getMonth()+1,d.getDate()].join('-')};
let day='',units=0,busy=false,sequence=0;
water.innerHTML='<div class="water-heading"><span>今日饮水</span><span class="water-total" aria-live="polite"></span></div><div class="water-transfer"><div class="water-vessel water-large" role="progressbar" aria-label="已完成杯数" aria-valuemin="0" aria-valuemax="8"><span class="water-level"></span><span class="water-ticks"></span></div><span class="water-stream" aria-hidden="true"></span><button type="button" class="water-action"><span class="water-vessel water-small" aria-hidden="true"><span class="water-level"></span></span></button></div><span class="water-hint"></span>';
const transfer=water.querySelector('.water-transfer'),large=water.querySelector('.water-large'),small=water.querySelector('.water-small'),action=water.querySelector('.water-action'),total=water.querySelector('.water-total'),hint=water.querySelector('.water-hint');
function fill(el,n){el.style.setProperty('--level',String(n))}
function updateText(){total.textContent=units===16?'8 / 8 杯':(units/2)+' / 8 杯';large.setAttribute('aria-valuenow',String(Math.floor(units/2)));hint.textContent=units===16?'已完成':units%2?'再记半杯':'点记半杯';action.disabled=busy||units===16;action.setAttribute('aria-label',units===16?'今日饮水目标已完成':units%2?'记录剩余半杯':'记录半杯')}
function sync(){transfer.classList.remove('pouring');fill(large,Math.floor(units/2)/8);fill(small,(units%2)/2);updateText()}
function load(){day=dateKey();units=0;busy=false;sequence++;try{const stored=JSON.parse(localStorage.getItem('tea-water-units:'+day));if(Number.isInteger(stored)&&stored>=0&&stored<=16)units=stored;else{const old=JSON.parse(localStorage.getItem('tea-daily-water:'+day));if(Array.isArray(old)&&old.length===8&&old.every(n=>[0,1,2].includes(n)))units=old.reduce((a,b)=>a+b,0)}}catch{}sync()}
function refresh(){if(day!==dateKey())load()}
action.addEventListener('click',()=>{refresh();if(busy||units>=16)return;units++;try{localStorage.setItem('tea-water-units:'+day,JSON.stringify(units))}catch{}if(units%2){sync();return}busy=true;const token=++sequence;fill(small,1);action.disabled=true;const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;setTimeout(()=>{if(token!==sequence)return;transfer.classList.add('pouring');fill(small,0);fill(large,units/16);setTimeout(()=>{if(token!==sequence)return;busy=false;sync()},reduced?0:620)},reduced?0:350)});
refresh();setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
const panel=document.querySelector('#constitution-panel'),input=document.querySelector('#tongue-file'),preview=document.querySelector('#tongue-preview'),placeholder=document.querySelector('#tongue-placeholder'),analyze=document.querySelector('#tongue-analyze'),result=document.querySelector('#tongue-result');
let url='';
function clear(){if(url)URL.revokeObjectURL(url);url='';preview.removeAttribute('src');preview.hidden=true;placeholder.hidden=false;input.value='';analyze.disabled=true;result.textContent=''}
document.querySelector('#constitution-btn').addEventListener('click',()=>panel.showModal());
document.querySelector('#constitution-close').addEventListener('click',()=>panel.close());
panel.addEventListener('close',clear);
input.addEventListener('change',()=>{const file=input.files[0];if(!file)return;if(url)URL.revokeObjectURL(url);url='';preview.hidden=true;placeholder.hidden=false;analyze.disabled=true;result.textContent='';if(!file.type.startsWith('image/')||file.size>15*1024*1024){result.textContent='请选择 15 MB 以内的图片。';return}url=URL.createObjectURL(file);preview.onload=()=>{preview.hidden=false;placeholder.hidden=true;analyze.disabled=false};preview.onerror=()=>{result.textContent='无法读取图片，请尝试 JPEG 或 PNG。'};preview.src=url});
analyze.addEventListener('click',()=>{result.innerHTML='<div class="mock-report"><small>演示结果 · 非真实分析</small><h3>体质倾向：平和（示例）</h3><p>舌象观察：淡红舌、薄白苔（示例数据，与上传照片无关）。</p><h4>今日饮水建议</h4><p>温白水，少量多次；按口渴与活动情况调整。</p><p>此处为界面演示，照片未上传，不构成体质判断或医疗建议。</p></div>';});

const note=document.querySelector('#formula-hud');
document.addEventListener('pointerdown',e=>{if(note.open&&!note.contains(e.target))note.open=false});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&note.open){note.open=false;note.querySelector('summary').focus()}});
