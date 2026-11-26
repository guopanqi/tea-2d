const water=document.querySelector('#daily-water');
const dateKey=()=>{const d=new Date();return [d.getFullYear(),d.getMonth()+1,d.getDate()].join('-')};
let day='',cups=[];
function load(){day=dateKey();cups=Array(8).fill(0);try{const v=JSON.parse(localStorage.getItem('tea-daily-water:'+day));if(Array.isArray(v)&&v.length===8&&v.every(n=>[0,1,2].includes(n)))cups=v}catch{}}
function render(){const total=cups.reduce((a,b)=>a+b,0)/2;water.innerHTML='<div class="water-heading"><span>今日饮水</span><span aria-live="polite">'+(total===8?'今日已完成':total+' / 8 杯')+'</span></div><div class="water-cups">'+cups.map((v,i)=>'<button type="button" class="water-cup" data-cup="'+i+'" aria-label="第'+(i+1)+'杯，'+['空杯','半杯','满杯'][v]+'，点击切换"><svg viewBox="0 0 24 30" aria-hidden="true"><rect x="3" y="2" width="18" height="26" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/>'+(v?'<rect x="5" y="'+(v===1?15:4)+'" width="14" height="'+(v===1?11:22)+'" fill="#8d9d8c"/>':'')+'</svg></button>').join('')+'</div>'}
function refresh(){if(day!==dateKey()){load();render()}}
water.addEventListener('click',e=>{const btn=e.target.closest('[data-cup]');if(!btn)return;refresh();const i=Number(btn.dataset.cup);cups[i]=(cups[i]+1)%3;try{localStorage.setItem('tea-daily-water:'+day,JSON.stringify(cups))}catch{}render();water.querySelector('[data-cup="'+i+'"]').focus({preventScroll:true})});
refresh();setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);
const panel=document.querySelector('#constitution-panel'),input=document.querySelector('#tongue-file'),preview=document.querySelector('#tongue-preview'),placeholder=document.querySelector('#tongue-placeholder'),analyze=document.querySelector('#tongue-analyze'),result=document.querySelector('#tongue-result');
let url='';
function clear(){if(url)URL.revokeObjectURL(url);url='';preview.removeAttribute('src');preview.hidden=true;placeholder.hidden=false;input.value='';analyze.disabled=true;result.textContent=''}
document.querySelector('#constitution-btn').addEventListener('click',()=>panel.showModal());
document.querySelector('#constitution-close').addEventListener('click',()=>panel.close());
panel.addEventListener('close',clear);
input.addEventListener('change',()=>{const file=input.files[0];if(!file)return;if(url)URL.revokeObjectURL(url);url='';preview.hidden=true;placeholder.hidden=false;analyze.disabled=true;result.textContent='';if(!file.type.startsWith('image/')||file.size>15*1024*1024){result.textContent='请选择 15 MB 以内的图片。';return}url=URL.createObjectURL(file);preview.onload=()=>{preview.hidden=false;placeholder.hidden=true;analyze.disabled=false};preview.onerror=()=>{result.textContent='无法读取图片，请尝试 JPEG 或 PNG。'};preview.src=url});
analyze.addEventListener('click',()=>{result.innerHTML='<div class="mock-report"><small>演示结果 · 非真实分析</small><h3>体质倾向：平和（示例）</h3><p>舌象观察：淡红舌、薄白苔（示例数据，与上传照片无关）。</p><h4>今日饮水建议</h4><p>温白水，少量多次；按口渴与活动情况调整。</p><p>此处为界面演示，照片未上传，不构成体质判断或医疗建议。</p></div>';});
