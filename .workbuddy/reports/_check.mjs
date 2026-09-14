
import * as THREE from './three.module.js';
import { STUDENT_ASPECT as IMG_ASPECT } from './students/aspects.js'; // 立绘宽高比与素材同步（prep_students.py 生成）
import { HeatWorld3D, World, idx } from './framework3d.mjs';  // 灵境数学框架（physics.js / world.js 的浏览器移植：真把咱们的数学放进 3D 空间）
import { buildDeck, deckToMarkdown, transferScore, flowState } from './skillcards.mjs'; // 课后技能卡片组 + 传授度量 + 心流（用 World/热场数学实现）
import { buildSummary, summaryToMarkdown } from './summary.mjs'; // 课后总结：把实践升维成理论感（图论/信息论/贝叶斯/控制论…）
// 2026-09-11 新增三块（都有外部实证支撑，见各模块头部）：
import { buildPreTest, evaluateExploration, consolidationNotes } from './preclass.mjs'; // 课前生产性失败（Kapur PS-I）
import { detectPeaks, peakLine } from './insight.mjs';                                   // 顿悟峰检测（峰终定律的"峰"）
import { newJournal, upsertJournal, reviewQueue, growthLine, journalToMarkdown } from './journal.mjs'; // 跨课知识库（FSRS DSR + 交错复习）

// 全局错误兜底：任何运行期异常都显示在页面上（而不是白屏），便于定位
function showFatal(msg){
  let box = document.getElementById('fatal');
  if(!box){ box = document.createElement('div'); box.id='fatal';
    box.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7f1d1d;color:#fff;font:12px/1.5 ui-monospace,Consolas,monospace;padding:10px 14px;white-space:pre-wrap;max-height:45%;overflow:auto;box-shadow:0 -2px 10px rgba(0,0,0,.5)';
    document.body.appendChild(box); }
  box.textContent += msg + '\n';
}
addEventListener('error', (e)=>showFatal('❌ '+(e.message||e.error)+(e.filename?(' @'+e.lineno+':'+e.colno):'')));
addEventListener('unhandledrejection', (e)=>showFatal('⛔ Promise: '+((e.reason&&(e.reason.message||e.reason))||e.reason)));

const COLORS = [0x6366f1, 0xec4899, 0xf59e0b, 0x14b8a6, 0xef4444];
const $ = (id) => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a120a);   // 暖暗（民国学堂夜/黄昏底）
scene.fog = new THREE.Fog(0x1a120a, 9, 24);
const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 3.4);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias:true });
} catch (err) {
  document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:16px/1.7 sans-serif;color:#e8ebf2;background:#0b1020"><div><p>当前环境不支持 WebGL，无法渲染 3D 课室。</p><p>请用 <b>Chrome / Edge</b> 打开本页，或改用 2D 版：<a href="/classroom.html" style="color:#a5b4fc">/classroom.html</a></p></div></div>';
  throw err;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('app').insertBefore(renderer.domElement, $('app').firstChild);

// 灯光（暖色：民国学堂油灯/午后暖阳感）
const ambient = new THREE.AmbientLight(0xfff0d8, 0.55); scene.add(ambient);
const hemi = new THREE.HemisphereLight(0x6b5a3a, 0x2a1d10, 0.45); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffe9c8, 0.7); dir.position.set(2, 6, 4); scene.add(dir);
const spot = new THREE.SpotLight(0xffd9a0, 0.7, 22, Math.PI/4, 0.4); spot.position.set(0,6,3); scene.add(spot);

// ===== 民国/战争年代课室环境（暖木 + 土墙 + 木格窗 + 朱底毛笔匾，零外部素材）=====
const frameMat = new THREE.MeshStandardMaterial({color:0x4a3418, roughness:.9}); // 木框（屏风/窗/匾/梁共用）
// 程序化木纹
function woodTexture(base, planks, seed){
  const c=document.createElement('canvas'); c.width=c.height=512; const x=c.getContext('2d');
  x.fillStyle=base; x.fillRect(0,0,512,512);
  let r=seed||7; const rnd=()=>{ r=(r*9301+49297)%233280; return r/233280; };
  const pw=512/planks;
  for(let i=0;i<planks;i++){
    const s=0.82+rnd()*0.28; x.fillStyle='rgb('+Math.round(150*s)+','+Math.round(108*s)+','+Math.round(68*s)+')'; x.fillRect(i*pw,0,pw,512);
    x.strokeStyle='rgba(60,40,20,.22)'; x.lineWidth=1;
    for(let g=0;g<16;g++){ const yy=rnd()*512; x.beginPath(); x.moveTo(i*pw,yy); x.bezierCurveTo(i*pw+pw*.3,yy+(rnd()-.5)*18,i*pw+pw*.7,yy+(rnd()-.5)*18,i*pw+pw,yy+(rnd()-.5)*9); x.stroke(); }
    x.fillStyle='rgba(35,22,10,.45)'; x.fillRect(i*pw,0,2,512);
  }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping; return t;
}
// 朱底毛笔匾额
function bannerTexture(text){
  const c=document.createElement('canvas'); c.width=1024; c.height=256; const x=c.getContext('2d');
  x.fillStyle='#7a1f1a'; x.fillRect(0,0,1024,256);
  x.fillStyle='#5e140f'; x.fillRect(0,0,1024,16); x.fillRect(0,240,1024,16);
  x.fillStyle='#f3e3b0'; x.font='bold 150px KaiTi, STKaiti, 楷体, serif'; x.textAlign='center'; x.textBaseline='middle';
  x.fillText(text, 512, 136);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}
// 地板（暖木）
const floorTex = woodTexture('#6b4a28', 8, 11); floorTex.repeat.set(4,4);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16,16), new THREE.MeshStandardMaterial({map:floorTex, roughness:.85}));
floor.rotation.x = -Math.PI/2; scene.add(floor);
// 墙（土黄灰泥）+ 墙裙（下部木带）
const wallMat = new THREE.MeshStandardMaterial({color:0xcdb892, roughness:1});
const wainscotMat = new THREE.MeshStandardMaterial({map: woodTexture('#5a3c1e', 10, 23), roughness:.9});
function addWall(w,h,x,y,z,ry){
  const wall=new THREE.Mesh(new THREE.PlaneGeometry(w,h), wallMat); wall.position.set(x,y,z); wall.rotation.y=ry; scene.add(wall);
  const wc=new THREE.Mesh(new THREE.PlaneGeometry(w,1.3), wainscotMat); wc.position.set(x,0.65,z); wc.rotation.y=ry; scene.add(wc);
}
addWall(16,8, 0,4,-6, 0);             // 后墙
addWall(16,8, -8,4,0, Math.PI/2);     // 左墙
addWall(16,8, 8,4,0, -Math.PI/2);     // 右墙
// 天花板 + 横梁
const ceil=new THREE.Mesh(new THREE.PlaneGeometry(16,16), new THREE.MeshStandardMaterial({color:0x3a2a16, roughness:1}));
ceil.rotation.x=Math.PI/2; ceil.position.y=8; scene.add(ceil);
for(let i=-2;i<=2;i++){ const beam=new THREE.Mesh(new THREE.BoxGeometry(16,0.24,0.24), frameMat); beam.position.set(0,7.82,i*2.8); scene.add(beam); }
// 朱底毛笔匾额（民国学堂校训：礼义廉耻）
const bannerFrameM=new THREE.Mesh(new THREE.BoxGeometry(6.3,1.8,0.08), frameMat); bannerFrameM.position.set(0,6.4,-5.96); scene.add(bannerFrameM);
const banner=new THREE.Mesh(new THREE.PlaneGeometry(6,1.5), new THREE.MeshBasicMaterial({map:bannerTexture('礼义廉耻')}));
banner.position.set(0,6.4,-5.9); scene.add(banner);

// ===== 水墨山水：贴在「空间表面」上，绝不立在人前 =====
// 原则（用户指正）：课室是三维空间，山水是空间的表皮（墙/顶/地），不是挡在学生前的板子。
// 教师视角下 5 名学生必须始终可见 → 学生前方的地面通道完全清空，不放假屏风。
const screenTexA = new THREE.TextureLoader().load('students/screen_a.jpg'); screenTexA.colorSpace = THREE.SRGBColorSpace;
const screenTexB = new THREE.TextureLoader().load('students/screen_b.jpg'); screenTexB.colorSpace = THREE.SRGBColorSpace;
// 山水壁纸材质：平铺 + 自发光（暖暗环境里也看得清，像"透光的画")
function inkMat(tex, rx, ry){
  const t = tex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map:t, emissive:0xffffff, emissiveMap:t, emissiveIntensity:0.34, roughness:1 });
}
// 左右侧墙：整面山水壁画（墙裙以上到顶，6.6m 高 × 15.7m 长，横向平铺 2 幅，比例不失真）
const muralL = new THREE.Mesh(new THREE.PlaneGeometry(15.7, 6.6), inkMat(screenTexA, 2, 1));
muralL.rotation.y = Math.PI/2; muralL.position.set(-7.94, 4.6, 0); scene.add(muralL);
const muralR = new THREE.Mesh(new THREE.PlaneGeometry(15.7, 6.6), inkMat(screenTexB, 2, 1));
muralR.rotation.y = -Math.PI/2; muralR.position.set(7.94, 4.6, 0); scene.add(muralR);
// 黑板两侧：大幅山水挂轴（平贴在后墙上，厚度仅 0.05m，不占空间）
function makeScroll(x){
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.45, 4.5, 0.05), frameMat); g.add(frame);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 4.3), inkMat(x<0 ? screenTexA : screenTexB, 1, 1));
  art.position.z = 0.035; g.add(art);
  g.position.set(x, 3.55, -5.82); scene.add(g);
}
makeScroll(-6.35); makeScroll(6.35);

// 黑板（动态写教案）
function makeBoardTexture(title, body){
  const c = document.createElement('canvas'); c.width=1024; c.height=512; const x=c.getContext('2d');
  x.fillStyle='#0c1f17'; x.fillRect(0,0,1024,512);
  x.fillStyle='#dff5e6'; x.font='bold 46px KaiTi, STKaiti, "Kaiti SC", 楷体, serif'; x.fillText('《'+title+'》', 40, 70);
  x.font='32px KaiTi, STKaiti, "Kaiti SC", 楷体, serif'; let y=130; const lines=(body||'').split(''); let line='';
  for(const ch of lines){ line+=ch; if(line.length>22){ x.fillText(line,40,y); y+=44; line=''; } }
  if(line) x.fillText(line,40,y);
  const t = new THREE.CanvasTexture(c); t.needsUpdate=true; return t;
}
const board = new THREE.Mesh(new THREE.PlaneGeometry(9,4.5), new THREE.MeshStandardMaterial({map:makeBoardTexture('灵境·课室','站在讲台上，面对你的学生。'), roughness:.9}));
board.position.set(0,3.2,-5.9); scene.add(board);
const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(9.4,4.9,0.2), new THREE.MeshStandardMaterial({color:0x6b4f2a})); boardFrame.position.set(0,3.2,-6.0); scene.add(boardFrame);

// ===== 讲台（民国木讲桌：教案本 + 粉笔盒 + 铜铃 + 茶缸 + 教鞭）=====
// 第一人称"我站在讲台后"的实体锚点：桌沿正好落在画面下缘，学生全身仍不被遮挡（几何核算见 docs）。
function makeBookTexture(title){
  const c=document.createElement('canvas'); c.width=512; c.height=384; const x=c.getContext('2d');
  x.fillStyle='#f5edd6'; x.fillRect(0,0,512,384);
  x.strokeStyle='#d8c9a5'; x.lineWidth=3; x.strokeRect(6,6,500,372);
  x.strokeStyle='#c9b98f'; x.lineWidth=4; x.beginPath(); x.moveTo(256,10); x.lineTo(256,374); x.stroke();
  x.fillStyle='#2b2620'; x.textAlign='center'; x.font='bold 40px KaiTi, STKaiti, 楷体, serif';
  x.fillText('《'+(title||'灵境·课室')+'》', 256, 74);
  x.fillStyle='#5a5348'; x.font='22px KaiTi, STKaiti, 楷体, serif'; x.fillText('教　案', 256, 118);
  x.strokeStyle='#cbbf9f'; x.lineWidth=1;
  for(let y=150;y<350;y+=34){ x.beginPath(); x.moveTo(40,y); x.lineTo(226,y); x.stroke(); x.beginPath(); x.moveTo(286,y); x.lineTo(472,y); x.stroke(); }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}
const deskMat = new THREE.MeshStandardMaterial({map: woodTexture('#7a5530', 6, 41), roughness:.85});
const podium = new THREE.Group();
const deskBody = new THREE.Mesh(new THREE.BoxGeometry(2.0,0.86,0.62), deskMat); deskBody.position.y=0.43; podium.add(deskBody);
const deskTop  = new THREE.Mesh(new THREE.BoxGeometry(2.14,0.07,0.74), deskMat); deskTop.position.y=0.895; podium.add(deskTop);
// 摊开的教案本（上课时显示课题）
const bookMat = new THREE.MeshBasicMaterial({map: makeBookTexture('灵境·课室')});
[-0.17,0.17].forEach((off,i)=>{
  const p=new THREE.Mesh(new THREE.PlaneGeometry(0.34,0.26), bookMat);
  p.rotation.x=-Math.PI/2; p.rotation.z = i? -0.05 : 0.05; p.position.set(off,0.945,0.07); podium.add(p);
});
// 粉笔盒 + 粉笔
const chalkBox = new THREE.Mesh(new THREE.BoxGeometry(0.24,0.08,0.13), new THREE.MeshStandardMaterial({color:0x8a6a3a, roughness:.9}));
chalkBox.position.set(0.62,0.972,-0.02); podium.add(chalkBox);
for(let i=0;i<3;i++){ const st=new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,0.07,6), new THREE.MeshStandardMaterial({color:0xf7f4ea}));
  st.rotation.z=Math.PI/2; st.position.set(-0.55+i*0.05,0.955,0.20); podium.add(st); }
// 铜铃（与上课铃仪式呼应）
const brass = new THREE.MeshStandardMaterial({color:0xc9a227, metalness:.7, roughness:.35});
const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.095,0.10,16), brass); bell.position.set(-0.62,0.985,0.0); podium.add(bell);
const bellTop = new THREE.Mesh(new THREE.TorusGeometry(0.035,0.012,8,14), brass); bellTop.rotation.x=Math.PI/2; bellTop.position.set(-0.62,1.045,0); podium.add(bellTop);
// 茶缸
const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.058,0.052,0.13,16), new THREE.MeshStandardMaterial({color:0xf2efe6, roughness:.55}));
mug.position.set(0.88,1.0,-0.08); podium.add(mug);
// 教鞭
const cane = new THREE.Mesh(new THREE.BoxGeometry(0.92,0.018,0.018), new THREE.MeshStandardMaterial({color:0x6b4a28, roughness:.8}));
cane.position.set(-0.78,0.955,0.16); cane.rotation.y=0.32; podium.add(cane);
podium.position.set(0,0,2.28); scene.add(podium);

// 学生立体形象
let studentsData = [];
const avatars = [];
function makeLabel(text, color){
  // 毛笔字名签：宣纸底 + 楷体竖排 + 墨色名字 + 朱砂色性格（战争年代卷轴风）
  const [name, trait] = text.split(' · ');
  const c=document.createElement('canvas'); c.width=128; c.height=288; const x=c.getContext('2d');
  x.fillStyle='#f3ecd8'; x.fillRect(0,0,128,288);                 // 宣纸
  x.fillStyle='#e8dfc6'; x.fillRect(0,0,10,288); x.fillRect(118,0,10,288); // 卷轴边
  x.strokeStyle='#8a6a3a'; x.lineWidth=4; x.strokeRect(8,8,112,272);
  x.textAlign='center';
  x.fillStyle='#23201a';                                          // 墨色
  x.font='bold 50px KaiTi, STKaiti, "Kaiti SC", 楷体, serif';
  [...(name||'')].forEach((ch,i)=>x.fillText(ch, 64, 72+i*58));
  x.fillStyle='#7a2c20';                                          // 朱砂
  x.font='28px KaiTi, STKaiti, "Kaiti SC", 楷体, serif';
  [...(trait||'')].forEach((ch,i)=>x.fillText(ch, 64, 214+i*34));
  const t=new THREE.CanvasTexture(c); return new THREE.Sprite(new THREE.SpriteMaterial({map:t, transparent:true}));
}
// ===== 学生立绘（二次元透明 PNG，本地托管；替换原胶囊+球体）=====
const STUDENT_IMG = { '小明':'students/xiaoming.png','小红':'students/xiaohong.png','小刚':'students/xiaogang.png','小丽':'students/xiaoli.png','小华':'students/xiaohua.png' };
const STUDENT_ASPECT = { '小明':IMG_ASPECT.xiaoming,'小红':IMG_ASPECT.xiaohong,'小刚':IMG_ASPECT.xiaogang,'小丽':IMG_ASPECT.xiaoli,'小华':IMG_ASPECT.xiaohua }; // 立绘 宽/高（来自 aspects.js）
const studentTex = {};
const texLoader = new THREE.TextureLoader();
for (const n in STUDENT_IMG){
  texLoader.load(STUDENT_IMG[n], (t)=>{
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; studentTex[n] = t;
    avatars.forEach(a=>{ if(a.userData.name===n && a.userData.plane){ a.userData.plane.material.map=t; a.userData.plane.material.needsUpdate=true; } });
  });
}
// 头顶「疑惑解开度」进度条（蓝→绿）。
// 为什么不是"理解度"（用户定框架 2026-09-10）：一段讲解不可能让 5 个学生一次全懂；
// 学生带着旧想法（前概念）进课堂，能变的只是"他心里那个疑问被解开多少"。R∈[0,1]。
function rr(x,px,py,w,h,r){ x.beginPath(); x.moveTo(px+r,py); x.arcTo(px+w,py,px+w,py+h,r); x.arcTo(px+w,py+h,px,py+h,r); x.arcTo(px,py+h,px,py,r); x.arcTo(px,py,px+w,py,r); x.closePath(); }
function makeBar(){
  const c=document.createElement('canvas'); c.width=220; c.height=40; const x=c.getContext('2d');
  const tex=new THREE.CanvasTexture(c);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false}));
  sp.userData={x,tex,val:-9};
  return sp;
}
function drawBar(sp,v){
  const pending = v < 0;                       // 还没上课：不假装有数值
  if(!pending) v = Math.max(0,Math.min(1,v));
  if(sp.userData.val===v) return; sp.userData.val=v;
  const x=sp.userData.x; x.clearRect(0,0,220,40);
  x.fillStyle='rgba(10,14,26,.78)'; rr(x,0,6,220,28,14); x.fill();
  if(pending){
    x.fillStyle='#c9b98f'; x.font='bold 15px sans-serif'; x.textAlign='center'; x.fillText('待开课',110,26);
  }else{
    x.fillStyle='hsl('+(205-65*v)+',80%,48%)'; rr(x,3,9,Math.max(9,214*v),22,11); x.fill();
    x.fillStyle='#fff'; x.font='bold 15px sans-serif'; x.textAlign='center'; x.fillText('疑惑解开 '+Math.round(v*100)+'%',110,26);
  }
  sp.userData.tex.needsUpdate=true;
}
function buildStudents(list){
  // 已在教室里的同一批学生 → 只更新人设（前概念等），不重建（重建会打断动画与"在场感"）
  const same = list.length === avatars.length && list.every((s,i)=>avatars[i] && avatars[i].userData.name === s.name);
  if(same){
    studentsData = list;
    list.forEach((s,i)=>{ const ud = avatars[i].userData; ud.mis = s.mis || ud.mis || ''; ud.trait = s.trait || ud.trait; });
    return;
  }
  avatars.forEach(a=>scene.remove(a)); avatars.length=0; studentsData=list;
  const positions = [ [-3,-2.2],[-1.5,-2.6],[0,-2.9],[1.5,-2.6],[3,-2.2] ];
  const H = 1.9; // 立绘世界高度
  list.forEach((s,i)=>{
    const g = new THREE.Group();
    const col = COLORS[i%COLORS.length];
    // 课桌：置于立绘之前（挡住立绘下缘与图内自带的桌面，视觉上"学生坐在桌后"）
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.15,0.72,0.62), new THREE.MeshStandardMaterial({color:0x5b4630, roughness:.95}));
    desk.position.set(0,0.44,0.06); g.add(desk);
    // 学生立绘（billboard，每帧面向教师相机）
    const ar = STUDENT_ASPECT[s.name] || 0.673, w = H*ar;
    const BOT = 0.35; // 立绘下缘：正好被 3D 课桌盖住，遮掉图内自带的桌面
    const mat = new THREE.MeshBasicMaterial({ transparent:true, alphaTest:0.5, side:THREE.DoubleSide });
    if(studentTex[s.name]) mat.map = studentTex[s.name];
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w,H), mat);
    plane.position.set(0, BOT + H/2, -0.30);
    g.add(plane);
    // 头顶：理解度进度条 + 名签
    const bar = makeBar(); bar.position.y = BOT+H+0.06; bar.scale.set(1.25,0.22,1); g.add(bar); drawBar(bar,-1);
    const label = makeLabel(s.name+' · '+s.trait, col); label.position.y = BOT+H+0.75; label.scale.set(0.55,1.24,1); g.add(label);
    const [px,pz]=positions[i];
    g.position.set(px,0,pz);
    g.userData = { name:s.name, trait:s.trait, mis:s.mis||'', plane, desk, bar, label, baseZ:pz, color:col,
      status:'idle', speakT:0, understand:0, R:0, padLean:0.10, stand:false };
    scene.add(g); avatars.push(g);
  });
}

function setStatus(name, st){ const a=avatars.find(v=>v.userData.name===name); if(a) a.userData.status=st; }
// 学生头顶显示的是「疑惑解开度 R」——不是"理解度"（用户 2026-09-10 定框架）。
// 姿态由 PAD 表现层驱动：把 R 线性抬到 [0.15,1] 再喂 padTarget，避免 R=0 时立绘一片死气（纯表现层处理）。
function setR(name, R){
  const a=avatars.find(v=>v.userData.name===name); if(!a) return;
  const r = clampJS(Number(R)||0, 0, 1);
  a.userData.R = r;
  a.userData.understand = 0.15 + 0.85*r;
  drawBar(a.userData.bar, r);
  a.userData.padTarget = padTarget(name, a.userData.understand);   // 只存目标；惯性在 animate 里指数平滑
  if(!a.userData.padState) a.userData.padState = { ...a.userData.padTarget };
}
function pulseSpeak(name){ const a=avatars.find(v=>v.userData.name===name); if(a) a.userData.speakT = performance.now(); }

// 对话泡（HTML 投影）：学生说 + 解开度 + 「他进课堂前的旧想法」
// 显示前概念是要让人看见：学生不是白纸，一段讲解不可能让 5 个人一次全懂。
const bubbleEls = {};
function showBubble(name, text, mis, R){
  let el = bubbleEls[name];
  if(!el){ el=document.createElement('div'); el.className='bub'; $('bubbles').appendChild(el); bubbleEls[name]=el; }
  let html = '<b>'+escapeHtml(name)+'</b>：'+escapeHtml(text||'（未发言）');
  if(typeof R === 'number') html += '<div class="rf">疑惑解开 '+Math.round(clampJS(R,0,1)*100)+'%</div>';
  if(mis) html += '<div class="mis">他进课堂前以为：'+escapeHtml(mis)+'</div>';
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(()=>{ el.classList.remove('show'); }, 6800);
}
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

// ===== 体验感层：PAD 情绪模型 + 信息论熵 H + 角色仪式（见 docs 体验设计） =====
// 诚实标注：PAD 是「理解度 + 性格」→ 三维情绪向量的**表现层映射**，非真情绪识别；
// 理解度本身来自 LLM 自评（软度量），故 PAD 仅驱动姿态/颜色，不当真实情绪诊断。
const PAD_BASE = { '小明':0.35, '小红':0.15, '小刚':0.45, '小丽':0.05, '小华':0.25 }; // 性格基线愉悦度
function clampJS(x,a,b){ return Math.max(a, Math.min(b, x)); }
// 理解度 u∈[0,1] → PAD 目标向量（AI专家/数学家建议：E 显式驱动 PAD + 状态需有惯性）
//   P 由性格基线 + 理解度 + 全班 E 偏置合成；A/D 由理解度驱动。
function padTarget(name, u){
  const bp = PAD_BASE[name] ?? 0.2;
  const P = clampJS(bp + 0.6*(u-0.5) + globalPleasureBias, -1, 1); // 愉悦度：理解高 + 全班E升 → 更愉悦
  const A = clampJS(-0.4 + u*1.2, -1, 1);        // 唤醒度：理解越高越兴奋
  const D = clampJS(-0.5 + u*1.0, -1, 1);        // 支配度：理解越高越"我懂了"
  return { P, A, D };
}
// PAD 向量 → 姿态参数（连续映射；数学家提示映射非唯一、待 A/B 校准，故集中在此易调）
//   同一情绪可有多种姿态表达（点头/微笑），此处取一种可连续变化的映射。
function poseFromPAD(pad, u){
  let label='认真', tilt=0, gazeX=0;
  const lean = 0.12 + 0.30*((pad.A+pad.D)/2);    // 前倾程度（兴奋/自信→更前倾）
  if(u>0.7){ label='恍然大悟'; gazeX=-0.12; }      // 抬头看教师（方案3：理解→视线跟随教师）
  else if(u<0.4){ label='困惑'; tilt=0.32; gazeX=0.30; } // 歪头+低头看桌面（方案3：困惑→视线移开）
  else if(pad.A>0.5){ label='兴奋'; }
  const glow = 0.10 + Math.max(0,pad.A)*0.5;      // 唤醒越高越发光
  return { label, tilt, lean, glow, gazeX };
}
function lerpHex(c1,c2,t){
  const r1=(c1>>16)&255,g1=(c1>>8)&255,b1=c1&255, r2=(c2>>16)&255,g2=(c2>>8)&255,b2=c2&255;
  return (Math.round(r1+(r2-r1)*t)<<16)|(Math.round(g1+(g2-g1)*t)<<8)|Math.round(b1+(b2-b1)*t);
}
// 信息论熵（客户端实时版，与服务端 classEntropy 同公式）：理解度在全体「学生×知识点」单元上分布的 Shannon 熵
function shannonH(rows){
  const cells=[]; for(const r of rows) for(const v of r) cells.push(v);
  const N=cells.length; if(!N) return 0;
  const K=10; const hist=new Array(K).fill(0);
  for(const v of cells){ const b=Math.min(K-1, Math.max(0, Math.floor(v*K))); hist[b]++; }
  let H=0; for(const c of hist){ const p=c/N; if(p>0) H-=p*Math.log(p); }
  return H/Math.log(K);
}
let latestP = {}; // 各生最新知识行（供实时熵）
let currentH = 0.3; // 当前课堂熵（方案4：驱动环境光色温+背景亮度）
let globalPleasureBias = 0; // 全班 E 对愉悦度的偏置（数学家建议：E→PAD 显式闭环）

// 角色仪式：上课铃（WebAudio 合成，零素材零依赖）+ 起立问好 + 点名
let audioCtx=null;
function playBell(){
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended') audioCtx.resume();
    const t0=audioCtx.currentTime;
    [[660,0],[880,0.18],[660,0.36],[880,0.54]].forEach(([f,dt])=>{
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.frequency.value=f; o.type='sine';
      g.gain.setValueAtTime(0.0001,t0+dt);
      g.gain.exponentialRampToValueAtTime(0.25,t0+dt+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+dt+0.16);
      o.connect(g); g.connect(audioCtx.destination); o.start(t0+dt); o.stop(t0+dt+0.18);
    });
  }catch(e){ /* 静音降级（如浏览器禁音频） */ }
}
function showCenterBubble(text){
  const el=$('cbub'); el.textContent=text; el.classList.add('show');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'), 2200);
}
function ceremony(){
  playBell();
  avatars.forEach(a=>{ a.userData.stand=true; });
  showCenterBubble('🔔 上课铃响了 · 全体起立：老师好！🙇');
  setTimeout(()=>{ avatars.forEach(a=>a.userData.stand=false); }, 1700);
  setTimeout(()=>{
    const a=avatars[Math.floor(Math.random()*avatars.length)];
    if(a){ pulseSpeak(a.userData.name); showBubble(a.userData.name,'到！'); }  // 被点到名 → 立绘放大回应
  }, 1900);
}

// 鼠标转头
let yaw=0, pitch=0, dragging=false, lx=0, ly=0;
renderer.domElement.addEventListener('pointerdown', e=>{ dragging=true; lx=e.clientX; ly=e.clientY; });
addEventListener('pointerup', ()=>dragging=false);
addEventListener('pointermove', e=>{ if(!dragging) return; yaw -= (e.clientX-lx)*0.004; pitch -= (e.clientY-ly)*0.004; pitch=Math.max(-0.5,Math.min(0.6,pitch)); lx=e.clientX; ly=e.clientY; });

// 动画
const tmp = new THREE.Vector3();
// 方案4：课堂熵 H → 氛围渲染的色板（低熵=冷暗沉闷，高熵=暖亮活跃），复用临时对象避免每帧分配
// 方案4：课堂熵 H → 氛围（低熵=暗沉、高熵=明亮；统一暖色，呼应民国暖调）
const COOL_AMB = new THREE.Color(0x9a7440), WARM_AMB = new THREE.Color(0xffd9a0);
const BG_DIM = new THREE.Color(0x140d06), BG_BRIGHT = new THREE.Color(0x2a1d0e);
const _ambTmp = new THREE.Color(), _bgTmp = new THREE.Color();
function animate(){
  requestAnimationFrame(animate);
  const now = performance.now();
  avatars.forEach(a=>{
    const ud=a.userData;
    // PAD 惯性：状态向目标指数平滑 + OU 微噪，情绪不每轮跳变、有"惯性"
    if(ud.padTarget){
      const k=0.06, n=(Math.random()-0.5)*0.015;
      ud.padState.P += (ud.padTarget.P - ud.padState.P)*k + n;
      ud.padState.A += (ud.padTarget.A - ud.padState.A)*k;
      ud.padState.D += (ud.padTarget.D - ud.padState.D)*k;
    }
    const pose = ud.padState ? poseFromPAD(ud.padState, ud.understand) : { tilt:0, gazeX:0, lean:0.12, glow:0.1 };
    ud.padJitter = (ud.padJitter||0)*0.9 + (Math.random()-0.5)*0.05;   // OU 微抖（生命感）
    const standTarget = ud.stand ? 0.22 : 0;                           // 起立问好
    ud.standOff = (ud.standOff||0) + (standTarget - (ud.standOff||0))*0.15;
    a.position.y = ud.standOff + Math.sin(now*0.0015 + a.position.x)*0.03 + ud.padJitter*0.012;
    const speaking = now - ud.speakT < 1200;
    // PAD 前倾：立绘整体朝教师微移，说话时更明显
    ud.padLean += (pose.lean - ud.padLean)*0.08;
    const targetZ = ud.baseZ + ud.padLean + (speaking ? 0.22*Math.sin(now*0.012) : 0);
    a.position.z += (targetZ - a.position.z)*0.1;
    // billboard：立绘始终面向相机（教师环顾时也正对你）
    const pl = ud.plane;
    pl.quaternion.copy(camera.quaternion);
    pl.rotateZ(Math.sin(now*0.0011 + a.position.x)*0.02);              // 轻微摇晃
    // PAD 愉悦度→冷暖光（低愉悦偏冷蓝，理解好则纯白）
    pl.material.color.set(lerpHex(0xcdb892, 0xffffff, (clampJS(ud.padState?ud.padState.P:0,-1,1)+1)/2));
    // 说话时轻微放大（与"举手发言"呼应）
    const sc = speaking ? 1.05 : 1.0;
    const cs = pl.scale.x || 1;
    const ns = cs + (sc - cs)*0.15;
    pl.scale.set(ns, ns, 1);
  });
  // 方案4：课堂熵 H → 氛围渲染（低熵冷暗沉闷 / 高熵暖亮活跃），让课室随教学场"活起来"
  const hT = clampJS(currentH, 0, 1);
  _ambTmp.copy(COOL_AMB).lerp(WARM_AMB, hT); ambient.color.lerp(_ambTmp, 0.04);
  _bgTmp.copy(BG_DIM).lerp(BG_BRIGHT, hT); scene.background.lerp(_bgTmp, 0.04);
  // 相机（第一人称讲台，带轻微呼吸/重心晃动 = 具身存在感）
  const cx=0, cz=3.2;
  const cy = 1.6 + Math.sin(now*0.0011)*0.012;
  camera.position.set(cx + Math.sin(now*0.0007)*0.02, cy, cz);
  const tx=Math.sin(yaw)*Math.cos(pitch), ty=1.2+Math.sin(pitch), tz=-Math.cos(yaw)*Math.cos(pitch);
  camera.lookAt(cx+tx, ty, cz+tz-3.0);
  // 投影对话泡
  avatars.forEach(a=>{
    const el=bubbleEls[a.userData.name]; if(!el) return;
    a.userData.plane.getWorldPosition(tmp); tmp.y += 1.0;   // 立绘头顶上方
    tmp.project(camera);
    if(tmp.z>1){ el.style.display='none'; return; }
    el.style.display='block';
    el.style.left = ((tmp.x*0.5+0.5)*innerWidth)+'px';
    el.style.top = ((-tmp.y*0.5+0.5)*innerHeight)+'px';
  });
  // 灵境数学：课堂热场按真实 3D FTCS 推进（上课中每 2 帧一步，稳定可见；课前/下课后随相位停或冷却）
  if (heat) {
    if (phase !== 'idle' && (heatTick = (heatTick + 1) % 2) === 0) heat.step();
    updateHeatCloud();
    worldSyncEnergy();                            // 物理载体能量实时同步进 World.M
  }
  renderer.render(scene, camera);
}
// 首帧延到下一动画帧：本模块在 animate() 之后才用 let 声明 heat/heatTick/phase 等，
// 若在此处同步调用 animate() 会触发"在初始化前访问"的 TDZ 报错（白屏）。
requestAnimationFrame(animate);
addEventListener('resize', ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });

// ===== 灵境数学：3D 热传导场（真 PDE）=====
// 框架原文：物理是「载体」，不声称模拟真实世界。这里用真实的 3D FTCS 把"老师讲解注入的能量"
// 渲染成会扩散、会冷却的悬浮体素云——看得见咱们的数学在跑，不是装饰。
// 同时把课堂接进核心世界模型 World = ⟨S, R, M, T⟩（公理3：你的讲解=不可计算的外部输入，引擎只承接不生成）。
const HEAT_N = 9;                                  // 网格（奇数，唯一原点在中心）
const HEAT_REF = 1.2;                              // 归一参考温度：注入 1.0 ≈ 明亮暖色，课前微温 ≈ 暗蓝
let heat = null;
try {
  // λ = α·dt/dx² = 0.12·0.1/1 = 0.012 ≤ 1/6 → 3D FTCS 稳定（physics.js 同款 fail-closed 护栏）
  heat = new HeatWorld3D({ n: HEAT_N, dx: 1, alpha: 0.12, dt: 0.1 });
  heat.init(() => 0.035);                          // 课前：一点微温，让"课堂场"隐约可见；上课后由讲解点燃
} catch (e) { heat = null; console.warn('HeatWorld3D 初始化失败（CFL 护栏拒启）：', e); }

// 体素云悬浮在课室正上方（学生头顶之上、匾额之下，黑板前）
const HEAT_CENTER = new THREE.Vector3(0, 4.6, -3.2);
const HEAT_SPAN = 3.0;                             // 体素云总边长（世界单位）
const heatGeo = new THREE.BufferGeometry();
const heatPos = new Float32Array(HEAT_N * HEAT_N * HEAT_N * 3);
const heatCol = new Float32Array(HEAT_N * HEAT_N * HEAT_N * 3);
heatGeo.setAttribute('position', new THREE.BufferAttribute(heatPos, 3));
heatGeo.setAttribute('color', new THREE.BufferAttribute(heatCol, 3));
const heatMat = new THREE.PointsMaterial({
  size: 0.36, vertexColors: true, transparent: true, opacity: 0.95,
  depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
});
const heatCloud = new THREE.Points(heatGeo, heatMat);
scene.add(heatCloud);

// 预计算每个体素的世界坐标（网格中心对齐 HEAT_CENTER）
const heatWorldPos = [];
for (let z = 0; z < HEAT_N; z++) for (let y = 0; y < HEAT_N; y++) for (let x = 0; x < HEAT_N; x++) {
  const fx = (x - (HEAT_N - 1) / 2) / ((HEAT_N - 1) / 2) * (HEAT_SPAN / 2);
  const fy = (y - (HEAT_N - 1) / 2) / ((HEAT_N - 1) / 2) * (HEAT_SPAN / 2);
  const fz = (z - (HEAT_N - 1) / 2) / ((HEAT_N - 1) / 2) * (HEAT_SPAN / 2);
  heatWorldPos.push([HEAT_CENTER.x + fx, HEAT_CENTER.y + fy, HEAT_CENTER.z + fz]);
}
// 温度 → 颜色（冷蓝 → 暖橙红 → 亮黄）
const HEAT_COLD = new THREE.Color(0x2b3a8f), HEAT_WARM = new THREE.Color(0xff5a1f), HEAT_HOT = new THREE.Color(0xffe08a);
const _hc = new THREE.Color();
function heatColor(out, t) {
  if (t < 0.5) out.copy(HEAT_COLD).lerp(HEAT_WARM, t / 0.5);
  else out.copy(HEAT_WARM).lerp(HEAT_HOT, (t - 0.5) / 0.5);
  return out;
}
// 把当前温度场刷进体素云（位置固定，只更新颜色/亮度；低温体素压暗≈接近透明）
function updateHeatCloud() {
  if (!heat) return;
  const u = heat.u, n = heat.n;
  let k = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const val = u[idx(x, y, z, n)];
    const wp = heatWorldPos[k];
    heatPos[k * 3] = wp[0]; heatPos[k * 3 + 1] = wp[1]; heatPos[k * 3 + 2] = wp[2];
    // 用固定参考温度归一（不随当前最大值漂移）：课前微温≈暗蓝，老师注入≈明亮暖色
    const t = Math.max(0, Math.min(1, val / HEAT_REF));
    heatColor(_hc, t);
    const b = 0.10 + 0.90 * t;                     // 低温压暗（Additive 下≈透明），高温明亮
    heatCol[k * 3] = _hc.r * b; heatCol[k * 3 + 1] = _hc.g * b; heatCol[k * 3 + 2] = _hc.b * b;
    k++;
  }
  heatGeo.attributes.position.needsUpdate = true;
  heatGeo.attributes.color.needsUpdate = true;
}
// 字段标题（诚实标注这是真数学载体，不是氛围贴图）
function makeCaption(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const x = c.getContext('2d');
  x.fillStyle = 'rgba(18,12,6,.78)'; x.fillRect(0, 0, 512, 96);
  x.fillStyle = '#ffeecb'; x.font = 'bold 34px KaiTi, STKaiti, 楷体, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  sp.scale.set(2.6, 0.49, 1);
  return sp;
}
const heatCaption = makeCaption('教学能量场 · 3D 热传导 FTCS');
heatCaption.position.set(HEAT_CENTER.x, HEAT_CENTER.y + HEAT_SPAN / 2 + 0.35, HEAT_CENTER.z);
scene.add(heatCaption);
// 兜底：极端情况下热场初始化失败（CFL 护栏拒启），则不渲染体素云，避免原点出现游离亮斑
if (!heat) { heatCloud.visible = false; heatCaption.visible = false; }

// ===== 灵境核心世界模型：World = ⟨S, R, M, T⟩，把课堂接进框架 =====
let world = null;
function worldReset(students) {
  if (typeof World === 'undefined') return;
  world = new World();
  world.addAgent({ id: 'teacher', name: '你', kind: 'teacher' });          // 公理3：人类=外部输入
  (students || []).forEach((s) => world.addAgent({ id: 'ag_' + s.name, name: s.name, kind: 'student' }));
  (students || []).forEach((s) => world.addRelation('teach', 'teacher', 'ag_' + s.name));
}
function worldInjectLesson(title, text) {
  if (!world) return;
  world.addArtifact({ owner: 'teacher', kind: 'lesson', payload: { title, text } });
}
function worldSyncEnergy() {
  if (!world || !heat) return;
  world.M.energy = heat.energy();               // 物理载体能量 → 世界测度 M
}
let heatTick = 0;

// ===== 前端状态机 =====
// idle(课前·人已在教室) → busy(学生说话中) → reply(轮到你回话) → done(作品：《课堂纪要》)
// 设计铁律（用户 2026-09-10 定框架）：
//   ① 一打开就是教室，不是文字聊天面板——讲台只是讲台，不属于对话框；
//   ② 学生的头顶是「疑惑解开度 R」，不是"理解度"——一段话不可能让 5 人一次全懂；
//   ③ 课的价值是让**人类**整理、升华自己的知识：下课由 5 名学生共同交出《课堂纪要》（作品）+ 你的收益。
const askbar=$('askbar'), replyText=$('replyText'), micBtn=$('mic');
let sessionId = null;
let phase = 'idle';
let finishing = false;
let lastWork = null;        // { title, md } 供复制/下载
let lastDeck = null;        // 技能卡片组（供下载）
let lastSummary = null;     // 课后总结（供下载）
let clsTurns = [];          // 课堂时序 [{round, student, R, say}] —— 供顿悟峰检测
let curRound = 1;           // 当前轮次（顿悟检测要知道每轮在什么时候）
let lastJournal = null;     // 跨课知识库（供下载）
let preState = null;        // 课前探索状态 {pre, attempts, kind, lesson}
const transcript = [];      // 本地留一份课堂实录

// 跨课知识库落盘：**只存本机浏览器**（localStorage），不上传、不联网
const JKEY = 'lingjing.journal.v1';
function loadJournal() { try { const s = localStorage.getItem(JKEY); return s ? JSON.parse(s) : newJournal(); } catch (e) { return newJournal(); } }
function saveJournal(j) { try { localStorage.setItem(JKEY, JSON.stringify(j)); } catch (e) { /* 隐私模式等：静默降级 */ } }

const FALLBACK_ROSTER = [
  { name:'小明', trait:'好奇' }, { name:'小红', trait:'严谨' }, { name:'小刚', trait:'活泼' },
  { name:'小丽', trait:'害羞' }, { name:'小华', trait:'自信' },
];

function showTeacherSay(text){
  const el=$('tsay');
  $('tsayText').textContent = text;
  el.classList.add('on');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('on'), 6000);
}
// 讲台条的两种形态：课前＝写下今天要讲的一课；上课中＝回答学生
function setBar(mode){
  if(mode==='hide'){ askbar.classList.remove('on'); return; }
  askbar.classList.add('on');
  $('chips').style.display = (mode==='idle') ? 'flex' : 'none';
  $('replySkip').style.display = (mode==='idle') ? 'none' : '';
  if(mode==='idle'){
    $('askWho').textContent='讲台';
    replyText.placeholder='今天你想讲什么？把你要教的东西说出来…（回车＝开始上课）';
    $('replySend').textContent='开始上课';
  }else{
    $('askWho').textContent='你：';
    replyText.placeholder='学生问完了 · 你说两句（回答／追问／接着讲；留空＝跳过，让他们自己再想想）';
    $('replySend').textContent='回答';
  }
  replyText.value='';
}
function setBusy(b){ $('replySend').disabled=b; replyText.disabled=b; }
function showErr(msg){
  const e=$('error'); e.textContent=msg; e.style.display='block';
  clearTimeout(e._t); e._t=setTimeout(()=>{ e.style.display='none'; }, 6000);
}

function handleEvent(ev){
  if(ev.type==='session'){ sessionId = ev.id; return; }
  if(ev.type==='start'){
    $('boardTitle').textContent='《'+(ev.lessonTitle||'课室')+'》';
    board.material.map = makeBoardTexture(ev.lessonTitle||'课室', ev.lessonText||''); board.material.needsUpdate=true;
    bookMat.map = makeBookTexture(ev.lessonTitle||'课室'); bookMat.needsUpdate=true;   // 讲台上的教案本同步课题
    buildStudents(ev.students||[]);              // 同一批学生 → 只更新前概念，不重建（保住"在场感"）
    latestP = {}; transcript.length = 0; lastWork = null;
    clsTurns = []; curRound = 1;              // 新的课堂时序（顿悟峰检测从这里读）
    // 灵境数学：重置世界模型 + 热场，第一段讲解注入能量（真把咱们的数学点燃）
    worldReset(ev.students||[]);
    worldInjectLesson(ev.lessonTitle, ev.lessonText);
    if (heat) { heat.u.fill(0); heat.init(() => 0.035); heat.injectAt(1, 1.0); } // 教师开讲＝能量注入场中心
    $('mR').textContent='–'; $('mS').textContent='–'; $('mH').textContent='–'; $('mN').textContent='1';
    $('boardSub').textContent='你站在讲台上 · 5 名学生带着各自的旧想法进了课堂';
    ceremony(); // 上课铃 → 起立问好 → 点名
    return;
  }
  if(ev.type==='round_start'){
    avatars.forEach(a=>{ a.userData.status='listen'; drawBar(a.userData.bar,-1); }); // 新一轮：疑问重新问一遍
    if(ev.teacherReply) showTeacherSay(ev.teacherReply);
    if(heat && ev.teacherReply) heat.injectAt(1, 0.6);  // 老师这段回话＝再注入一束能量，场继续扩散
    setBar('hide');
    return;
  }
  if(ev.type==='understand'){ setStatus(ev.name,'think'); setR(ev.name,ev.R); latestP[ev.name]=ev.Prow; return; }
  if(ev.type==='ask'){
    const a=avatars.find(v=>v.userData.name===ev.name);
    setStatus(ev.name,'ask'); setR(ev.name,ev.R); pulseSpeak(ev.name);
    showBubble(ev.name, ev.text, (a && a.userData.mis) || '', ev.R);   // 带上"他进课堂前以为…"
    latestP[ev.name]=ev.Prow;
    transcript.push(ev.name+'：'+ev.text);
    // 课堂时序：顿悟峰检测的输入（R 的逐轮变化 + 当时那句话）
    clsTurns.push({ round: curRound, student: ev.name, R: Number(ev.R)||0, say: ev.text, mis: (a && a.userData.mis) || '' });
    return;
  }
  if(ev.type==='round_end'){
    $('mN').textContent = String(ev.round);
    curRound = (Number(ev.round) || 0) + 1;   // 本轮结束 → 进入下一轮（供时序标注）
    if(typeof ev.avgR==='number') $('mR').textContent=Number(ev.avgR).toFixed(3);
    $('mS').textContent=Number(ev.sigma2).toFixed(4);
    if(Object.keys(latestP).length===avatars.length){ const h=shannonH(Object.values(latestP)); currentH=h; $('mH').textContent=h.toFixed(3); }
    globalPleasureBias = clampJS(((Number(ev.E)||0) - 0.01) * 4, -0.2, 0.3);   // E 升 → 全班愉悦度偏置上扬
    // 诚实标注：本轮到底几个学生是真 LLM 在说（0/5 可能是额度用尽，也可能是模型返回空）
    $('status').textContent = '第 '+ev.round+' 轮结束 · ' + (typeof ev.llmOk==='number'
      ? (ev.llmOk>0 ? ('真 LLM 学生 '+ev.llmOk+'/5') : '本轮 0/5 走真 LLM（额度/限流或模型返回空）· 学生走兜底语料')
      : '—');
    if(ev.canContinue){ phase='reply'; setBar('reply'); setBusy(false); setTimeout(()=>replyText.focus(),80); }
    else finishClass();                                                          // 最后一轮 → 自动收尾
    return;
  }
  if(ev.type==='done'){
    phase='done';
    $('mR').textContent=Number(ev.avgR||0).toFixed(3);
    if(ev.H!=null){ currentH=Number(ev.H)||0; $('mH').textContent=Number(ev.H).toFixed(3); }  // 终态权威熵
    const last=ev.rounds&&ev.rounds.length?ev.rounds[ev.rounds.length-1]:{sigma2:0};
    $('mS').textContent=Number(last.sigma2).toFixed(4);
    setBar('hide'); setBusy(false);
    renderWork(ev);
    return;
  }
  if(ev.type==='error'){ showErr('出错了：'+ev.message); setBusy(false); if(phase==='busy'){ phase='reply'; setBar('reply'); } }
}

// ===== 作品渲染：《课堂纪要》（5 名学生共同交出）+ 你自己的收获 =====
// 极简 Markdown → HTML（只支持纪要会用到的：标题/列表/粗体/引用），避免引第三方库。
function mdToHtml(md){
  const inline = (s)=>escapeHtml(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/`(.+?)`/g,'<code>$1</code>');
  let out='', inUl=false;
  const closeUl=()=>{ if(inUl){ out+='</ul>'; inUl=false; } };
  for(const raw of String(md||'').split('\n')){
    const l=raw.replace(/\s+$/,'');
    if(/^#{1,3}\s+/.test(l)){ closeUl(); out+='<h3>'+inline(l.replace(/^#{1,3}\s+/,''))+'</h3>'; continue; }
    if(/^>\s?/.test(l)){ closeUl(); out+='<blockquote>'+inline(l.replace(/^>\s?/,''))+'</blockquote>'; continue; }
    if(/^[-*]\s+/.test(l)){ if(!inUl){ out+='<ul>'; inUl=true; } out+='<li>'+inline(l.replace(/^[-*]\s+/,''))+'</li>'; continue; }
    if(!l){ closeUl(); continue; }
    closeUl(); out+='<p>'+inline(l)+'</p>';
  }
  closeUl();
  return out;
}
/* ========================================================================
   课后可视化：算出来的数学，别在最后一步拍平成文字。
   —— 原来的课后三块（峰 / 课前对照 / 复习队列）全是段落和表格，可它们本质
      分别是"一条曲线""一次左右对照""一条时间轴"。写成文字＝把数学丢掉。
   这三张图只用内联 SVG / DIV + CSS，不引任何库（单文件仍可离线分发）。
   ======================================================================== */

// 线条色（暖色系，和课室的木色一致；cream 底上对比度够）
const LINE_COLORS = ['#b0492f', '#2f6f4f', '#1f5b8a', '#8a5a1a', '#7a3a6a'];

function hashStr(s) {
  let h = 0;
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return h;
}

/**
 * 顿悟峰曲线：横轴＝轮次，纵轴＝学生懂了没（R ∈ [0,1]）。
 * 细线＝5 名学生各自，粗线＝全班均值，红圈＝检测出的那个峰。
 * **没有峰也照样画** —— 把"平稳上升"如实画出来，比一句"没有峰"更诚实、也更有信息。
 * @param {Array<{round:number,student:string,R:number}>} turns 课堂时序
 * @param {object|null} strongest detectPeaks 的最强峰（可为 null）
 */
function peakChartSvg(turns, strongest) {
  const list = Array.isArray(turns) ? turns : [];
  const rounds = [...new Set(list.map((t) => Number(t.round) || 0).filter((r) => r > 0))].sort((a, b) => a - b);
  if (rounds.length < 2) return '';   // 少于两轮画不出"变化"，不硬画

  const byStudent = new Map(), byRound = new Map();
  for (const t of list) {
    const r = Number(t.round) || 0; if (!r) continue;
    const s = String(t.student || '?');
    const R = Math.max(0, Math.min(1, Number(t.R) || 0));
    if (!byStudent.has(s)) byStudent.set(s, new Map());
    byStudent.get(s).set(r, R);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(R);
  }
  const mean = rounds.map((r) => byRound.get(r).reduce((a, b) => a + b, 0) / byRound.get(r).length);
  const W = 620, H = 178, L = 38, Rp = 14, T = 16, B = 36;
  const pw = W - L - Rp, ph = H - T - B;
  const xi = new Map(rounds.map((r, i) => [r, i]));
  const x = (r) => L + (xi.get(r) || 0) * pw / Math.max(1, rounds.length - 1);
  const y = (v) => T + (1 - Math.max(0, Math.min(1, v))) * ph;
  const f1 = (n) => n.toFixed(1);

  let g = '';
  // 网格 + 纵轴刻度
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    g += '<line x1="' + L + '" y1="' + f1(y(v)) + '" x2="' + (L + pw) + '" y2="' + f1(y(v)) + '" stroke="#e6dcc2" stroke-width="1"/>';
    g += '<text x="' + (L - 6) + '" y="' + f1(y(v) + 3.5) + '" text-anchor="end" font-size="9" fill="#9a8f78">'
      + v.toFixed(2) + '</text>';
  });
  // "还糊涂"分界：R < 0.45 是峰检测的判据，画出来这条线才有意义（否则图上看不懂为什么这里算峰）
  g += '<line x1="' + L + '" y1="' + f1(y(0.45)) + '" x2="' + (L + pw) + '" y2="' + f1(y(0.45)) + '" stroke="#c9b98f" stroke-width="1" stroke-dasharray="4 3"/>';
  g += '<text x="' + (L + pw) + '" y="' + f1(y(0.45) - 4) + '" text-anchor="end" font-size="9" fill="#b09a6a">0.45 以下＝还糊涂</text>';

  // 学生细线
  let si = 0;
  for (const [, mp] of byStudent) {
    const col = LINE_COLORS[si++ % LINE_COLORS.length];
    const pts = rounds.filter((r) => mp.has(r)).map((r) => f1(x(r)) + ',' + f1(y(mp.get(r))));
    if (pts.length >= 2) g += '<polyline fill="none" stroke="' + col + '" stroke-width="1.3" stroke-opacity="0.4" points="' + pts.join(' ') + '"/>';
  }
  // 全班均值（粗线）
  g += '<polyline fill="none" stroke="#8a6a3a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="'
    + rounds.map((r, i) => f1(x(r)) + ',' + f1(y(mean[i]))).join(' ') + '"/>';
  rounds.forEach((r, i) => { g += '<circle cx="' + f1(x(r)) + '" cy="' + f1(y(mean[i])) + '" r="2.8" fill="#8a6a3a"/>'; });

  // ⚠️ 全班 R 全程贴着 0 的时候，这条线看起来就像"图坏了"。
  //    所以把数值直接写在线上 —— 平线也要能读出"它就是 0.00"。
  //    贴底时写在图内右上：写在线的末端会横轴刻度挤在同一行、把最后一个轮次号压掉。
  const mMin = Math.min.apply(null, mean), mMax = Math.max.apply(null, mean);
  const flat = mMax < 0.15;
  const mLabel = '全班均值 ' + mMin.toFixed(2) + (mMax - mMin < 0.005 ? '' : ' → ' + mMax.toFixed(2));
  const mLabelY = flat ? T + 10 : Math.max(T + 10, y(mMax) - 7);
  g += '<text x="' + (L + pw) + '" y="' + f1(mLabelY) + '" text-anchor="end" font-size="9.5" font-weight="700" fill="#8a6a3a">'
    + mLabel + '</text>';

  let legend = '<span><i style="background:#8a6a3a"></i>全班均值</span>'
    + '<span><i style="background:#c9b98f"></i>细线＝每名学生</span>';

  // 峰的位置
  const pr = strongest ? Number(strongest.round) : 0;
  if (strongest && xi.has(pr)) {
    const px = x(pr), py = y(Number(strongest.toR) || 0);
    g += '<line x1="' + f1(px) + '" y1="' + T + '" x2="' + f1(px) + '" y2="' + (T + ph) + '" stroke="#b0492f" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.65"/>';
    g += '<circle cx="' + f1(px) + '" cy="' + f1(py) + '" r="5.5" fill="none" stroke="#b0492f" stroke-width="2"/>';
    g += '<circle cx="' + f1(px) + '" cy="' + f1(py) + '" r="2.2" fill="#b0492f"/>';
    const anchor = px > L + pw * 0.62 ? 'end' : 'start';
    g += '<text x="' + f1(anchor === 'end' ? px - 9 : px + 9) + '" y="' + f1(py - 9) + '" text-anchor="' + anchor
      + '" font-size="10" font-weight="700" fill="#b0492f">' + escapeHtml(String(strongest.student || ''))
      + (strongest.reachedClear ? ' 通了' : ' 跟上了') + '</text>';
    legend += '<span><i style="background:#b0492f"></i>峰 · 第 ' + pr + ' 轮</span>';
  }

  // 横轴刻度（最多约 8 个，避免挤成一团）
  const step = Math.max(1, Math.ceil(rounds.length / 8));
  rounds.forEach((r, i) => {
    if (i % step && i !== rounds.length - 1) return;
    g += '<text x="' + f1(x(r)) + '" y="' + (T + ph + 14) + '" text-anchor="middle" font-size="9" fill="#9a8f78">' + r + '</text>';
  });
  g += '<text x="' + L + '" y="' + (H - 4) + '" font-size="9" fill="#9a8f78">纵轴＝学生懂了没（R）</text>';
  g += '<text x="' + (L + pw) + '" y="' + (H - 4) + '" text-anchor="end" font-size="9" fill="#9a8f78">横轴＝第几轮 →</text>';

  return '<div class="chartwrap"><div class="legend">' + legend
    + (flat ? '<span style="color:#7a2c20">全班 R 全程低于 0.15 —— 这一课没有人真的跟上，曲线贴着底不是图坏了</span>' : '')
    + '</div>'
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="学生疑惑解开度随课堂轮次变化的曲线">' + g + '</svg></div>';
}

/**
 * 复习时间轴：每个概念一条横条，长度按"距下次复习还有几天"的**对数刻度**。
 * 为什么用对数：DSR 排期是乘性增长的（1 天 → 4 天 → 20 天 → 100 天），
 * 线性刻度会把所有长间隔全挤在右端、彼此看不出差别 —— 那这张图就白画了。
 * 颜色按课题分配，同一课题同色，正好把"交错复习"（相邻不重复课题）看出来。
 * @param {Array} interleaved 到期的卡（已交错排好）
 * @param {number} now
 * @param {object} [opts] {upcoming:boolean} —— 今天没有到期的卡时，显示"接下来该复习的"。
 *        不这么干的话，第一课刚上完这张图**永远看不见**（新卡都在 3 天后才到期），
 *        界面只剩一句"今天没有到期的卡"，等于这张图白做了。
 */
function queueTimelineHtml(interleaved, now, opts) {
  const o = opts || {};
  const items = Array.isArray(interleaved) ? interleaved : [];
  if (!items.length) {
    return '<div style="font-size:12px;color:#6b6355;margin-top:8px">还没有排上复习的卡——上完一课，这里就会开始排。</div>';
  }
  const days = items.map((c) => Math.max(1, Math.round(((Number(c.dueAt) || now) - now) / 86400000)));
  // ⚠️ 刻度**锚在绝对天数**（1 天…1 年），不按本组最大值归一化。
  //    归一化的话，"这一课的三张卡都是 3 天后"会被全画成 100% —— 长度就不携带任何量级信息，
  //    跨课也没法比（上一课的 100% 和这一课的 100% 不是一回事）。绝对刻度才能一眼读出"这张是 3 天，那张是 1 年"。
  const SCALE_MAX_DAYS = 365;
  const scale = (d) => Math.max(4, Math.round(100 * Math.log(1 + d) / Math.log(1 + SCALE_MAX_DAYS)));
  const topics = [...new Set(items.map((c) => String(c.topic || '一课')))];
  const colorOf = (t) => LINE_COLORS[Math.abs(hashStr(t)) % LINE_COLORS.length];

  const rows = items.map((c, i) => {
    const late = !!c.overdue;
    // 逾期的不算"还有几天"（负数没意义），直接压到 0 → 条最短 + 标红，
    // 视觉上就是"最该现在复习的排最前"。若沿用 Math.max(1,...)，逾期会和"1 天后"长得一样。
    const d = late ? 0 : Math.max(1, Math.round((Number(c.dueAt) - now) / 86400000));
    const lateDays = late ? Math.max(1, Math.round((now - (Number(c.dueAt) || now)) / 86400000)) : 0;
    return '<div class="tl-row">'
      + '<span class="tl-name" title="' + escapeHtml(c.concept) + '">' + escapeHtml(c.concept) + '</span>'
      + '<span class="tl-track"><i style="width:' + scale(d) + '%;background:' + colorOf(c.topic) + '"></i></span>'
      + '<span class="tl-days' + (late ? ' tl-due' : '') + '">' + (late ? '已到期 ' + lateDays + ' 天' : d + ' 天后') + '</span>'
      + '</div>';
  }).join('');

  const legend = topics.map((t) => '<span><i style="background:' + colorOf(t) + '"></i>' + escapeHtml(t) + '</span>').join('');
  // 刻度尺：把"条长"翻译成天数。没有它，条长只是相对长短，读不出量级。
  const RULER = [1, 7, 30, 90, 365];
  const ruler = '<div class="tl-axis"><span class="sp"></span><span class="ruler">'
    + RULER.map((d) => '<i style="left:' + scale(d) + '%">' + (d === 365 ? '1年' : d + '天') + '</i>').join('')
    + '</span><span class="sp2"></span></div>';
  return (o.upcoming
      ? '<p class="chart-cap" style="color:#7a2c20;font-weight:600">今天没有到期的卡 —— 下面是接下来该复习的，按时间排。</p>'
      : '')
    + '<p class="chart-cap">按"回忆概率掉到 90%"定下次复习时刻。条长用<b>对数刻度、锚在 1 天到 1 年</b>'
    + '（线性刻度会让长间隔全挤在右端看不出差别；锚绝对值才能跨课比较）。'
    + '相邻几张来自不同课题（交错复习），颜色即课题。</p>'
    + (legend ? '<div class="legend">' + legend + '</div>' : '')
    + '<div class="tl">' + rows + '</div>'
    + ruler;
}

/**
 * 课前尝试 × 讲解：左"你自己猜的" / 右"先生讲的（你碰到了几个）"。
 * 原来这两边是上下两段文字，看不出"差在哪儿"；并排才构成一次对照。
 */
function preDiffHtml(cons, ev) {
  const cover = (ev && ev.conceptCover) || [];
  const attempts = (cons && cons.attempts) || [];
  const left = attempts.map((a) => '<li>' + a.index + '. 「' + escapeHtml(a.gist) + '」'
    + (a.touched && a.touched.length
      ? '<br><span class="hit">当时碰到：' + a.touched.map((t) => escapeHtml(String(t).slice(0, 10))).join('、') + '</span>'
      : '')
    + '</li>').join('');
  const right = cover.map((c) => {
    const got = Number(c.hit) >= 0.2;
    return '<span class="' + (got ? 'hit' : 'gap') + '">' + (got ? '✓ ' : '○ ') + escapeHtml(c.concept) + '</span>';
  }).join('');
  const got = cover.filter((c) => Number(c.hit) >= 0.2).length;
  const pct = cover.length ? Math.round(got / cover.length * 100) : 0;
  return '<div class="diff">'
    + '<div><h4>你课前的那两次尝试</h4><ol>' + (left || '<li>（这次没留下尝试）</li>') + '</ol></div>'
    + '<div><h4>先生这段讲的 · 你课前碰到了几个</h4><div class="cchips">'
    + (right || '<span class="gap">（这次没提炼出概念）</span>') + '</div></div>'
    + '</div>'
    + '<div class="gapbar"><span>课前先摸到 ' + got + '/' + cover.length + ' 个</span>'
    + '<span class="t"><i style="width:' + pct + '%"></i></span><span>' + pct + '%</span></div>';
}

/** 长段解释收进折叠区：默认不摊开，想深究的人再点。 */
function whyHtml(summary, body) {
  return '<details class="why"><summary>' + escapeHtml(summary) + '</summary><div class="body">' + body + '</div></details>';
}

function renderWork(ev){
  const g = ev.gains || {}, m = ev.minutes || {};
  const title = ev.lessonTitle || '这一课';
  $('wkTitle').textContent = '《'+title+'》课堂纪要';
  // 人话优先：这里给的是"这节课发生了什么"，不摊内部指标（R̄/σ²/技术状态见下面的课后总结与角标）
  const bits = ['你和 5 名学生聊了 '+((ev.rounds||[]).length)+' 轮'];
  bits.push('这份纪要由他们的发言整理而成');
  $('wkSub').textContent = bits.join(' · ');
  $('wkPath').textContent = m.path ? ('已落盘：'+m.path) : (m.error ? ('纪要落盘异常：'+m.error) : '');
  $('wkMd').innerHTML = mdToHtml(m.md || '（本次没有生成纪要）');
  $('gPts').textContent = g.points!=null ? g.points : '–';
  $('gRep').textContent = g.replies!=null ? g.replies : '–';
  $('gClr').textContent = g.clarifying!=null ? (g.clarifying+'/'+(g.replies||0)) : '–';
  $('gRes').textContent = g.resolved!=null ? (g.resolved+'/'+((ev.students||[]).length||5)) : '–';
  $('gCmp').textContent = g.completeness!=null ? (g.completeness+'%') : '–';
  $('gV').textContent = Number(ev.V||0).toFixed(3);
  const bs = g.blindSpots||[];
  $('wkBlind').innerHTML = (bs.length
    ? '<b>学生没听明白、你这次还没答到的：</b><br>' + bs.map(b=>'· '+escapeHtml(b.name)+'：'+escapeHtml(b.q)).join('<br>')
    : '学生这一课没有留下悬着的问题——但这不等于他们全懂了，只说明你这次把话正好说到他们的疑问上了。')
    + whyHtml('这些数字是怎么算的',
      '"讲解完整度"是启发式自评：要点覆盖 40% + 疑惑解开 40% + 澄清型回答占比 20%，不是客观测评；'
      + 'R 与 σ² 同理，只作相对变化参考。本课 5 名学生与你的讲解已被接进灵境世界模型 ⟨S,R,M,T⟩；'
      + '课室上方悬浮的"教学能量场"是真实 3D 热传导 FTCS 演化，不是装饰。');
  // ===== 课后技能卡片组（用 World/热场数学把你的传授反哺成可复习的卡）=====
  try {
    const he = (typeof heat !== 'undefined' && heat) ? heat.energy() : 0;   // 实时热场能量 = 已注入的知识量
    const deck = buildDeck(ev, { heatEnergy: he, heatRef: HEAT_REF });
    lastDeck = deck;
    // 传授度量条：你的知识真的进了 AI 多少（0~1）
    $('kBar').style.width = Math.round(deck.transfer.K * 100) + '%';
    $('kVal').textContent = deck.transfer.K.toFixed(2);
    // 心流徽章（Flow 理论：挑战 vs 技能）
    const fb = $('flowBadge'); fb.textContent = deck.flow.label; fb.style.background = deck.flow.color;
    $('flowAdvice').textContent = deck.flow.advice;
    // 卡片网格：点开翻面（正面=回顾提问，背面=要点 + 学生原话 dark knowledge）
    const deckEl = $('deck'); deckEl.innerHTML = '';
    (deck.cards || []).forEach((c) => {
      const el = document.createElement('div'); el.className = 'card';
      // 打上概念 key，便于知识库算完 DSR 排期后回填（避免两套复习时间打架）
      el.setAttribute('data-key', String(c.concept||'').replace(/[「」“”'']/g,'').replace(/\s+/g,' ').trim().slice(0,24));
      el.innerHTML =
        '<div class="ctop"><span class="ctitle">' + escapeHtml(c.concept) + '</span>' +
        '<span class="ctag">难度 ' + c.difficulty + '</span></div>' +
        '<div class="cbody"><span class="flip">▸ 回顾：</span>' + escapeHtml(c.front) + '</div>' +
        '<div class="cmeta">AI 已吃透 ' + Math.round(c.mastery * 100) + '% · 复习 ' + c.nextDue + ' 天后</div>';
      el.title = '点开看要点（背面）';
      el.onclick = () => {
        const body = document.createElement('div');
        body.className = 'cbody';
        body.innerHTML = '<span class="flip">▾ 要点：</span>' + escapeHtml(c.back) +
          (c.studentVoice ? '<br><span style="color:#8a7f6a">学生原话：' + escapeHtml(c.studentVoice) + '</span>' : '') +
          '<br><span style="color:#9a8f78">间隔复习：' + c.schedule.join(' → ') + ' 天</span>';
        const old = el.querySelector('.cbody');
        if (old) old.replaceWith(body);
        el.onclick = null;
      };
      deckEl.appendChild(el);
    });
    $('deckNote').innerHTML = escapeHtml(deck.worldRef.note) +
      whyHtml('卡片是怎么来的',
        '卡片由课堂实录确定性提炼，只作回顾用、非客观测评；'
        + '"AI 已吃透"来自 World 里该概念的知识态均值，是启发式信号。');
  } catch (e) {
    $('deckNote').textContent = '技能卡片生成失败：' + (e && e.message || e);
  }

  // ===== 最后一课总结（给人类的"理论感"：把实践升维成数学结构）=====
  try {
    const he = (typeof heat !== 'undefined' && heat) ? heat.energy() : 0;
    const sum = buildSummary(ev, { heatEnergy: he, heatRef: HEAT_REF });
    lastSummary = sum;
    // 四感
    const SENSE_COLOR = { experience:'#5b3a8a', game:'#2f6f4f', practice:'#b06a1a', theory:'#1f5b8a' };
    const se = $('senses'); se.innerHTML = '';
    ['experience','game','practice','theory'].forEach((k)=>{
      const s = sum.senses[k];
      const el = document.createElement('div'); el.className='sense';
      el.innerHTML = '<div class="sv" style="color:'+(SENSE_COLOR[k]||'#5b3a8a')+'">'+Math.round(s.value*100)+'%</div>'+
        '<div class="sl">'+s.label+'</div>'+
        '<div class="sbar"><i style="width:'+Math.round(s.value*100)+'%;background:'+(SENSE_COLOR[k]||'#5b3a8a')+'"></i></div>';
      se.appendChild(el);
    });
    // 数学地图
    const rows = sum.theory.map(t=>'<tr><td>'+escapeHtml(t.branch)+'</td><td>'+escapeHtml(t.math)+'</td><td>'+escapeHtml(String(t.value))+'</td><td>'+escapeHtml(t.meaning)+'</td></tr>').join('');
    $('sumTheory').innerHTML = '<table><thead><tr><th>数学分支</th><th>数学对象</th><th>你的值</th><th>对你意味着什么</th></tr></thead><tbody>'+rows+'</tbody></table>';
    // 下一步
    const nxt = [];
    nxt.push('1. 挑<b>枢纽概念</b>（第 '+(sum.graph.hubs.map(h=>h+1).join('、')||'—')+' 个），用一句"所以"把它和<b>根概念</b>连起来——这就补上了你的证明骨架。');
    if (sum.kl > 0.3 && sum.worstConcept >= 0) nxt.push('2. 第 '+(sum.worstConcept+1)+' 个概念你讲得最多、学生吃得最少，换一个生活类比重讲一遍。');
    nxt.push((sum.kl>0.3?'3. ':'2. ')+'按卡片的复习时刻回看，让这次实践沉到长期记忆里。');
    $('sumNext').innerHTML = nxt.join('<br>');
    $('sumNote').innerHTML = whyHtml('这份总结的诚实边界', escapeHtml(sum.honest));
  } catch (e) {
    $('sumNote').textContent = '课后总结生成失败：' + (e && e.message || e);
  }

  // ===== 课前尝试 × 讲解的对照（Kapur：failure without consolidation is just failure）=====
  try {
    const pw = $('preWrap');
    if (preState && preState.ev && (preState.attempts || []).length && !preState.skipped) {
      const cons = consolidationNotes(preState.pre, preState.ev, preState.attempts);
      // 左「你猜的」/ 右「先生讲的」并排 —— 上下两段文字看不出"差在哪儿"，并排才构成对照
      $('preBox').innerHTML = preDiffHtml(cons, preState.ev);
      $('preNote').innerHTML = escapeHtml(cons.instruction)
        + whyHtml('这个对照怎么来的', escapeHtml(cons.honest)
          + ' 左栏是你课前的原话；右栏的 ✓/○ 是按「你当时的用词碰到了这个概念没有」算的'
          + '（2-gram 覆盖率 ≥ 0.2 算碰到），不是语义理解判断。');
      pw.style.display = '';
    } else {
      pw.style.display = 'none';   // 这一课没做课前探索 → 不显示，也不编
    }
  } catch (e) {
    $('preNote').textContent = '课前对照生成失败：' + (e && e.message || e);
  }

  // ===== 顿悟峰：从课堂时序里认出"卡住 → 跃迁"（峰终定律里的"峰"）=====
  try {
    const pk = detectPeaks(clsTurns);
    const box = $('peakBox');
    // 先画曲线：有峰没峰都画。把"卡住 → 跃迁"画出来，比写一句"卡了 2 轮之后…"信息量大得多
    $('peakChart').innerHTML = peakChartSvg(clsTurns, pk.peakCount ? pk.strongest : null);
    if (pk.peakCount) {
      const p = pk.strongest;
      box.className = 'peakbox';
      box.innerHTML =
        '<span class="who">' + escapeHtml(p.student) + (p.reachedClear ? ' 通了' : ' 一下跟上了') + '</span>' +
        ' · 第 ' + p.round + ' 轮<br>' +
        '卡了 ' + p.stuckRounds + ' 轮之后，从「还糊涂」到「' + (p.reachedClear ? '通了' : '有点明白') + '」。' +
        (p.say ? '<br><span class="sub">他当时说：' + escapeHtml(p.say) + '</span>' : '');
    } else {
      box.className = 'peakbox none';
      box.textContent = pk.narrative;
    }
    $('peakNote').innerHTML = whyHtml('为什么这么算（点开看判据）',
      '峰是<b>检测</b>出来的，不是<b>制造</b>出来的——只有真的出现「卡住 → 跃迁」才算；'
      + '没有就如实说没有，不硬造高潮。判据：疑惑解开度 R &lt; 0.45 算"还糊涂"（图上那条虚线），'
      + '单轮涨 ≥ 0.18 算"跃迁"。峰强＝幅度 ⊕ log 尺度的卡住时长 ⊕ 意外度；'
      + '说了"哦原来"这类破题话再乘 1.15（只加成、不惩罚）。'
      + '图上的细线是 5 名学生各自，粗线是全班均值。');
  } catch (e) {
    $('peakNote').textContent = '峰检测失败：' + (e && e.message || e);
  }

  // ===== 跨课知识库：把这一课并进累积的个人知识库（复利感的来源）=====
  try {
    const stored = loadJournal();
    const res = upsertJournal(stored, { topic: title, at: Date.now(), summary: lastSummary, deck: lastDeck });
    lastJournal = res.journal;
    saveJournal(lastJournal);
    const q = reviewQueue(lastJournal, Date.now());
    const gl = growthLine(lastJournal, Date.now());
    $('jGrowth').textContent = gl.text;
    // 复习队列本质是一条时间轴：原来是 5 列表格，把"什么时候该复习"的时间感读没了。
    // 今天没有到期的卡时，退而显示"接下来该复习的"——否则第一课刚上完这张图永远看不见
    // （新卡都在几天后才到期），界面只剩一句"今天没有到期的卡"，图就白做了。
    const qDue = q.interleaved && q.interleaved.length ? q.interleaved : (q.upcoming || []);
    $('jQueue').innerHTML = queueTimelineHtml(qDue, Date.now(), { upcoming: !(q.interleaved && q.interleaved.length) });
    $('jStats').innerHTML =
      '<div><b>' + gl.metrics.cards + '</b> 个概念</div>' +
      '<div><b>' + gl.metrics.topics + '</b> 个课题</div>' +
      '<div><b>' + gl.metrics.memoryAssetDays + '</b> 天记忆资产</div>' +
      '<div><b>' + gl.metrics.reviewsTotal + '</b> 次复习</div>';
    $('jNote').innerHTML = whyHtml('为什么这么排（点开看模型与边界）',
      '排期用 FSRS 的 DSR 记忆模型（R(t)=(1+F·t/S)^DECAY），按"回忆概率掉到 90%"定下次复习；'
      + '队列是<b>交错</b>排的（相邻几张来自不同课题），因为混着复习比按课题成堆复习记得更牢（Dunlosky 2014）。'
      + '这是公开模型的简化骨架，不是 FSRS 的 17 参数拟合版。'
      + '数据只存在你这台机器的浏览器里，不联网、不上传。');
    // 回填：让卡片上的"复习 N 天后"与知识库的 DSR 排期一致
    // （卡片模块原用固定序列 [1,2,4,7,15,30,60]，知识库用 DSR —— 两套时间必须在界面上统一）
    document.querySelectorAll('#deck .card').forEach((el) => {
      const key = el.getAttribute('data-key');
      const c = lastJournal.cards.find((x) => x.key === key);
      if (!c || c.dueAt == null) return;
      const meta = el.querySelector('.cmeta');
      if (meta) {
        const days = Math.max(1, Math.round((c.dueAt - Date.now()) / 86400000));
        meta.textContent = meta.textContent.replace(/复习 \d+ 天后/, '复习 ' + days + ' 天后');
      }
    });
  } catch (e) {
    $('jNote').textContent = '知识库更新失败：' + (e && e.message || e);
  }

  lastWork = { title, md: m.md || '' };
  $('work').classList.add('on');
}

// 读一条 SSE 流（start / reply 共用）
async function streamClass(url, body){
  const resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if(!resp.ok || !resp.body) throw new Error('HTTP '+resp.status);
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while(true){
    const {done, value} = await reader.read(); if(done) break;
    buf += dec.decode(value, {stream:true});
    let idx;
    while((idx = buf.indexOf('\n\n')) >= 0){
      const chunk = buf.slice(0, idx); buf = buf.slice(idx+2);
      const line = chunk.split('\n').find(l=>l.startsWith('data: '));
      if(line) handleEvent(JSON.parse(line.slice(6)));
    }
  }
}

// 老师开口讲第一段 → 开课
async function startClass(text){
  if(phase==='busy' || !text) return;
  phase='busy'; setBusy(true); $('error').style.display='none';
  $('work').classList.remove('on');
  $('chips').style.display='none';
  showTeacherSay(text);                     // 你上讲台说的第一段，直接出现在教室里
  transcript.push('你：'+text);
  try{ await streamClass('/api/class/start', { lesson: text }); }
  catch(e){ showErr('出错了：'+(e.message||e)); }
  finally{ setBusy(false); if(phase==='busy') phase='idle'; }
}
// 老师回话（text 为空即"跳过"，让学生继续）
async function tellStudents(text){
  if(!sessionId || phase==='busy') return;
  phase='busy'; setBusy(true); setBar('hide');
  if(text){ transcript.push('你：'+text); showTeacherSay(text); }
  try{ await streamClass('/api/class/reply', { id: sessionId, text: text||'' }); }
  catch(e){ showErr('出错了：'+(e.message||e)); }
  finally{ setBusy(false); if(phase==='busy') phase='reply'; }
}
// 最后一轮：让服务端收尾 emit done
function finishClass(){
  if(finishing) return; finishing = true;
  setBar('hide');
  if(sessionId) streamClass('/api/class/reply', { id: sessionId, text: '' }).catch(()=>{});
}
// 语音输入（同一支话筒：课前说课题，课中说回答）
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!SR){ micBtn.disabled=true; micBtn.title='当前浏览器不支持语音（请用 Chrome/Edge）'; }
else{ const rec=new SR(); rec.lang='zh-CN'; rec.continuous=true; rec.interimResults=false; let on=false;
  rec.onresult=e=>{ let t=''; for(let i=e.resultIndex;i<e.results.length;i++) t+=e.results[i][0].transcript;
    replyText.value=(replyText.value?replyText.value+' ':'')+t.trim(); };
  rec.onerror=()=>{ micBtn.textContent='🎤 语音讲'; on=false; };
  rec.onend=()=>{ on=false; micBtn.textContent='🎤 语音讲'; };
  micBtn.onclick=()=>{ if(phase==='busy') return; if(on){ rec.stop(); return; } try{ rec.start(); on=true; micBtn.textContent='⏹ 停止'; }catch{} };
}

// ===== 课前：生产性失败探索（Kapur 的 PS-I 设计）=====
// 写下课题后**不立刻开课**，先让人类自己答两次。依据：先挣扎、后讲解，理解更深
//   （Kapur 2014 d=2.25；ETH 线性代数 650 人课通过率 +20%；ALTER-Math 5 万学生增益 1.56×）。
// 硬条件（缺一个就白做）：① 问题真的超出当前能力 ② 至少两次**真实**尝试 ③ 有足够先验
//                        ④ 讲解必须接在尝试上（课后有对照面板）
// ⚠️ 但**绝不挡人**：讲台条照常可用，"跳过，直接讲"随时可点 —— 守住"一打开就是教室"这条铁律。
function splitLesson(t){
  const s = String(t||''); const i = s.indexOf('::');
  if(i < 0) return { topic: s.slice(0,14), text: s };
  return { topic: s.slice(0,i).trim(), text: s.slice(i+2).trim() };
}
function conceptsOf(text){
  const t = String(text||'');
  const parts = t.split(/[。！？；\n]+/).map(s=>s.trim()).filter(Boolean);
  if(parts.length >= 3) return parts.slice(0,5);
  const byComma = t.split(/[，,、]+/).map(s=>s.trim()).filter(Boolean);
  if(byComma.length >= 3) return byComma.slice(0,5);
  return [t.slice(0,20) || '这一课'];
}
function probeFbHtml(ev){
  const c = ({
    'one-attempt':'还差一次。换一个**完全不同的角度**——不是把上一条改写，是换一条路走。',
    'not-genuine':'这几句还不算"尝试"。不用答对，把你**确定的那部分**先写下来，再从那里往外推。',
    'no-prior':'你对这个课题的先验还太少。硬答会变成"干瞪眼"而不是生产性失败（Kapur 的前提是有足够先验）——可以先补点背景，或者直接开讲。',
    'shallow':'两次尝试基本是同一个角度。真探索的标志是**两次走的是不同的路**。',
    'no-attempt':'先写一句试试。',
    'ready':'两次不同角度的尝试，够了。',
  })[ev.verdict] || '';
  return '<b>已尝试 '+ev.genuineCount+' 次</b> · '+c;
}
function beginExplore(t){
  const L = splitLesson(t);
  const concepts = conceptsOf(L.text);
  const pre = buildPreTest(L.topic, L.text, concepts);
  preState = { pre, attempts:[], ev:null, skipped:false, lesson:L.text, topic:L.topic, concepts };
  phase = 'explore';
  $('probe').classList.add('on');
  $('pStep').textContent = '第 1 次尝试 · 答不全是正常的';
  $('pQ').textContent = (pre.probes[0]||{}).ask || '';
  $('pFb').classList.remove('on'); $('pFb').innerHTML = '';
  $('askWho').textContent = '先猜';
  $('replySend').textContent = '提交尝试';
  $('replySkip').style.display = 'none';
  $('chips').style.display = 'none';
  replyText.placeholder = '写下你的第一次尝试（不用对，写你确定的那部分就行）…（回车＝提交）';
  replyText.value = ''; replyText.focus();
}
function goPreready(skipped){
  phase = 'preready';
  $('probe').classList.remove('on');
  askbar.classList.add('on');
  $('chips').style.display = 'none';
  $('replySkip').style.display = 'none';
  $('askWho').textContent = '讲台';
  $('replySend').textContent = '开始上课';
  replyText.placeholder = '把你要讲的这一课完整说出来…（回车＝开始上课）';
  replyText.value = ''; replyText.focus();
  if(skipped) $('boardSub').textContent = '你站在讲台上 · 这一课跳过了课前探索';
}
function submitAttempt(t){
  if(!preState || !t) return;
  preState.attempts.push({ text:t, at:Date.now() });
  const ev = evaluateExploration(preState.topic, preState.concepts, preState.attempts, { lessonText: preState.lesson });
  preState.ev = ev;
  $('pFb').innerHTML = probeFbHtml(ev); $('pFb').classList.add('on');
  replyText.value = '';
  if(preState.attempts.length < preState.pre.minAttempts){
    $('pStep').textContent = '第 2 次尝试 · 换个完全不同的角度';
    $('pQ').textContent = (preState.pre.probes[1] || preState.pre.probes[0] || {}).ask || '';
    replyText.focus(); return;
  }
  if(ev.ready){
    $('pStep').textContent = '够了 · 去讲吧';
    $('pQ').textContent = '两次不同角度的尝试已经到位。现在把这一课完整讲出来——课后我会把你这两次尝试和讲解摆在一起对照。';
    $('pSkip').textContent = '直接讲（已探索）';
    goPreready(false);
    $('probe').classList.add('on');   // 保留这张卡把话说完
    return;
  }
  // 还没达标：留在探索阶段（可继续试，也可随时跳过）——不卡死人是底线
  const n = preState.attempts.length;
  $('pStep').textContent = '再来一次（第 ' + (n+1) + ' 次）· 或者跳过直接讲';
  $('pQ').textContent = (preState.pre.probes[n % Math.max(1,preState.pre.probes.length)] || preState.pre.probes[0] || {}).ask || '';
  replyText.focus();
}
$('pSkip').onclick = () => {
  if(!preState || (phase!=='explore' && phase!=='preready')) return;
  preState.skipped = true;
  $('probe').classList.remove('on');
  goPreready(true);
};

function onSend(){
  const t=replyText.value.trim();
  if(phase==='busy'||phase==='done') return;
  if(phase==='idle'){ if(t) beginExplore(t); return; }
  if(phase==='explore'){ if(t) submitAttempt(t); return; }
  if(phase==='preready'){ if(t) { $('probe').classList.remove('on'); startClass(t); } return; }
  tellStudents(t);
}
$('replySend').onclick=onSend;
$('replySkip').onclick=()=>{ if(phase==='reply') tellStudents(''); };
replyText.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); onSend(); } });
$('chips').addEventListener('click',e=>{
  const a=e.target.closest('a[data-demo]'); if(!a || phase!=='idle') return;
  const t=a.getAttribute('data-demo')||'';
  beginExplore(t);   // 先让人类自己猜两次（生产性失败），再开讲
});
$('again').onclick=()=>location.reload();
// 课后回顾 ↔ 课室：双向都能走。关掉回顾不是"关闭弹窗"，是回到那间还有学生的教室。
$('closeWork').onclick=()=>{ $('work').classList.remove('on'); $('reopen').style.display='block'; };
$('reopen').onclick=()=>{ $('reopen').style.display='none'; $('work').classList.add('on'); };
$('copyMd').onclick=async()=>{
  if(!lastWork) return;
  const done=()=>{ $('copyMd').textContent='已复制 ✓'; setTimeout(()=>{ $('copyMd').textContent='复制这份纪要'; }, 1800); };
  try{ await navigator.clipboard.writeText(lastWork.md); done(); }
  catch{
    const tmp=document.createElement('textarea'); tmp.value=lastWork.md;
    document.body.appendChild(tmp); tmp.select();
    try{ document.execCommand('copy'); done(); }catch{ $('copyMd').textContent='复制失败，请手动选中'; }
    document.body.removeChild(tmp);
  }
};
$('dlMd').onclick=()=>{
  if(!lastWork) return;
  const blob=new Blob([lastWork.md],{type:'text/markdown;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='《'+lastWork.title+'》课堂纪要.md'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
};
$('dlDeck').onclick=()=>{
  if(!lastDeck) return;
  const blob=new Blob([deckToMarkdown(lastDeck)],{type:'text/markdown;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='《'+lastDeck.title+'》技能卡片组.md'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
};
$('dlSum').onclick=()=>{
  if(!lastSummary) return;
  const blob=new Blob([summaryToMarkdown(lastSummary)],{type:'text/markdown;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='《'+lastSummary.title+'》课后总结.md'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
};
$('dlJournal').onclick=()=>{
  if(!lastJournal) lastJournal = loadJournal();
  if(!lastJournal) return;
  const blob=new Blob([journalToMarkdown(lastJournal)],{type:'text/markdown;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='我的知识库.md'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000);
};

// ===== 打开页面 = 已经坐在/站在教室里（不是先弹一个文字面板）=====
// 先把 5 名学生摆进教室，再等老师开口。名单来自 GET /api/roster（静态人设）。
// 诚实标注：LLM 状态分四档（verified/unverified/no-key/circuit-open），不谎称"真 LLM 学生在场"。
function llmLine(llm){
  switch((llm||{}).state){
    case 'verified':      return '真 LLM 学生在场 · '+(llm.model||'');
    case 'unverified':    return 'LLM 已配置（首次调用前不保证可用；额度用尽会自动走兜底语料）';
    case 'no-key':        return '未配置 LINGJING_OR_KEY · 学生走兜底语料（课堂流程与体验照常）';
    case 'circuit-open':  return 'LLM '+((llm&&llm.reason)||'额度/限流熔断中')+' · 学生走兜底语料';
    default:              return (llm&&llm.usable) ? 'LLM 可用' : 'LLM 状态未知';
  }
}
async function boot(){
  setBar('idle');
  try{
    const r = await (await fetch('/api/roster')).json();
    buildStudents((r.students && r.students.length) ? r.students : FALLBACK_ROSTER);
    $('status').textContent = llmLine(r.llm);
  }catch(e){
    buildStudents(FALLBACK_ROSTER);
    $('status').textContent = '名单读取失败（'+((e&&e.message)||e)+'）· 已用本地名单摆好 5 名学生';
  }
}
boot();

// Three.js 加载失败兜底
setTimeout(()=>{ if(!window.THREE_OK && typeof THREE==='undefined'){ $('loaderr').style.display='flex'; } }, 4000);
