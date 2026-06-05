// ── LOGIN ──
document.querySelectorAll('.lang-btn').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.lang-btn').forEach(x=>{x.classList.remove('bg-slate-900','text-white');x.classList.add('bg-slate-100')});
  b.classList.add('bg-slate-900','text-white');
  loginLang=b.dataset.lang;
});

document.getElementById('loginBtn').onclick=async()=>{
  const nameVal=document.getElementById('name').value.trim();
  const passVal=document.getElementById('pass').value.trim();
  const e=document.getElementById('err');
  e.classList.add('hidden');
  if(!nameVal||!passVal){e.textContent='Nome e password obbligatori';e.classList.remove('hidden');return}
  const hashHex=await hashPassword(passVal);
  const{data:profile,error}=await supa.from('users').select('*').eq('name',nameVal).eq('password_hash',hashHex).single();
  if(error||!profile){e.textContent='Nome o password errati';e.classList.remove('hidden');return}
  doLogin(profile);
};

function doLogin(profile){
  user=profile;
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('who').textContent=user.name;
  init(); applyLang(); updateAlertBtn(); loadNews(); setupPush();
  loadBriefing(); startPresence(); startUrgencyCheck();
}

document.getElementById('out').onclick=()=>{user=null;location.reload()};

// ── TAB NAVIGATION ──
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>{x.classList.remove('tab-active');x.classList.add('text-slate-500');const svg=x.querySelector('svg');if(svg)svg.style.stroke='';const sp=x.querySelector('.tab-label');if(sp)sp.style.color=''});
  b.classList.add('tab-active');b.classList.remove('text-slate-500');
  const svg=b.querySelector('svg');if(svg)svg.style.stroke='#059669';
  const sp=b.querySelector('.tab-label');if(sp)sp.style.color='#059669';
  const t=b.dataset.t;
  document.getElementById('vh').classList.toggle('hidden',t!=='h');
  document.getElementById('vm').classList.toggle('hidden',t!=='m');
  document.getElementById('vs').classList.toggle('hidden',t!=='s');
  document.getElementById('vc').classList.add('hidden');
  document.getElementById('vr').classList.toggle('hidden',t!=='r');
  document.getElementById('vp').classList.toggle('hidden',t!=='c');
  if(t==='c') renderRecipes();
  if(t==='s') renderS();
  if(t==='h') renderHomeStations();
  if(t==='r') loadReport('today');
});

