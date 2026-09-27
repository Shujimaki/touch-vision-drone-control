// Tablet web app, ported from the interface mockup (jaz-villanueva/Thesis-UI-Mockup) without changing its layout,
// look or behaviour. The flight host, drones and Multi-ranger are still simulated in the page (DEC-18); the bridge
// connection (protocol v1) replaces the simulation in a later roadmap part.
import { BAT_CRIT, BAT_LOW, BAT_LOW_S, SAG_MAX, batteryLevel } from "./lib/battery";
import { clamp, segCross, segHitsRect, segMinDist } from "./lib/geometry";
import { U, fmtMS, fmtT, sg } from "./lib/format";
import type { GestureRecognizer } from "@mediapipe/tasks-vision";

type Vec3 = [number, number, number];
type LogKind = "info" | "ok" | "warn" | "crit";
type Dir = "front" | "right" | "back" | "left" | "up";
type Gesture = "idle" | "confirming" | "climb" | "descend" | "locked" | "lost" | "unrecognized";
type Outcome = "completed" | "collision" | "timeout" | "hardware_abort";
interface Box { id: string; x: number; y: number; hx: number; hy: number; h: number }
interface Hoop { id: string; x: number; y: number; type?: "horizontal"; ang?: number; z: number; r: number }
interface DroneCfg { id: string; n: number; x: number; y: number; z: number; vbat: number; link: number; yaw: number }
interface Health { motorPass: boolean[]; sag: number; batPass: boolean; at: number }
interface Drone extends DroneCfg {
  tx: number; ty: number; vx: number; vy: number; vz: number; roll: number; pitch: number;
  pHeld: boolean; latched?: boolean; zTarget: number | null; landing: boolean; clampMax: boolean; clampMin: boolean;
  trail: Vec3[]; ranges: Partial<Record<Dir, number | null>>; dh: { dir: Dir; range: number } | null;
  crashed: boolean; tumbled?: boolean; below?: { dist: number; what: string } | null; health?: Health | null;
  lowT?: number; landT?: number; mvx?: number; mvy?: number; blocked?: string | null; blockPt?: [number, number] | null;
  dragStart?: [number, number]; dragMoved?: boolean; nfzFlag?: boolean;
}
interface Trial { n: number; running: boolean; t0: number; dh: number; restrict: number; last: TrialRecord | null; prog?: Record<string, number>; home?: Record<string, boolean> }
type SimToggle = "simHold" | "degraded" | "lowBatt" | "motorFault" | "cf3Lost" | "proximity";
interface State {
  liveRate: number; t: number; gesture: Gesture; beforeConfirm: Gesture; simHold: boolean; degraded: boolean; lowBatt: boolean;
  motorFault: boolean; cf3Lost: boolean; proximity: boolean; stopped: boolean; log: LogEntry[]; prox: Map<string, number>; wob: number;
  video: string; holdOrder: string[]; altBlock: { d: Drone; why: string } | null; altBlockKey: string | null; appliedRate: number;
  trial: Trial; session: number; curTrial: string; trials: TrialRecord[]; logView: string; logSes: string; alert?: string | null; frameErr?: boolean;
}
interface Landmark { x: number; y: number; z: number }
type OptToggle = "trails" | "feeds" | "course" | "lefty" | "latch" | "light";
interface Step { get: () => number; set: (v: number) => void; step: number; lo: number | (() => number); hi: number | (() => number); fmt: (v: number) => string; name: string }
interface SyncItem { id: string; what: string; get: () => number[]; set: (v: number[]) => void }
interface SyncRow extends SyncItem { now: number[]; m: number[]; dcm: number }
interface LogEntry { t: number; text: string; k: LogKind; ses: string; tr: string }
interface TrialRecord { id: string; session: string; t0: number; t1: number | null; outcome: Outcome | null; elapsed: number; dh: number; restrict: number }
type Pal = Record<"bg" | "panel" | "line" | "line2" | "tx" | "tx2" | "tx3" | "grn" | "grnDim" | "friend" | "own" | "sel" | "selDim" | "caut" | "crit" | "critBg" | "tagBg" | "iconFill" | "iconTx" | "heldTx" | "grid0" | "gridMaj" | "gridMin" | "arena" | "boxFill" | "boxLine", string> & { threatA: number[] };
declare global {
  interface Window { __ready?: boolean }
  interface Navigator { standalone?: boolean }
  interface Document { webkitFullscreenElement?: Element | null }
  interface HTMLElement { webkitRequestFullscreen?: (opts?: FullscreenOptions) => Promise<void> }
}

/* =====================================================================
   MOCK DATA
   ===================================================================== */
const CONFIG:{arena:{xMin:number;xMax:number;yMin:number;yMax:number;margin:number};z:{min:number;max:number;displayMax:number};nfz:{x:number;y:number;h:number};
  boxes:Box[];hoops:Hoop[];zoneMargin:number;droneBuf:number;droneVsep:number;rateMax:number;hSpeed:number;proxWarn:number;proxCrit:number;takeoffZ:number;lowBatt:number;
  padTol:number;timeLimit:number;sessionStart:number;timelineSec:number;drones:DroneCfg[];initialLog:[number,string,LogKind][];layout?:{source:string;synced:string;bodies:number}}={
  arena:{xMin:0,xMax:5.31,yMin:0,yMax:3.55,margin:0.25},   // Miguel 409: 531 x 355 cm, origin at room corner (Fig. 5); 0.25 m capture-volume margin is a placeholder
  z:{min:0.50,max:1.44,displayMax:2.00},   // 0.5 m flight floor (SO2); 1.44 m "all cams" ceiling (Figs. 5-7) until the capture volume is measured
  nfz:{x:2.655,y:1.775,h:0.59},   // 118 cm restricted zone at the room centre (§1.7.6 prose; Fig. 5 draws it ~11 cm lower)
  boxes:[{id:"O1",x:1.31,y:1.56,hx:0.265,hy:0.255,h:1.02},{id:"O2",x:2.60,y:2.71,hx:0.265,hy:0.255,h:1.53}],   // balikbayan stacks 53x51 cm
  hoops:[{id:"H1",x:1.31,y:2.70,type:"horizontal",z:1.00,r:0.20},{id:"H2",x:3.99,y:2.70,ang:90,z:0.50,r:0.20},{id:"H3",x:3.99,y:1.49,ang:90,z:1.50,r:0.20}],   // 40 cm hoops
  zoneMargin:0.06,
  droneBuf:0.20,droneVsep:0.10,   // drag buffer between drones at similar height (two 0.05 m bodies plus margin); placeholders   // targets stay this far outside the restricted zone (protocol v1 zone_margin placeholder)
  rateMax:0.20,hSpeed:1.0,proxWarn:0.25,proxCrit:0.15,takeoffZ:0.60,lowBatt:20,
  padTol:0.15,     // placeholder: a drone counts as back on its start position within 15 cm, half the 30 cm pad spacing (§1.7.6)
  timeLimit:300,   // placeholder: the proposal sets it from two expert pilots' mean times x 2 (§1.7.4)
  sessionStart:12*60+31,timelineSec:300,
  drones:[
    {id:"cf1",n:1,x:2.35,y:0.45,z:0,vbat:4.02,link:98,yaw:20},
    {id:"cf2",n:2,x:2.65,y:0.45,z:0,vbat:3.98,link:97,yaw:350},
    {id:"cf3",n:3,x:2.95,y:0.45,z:0,vbat:3.94,link:96,yaw:95}],
  initialLog:[[-151,"Session S1 started","info"],[-148,"MoCap lock, 3 of 3 rigid bodies","ok"],
    [-9,"Drones on start pads D1–D3, 30 cm spacing","ok"]]
};
// Map and gauge colours. Dark mode uses the tactical green accent; light mode uses an electric blue accent.
const PAL:{dark:Pal;light:Pal}={
  dark:{bg:"#0A0E0B",panel:"#181C18",line:"#2C342C",line2:"#3E483D",tx:"#E1E8DF",tx2:"#9DAA9B",tx3:"#687566",grn:"#5FD068",grnDim:"#1B2E1D",friend:"#5FD068",own:"#25C6E8",sel:"#F5D90A",selDim:"#D9C95A",caut:"#FF9A1F",crit:"#F2453D",
    critBg:"#1A0605",tagBg:"#0B100C",iconFill:"#121712",iconTx:"#FFFFFF",heldTx:"#07120A",grid0:"#101A12",gridMaj:"#1F3A24",gridMin:"#14231A",arena:"#3E8F46",boxFill:"#2B312B",boxLine:"#C9D1C7",threatA:[95,208,104]},
  light:{bg:"#F3F7FD",panel:"#FFFFFF",line:"#CCD8EA",line2:"#A9BCD9",tx:"#07132A",tx2:"#3C4E6B",tx3:"#7486A3",grn:"#0066FF",grnDim:"#E1ECFF",friend:"#0066FF",own:"#00A6C8",sel:"#E0147C",selDim:"#B0106A",caut:"#EA7300",crit:"#E5173F",
    critBg:"#FFECEF",tagBg:"#FFFFFF",iconFill:"#FFFFFF",iconTx:"#07132A",heldTx:"#FFFFFF",grid0:"#EDF3FC",gridMaj:"#A8C2EC",gridMin:"#DCE6F6",arena:"#0066FF",boxFill:"#DDE6F5",boxLine:"#1D2E4D",threatA:[0,102,255]}};
const K:Pal={...PAL.dark};

/* =====================================================================
   STATE + HELPERS
   ===================================================================== */
const S:State={liveRate:0,t:CONFIG.sessionStart,gesture:"idle",beforeConfirm:"idle",simHold:false,degraded:false,lowBatt:false,motorFault:false,cf3Lost:false,proximity:false,stopped:false,log:[],prox:new Map(),wob:0,video:"cf1",holdOrder:[],altBlock:null,altBlockKey:null,appliedRate:0,trial:{n:1,running:false,t0:0,dh:0,restrict:0,last:null},session:1,curTrial:"",trials:[],logView:"all",logSes:"all"};
let drones:Drone[]=[];const pointers=new Map<number,string>();
// every id looked up here exists in index.html
const $=<T extends HTMLElement=HTMLElement>(id:string):T=>document.getElementById(id) as T;
let SC=128,OX=300,OY=300,VW=600,VH=600;const px=(x:number)=>OX+x*SC,py=(y:number)=>OY-y*SC;
const isHeld=(d:Drone)=>d.pHeld||d.latched||(S.simHold&&(d.id==="cf1"||d.id==="cf2"));
const airborne=(d:Drone)=>d.z>0.08&&!S.stopped&&!d.crashed;
const gAct=()=>S.gesture==="climb"||S.gesture==="descend";
/* ---------- live camera + hand tracking ---------- */
const CAM:{on:boolean;stream:MediaStream|null;hands:GestureRecognizer|null;tracking:boolean;lm:Landmark[]|null;cat:string|null;lastFrame:number;busy:boolean;last:number;
  fps:number;fc:number;ft:number;neutral:number|null;conf:{t0:number;y0:number}|null;label:string;score:number;deviceId:string|null;mirror:boolean;devices:MediaDeviceInfo[]}={on:false,stream:null,hands:null,tracking:false,lm:null,cat:null,lastFrame:-1,busy:false,last:0,fps:0,fc:0,ft:0,neutral:null,conf:null,label:"",score:0,deviceId:null,mirror:true,devices:[]};
const GEST={confirmMs:500,still:0.04,dead:0.03,full:0.18,landHold:1.0};   // landHold: seconds of lowering at the floor before a gesture landing   // confirmation hold, steadiness, dead zone and full-rate displacement (fractions of frame height); placeholders (OPEN-07)
// MediaPipe Gesture Recognizer (DEC-06): the MediaPipe Hands landmark model (SO2) plus a landmark-based classifier
// with the built-in Open_Palm and Closed_Fist labels. Served from local files (README: no cloud dependency):
// tasks-vision 1.0.1 and gesture_recognizer.task float16 v1, SHA-256 97952348...b0482 as pinned in the README.
// WASM and model are placed in public/mediapipe by scripts/setup-mediapipe.mjs.
const MP_BASE=new URL("mediapipe",location.href).href,
      MP_MODEL=new URL("mediapipe/models/gesture_recognizer.task",location.href).href;
function camNote(t?:string){const n=$("camNote");if(!n)return;n.hidden=!t;n.textContent=t||"";}
function camIcon(on:boolean){const b=$("camBtn");b.classList.toggle("on",on);b.setAttribute("aria-pressed",String(on));b.setAttribute("aria-label",on?"Turn the hand camera off":"Turn the hand camera on");}
async function toggleCamera(){if(CAM.on){stopCamera();return;}await startCamera(CAM.deviceId);}
// open a real camera: a specific deviceId, else the front (user-facing) camera
async function startCamera(deviceId:string|null,quiet?:boolean){
  if(!window.isSecureContext||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){camNote("Camera needs a secure page. Open it over https (e.g. GitHub Pages) or from localhost.");return false;}
  const video=deviceId?{deviceId:{exact:deviceId},width:{ideal:640},height:{ideal:480}}:{facingMode:"user",width:{ideal:640},height:{ideal:480}};
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({video,audio:false});}
  catch(err){const n=(err as {name?:string}|null)?.name;
    if(!quiet)camNote(n==="NotAllowedError"?"Camera permission was denied. Allow camera access for this site in the browser (address-bar camera icon or site settings), then tap the camera icon.":n==="NotFoundError"?"No camera found on this device.":n==="NotReadableError"?"The camera is in use by another app. Close it, then tap the camera icon.":`Camera unavailable (${n||"error"}).`);
    return false;}
  CAM.stream&&CAM.stream.getTracks().forEach(t=>t.stop());CAM.stream=stream;
  const tr=stream.getVideoTracks()[0],st=tr.getSettings?tr.getSettings():{};
  CAM.deviceId=st.deviceId||deviceId||null;CAM.mirror=st.facingMode?st.facingMode!=="environment":!/back|rear|environment/i.test(tr.label||"");
  tr.addEventListener("ended",()=>{if(CAM.stream===stream){stopCamera();camNote("Camera disconnected. Tap the camera icon to reconnect.");}});
  const v=$<HTMLVideoElement>("camVideo");v.classList.toggle("mirror",CAM.mirror);v.srcObject=stream;v.hidden=false;await v.play().catch(()=>{});
  const was=CAM.on;CAM.on=true;
  camIcon(true);camNote("");
  try{CAM.devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput");}catch(e){CAM.devices=[];}

  if(!was){log(`Tablet camera on${tr.label?`, ${tr.label}`:""}`,"ok");loadHands();}else log(`Camera switched to ${tr.label||"next camera"}`);
  return true;}
function stopCamera(){CAM.stream&&CAM.stream.getTracks().forEach(t=>t.stop());CAM.stream=null;CAM.on=false;CAM.tracking=false;CAM.lm=null;
  const v=$<HTMLVideoElement>("camVideo");v.srcObject=null;v.hidden=true;camIcon(false);camNote("");log("Tablet camera off");}
// start the camera on load; if the browser wants a tap first, the camera icon stays available
async function autoCamera(){
  let state="prompt";try{state=(await navigator.permissions.query({name:"camera"})).state;}catch(e){}
  if(state==="denied"){camNote("Camera access is blocked for this site. Allow it in the browser's site settings, then tap the camera icon.");return;}
  await startCamera(null,true);}
async function loadHands(){if(CAM.hands){CAM.tracking=true;handLoop();return;}
  camNote("Loading MediaPipe Gesture Recognizer…");
  const fail=()=>camNote("Live video only: the gesture recognizer could not load. Gestures stay on the simulation controls.");
  let V:typeof import("@mediapipe/tasks-vision"),files:Awaited<ReturnType<typeof V.FilesetResolver.forVisionTasks>>;
  try{V=await import("@mediapipe/tasks-vision");files=await V.FilesetResolver.forVisionTasks(MP_BASE+"/wasm");}catch(e){fail();return;}
  const make=(delegate:"GPU"|"CPU")=>V.GestureRecognizer.createFromOptions(files,{baseOptions:{modelAssetPath:MP_MODEL,delegate},runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:0.6,minHandPresenceConfidence:0.6,minTrackingConfidence:0.5});
  try{CAM.hands=await make("GPU");}catch(e){try{CAM.hands=await make("CPU");}catch(e2){fail();return;}}
  CAM.tracking=true;camNote("");log("Gesture Recognizer running","ok");handLoop();}
function handLoop(){if(!CAM.on||!CAM.tracking)return;const v=$<HTMLVideoElement>("camVideo"),now=performance.now();
  if(v.readyState>=2&&v.currentTime!==CAM.lastFrame){CAM.lastFrame=v.currentTime;
    try{const r=CAM.hands!.recognizeForVideo(v,now),g=r.gestures&&r.gestures[0]&&r.gestures[0][0];
      CAM.lm=r.landmarks&&r.landmarks[0]||null;CAM.cat=g?g.categoryName:null;CAM.score=g?g.score:0;CAM.fc++;}catch(e){}}
  if(now-CAM.ft>1000){CAM.fps=CAM.fc;CAM.fc=0;CAM.ft=now;}
  requestAnimationFrame(handLoop);}
// Gesture channel (§1.7.3.6). An open palm must be held steady for GEST.confirmMs before the wrist height
// is captured as the neutral point, so a resting hand in view does not activate altitude control.
// Open_Palm activates and drives the rate, Closed_Fist locks, every other label (None, Pointing_Up, ...) counts as unrecognised
const MIN_SCORE=0.5;
function classify(){return CAM.score>=MIN_SCORE&&CAM.cat==="Open_Palm"?"open":CAM.score>=MIN_SCORE&&CAM.cat==="Closed_Fist"?"fist":"other";}
// proportional to displacement from neutral, zero inside the dead zone, capped at the maximum rate
function gestureRate(disp:number){const a=Math.abs(disp);if(a<=GEST.dead)return 0;return Math.sign(disp)*CONFIG.rateMax*Math.min(1,(a-GEST.dead)/(GEST.full-GEST.dead));}
function liveGesture(){if(!CAM.tracking)return;const L=CAM.lm,now=performance.now();
  if(!L){CAM.label="";CAM.conf=null;S.liveRate=0;
    if(gAct()||S.gesture==="unrecognized")setGesture("lost");else if(S.gesture==="confirming")setGesture(S.beforeConfirm||"idle");return;}
  const c=classify(),W=L[0]!;CAM.label=(c==="open"?"Open Palm":c==="fist"?"Closed Fist":"Unrecognized")+(c==="other"?"":` ${Math.round(CAM.score*100)}%`);
  if(c==="fist"){CAM.conf=null;S.liveRate=0;if(S.gesture!=="locked"){CAM.neutral=null;setGesture("locked");}return;}
  if(c==="other"){S.liveRate=0;if(gAct())setGesture("unrecognized");else if(S.gesture==="confirming"){CAM.conf=null;setGesture(S.beforeConfirm||"idle");}return;}
  // open palm: keep driving the rate, resume after an unrecognised pose, or confirm a fresh activation
  if(gAct()||(S.gesture==="unrecognized"&&CAM.neutral!=null)){S.liveRate=gestureRate(CAM.neutral!-W.y);
    if(!gAct())setGesture(S.liveRate<0?"descend":"climb");else if(S.liveRate)S.gesture=S.liveRate>0?"climb":"descend";return;}
  if(S.gesture!=="confirming"||!CAM.conf){CAM.conf={t0:now,y0:W.y};setGesture("confirming");return;}
  if(Math.abs(W.y-CAM.conf.y0)>GEST.still){CAM.conf={t0:now,y0:W.y};return;}   // hand still moving: restart the hold
  if(now-CAM.conf.t0>=GEST.confirmMs){CAM.neutral=W.y;CAM.conf=null;S.liveRate=0;setGesture("climb");}}
const confirmPct=()=>CAM.conf?Math.round(clamp((performance.now()-CAM.conf.t0)/GEST.confirmMs,0,1)*100):0;
const rateCmd=()=>CAM.tracking&&gAct()?S.liveRate:S.gesture==="climb"?0.75*CONFIG.rateMax:S.gesture==="descend"?-0.75*CONFIG.rateMax:0;
const videoD=()=>drones.find(d=>d.id===S.video)!;
/* ---------- Crazyflie battery and health, using the firmware's own values (crazyflie-firmware 2026.08) ----------
   pm.vbat (V); pm.batteryLevel = 10 x the step on LiPoTypicalChargeCurve (0 to 90 %); pm.state goes to lowPower
   below pm.lowVoltage 3.2 V for 5 s; pm.criticalLowVoltage is 3.0 V. The health test group: health.startPropTest
   gives health.motorPass (bit n = motor n+1 passed); health.startBatTest gives health.batterySag, a pass when the sag
   is 0.70 V or less. sys.canfly and sys.isTumbled come from the supervisor. Link quality (0-100) comes from cflib. */
const volts=(d:Drone)=>d.vbat;
const pmState=(d:Drone)=>(d.lowT||0)>=BAT_LOW_S?"lowPower":"battery";
function healthOf(d:Drone):{k:""|"ok"|"crit";text:string}{const h=d.health,why:string[]=[];
  if(connState(d)==="lost")why.push("radio link lost");
  if(pmState(d)==="lowPower")why.push(`battery low (${d.vbat.toFixed(2)} V)`);
  if(d.tumbled)why.push("tumbled");
  if(h&&h.motorPass){const bad=h.motorPass.map((p,i)=>p?null:`M${i+1}`).filter(Boolean);if(bad.length)why.push(`motor ${bad.join(", ")} failed`);}
  if(h&&h.batPass===false)why.push(`battery sag ${h.sag.toFixed(2)} V`);
  return why.length?{k:"crit",text:why.join("; ")}:h?{k:"ok",text:"Passed"}:{k:"",text:"Not checked"};}
// Propeller and battery tests, run on the ground between trials. Display only: they never block a command.
function runHealthCheck(){
  if(S.trial.running){log("Run the health check between trials","warn");return;}
  if(drones.some(d=>d.z>0.02)){log("Land every drone before the health check: the test spins the propellers","warn");return;}
  log("Health check: propeller and battery tests on all drones");
  setTimeout(()=>{drones.forEach(d=>{if(connState(d)==="lost"){d.health=null;return;}
      const motorPass=[0,1,2,3].map(i=>!(S.motorFault&&d.id==="cf2"&&i===2)),sag=+(0.25+Math.max(0,4.10-d.vbat)*0.9).toFixed(2);
      d.health={motorPass,sag,batPass:sag<=SAG_MAX,at:S.t};const hs=healthOf(d);log(`${U(d.id)} health: ${hs.text}`,hs.k==="crit"?"crit":"ok");});
    const bad=drones.filter(d=>healthOf(d).k==="crit");if(bad.length)S.alert=`Health check: ${bad.map(d=>`${U(d.id)} ${healthOf(d).text}`).join(". ")}. Check before flying.`;
    renderTelemetry();},1200);}
function log(text:string,k:LogKind="info"){S.log.push({t:S.t,text,k,ses:sessionId(),tr:S.curTrial||""});renderLog();}

function resetScenario(){
  drones=CONFIG.drones.map(d=>({...d,tx:d.x,ty:d.y,vx:0,vy:0,vz:0,roll:0,pitch:0,pHeld:false,zTarget:null,landing:false,clampMax:false,clampMin:false,trail:[],ranges:{},dh:null,crashed:false}));
  Object.assign(S,{gesture:"idle",simHold:false,degraded:false,lowBatt:false,cf3Lost:false,proximity:false,stopped:false,prox:new Map(),video:"cf1",holdOrder:[],altBlock:null,altBlockKey:null,appliedRate:0});
  S.trial.running=false;S.trial.last=null;S.alert=null;S.frameErr=false;
  S.log=CONFIG.initialLog.map(([dt,text,k])=>({t:S.t+dt,text,k,ses:sessionId(),tr:""}));S.curTrial="";
  $("estop").classList.remove("fired");$("estopTitle").textContent="E-STOP";$("estopSub").textContent="Hold 1 s";
  if(window.__ready){OPT.feed="cf1";Object.keys(OPT.feedSel).forEach(x=>OPT.feedSel[x]=x==="cf1");}
  syncSim();renderLog();buildFeeds();buildSensorScene();if(window.__ready)applyFeeds();
}
/* ---------- restricted zone: interface-level, course trials only (§1.7.6) ---------- */
// The restricted zone is "only active while the lap-course trials are being run" (§1.7.6), so it applies while a trial runs.
// Blocked at all times (project decision DEC-20, stricter than §1.7.6); restriction triggers are counted only in trials.
function restrictedZones(){const N=CONFIG.nfz;return[{id:"NFZ",name:"restricted zone",x:N.x,y:N.y,hx:N.h,hy:N.h}];}
// green (clear) -> amber (near) -> red (at the defensive-hover distance)
const PROX_R=40;   // proximity ring radius in px: about 2.5 fingertip radii, so a finger on the icon leaves it visible
function threatColor(t:number){const L=(a:number,b:number,k:number)=>Math.round(a+(b-a)*k),A=K.threatA,B=[255,154,31],C=[242,69,61];
  const [p,q,k]=t<0.5?[A,B,t/0.5]:[B,C,(t-0.5)/0.5];return `rgb(${L(p[0],q[0],k)},${L(p[1],q[1],k)},${L(p[2],q[2],k)})`;}
// The touch surface rejects any drag that would place a drone entity inside the restricted zone.
// Physical obstacles are not blocked here: they exist to test the onboard Multi-ranger stop (§1.7.6).
function dragBlocked(x:number,y:number):string|null{const B=CONFIG.zoneMargin;for(const o of restrictedZones())if(Math.abs(x-o.x)<o.hx+B&&Math.abs(y-o.y)<o.hy+B)return o.name;return null;}
// Interface-level obstacle buffer around other drones (SO1, §1.7.3.2): a drag is rejected when it would bring a drone
// within CONFIG.droneBuf of another drone flying at a similar height (within CONFIG.droneVsep), where they would really touch.
// Drags that increase the gap are always allowed. Placeholder distances, pending flight tests.
function droneBlocked(d:Drone,ax:number,ay:number,bx:number,by:number):string|null{for(const e of drones){if(e===d||!airborne(e))continue;
    const ez=e.zTarget!=null?e.zTarget:e.z;if(Math.abs(d.z-e.z)>=CONFIG.droneVsep&&Math.abs(d.z-ez)>=CONFIG.droneVsep)continue;
    for(const[cx,cy] of [[e.x,e.y],[e.tx,e.ty]]){const d0=Math.hypot(ax-cx,ay-cy),dm=segMinDist(ax,ay,bx,by,cx,cy);if(dm<CONFIG.droneBuf&&dm<d0-1e-4)return U(e.id);}}
  return null;}
function dragPathBlocked(d:Drone,ax:number,ay:number,bx:number,by:number):string|null{const B=CONFIG.zoneMargin;for(const o of restrictedZones()){
    if(Math.abs(ax-o.x)<o.hx+B&&Math.abs(ay-o.y)<o.hy+B)continue;   // a drone already inside (e.g. after a layout sync) may be dragged out
    if(segHitsRect(ax,ay,bx,by,o.x,o.y,o.hx+B,o.hy+B))return o.name;}
  return dragBlocked(bx,by)||droneBlocked(d,ax,ay,bx,by)||droneBlocked(d,d.x,d.y,bx,by);}
// 3D distance from a point to a hoop's ring (the frame, not the opening)
function hoopRim(h:Hoop,d:Drone){const a=(h.ang||0)*Math.PI/180,n=h.type==="horizontal"?[0,0,1]:[-Math.sin(a),Math.cos(a),0],
  v=[d.x-h.x,d.y-h.y,d.z-h.z],vn=v[0]*n[0]+v[1]*n[1]+v[2]*n[2],p=[v[0]-vn*n[0],v[1]-vn*n[1],v[2]-vn*n[2]],pl=Math.hypot(p[0],p[1],p[2])||1e-6;
  return{dist:Math.hypot(vn,pl-h.r),pt:[h.x+p[0]/pl*h.r,h.y+p[1]/pl*h.r,h.z+p[2]/pl*h.r]};}

/* ---------- simulated Multi-ranger deck (§1.7.3.2) ----------
   Five time-of-flight sensors facing front, back, left, right and up, about 4 m range. There is no downward sensor.
   Each sensor sees a cone of about 27°. Readings drive the proximity ring and the onboard defensive hover.
   Trigger and clear distances are placeholders until bench tests (OPEN-04). */
const MR={half:13.5*Math.PI/180,max:4.0,trig:0.15,clear:0.20,show:0.60,body:0.05,ceil:2.55};
const DIRS:Dir[]=["front","right","back","left","up"];
let HOOP_PTS:Vec3[]=[];
function buildSensorScene(){HOOP_PTS=[];if(!OPT.course)return;CONFIG.hoops.forEach(h=>{const a=(h.ang||0)*Math.PI/180;
  for(let i=0;i<72;i++){const t=i/72*2*Math.PI,c=Math.cos(t)*h.r,s=Math.sin(t)*h.r;
    HOOP_PTS.push(h.type==="horizontal"?[h.x+c,h.y+s,h.z]:[h.x+Math.cos(a)*c,h.y+Math.sin(a)*c,h.z+s]);}});}
function dirVec(d:Drone,k:Dir):Vec3{const y=d.yaw*Math.PI/180,f:Vec3=[Math.sin(y),Math.cos(y),0],r:Vec3=[Math.cos(y),-Math.sin(y),0];
  return k==="front"?f:k==="back"?[-f[0],-f[1],0]:k==="right"?r:k==="left"?[-r[0],-r[1],0]:[0,0,1];}
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=(a:Vec3):Vec3=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l];};
function coneRays(u:Vec3):Vec3[]{ // the sensor axis plus eight rays around the edge of its field of view
  const v=unit(cross(u,Math.abs(u[2])>0.9?[1,0,0]:[0,0,1])),w=cross(u,v),c=Math.cos(MR.half),s=Math.sin(MR.half),R=[u];
  for(let i=0;i<8;i++){const t=i/8*2*Math.PI,ct=Math.cos(t),st=Math.sin(t);R.push([u[0]*c+(v[0]*ct+w[0]*st)*s,u[1]*c+(v[1]*ct+w[1]*st)*s,u[2]*c+(v[2]*ct+w[2]*st)*s]);}
  return R;}
function rayBox(p:Vec3,u:Vec3,b:Box):number|null{let t0=0,t1=1e9;const lo=[b.x-b.hx,b.y-b.hy,0],hi=[b.x+b.hx,b.y+b.hy,b.h];
  for(let i=0;i<3;i++){if(Math.abs(u[i])<1e-9){if(p[i]<lo[i]||p[i]>hi[i])return null;}
    else{let a=(lo[i]-p[i])/u[i],c=(hi[i]-p[i])/u[i];if(a>c){const t=a;a=c;c=t;}t0=Math.max(t0,a);t1=Math.min(t1,c);if(t0>t1)return null;}}
  return t0;}
function sensorRange(d:Drone,k:Dir):number|null{const p:Vec3=[d.x,d.y,d.z],u=dirVec(d,k),A=CONFIG.arena,ca=Math.cos(MR.half);let best=MR.max;
  [[0,A.xMin],[0,A.xMax],[1,A.yMin],[1,A.yMax],[2,MR.ceil]].forEach(([i,v])=>{if(Math.abs(u[i])>1e-9){const t=(v-p[i])/u[i];if(t>0&&t<best)best=t;}});
  if(OPT.course){const rays=coneRays(u);
    CONFIG.boxes.forEach(b=>rays.forEach(r=>{const t=rayBox(p,r,b);if(t!=null&&t<best)best=t;}));
    for(const q of HOOP_PTS){const vx=q[0]-p[0],vy=q[1]-p[1],vz=q[2]-p[2],L=Math.hypot(vx,vy,vz);if(L<1e-6||L-0.01>=best)continue;
      if((vx*u[0]+vy*u[1]+vz*u[2])/L>=ca)best=Math.max(0,L-0.01);}}
  drones.forEach(e=>{if(e===d||e.z<0.02)return;const vx=e.x-p[0],vy=e.y-p[1],vz=e.z-p[2],L=Math.hypot(vx,vy,vz);if(L<1e-6)return;
    if((vx*u[0]+vy*u[1]+vz*u[2])/L>=ca&&L-MR.body<best)best=Math.max(0,L-MR.body);});
  return best<MR.max?best:null;}
function senseAll(){drones.forEach(d=>{d.ranges={};d.below=null;if(!airborne(d))return;DIRS.forEach(k=>d.ranges[k]=sensorRange(d,k));d.below=clearBelow(d);});}
// Clearance below a drone. The Multi-ranger has no downward sensor, so this comes from the motion-capture height and
// the known course layout: floor, box tops, hoop frames and other drones. It is shown only. The interface never
// stops a drone by itself (§1.6.3); only the onboard sensors trigger defensive hover (§1.7.3.7).
function clearBelow(d:Drone){let best={dist:d.z,what:"floor"};const B=MR.body,take=(c:number,what:string)=>{if(c>=0&&c<best.dist)best={dist:c,what};};
  if(OPT.course){
    CONFIG.boxes.forEach(b=>{if(Math.abs(d.x-b.x)<b.hx+B&&Math.abs(d.y-b.y)<b.hy+B)take(d.z-b.h,b.id);});
    CONFIG.hoops.forEach(h=>{
      if(h.type==="horizontal"){if(Math.abs(Math.hypot(d.x-h.x,d.y-h.y)-h.r)<B+0.01)take(d.z-h.z,h.id);return;}
      const a=h.ang!*Math.PI/180,ux=Math.cos(a),uy=Math.sin(a),s=(d.x-h.x)*ux+(d.y-h.y)*uy,perp=Math.abs(-(d.x-h.x)*uy+(d.y-h.y)*ux);
      if(perp<B+0.01&&Math.abs(s)<h.r){const q=Math.sqrt(h.r*h.r-s*s);[h.z+q,h.z-q].forEach(zr=>take(d.z-zr,h.id));}});}
  drones.forEach(e=>{if(e!==d&&e.z>0.02&&Math.hypot(d.x-e.x,d.y-e.y)<2*B)take(d.z-e.z,U(e.id));});
  return best;}
// physical contact: drone body against a box, a hoop frame or another drone. A collision fails the trial (§1.7.6).
function collisionOf(d:Drone):{what:string;other?:Drone}|null{
  if(OPT.course){for(const b of CONFIG.boxes){const dx=Math.max(Math.abs(d.x-b.x)-b.hx,0),dy=Math.max(Math.abs(d.y-b.y)-b.hy,0),dz=Math.max(d.z-b.h,0);if(Math.hypot(dx,dy,dz)<MR.body)return{what:b.id};}
    for(const h of CONFIG.hoops)if(hoopRim(h,d).dist<MR.body+0.01)return{what:`${h.id} frame`};}
  for(const e of drones){if(e===d||e.crashed||e.z<0.03)continue;if(Math.hypot(d.x-e.x,d.y-e.y,d.z-e.z)<2*MR.body)return{what:U(e.id),other:e};}
  return null;}
// during a trial each drone must pass the hoops in order, H1 then H2 then H3 (§1.4.2, §1.7.6)
function passed(d:Drone,h:Hoop){const T=S.trial;if(!T.running||!T.prog){log(`${U(d.id)} passed ${h.id}`,"ok");return;}
  const i=CONFIG.hoops.indexOf(h),p=T.prog[d.id]!,n=CONFIG.hoops.length;
  if(i===p){T.prog[d.id]=p+1;log(`${U(d.id)} passed ${h.id}${p+1===n?", all hoops done, return to the start position and land":""}`,"ok");}
  else if(i<p)log(`${U(d.id)} passed ${h.id} again`);
  else log(`${U(d.id)} passed ${h.id} out of order; ${CONFIG.hoops[p]!.id} comes first, so it does not count`,"warn");}
function checkHoops(d:Drone,x0:number,y0:number,z0:number){if(!OPT.course)return;CONFIG.hoops.forEach(h=>{
  if(h.type==="horizontal"){ // pass by climbing/descending through the ring
    if((z0-h.z)*(d.z-h.z)<0){const r=Math.hypot(d.x-h.x,d.y-h.y);if(r<=h.r*0.8)passed(d,h);}return;}
  const a=h.ang!*Math.PI/180,ux=Math.cos(a)*h.r,uy=Math.sin(a)*h.r;
  if(segCross(x0,y0,d.x,d.y,h.x-ux,h.y-uy,h.x+ux,h.y+uy)){
    if(Math.abs(d.z-h.z)<=h.r*0.8)passed(d,h);
    else if(Math.abs(d.z-h.z)>h.r+MR.body)log(`${U(d.id)} went ${d.z<h.z?"under":"over"} ${h.id}, not through it (frame ${(h.z-h.r).toFixed(2)}–${(h.z+h.r).toFixed(2)} m)`,"warn");}});}
function flightState(d:Drone):[string,""|"ok"|"own"|"caut"|"crit"]{
  if(d.crashed)return["Collision","crit"];
  if(S.stopped)return["Motors cut","crit"];
  if(connState(d)==="lost")return["No link","crit"];
  if(d.dh&&d.z>0.02)return["Defensive hover","caut"];
  if(d.landing)return d.z>0.02?["Landing","own"]:["Grounded",""];
  if(d.z<=0.02&&d.zTarget==null)return["Grounded",""];
  if(d.zTarget!=null)return["Taking off","own"];
  if(isHeld(d)&&S.gesture==="lost")return["Holding altitude","caut"];
  const mv=Math.hypot(d.tx-d.x,d.ty-d.y)>0.03||(isHeld(d)&&S.appliedRate!==0);
  return mv?["Moving","own"]:["Hovering","ok"];
}

/* =====================================================================
   MAP
   ===================================================================== */
/* Fit the arena to the largest square the map body allows (minus the altitude overlay),
   and extend the grid across the whole viewport so no space is left empty. */
function fitMap(){
  const rr=document.querySelector<HTMLElement>(".mapbody")!.getBoundingClientRect(),r={width:rr.width/SCALE,height:rr.height/SCALE};
  VW=Math.max(300,r.width);VH=Math.max(300,r.height);
  const padL=16,padT=16,padB=26,rightReserve=0,availW=VW-rightReserve-padL-10,availH=VH-padT-padB;   // small bottom band for the scale and event ticker
  const A=CONFIG.arena,aw=A.xMax-A.xMin,ad=A.yMax-A.yMin;SC=Math.min(availW/aw,availH/ad);
  OX=padL+availW/2-((A.xMax+A.xMin)/2)*SC;OY=padT+availH/2+((A.yMax+A.yMin)/2)*SC;
  $("mapSvg").setAttribute("viewBox",`0 0 ${VW} ${VH}`);
  $("scaleBar").style.width=SC.toFixed(0)+"px";
  buildMapStatic();
}
function buildMapStatic(){
  const a=CONFIG.arena;let g=`<rect x="0" y="0" width="${VW}" height="${VH}" fill="${K.bg}"/>`;
  // extended background grid (outside the capture volume, dimmer)
  const gx0=Math.floor((0-OX)/SC*2)/2,gx1=Math.ceil((VW-OX)/SC*2)/2,gy0=Math.floor((OY-VH)/SC*2)/2,gy1=Math.ceil(OY/SC*2)/2;
  for(let v=gx0;v<=gx1;v+=0.5)g+=`<line x1="${px(v)}" y1="0" x2="${px(v)}" y2="${VH}" stroke="${K.grid0}"/>`;
  for(let v=gy0;v<=gy1;v+=0.5)g+=`<line x1="0" y1="${py(v)}" x2="${VW}" y2="${py(v)}" stroke="${K.grid0}"/>`;
  g+=`<rect x="${px(a.xMin)}" y="${py(a.yMax)}" width="${(a.xMax-a.xMin)*SC}" height="${(a.yMax-a.yMin)*SC}" fill="${K.bg}"/>`;
  for(let v=Math.ceil(a.xMin*2)/2;v<=a.xMax+1e-6;v+=0.5){const mj=Math.abs(v%1)<1e-6;
    g+=`<line x1="${px(v)}" y1="${py(a.yMax)}" x2="${px(v)}" y2="${py(a.yMin)}" stroke="${mj?K.gridMaj:K.gridMin}"/>`;
    if(mj)g+=`<text x="${px(v)}" y="${py(a.yMax)-8}" fill="${K.grn}" fill-opacity=".75" font-size="10" text-anchor="middle">${v.toFixed(0)}</text>`;}
  for(let v=Math.ceil(a.yMin*2)/2;v<=a.yMax+1e-6;v+=0.5){const mj=Math.abs(v%1)<1e-6;
    g+=`<line x1="${px(a.xMin)}" y1="${py(v)}" x2="${px(a.xMax)}" y2="${py(v)}" stroke="${mj?K.gridMaj:K.gridMin}"/>`;
    if(mj){g+=`<text x="${px(a.xMin)-8}" y="${py(v)+3}" fill="${K.grn}" fill-opacity=".75" font-size="10" text-anchor="end">${v.toFixed(0)}</text>`;}}
  const m=a.margin;
  g+=`<rect x="${px(a.xMin)}" y="${py(a.yMax)}" width="${(a.xMax-a.xMin)*SC}" height="${(a.yMax-a.yMin)*SC}" fill="none" stroke="${K.arena}" stroke-width="1.5"/>`;
  g+=`<rect x="${px(a.xMin+m)}" y="${py(a.yMax-m)}" width="${(a.xMax-a.xMin-2*m)*SC}" height="${(a.yMax-a.yMin-2*m)*SC}" fill="none" stroke="${K.caut}" stroke-opacity=".5" stroke-dasharray="6 5"/>`;
  // altitude gradient (bottom → top: below-min caution, safe band green, above-max caution)
  const Z=CONFIG.z,p=(z:number)=>(1-z/Z.displayMax)*100;
  g+=`<defs><linearGradient id="altGlass" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5FD068" stop-opacity=".9"/><stop offset="40%" stop-color="#F5D90A" stop-opacity=".82"/><stop offset="70%" stop-color="#FF9A1F" stop-opacity=".78"/><stop offset="100%" stop-color="#F2453D" stop-opacity=".75"/></linearGradient></defs>`;
  g+=`<defs><linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${K.caut}"/><stop offset="${p(Z.max)}%" stop-color="${K.caut}"/>
    <stop offset="${p(Z.max)+0.01}%" stop-color="#C8F7CF"/><stop offset="${(p(Z.max)+p(Z.min))/2}%" stop-color="${K.grn}"/>
    <stop offset="${p(Z.min)}%" stop-color="#2F6B37"/><stop offset="${p(Z.min)+0.01}%" stop-color="${K.caut}"/><stop offset="100%" stop-color="${K.caut}"/></linearGradient>
    <filter id="proxGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="proxSoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1"/></filter>
    <pattern id="nfzHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="${K.crit}" stroke-opacity=".45" stroke-width="3"/></pattern></defs>`;
  // obstacles: boxes (footprint + height) and hoops (gate line, posts, centre height)
  if(OPT.course){
    g+=`<defs><pattern id="boxHatch" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 7L7 0" stroke="${K.boxLine}" stroke-opacity=".35" stroke-width="1.2"/></pattern></defs>`;
    CONFIG.boxes.forEach(b=>{const X=px(b.x-b.hx),Y=py(b.y+b.hy),W=2*b.hx*SC,H=2*b.hy*SC;
      g+=`<rect x="${X+4}" y="${Y+4}" width="${W}" height="${H}" fill="#000" opacity=".35"/>`;
      g+=`<rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="${K.boxFill}" stroke="${K.boxLine}" stroke-width="1.5"/><rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="url(#boxHatch)"/>`;
      g+=`<text x="${px(b.x)}" y="${py(b.y)-2}" fill="${K.tx}" font-size="11" font-weight="700" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${b.id}</text>`;
      g+=`<text x="${px(b.x)}" y="${py(b.y)+11}" fill="${K.tx2}" font-size="9" text-anchor="middle">${b.h.toFixed(2)} m</text>`;});
    CONFIG.hoops.forEach(h=>{if(h.type==="horizontal"){const cx=px(h.x),cy=py(h.y),r=h.r*SC;
        g+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${K.sel}" fill-opacity=".06" stroke="${K.sel}" stroke-width="3.5"/><circle cx="${cx}" cy="${cy}" r="2.5" fill="${K.sel}"/>`;
        g+=`<text x="${cx}" y="${cy-r-8}" fill="${K.sel}" font-size="11" font-weight="700" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${h.id}<tspan fill="${K.selDim}" font-weight="400" font-size="9" dx="4">${h.z.toFixed(2)} m</tspan></text>`;return;}
      const a=h.ang!*Math.PI/180,ux=Math.cos(a),uy=Math.sin(a),x1=px(h.x-ux*h.r),y1=py(h.y-uy*h.r),x2=px(h.x+ux*h.r),y2=py(h.y+uy*h.r),cx=px(h.x),cy=py(h.y),nx=-uy,ny=ux,L=16;
      g+=`<line x1="${cx-nx*L}" y1="${cy+ny*L}" x2="${cx+nx*L}" y2="${cy-ny*L}" stroke="${K.sel}" stroke-opacity=".5" stroke-dasharray="3 3"/>`;
      g+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${K.sel}" stroke-width="4" stroke-linecap="round"/>`;
      g+=`<circle cx="${x1}" cy="${y1}" r="4" fill="${K.tagBg}" stroke="${K.sel}" stroke-width="2"/><circle cx="${x2}" cy="${y2}" r="4" fill="${K.tagBg}" stroke="${K.sel}" stroke-width="2"/>`;
      g+=`<text x="${cx+nx*22}" y="${cy-ny*22+(ny>0.5?0:4)}" fill="${K.sel}" font-size="11" font-weight="700" text-anchor="${nx<-0.5?"end":nx>0.5?"start":"middle"}" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${h.id}<tspan fill="${K.selDim}" font-weight="400" font-size="9" dx="4">${h.z.toFixed(2)} m</tspan></text>`;});
  }
  // drag margin around the restricted zone (where drags stop)
  restrictedZones().forEach(o=>{const B=CONFIG.zoneMargin;g+=`<rect x="${px(o.x-o.hx-B)}" y="${py(o.y+o.hy+B)}" width="${(2*(o.hx+B))*SC}" height="${(2*(o.hy+B))*SC}" fill="none" stroke="${K.tx}" stroke-opacity=".18" stroke-width="1" stroke-dasharray="2 4"/>`;});
  // restricted zone: drags into it are always rejected
  const N=CONFIG.nfz,s0=N.h*SC;
    g+=`<rect x="${px(N.x)-s0}" y="${py(N.y)-s0}" width="${2*s0}" height="${2*s0}" fill="${K.crit}" fill-opacity=".10"/>`;
    g+=`<rect x="${px(N.x)-s0}" y="${py(N.y)-s0}" width="${2*s0}" height="${2*s0}" fill="url(#nfzHatch)" stroke="${K.crit}" stroke-width="2.5"/>`;
    g+=`<rect x="${px(N.x)-52}" y="${py(N.y)-10}" width="104" height="20" fill="${K.critBg}" stroke="${K.crit}"/><text x="${px(N.x)}" y="${py(N.y)+4}" fill="${K.crit}" font-size="10.5" font-weight="700" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">RESTRICTED</text>`;
  $("mapStatic").innerHTML=g;
}
function renderMap(){
  let g="";
  // short comet trail: points live 0.7 s and fade out by age
  drones.forEach(d=>{const T=d.trail;if(!OPT.trails||T.length<2)return;const LIFE=0.7;
    for(let i=1;i<T.length;i++){const age=S.t-T[i][2];if(age>LIFE)continue;const a=1-age/LIFE;
      g+=`<line x1="${px(T[i-1][0]).toFixed(1)}" y1="${py(T[i-1][1]).toFixed(1)}" x2="${px(T[i][0]).toFixed(1)}" y2="${py(T[i][1]).toFixed(1)}" stroke="${K.grn}" stroke-width="${(0.8+2.6*a).toFixed(2)}" stroke-opacity="${(0.75*a*a).toFixed(3)}" stroke-linecap="round"/>`;}});
  S.prox.forEach((dist,key)=>{const[a,b]=key.split("|").map(id=>drones.find(d=>d.id===id)!),crit=dist<CONFIG.proxCrit,col=crit?K.crit:K.caut,mx=(px(a.x)+px(b.x))/2,my=(py(a.y)+py(b.y))/2;
    g+=`<line x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    g+=`<g transform="translate(${mx},${my+58})"><rect x="-80" y="-12" width="160" height="22" fill="${K.tagBg}" stroke="${col}"/><text x="0" y="3" fill="${col}" font-size="11" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${crit?"Collision risk":"Proximity warning"} ${dist.toFixed(2)} m</text></g>`;});
  drones.forEach(d=>{
    const X=px(d.x),Y=py(d.y),held=isHeld(d),gr=d.z<=0.02||S.stopped||d.crashed,dist=Math.hypot(d.tx-d.x,d.ty-d.y);
    if(dist>0.03&&!d.crashed){const TX=px(d.tx),TY=py(d.ty),gid=`wisp-${d.id}`;
      // straight line to the operator's target: the drone flies it directly, with no route planning (§1.6.3)
      g+=`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${X}" y1="${Y}" x2="${TX}" y2="${TY}"><stop offset="0" stop-color="${K.own}" stop-opacity="0"/><stop offset=".45" stop-color="${K.own}" stop-opacity=".22"/><stop offset="1" stop-color="${K.own}" stop-opacity=".6"/></linearGradient>`;
      g+=`<path d="M${X.toFixed(1)} ${Y.toFixed(1)}L${TX.toFixed(1)} ${TY.toFixed(1)}" fill="none" stroke="url(#${gid})" stroke-width="2.2" stroke-linecap="round"/>`;
      g+=`<circle cx="${TX}" cy="${TY}" r="11" fill="${K.own}" fill-opacity=".07"/><circle cx="${TX}" cy="${TY}" r="6" fill="none" stroke="${K.own}" stroke-opacity=".55" stroke-width="1.2"/><circle cx="${TX}" cy="${TY}" r="1.8" fill="${K.own}" fill-opacity=".8"/>`;
    }
    if(d.blockPt){const BX=px(d.blockPt[0]),BY=py(d.blockPt[1]),TX=px(d.tx),TY=py(d.ty),gb=`blk-${d.id}`;
      g+=`<linearGradient id="${gb}" gradientUnits="userSpaceOnUse" x1="${TX}" y1="${TY}" x2="${BX}" y2="${BY}"><stop offset="0" stop-color="${K.crit}" stop-opacity=".6"/><stop offset="1" stop-color="${K.crit}" stop-opacity="0"/></linearGradient>`;
      g+=`<path d="M${TX} ${TY} L${BX} ${BY}" stroke="url(#${gb})" stroke-width="6" stroke-linecap="round" opacity=".5"/><circle cx="${TX}" cy="${TY}" r="10" fill="none" stroke="${K.crit}" stroke-opacity=".7" stroke-width="1.5"/>`;
      g+=`<text x="${TX}" y="${TY-15}" fill="${K.crit}" font-size="10" font-weight="700" text-anchor="middle">DRAG REJECTED: ${d.blocked}</text>`;}
    g+=`<g data-drone="${d.id}" style="cursor:pointer"><circle cx="${X}" cy="${Y}" r="30" fill="transparent"/>`;
    // proximity ring (§1.7.3.5): always a full circle well outside a fingertip. Each side sensor colours the part of the
    // ring facing it; the colour fades smoothly around the circle and darkens green -> amber -> red as the obstacle nears.
    if(airborne(d)){const R=PROX_R,N=72,FALL=55*Math.PI/180,pt=(a:number)=>`${(X+R*Math.cos(a)).toFixed(1)} ${(Y+R*Math.sin(a)).toFixed(1)}`;
      const src=(["front","right","back","left"] as Dir[]).map(k=>{const u=dirVec(d,k),r=d.ranges[k];return{a:Math.atan2(-u[1],u[0]),t:r==null?0:clamp((MR.show-r)/(MR.show-MR.trig),0,1)};}).filter(o=>o.t>0);
      let ring="",glow="";
      for(let i=0;i<N;i++){const a0=i/N*2*Math.PI,a1=(i+1)/N*2*Math.PI+0.004,am=(a0+a1)/2;
        let t=0;src.forEach(o=>{let da=Math.abs(((am-o.a+3*Math.PI)%(2*Math.PI))-Math.PI);if(da<FALL)t=Math.max(t,o.t*Math.cos(da/FALL*Math.PI/2));});
        const c=threatColor(t),seg=`M${pt(a0)}A${R} ${R} 0 0 1 ${pt(a1)}`;
        ring+=`<path d="${seg}" stroke="${c}" stroke-opacity="${(0.55+0.45*t).toFixed(2)}" stroke-width="${(2.5+3*t).toFixed(1)}"/>`;
        if(t>0.05)glow+=`<path d="${seg}" stroke="${c}" stroke-opacity="${(0.25+0.6*t).toFixed(2)}" stroke-width="${(6+14*t).toFixed(1)}"/>`;}
      if(glow)g+=`<g fill="none" filter="url(#proxGlow)">${glow}</g>`;
      g+=`<g fill="none">${ring}</g>`;
      // above (up sensor) and below (motion capture + course layout) indicators, right of the icon
      // above/below triangles sit in a cluster directly above the drone, clear of a fingertip on the icon and of
      // neighbours, which usually sit side by side (start pads 30 cm apart)
      const vt=(r:number|null|undefined)=>r==null?0:clamp((MR.show-r)/(MR.show-MR.trig),0,1),ru=d.ranges.up,rb=d.below?d.below.dist:null,xa=X+7,yc=Y-PROX_R-20;
      ([[ru,-1],[rb,1]] as [number|null|undefined,number][]).forEach(([r,dir])=>{const t=vt(r),c=t>0?threatColor(t):K.line2,y0=yc+dir*5;
        g+=`<path d="M${xa-4.5} ${y0}L${xa} ${y0+dir*6}L${xa+4.5} ${y0}Z" fill="${c}" fill-opacity="${t>0?1:.8}"/>`;
        if(t>0)g+=`<text x="${xa+8}" y="${y0+dir*5+3}" fill="${c}" font-size="9.5" font-weight="700">${r!.toFixed(2)}</text>`;});}
    // heading tick
    const hr=(d.yaw-90)*Math.PI/180;g+=`<line x1="${X+17*Math.cos(hr)}" y1="${Y+17*Math.sin(hr)}" x2="${X+21*Math.cos(hr)}" y2="${Y+21*Math.sin(hr)}" stroke="${K.own}" stroke-width="2.5"/>`;
    const lostC=connState(d)==="lost";g+=`<circle cx="${X}" cy="${Y}" r="15" fill="${held?K.own:K.iconFill}" stroke="${d.crashed||lostC?K.crit:gr?K.tx3:held?K.iconTx:K.own}" stroke-width="2.5" ${gr||lostC?'stroke-dasharray="4 3"':""}/>`;
    g+=`<text x="${X}" y="${Y+5}" fill="${held?K.heldTx:K.iconTx}" font-size="14" font-weight="700" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${d.n}</text>`;
    if(d.dh&&airborne(d)){g+=`<circle class="blink" cx="${X}" cy="${Y}" r="${PROX_R+6}" fill="none" stroke="${K.caut}" stroke-width="2"/>`;
      g+=`<g transform="translate(${X},${Y+PROX_R+16})"><rect x="-50" y="-9" width="100" height="17" fill="${K.tagBg}" stroke="${K.caut}"/><text x="0" y="3.5" fill="${K.caut}" font-size="9.5" font-weight="700" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">DEFENSIVE HOVER</text></g>`;}
    if(d.crashed){g+=`<path d="M${X-9} ${Y-9}L${X+9} ${Y+9}M${X+9} ${Y-9}L${X-9} ${Y+9}" stroke="${K.crit}" stroke-width="3"/>`;
      g+=`<g transform="translate(${X},${Y+PROX_R+16})"><rect x="-40" y="-9" width="80" height="17" fill="${K.critBg}" stroke="${K.crit}"/><text x="0" y="3.5" fill="${K.crit}" font-size="9.5" font-weight="700" text-anchor="middle">COLLISION</text></g>`;}
    // altitude gradient bar (left of the icon, outside the proximity ring)
    {const Zc=CONFIG.z,bh=28,bw=5,bx=X-11,by=Y-PROX_R-34,f=clamp(d.z/Zc.displayMax,0,1),ly=by+bh*(1-f),zy=(z:number)=>by+bh*(1-z/Zc.displayMax),cid=`ac-${d.id}`;
     g+=`<clipPath id="${cid}"><rect x="${bx}" y="${ly}" width="${bw}" height="${by+bh-ly}"/></clipPath>`;
     g+=`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="2.5" fill="${K.iconTx}" fill-opacity=".07" stroke="${K.iconTx}" stroke-opacity=".22" stroke-width=".8"/>`;
     g+=`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="2.5" fill="url(#altGlass)" clip-path="url(#${cid})"/>`;
     g+=`<path d="M${bx-2} ${zy(Zc.max)}H${bx+bw+2}M${bx-2} ${zy(Zc.min)}H${bx+bw+2}" stroke="${K.caut}" stroke-opacity=".7" stroke-width="1"/>`;
     g+=`<circle cx="${bx+bw/2}" cy="${ly}" r="6" fill="${K.iconTx}" fill-opacity=".12"/><circle cx="${bx+bw/2}" cy="${ly}" r="3" fill="${K.iconTx}" fill-opacity=".95"/>`;}
    g+=`<text x="${X}" y="${Y-PROX_R-39}" fill="${K.tx2}" font-size="10" text-anchor="middle">${d.z.toFixed(2)} m</text></g>`;
  });
  $("mapDyn").innerHTML=g;
}

/* =====================================================================
   ALTITUDE OVERLAY
   ===================================================================== */
let TW=100,TH=600;
function renderTapes(){
  const svgT=$("tapeSvg");svgT.setAttribute("viewBox",`0 0 ${TW} ${TH}`);
  const Z=CONFIG.z,top=44,bot=TH-44,h=bot-top,zy=(z:number)=>bot-(z/Z.displayMax)*h;let s="";
  // battery-style heat gradient: red (low) → orange → yellow → green (high)
  s+=`<defs><linearGradient id="heatT" gradientUnits="userSpaceOnUse" x1="0" y1="${bot}" x2="0" y2="${top}"><stop offset="0" stop-color="#F2453D"/><stop offset=".3" stop-color="#FF9A1F"/><stop offset=".6" stop-color="#F5D90A"/><stop offset="1" stop-color="#5FD068"/></linearGradient></defs>`;
  const slot=(TW-32)/3,TWD=Math.max(14,Math.min(40,slot-8)),XS=[0,1,2].map(i=>28+slot*i+(slot-TWD)/2);
  s+=`<defs><pattern id="hx" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="${K.caut}" stroke-opacity=".35" stroke-width="1.4"/></pattern></defs>`;
  for(let i=0;i<=20;i++){const v=i/10,mj=i%5===0;s+=`<line x1="${mj?17:20}" y1="${zy(v)}" x2="24" y2="${zy(v)}" stroke="${mj?K.grn:K.tx3}"/>`;if(mj)s+=`<text x="15" y="${zy(v)+3}" fill="${K.grn}" font-size="9" text-anchor="end">${v.toFixed(1)}</text>`;}
  XS.forEach((x,i)=>{const d=drones[i],held=isHeld(d),col=held?K.own:K.tx2,W=TWD,cz=clamp(d.z,0,Z.displayMax);
    s+=`<g opacity="${held?1:.6}">`;
    s+=`<rect x="${x}" y="${top}" width="${W}" height="${h}" fill="${K.tagBg}" stroke="${held?K.own:K.line2}"/>`;
    s+=`<rect x="${x+1}" y="${top+1}" width="${W-2}" height="${zy(Z.max)-top-1}" fill="url(#hx)"/><rect x="${x+1}" y="${zy(Z.min)}" width="${W-2}" height="${bot-zy(Z.min)-1}" fill="url(#hx)"/>`;
    s+=`<line x1="${x}" y1="${zy(Z.max)}" x2="${x+W}" y2="${zy(Z.max)}" stroke="${K.caut}" stroke-width="1.5"/><line x1="${x}" y1="${zy(Z.min)}" x2="${x+W}" y2="${zy(Z.min)}" stroke="${K.caut}" stroke-width="1.5"/>`;
    s+=`<rect x="${x+W*0.2}" y="${zy(cz)}" width="${W*0.6}" height="${bot-zy(cz)}" fill="url(#heatT)" opacity=".9"/>`;
    s+=`<path d="M${x-2} ${zy(cz)}L${x+6} ${zy(cz)-6}H${x+W+2}V${zy(cz)+6}H${x+6}Z" fill="${K.tagBg}" stroke="${col}" stroke-width="1.5"/>`;
    const r=held&&airborne(d)?S.appliedRate:0,blk=S.altBlock&&S.altBlock.d===d;
    if(r){const cx=x+W/2,dir=r>0?-1:1;for(let k=0;k<2;k++){const ay=zy(cz)+dir*(16+k*8);s+=`<path d="M${cx-6} ${ay-dir*3}L${cx} ${ay+dir*3}L${cx+6} ${ay-dir*3}" fill="none" stroke="${K.own}" stroke-width="2"/>`;}}
    if(blk){const w=S.altBlock!.why,lbl=w==="maximum altitude"?"MAX":w==="minimum altitude"?"MIN":"DH";s+=`<text x="${x+W/2}" y="${zy(cz)-10}" fill="${K.caut}" font-size="9" font-weight="700" text-anchor="middle">${lbl}</text>`;}
    s+=`<text x="${x+W/2}" y="${top-24}" fill="${K.iconTx}" font-size="${Math.min(11,slot/2.6).toFixed(1)}" text-anchor="middle">${d.z.toFixed(2)}</text>`;
    s+=`<circle cx="${x+W/2}" cy="${top-10}" r="7" fill="${K.iconFill}" stroke="${d.z>0.02&&!S.stopped?K.own:K.tx3}" stroke-width="1.5"/><text x="${x+W/2}" y="${top-6.5}" fill="${K.iconTx}" font-size="9" font-weight="700" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${d.n}</text>`;
    s+=`<text x="${x+W/2}" y="${bot+16}" fill="${held?K.own:K.tx3}" font-size="9" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${held?(slot<24?"H":"Held"):""}</text></g>`;});
  $("tapeSvg").innerHTML=s;
}

/* =====================================================================
   CAMERA FEED (grayscale sensor look, yellow detection box)
   ===================================================================== */
const PALM=[[100,130],[80,120],[66,105],[56,92],[48,80],[85,90],[82,68],[80,54],[79,42],[100,88],[100,63],[100,48],[100,35],[114,90],[117,67],[119,53],[120,42],[126,96],[133,79],[137,68],[140,58]];
const FIST=[[100,130],[80,120],[74,108],[82,100],[92,98],[85,90],[84,76],[90,82],[92,92],[100,88],[100,74],[104,82],[104,92],[114,90],[114,76],[116,84],[114,93],[126,96],[128,84],[128,92],[124,98]];
const BONES=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const HX=40,HY=50,OFF=24,NEUT=130-5+HY; // neutral = wrist landmark height
const HALF=PALM.map((p,i)=>[(p[0]+FIST[i][0])/2,(p[1]+FIST[i][1])/2]);   // a half-closed hand for the unrecognised pose
function renderLiveCam(){let s="";const g=S.gesture,W=320,H=240;
  if(CAM.tracking&&CAM.lm){const P=CAM.lm.map(p=>[(CAM.mirror?1-p.x:p.x)*W,p.y*H]);  // matches the preview (mirrored for the front camera)
    if((gAct()||g==="unrecognized")&&CAM.neutral!=null){const ny=CAM.neutral*H,cy=P[0][1],dz=GEST.dead*H;
      s+=`<rect x="0" y="${ny-dz}" width="${W}" height="${2*dz}" fill="#fff" fill-opacity=".08"/>`;
      s+=`<line x1="0" y1="${ny}" x2="${W}" y2="${ny}" stroke="#fff" stroke-opacity=".8" stroke-dasharray="4 4"/><text x="${W-44}" y="${ny-dz-4}" fill="#fff" font-size="9" text-anchor="end">neutral</text>`;
      s+=`<line x1="${P[0][0]}" y1="${ny}" x2="${P[0][0]}" y2="${cy}" stroke="${K.own}" stroke-width="2.5"/>`;}
    s+=`<g stroke="${K.own}" stroke-width="2" stroke-linecap="round">${BONES.map(([a,b])=>`<line x1="${P[a][0]}" y1="${P[a][1]}" x2="${P[b][0]}" y2="${P[b][1]}"/>`).join("")}</g>`;
    P.forEach(([x,y],i)=>s+=`<circle cx="${x}" cy="${y}" r="${i===0?3.5:2.4}" fill="${K.friend}"/>`);
    if(CAM.label){const xs=P.map(p=>p[0]),ys=P.map(p=>p[1]),x0=Math.min(...xs)-8,y0=Math.min(...ys)-8,x1=Math.max(...xs)+8,y1=Math.max(...ys)+8,lbl=CAM.label+(g==="confirming"?` · confirming ${confirmPct()}%`:""),w=lbl.length*6.3+12,col=CAM.label.startsWith("Unrecognized")?K.caut:K.sel;
      s+=`<rect x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" fill="none" stroke="${col}" stroke-width="2"/><rect x="${(x0+x1)/2-w/2}" y="${y0-22}" width="${w}" height="18" fill="#111"/><text x="${(x0+x1)/2}" y="${y0-9}" fill="${col}" font-size="11" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${lbl}</text>`;}}
  else if(CAM.tracking&&g==="lost"){s+=`<rect x="80" y="100" width="160" height="38" fill="#111" fill-opacity=".85" stroke="${K.caut}"/><text x="160" y="116" fill="${K.caut}" font-size="11" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">No hand in frame</text><text x="160" y="130" fill="#BBB" font-size="9" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">Held units holding altitude</text>`;}
  if(CAM.tracking)s+=`<text x="46" y="232" fill="${CAM.fps>=15?K.grn:K.caut}" font-size="10" font-weight="700">${CAM.fps} fps</text>`;
  $("camSvg").innerHTML=s;}
function renderCam(){
  if(CAM.on){renderLiveCam();return;}
  const g=S.gesture,act=gAct(),wob=Math.sin(S.wob)*1.6,dy=(g==="climb"?-OFF:g==="descend"?OFF:0)+wob;let s="";
  s+=`<rect width="320" height="240" fill="#000"/><text x="160" y="22" fill="#687566" font-size="10" font-weight="700" text-anchor="middle" letter-spacing=".08em">CAMERA OFF${g!=="idle"&&g!=="lost"?" · SIM":""}</text>`;
  if(act){const dz=GEST.dead*240;s+=`<rect x="0" y="${NEUT-dz}" width="320" height="${2*dz}" fill="#fff" fill-opacity=".08"/><line x1="0" y1="${NEUT}" x2="320" y2="${NEUT}" stroke="#FFFFFF" stroke-opacity=".75" stroke-dasharray="4 4"/><text x="276" y="${NEUT-dz-4}" fill="#fff" font-size="9" text-anchor="end">neutral</text>`;
    const cy=NEUT+dy;s+=`<line x1="52" y1="${NEUT}" x2="52" y2="${cy}" stroke="${K.own}" stroke-width="2.5"/><path d="M46 ${cy+(dy<0?6:-6)}L52 ${cy}L58 ${cy+(dy<0?6:-6)}" fill="none" stroke="${K.own}" stroke-width="2.5"/>`;}
  if(act||g==="locked"||g==="confirming"||g==="unrecognized"){
    const shape=g==="locked"?FIST:g==="unrecognized"?HALF:PALM,off=act?dy:wob,pts=shape.map(([x,y])=>[x+HX,y-5+HY+off]),col=g==="unrecognized"?K.caut:K.sel;
    s+=`<g stroke="${K.own}" stroke-width="1.5" stroke-linecap="round">${BONES.map(([a,b])=>`<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}"/>`).join("")}</g>`;
    pts.forEach(([x,y],i)=>s+=`<circle cx="${x}" cy="${y}" r="${i===9?3:2.2}" fill="${K.friend}"/>`);
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),x0=Math.min(...xs)-8,y0=Math.min(...ys)-8,x1=Math.max(...xs)+8,y1=Math.max(...ys)+8,lbl=g==="locked"?"Closed Fist":g==="unrecognized"?"Unrecognized":g==="confirming"?"Open Palm · confirming":"Open Palm",w=lbl.length*6.3+12;
    s+=`<rect x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" fill="none" stroke="${col}" stroke-width="2"/>`;
    s+=`<rect x="${(x0+x1)/2-w/2}" y="${y0-24}" width="${w}" height="18" fill="#111"/><text x="${(x0+x1)/2}" y="${y0-11}" fill="${col}" font-size="11" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${lbl}</text>`;
  }else{const lost=g==="lost";
    s+=`<rect x="80" y="100" width="160" height="38" fill="#111" stroke="${lost?K.caut:"#555"}"/>`;
    s+=`<text x="160" y="116" fill="${lost?K.caut:"#fff"}" font-size="11" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${lost?"No hand in frame":"Camera off"}</text><text x="160" y="130" fill="#BBB" font-size="9" text-anchor="middle" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${lost?"Held units holding altitude":"Tap the camera icon above to start"}</text>`;}
  $("camSvg").innerHTML=s;
}

/* =====================================================================
   DRONE CAMERA FEEDS (simulated forward camera; needs camera deck hardware)
   ===================================================================== */
function buildFeeds(){
  $("fheadSlot").appendChild($("fhead"));$("sideFeed").innerHTML="";
  $("feeds").innerHTML=drones.map(d=>`<div class="dfeed" data-f="${d.id}" role="img" aria-label="${U(d.id)} video">
    <span class="fh"><span class="num">${d.n}</span>${U(d.id)}<span class="st" id="fst-${d.id}">--</span></span>
    <svg id="fv-${d.id}" viewBox="0 0 240 190" preserveAspectRatio="xMidYMid meet" style="overflow:hidden"></svg>
    <span class="fstat"><span class="lnk" id="flk-${d.id}">LINK OK</span>
      <span class="bat" id="fbat-${d.id}" title="Battery"><i></i></span><span class="m" id="fbatv-${d.id}">--</span></span></div>`).join("");
}
const FS:Record<string,{w:number;h:number}>={};
function renderFeed(d:Drone){
  const box=FS[d.id]||{w:240,h:190},W=240,H=190,cx=W/2,z=Math.max(0.06,d.z),yr=d.yaw*Math.PI/180;
  const lat=d.x*Math.cos(yr)-d.y*Math.sin(yr),fwd=d.x*Math.sin(yr)+d.y*Math.cos(yr);
  const hy=H/2+d.pitch*4,F=150;let s="";
  const cut=S.stopped&&d.z<0.02;
  s+=`<g transform="rotate(${-d.roll} ${cx} ${H/2})">`;
  s+=`<rect x="-900" y="-900" width="2040" height="${hy+900}" fill="#3A3D3A"/><rect x="-900" y="${hy}" width="2040" height="1200" fill="#262826"/>`;
  // wall panel seams (move with yaw)
  const yo=((d.yaw%30)+30)%30;for(let k=-22;k<34;k++){const wx=k*40-yo*40/30;s+=`<line x1="${wx}" y1="${hy-70}" x2="${wx}" y2="${hy}" stroke="#4A4E4A" stroke-width="1"/>`;}
  s+=`<rect x="-900" y="${hy-74}" width="2040" height="4" fill="#2E312E"/>`;
  // floor grid in perspective, 0.5 m pitch
  const lo=((lat%0.5)+0.5)%0.5;
  for(let k=-24;k<=24;k++){const X=(k*0.5-lo);const bx=cx+X*F/z*0.8;s+=`<line x1="${cx+(bx-cx)*0.02}" y1="${hy}" x2="${cx+(bx-cx)*3}" y2="${hy+3*F*0.35}" stroke="#555A55" stroke-width=".8"/>`;}
  const fo=((fwd%0.5)+0.5)%0.5;
  for(let n=1;n<14;n++){const D=n*0.5-fo+0.25;const y=hy+F*z/D*0.9;if(y>H+40)continue;s+=`<line x1="-900" y1="${y}" x2="1140" y2="${y}" stroke="#555A55" stroke-width=".8"/>`;}
  s+=`</g>`;
  // link degradation → sensor noise
  if(S.degraded){for(let i=0;i<14;i++){const y=Math.random()*H;s+=`<rect x="0" y="${y}" width="${W}" height="${1+Math.random()*2}" fill="#fff" opacity="${.05+Math.random()*.12}"/>`;}}
  if(connState(d)==="lost")s+=`<rect x="-900" y="-900" width="2040" height="2040" fill="#000" opacity=".82"/><text x="${cx}" y="${H/2+4}" fill="#F2453D" font-size="13" font-weight="700" text-anchor="middle">NO SIGNAL</text>`;
  else if(cut)s+=`<rect width="${W}" height="${H}" fill="#000" opacity=".7"/><text x="${cx}" y="${H/2+4}" fill="#F2453D" font-size="12" text-anchor="middle">MOTORS CUT</text>`;
  // HUD
  s+=`<g stroke="#E1E8DF" stroke-width="1.2" fill="none" opacity=".85"><path d="M${cx-18} ${H/2}H${cx-6}M${cx+6} ${H/2}H${cx+18}M${cx} ${H/2-12}V${H/2-4}M${cx} ${H/2+4}V${H/2+12}"/></g>`;
  s+=`<g stroke="${K.grn}" stroke-width="1.4" fill="none" transform="rotate(${-d.roll} ${cx} ${H/2})"><path d="M${cx-60} ${H/2+d.pitch*4}H${cx-30}M${cx+30} ${H/2+d.pitch*4}H${cx+60}"/></g>`;
  if(S.degraded&&connState(d)!=="lost")s+=`<rect x="0" y="${H-18}" width="${W}" height="18" fill="#000" opacity=".55"/><text x="6" y="${H-5}" fill="${K.caut}" font-size="11">LINK WEAK (sim)</text>`;
  if(connState(d)==="lost")s+=`<rect x="-900" y="-900" width="2040" height="2040" fill="#050505"/><text x="${cx}" y="${H/2+4}" fill="#F2453D" font-size="13" font-weight="700" text-anchor="middle">NO SIGNAL</text>`;
  // widen/heighten the viewBox so the scene fills the tile without letterboxing
  const ar=box.w/box.h;let vb;
  if(ar>W/H){const vw=H*ar;vb=`${(W-vw)/2} 0 ${vw} ${H}`;}else{const vh=W/ar;vb=`0 ${(H-vh)/2} ${W} ${vh}`;}
  const el=$("fv-"+d.id);el.setAttribute("viewBox",vb);el.innerHTML=s;
  updFeedStat(d);
  const[st,k]=flightState(d),e=$("fst-"+d.id);e.textContent=st;e.style.color={ok:K.grn,own:K.own,caut:K.caut,crit:K.crit,"":K.tx2}[k];
}
function updFeedStat(d:Drone){
  const pct=batteryLevel(d.vbat),c=connState(d),bk=d.vbat<BAT_CRIT?"crit":pmState(d)==="lowPower"?"crit":d.vbat<BAT_LOW?"warn":"";
  const lk=$("flk-"+d.id);lk.textContent=c==="lost"?"LINK LOST":c==="weak"?"LINK WEAK":"LINK OK";lk.className="lnk "+(c==="lost"?"crit":c==="weak"?"warn":"");
  const bt=$("fbat-"+d.id);bt.className="bat "+bk;(bt.firstElementChild as HTMLElement).style.width=Math.max(1,pct/90*14)+"px";
  const bv=$("fbatv-"+d.id);bv.textContent=volts(d).toFixed(2)+" V";bv.className="m "+bk;
}
function renderFeeds(){drones.forEach(d=>{const t=document.querySelector<HTMLElement>(`.dfeed[data-f="${d.id}"]`);if(t&&!t.classList.contains("off"))renderFeed(d);});document.querySelectorAll<HTMLElement>(".dfeed").forEach(b=>{b.classList.toggle("on",b.dataset.f===S.video);b.classList.toggle("held",isHeld(drones.find(x=>x.id===b.dataset.f)!));});}

/* =====================================================================
   SIDE PANEL
   ===================================================================== */
function renderSide(){
  // left panel: what the gesture is commanding, and for which held drones
  const g=S.gesture,hl=drones.filter(isHeld),to=hl.length?hl.map(x=>U(x.id)).join(" + "):"no drone held";let main,sub,k;
  const landing=hl.find(d=>(d.landT??0)>0),down=hl.find(d=>d.landing&&d.z>0.02),up=hl.find(d=>d.zTarget!=null&&!d.landing);
  if(gAct()&&landing){main=`Keep lowering to land ${U(landing.id)}`;sub=`${Math.max(0,GEST.landHold-landing.landT!).toFixed(1)} s`;k="warn";}
  else if(down){main=`Landing ${U(down.id)}`;sub=to;k="ok";}
  else if(up){main=`Lifting off ${U(up.id)}`;sub=to;k="ok";}
  else if(gAct()){if(!hl.length){main="Hold a drone to use altitude";sub="Gesture active";k="idle";}
    else if(S.altBlock){main=`Paused: ${U(S.altBlock.d.id)} at ${S.altBlock.why}`;sub="Release it or reverse the gesture";k="warn";}
    else{const r=S.appliedRate;main=Math.abs(r)<0.005?"Palm at neutral, holding":`${r>0?"▲ Climbing":"▼ Descending"} ${Math.abs(r).toFixed(2)} m/s`;sub=to;k="ok";}}
  else if(g==="confirming"){main="Hold the open palm steady";sub=CAM.tracking?`Confirming, ${confirmPct()}%`:"Confirming";k="idle";}
  else if(g==="locked"){main="Altitude locked";sub=to;k="lock";}
  else if(g==="lost"){main="Hand lost, holding altitude";sub="Show an open palm to activate again";k="warn";}
  else if(g==="unrecognized"){main="Pose not recognised, holding";sub="Open palm resumes, fist locks";k="warn";}
  else{main="Show an open palm to start";sub="";k="idle";}
  const gs=$("gstat");gs.dataset.k=k;$("gMain").textContent=main;$("gSub").textContent=sub;
  // video panel: Take off / Land act on the drone shown (it follows the most recently touched held drone)
  const v=videoD(),bl=$<HTMLButtonElement>("btnLandSel"),bt=$<HTMLButtonElement>("btnTakeoffSel");
  bl.querySelector<HTMLElement>("small")!.textContent=U(v.id);bl.disabled=v.z<=0.02||v.landing||S.stopped||v.crashed;
  bt.querySelector<HTMLElement>("small")!.textContent=U(v.id);
  // only one of the two is ever usable, so show just the selected drone's next action
  const vUp=v.z>0.02&&!v.landing&&!v.crashed;bl.hidden=!vUp;bt.hidden=vUp;bt.disabled=v.z>0.05||v.zTarget!=null||S.stopped||connState(v)==="lost";
  // right panel also shows the held drones' current altitude (§1.7.3.5)
  $("heldAlt").innerHTML=`<span class="t">HELD ALTITUDE</span>`+(hl.length?hl.map(d=>`<div><span>${U(d.id)}</span><b class="m">${d.z.toFixed(2)} m</b></div>`).join(""):`<div class="none">No drone held</div>`);
}

/* =====================================================================
   TOP BAR + TIMELINE
   ===================================================================== */
function renderTrialCtl(){const T=S.trial,run=T.running;$("trSession").textContent=`Next participant (S${S.session+1})`;$("trGo").hidden=run;$("trRun").hidden=!run;$<HTMLButtonElement>("trVoid").disabled=!run;$<HTMLButtonElement>("trCol").disabled=!run;
  if(!run){$("trNext").textContent=trialId();$("trGo").classList.toggle("wait",!!trialBlocker());}}
function renderTop(){renderTrialCtl();
  // on/off status dot on each video selector button
  document.querySelectorAll<HTMLElement>("[data-fs]").forEach(b=>{const d=drones.find(x=>x.id===b.dataset.fs)!;if(!d)return;const c=connState(d);
    b.title=`${U(d.id)} ${c==="lost"?"offline":c==="weak"?"online, weak signal":"online"}`;});
  // per-drone battery and radio signal (Figure 1; telemetry §1.7.3.7). Flight state lives in Telemetry and the video header.
  drones.forEach(d=>{const el=$("ds-"+d.id);if(!el)return;const pct=batteryLevel(d.vbat),lq=linkQ(d),hs=healthOf(d),
      bk=pmState(d)==="lowPower"?"crit":d.vbat<BAT_LOW?"warn":"",sk=lq===0?"crit":lq<70?"warn":"",bars=lq===0?0:lq>90?4:lq>70?3:lq>45?2:1;
    const bt=el.querySelector<HTMLElement>(".bt")!;bt.className="bt "+bk;(bt.firstElementChild as HTMLElement).style.width=Math.max(1,pct/90*12)+"px";
    const v=el.querySelector<HTMLElement>(".v")!;v.textContent=pct+"%";v.className="m v "+bk;
    const sg=el.querySelector<HTMLElement>(".sg")!;sg.className="sg "+sk;[...sg.children].forEach((b,i)=>b.classList.toggle("on",i<bars));
    el.querySelector<HTMLElement>("b")!.style.color=hs.k==="crit"?"var(--crit)":"";
    el.title=`${U(d.id)}: pm.vbat ${d.vbat.toFixed(2)} V, pm.batteryLevel ${pct}%, link quality ${lq}%. Health: ${hs.text}`;});
  // trial clock (host-owned in the real system)
  const T=S.trial,tc=$("trialChip");if(!tc)return;   // the trial is shown in Telemetry, not on the main screen
  if(T.running){tc.className="trial run";tc.innerHTML=`<b>${trialId()}</b><span class="m">${fmtMS(S.t-T.t0)} / ${fmtMS(CONFIG.timeLimit)}</span>`;}
  else if(T.last){const f=T.last.outcome==="collision"||T.last.outcome==="timeout";tc.className="trial"+(f?" fail":"");
    tc.innerHTML=`<b>${T.last.id}</b><span>${f?"Failed: "+T.last.outcome:T.last.outcome==="completed"?"Completed":"Aborted"} ${fmtMS(T.last.elapsed)}</span>`;}
  else{tc.className="trial";tc.innerHTML=`<b>${trialId()}</b><span>Ready</span>`;}
}
// radio link quality in % (Crazyradio acknowledged packets); 0 when the link is lost
function linkQ(d:Drone){return connState(d)==="lost"?0:S.degraded?61:d.link;}
function connState(d:Drone):"ok"|"weak"|"lost"{if(S.cf3Lost&&d.id==="cf3")return"lost";return S.degraded?"weak":"ok";}
function renderLog(){
  const L=S.log[S.log.length-1];
  $("logLatest").textContent=L?L.text:"";$("lastDot").dataset.k=L?L.k:"";
}
/* ---------- Telemetry / Logs tab ---------- */
let TAB:"map"|"tel"="map";
function setTab(t:"map"|"tel"){if(t===TAB)return;TAB=t;
  $("tabMap").setAttribute("aria-selected",String(t==="map"));$("tabTel").setAttribute("aria-selected",String(t==="tel"));
  $("mapbody").hidden=t!=="map";$("telPane").hidden=t!=="tel";
  if(t==="tel"){ // the map is hidden, so nothing can stay held by a finger on it
    pointers.clear();drones.forEach(d=>{if(d.pHeld){d.pHeld=false;d.blocked=null;d.blockPt=null;log(`${U(d.id)} released (map hidden)`);}});renderTelemetry();}
  else requestAnimationFrame(()=>{fitMap();measure();});}
$("tabMap").addEventListener("click",()=>setTab("map"));$("alertOk").addEventListener("click",()=>{S.alert=null;renderAlert();});$("tabTel").addEventListener("click",()=>setTab("tel"));
function rangeCell(d:Drone,k:Dir){const r=d.ranges&&d.ranges[k];if(!airborne(d))return`<td class="dim">--</td>`;if(r==null)return`<td class="dim">&gt;4 m</td>`;
  return`<td class="${r<MR.trig?"crit":r<MR.show?"warn":""}">${r.toFixed(2)}</td>`;}
function protoState(d:Drone){return S.stopped?"stopped":d.landing&&d.z>0.02?"landing":d.zTarget!=null&&!d.landing?"taking_off":d.z>0.02?"flying":"grounded";}
function renderTelemetry(){if(TAB!=="tel")return;
  // fields follow protocol v1 telemetry and the Crazyflie firmware logs; "Below" is computed (DEC-19)
  let h=`<thead><tr><th rowspan="2">Drone</th><th rowspan="2">state</th><th rowspan="2">defensive_hover</th><th colspan="2" class="grp">Radio</th><th colspan="2" class="grp">Battery</th><th colspan="4" class="grp">Pose, motion capture (m, °)</th><th colspan="3" class="grp">cmd (m)</th><th colspan="5" class="grp">ranges, Multi-ranger (m)</th><th rowspan="2">Below (m)<br><span style="font-weight:400">computed</span></th><th rowspan="2">held</th></tr>
    <tr><th>link</th><th>quality</th><th>pm.vbat</th><th>level</th><th>x</th><th>y</th><th>z</th><th>yaw</th><th>x</th><th>y</th><th>z</th><th>front</th><th>back</th><th>left</th><th>right</th><th>up</th></tr></thead><tbody>`;
  drones.forEach(d=>{const c=connState(d),lq=linkQ(d),cz=d.zTarget!=null?d.zTarget:d.z,st=protoState(d);
    h+=`<tr><td><b>${U(d.id)}</b></td><td class="${st==="stopped"?"crit":st==="flying"?"ok":st==="grounded"?"dim":"own"}">${st}</td><td class="${d.dh?"caut":"dim"}">${d.dh?`${d.dh.dir} ${d.dh.range.toFixed(2)}`:"null"}</td>
      <td class="${c==="lost"?"crit":"ok"}">${c==="lost"?"lost":"ok"}</td><td class="${lq<70?"warn":""}">${lq}%</td>
      <td class="${pmState(d)==="lowPower"?"crit":d.vbat<BAT_LOW?"warn":""}">${d.vbat.toFixed(2)} V</td><td>${batteryLevel(d.vbat)}%</td>
      <td>${d.x.toFixed(2)}</td><td>${d.y.toFixed(2)}</td><td>${d.z.toFixed(2)}</td><td>${Math.round(((d.yaw+180)%360+360)%360-180)}</td>
      <td>${d.tx.toFixed(2)}</td><td>${d.ty.toFixed(2)}</td><td>${cz.toFixed(2)}</td>${DIRS.map(k=>rangeCell(d,k)).join("")}${d.below&&airborne(d)?`<td class="${d.below.dist<MR.trig?"crit":d.below.dist<MR.show?"warn":""}">${d.below.dist.toFixed(2)} <span class="dim">${d.below.what}</span></td>`:`<td class="dim">--</td>`}<td class="${isHeld(d)?"own":"dim"}">${isHeld(d)?"true":"false"}</td></tr>`;});
  $("telTable").innerHTML=h+"</tbody>";
  const g=S.gesture,gName={idle:"Idle",confirming:"Confirming",climb:"Active",descend:"Active",locked:"Locked",lost:"Hand lost",unrecognized:"Unrecognised pose"}[g]||g;
  $("telAlt").innerHTML=`<dt>Gesture state</dt><dd>${gName}</dd><dt>Source</dt><dd>${CAM.tracking?`Camera, ${CAM.fps} fps`:"Simulation controls"}</dd>
    <dt>Requested rate</dt><dd>${sg(gAct()?rateCmd():0)} m/s</dd><dt>Applied rate</dt><dd>${sg(S.appliedRate)} m/s</dd>
    <dt>Paused by</dt><dd class="${S.altBlock?"warn":""}">${S.altBlock?`${U(S.altBlock.d.id)}, ${S.altBlock.why}`:"--"}</dd>
    <dt>Limits</dt><dd>${CONFIG.z.min.toFixed(2)}–${CONFIG.z.max.toFixed(2)} m, max ${CONFIG.rateMax.toFixed(2)} m/s</dd>`;
  const T=S.trial,L=T.last;
  $("telTrial").innerHTML=`<dt>Trial</dt><dd>${T.running?trialId():L?L.id:trialId()}</dd><dt>Restricted zone</dt><dd>Blocking drags</dd>
    <dt>Status</dt><dd class="${T.running?"ok":L&&(L.outcome==="collision"||L.outcome==="timeout")?"crit":""}">${T.running?"Running":L?OUT[L.outcome!]:"Not started"}</dd>
    <dt>Elapsed</dt><dd>${T.running?fmtMS(S.t-T.t0):L?fmtMS(L.elapsed):"--"} / ${fmtMS(CONFIG.timeLimit)}</dd>
    <dt>Hoops passed</dt><dd>${T.running&&T.prog?drones.map(d=>`${d.id.slice(2)}: ${T.prog![d.id]}/${CONFIG.hoops.length}`).join(", "):"--"}</dd>
    <dt>Defensive hovers</dt><dd>${T.running?T.dh:L?L.dh:0}</dd><dt>Drag restrictions</dt><dd>${T.running?T.restrict:L?L.restrict:0}</dd><dt>Layout</dt><dd>${CONFIG.layout?`Motive, ${new Date(CONFIG.layout.synced).toLocaleTimeString()}`:"Figure 5"}</dd>`;
  let hh=`<thead><tr><th>Drone</th><th>Status</th><th>pm.state</th><th>sys.canfly</th><th>sys.isTumbled</th><th>health.motorPass</th><th>health.batterySag</th><th>Last check</th></tr></thead><tbody>`;
  drones.forEach(d=>{const hs=healthOf(d),h=d.health;
    hh+=`<tr><td><b>${U(d.id)}</b></td><td class="${hs.k}">${hs.text}</td><td class="${pmState(d)==="lowPower"?"crit":""}">${pmState(d)}</td><td>${!(d.tumbled||connState(d)==="lost")}</td><td class="${d.tumbled?"crit":""}">${!!d.tumbled}</td>
      <td>${h&&h.motorPass?h.motorPass.map((p,i)=>`<span class="${p?"ok":"crit"}">M${i+1}</span>`).join(" "):"<span class=dim>--</span>"}</td>
      <td class="${h&&!h.batPass?"crit":""}">${h?`${h.sag.toFixed(2)} V ${h.batPass?"pass":"fail"}`:"<span class=dim>--</span>"}</td><td>${h?`T+${fmtT(h.at)}`:"<span class=dim>never</span>"}</td></tr>`;});
  $("telHealth").innerHTML=hh+"</tbody>";
  renderLogView();}
// Event log: every event carries its session and trial. "All events" puts a divider wherever the trial changes;
// choosing a finished or running trial shows its record and only its events, timed from the trial start.
const OUT:Record<Outcome,string>={completed:"Completed",hardware_abort:"Voided, hardware fault",collision:"Failed, collision",timeout:"Failed, time limit"};
function trialList(){const L=[...S.trials];if(S.trial.running)L.push({id:trialId(),session:sessionId(),t0:S.trial.t0,t1:null,outcome:null,dh:S.trial.dh,restrict:S.trial.restrict,elapsed:S.t-S.trial.t0});return L;}
function renderLogView(){const sel=$<HTMLSelectElement>("logView"),L=trialList();
  // one ID per event: its trial (S1-T2) when it happened during a trial, otherwise its session (S1)
  const idOf=(e:LogEntry)=>e.tr||e.ses||"",sessions=[...new Set([...S.log.map(e=>e.ses),sessionId()].filter(Boolean))];
  const key=sessions.join()+"|"+L.map(t=>t.id+(t.outcome||"")).join();
  // two filters: pick a participant session, then (optionally) one of that session's trials
  const ss=$<HTMLSelectElement>("logSes");if(S.logSes!=="all"&&!sessions.includes(S.logSes))S.logSes="all";
  if(sel.dataset.key!==key+"|"+S.logSes){sel.dataset.key=key+"|"+S.logSes;
    ss.innerHTML=`<option value="all">All</option>`+sessions.map(x=>`<option value="${x}">${x}</option>`).join("");ss.value=S.logSes;
    const mine=L.filter(t=>t.session===S.logSes);
    sel.innerHTML=`<option value="all">All</option>`+mine.map(t=>`<option value="${t.id}">${t.id.split("-")[1]} · ${t.outcome?OUT[t.outcome]:"running"}</option>`).join("");
    if(!mine.some(t=>t.id===S.logView))S.logView="all";sel.value=S.logView;sel.disabled=S.logSes==="all"||!mine.length;}
  const v=S.logView!=="all"?S.logView:S.logSes,tr=L.find(t=>t.id===v),ses=sessions.includes(v)?v:null,sum=$("logSum");
  const ev=tr?S.log.filter(e=>e.tr===tr.id):ses?S.log.filter(e=>e.ses===ses):S.log;
  if(tr){sum.hidden=false;
    sum.innerHTML=`<dt>Trial</dt><dd>${tr.id}</dd><dt>Outcome</dt><dd class="${tr.outcome==="completed"?"ok":tr.outcome?"crit":""}">${tr.outcome?OUT[tr.outcome]:"Running"}</dd><dt>Started</dt><dd>T+${fmtT(tr.t0)}</dd><dt>Ended</dt><dd>${tr.t1!=null?"T+"+fmtT(tr.t1):"running"}</dd>
      <dt>Time</dt><dd>${fmtMS(tr.elapsed)} / ${fmtMS(CONFIG.timeLimit)}</dd><dt>Defensive hovers</dt><dd>${tr.dh}</dd><dt>Drag restrictions</dt><dd>${tr.restrict}</dd><dt>Events</dt><dd>${ev.length}</dd>`;}
  else if(ses){const T=L.filter(t=>t.session===ses),done=T.filter(t=>t.outcome==="completed").length,fail=T.filter(t=>t.outcome==="collision"||t.outcome==="timeout").length;sum.hidden=false;
    sum.innerHTML=`<dt>Participant session</dt><dd>${ses}</dd><dt>Trials</dt><dd>${T.length}</dd><dt>Started</dt><dd>${ev.length?"T+"+fmtT(ev[0].t):"--"}</dd><dt>Last event</dt><dd>${ev.length?"T+"+fmtT(ev[ev.length-1].t):"--"}</dd>
      <dt>Completed</dt><dd class="ok">${done}</dd><dt>Failed</dt><dd class="${fail?"crit":""}">${fail}</dd><dt>Aborted</dt><dd>${T.filter(t=>t.outcome==="hardware_abort").length}</dd><dt>Events</dt><dd>${ev.length}</dd>`;}
  else sum.hidden=true;
  $("logCount").textContent=!tr&&!ses?`${S.log.length} events`:`${ev.length} of ${S.log.length} events`;
  let h=`<li class="lh"><span>Time</span><span>${tr?"In trial":"ID"}</span><span></span><span>Event</span></li>`,prev="";
  [...ev].reverse().forEach((e,i)=>{const k=idOf(e);
    if(!tr&&(i===0||k!==prev)){const t=e.tr&&L.find(x=>x.id===e.tr);
      h+=`<li class="ldiv" role="separator"><span>${e.tr?`${e.tr} · ${t&&t.outcome?OUT[t.outcome]:"running"}`:`${e.ses} · between trials`}</span></li>`;}
    prev=k;h+=`<li><span class="t">T+${fmtT(e.t)}</span><span class="m">${tr?fmtMS(Math.max(0,e.t-tr.t0)):k}</span><span class="dot" data-k="${e.k}"></span><span>${e.text}</span></li>`;});
  $("telLog").innerHTML=h;}
$("logView").addEventListener("change",e=>{S.logView=(e.target as HTMLSelectElement).value;renderLogView();});
$("logSes").addEventListener("change",e=>{S.logSes=(e.target as HTMLSelectElement).value;S.logView="all";renderLogView();});
$("logToggle").addEventListener("click",()=>setTab("tel"));
document.querySelectorAll<HTMLElement>(".sec>button,.camhead>button:first-child").forEach(b=>b.addEventListener("click",()=>{const c=b.closest(".sec")!.classList.toggle("closed");b.setAttribute("aria-expanded",String(!c));}));

/* =====================================================================
   SIMULATION LOOP
   ===================================================================== */
function update(dt:number){
  S.t+=dt;liveGesture();S.wob+=dt*2.2;const Z=CONFIG.z;
  senseAll();
  // Onboard defensive hover (§1.7.3.7): a reading under the trigger distance stops translation and holds
  // position until that side clears, or the operator drags the drone the other way.
  drones.forEach(d=>{if(!airborne(d)){d.dh=null;return;}
    if(d.dh){const r=d.ranges[d.dh.dir];if(r==null||r>=MR.clear){log(`${U(d.id)} defensive hover cleared`,"ok");d.dh=null;}else d.dh.range=r;}
    if(!d.dh){let k:Dir|null=null as Dir|null;DIRS.forEach(dir=>{const r=d.ranges[dir];if(r!=null&&r<MR.trig&&(!k||r<d.ranges[k]!))k=dir;});
      if(k){d.dh={dir:k,range:d.ranges[k]!};d.mvx=d.mvy=0;log(`${U(d.id)} defensive hover, obstacle ${d.ranges[k]!.toFixed(2)} m ${k}`,"warn");if(S.trial.running)S.trial.dh++;}}});
  // Shared altitude rate (§1.7.2): the same rate for every held drone. If one cannot follow,
  // the rate pauses for all of them so their altitude offsets hold (OPEN-03).
  const rate=gAct()&&!S.stopped?rateCmd():0;let block:{d:Drone;why:string}|null=null as {d:Drone;why:string}|null;
  // Lift-off and landing with the altitude channel (§1.7.6): raising the hand lifts held grounded drones to the
  // 0.5 m flight floor (SO2); lowering the hand for GEST.landHold s with a held drone at the floor lands it.
  drones.forEach(d=>{if(!isHeld(d)||S.stopped||d.crashed||connState(d)==="lost"){d.landT=0;return;}
    if(d.z<=0.02&&d.zTarget==null&&rate>0){d.landing=false;d.zTarget=Z.min;log(`${U(d.id)} lifting off (gesture) to ${Z.min.toFixed(2)} m`);}
    if(airborne(d)&&!d.landing&&d.zTarget==null&&rate<0&&d.z<=Z.min+1e-3){d.landT=(d.landT||0)+dt;
      if(d.landT>=GEST.landHold){d.landT=0;landOne(d,`${U(d.id)} landing (gesture)`);}}else d.landT=0;});
  if(rate)drones.forEach(d=>{if(block||!isHeld(d)||!airborne(d))return;
    if(rate>0&&d.z>=Z.max-1e-3)block={d,why:"maximum altitude"};
    else if(rate<0&&d.z<=Z.min+1e-3)block={d,why:"minimum altitude"};
    else if(d.dh&&!(d.dh.dir==="up"&&rate<0))block={d,why:"defensive hover"};});
  const bk=block?block.d.id+block.why:null;
  if(bk!==S.altBlockKey){S.altBlockKey=bk;if(block&&block.why!=="minimum altitude")log(`Shared ${rate>0?"climb":"descent"} paused: ${U(block.d.id)} at ${block.why}`,"warn");}
  S.altBlock=block;S.appliedRate=block?0:rate;
  drones.forEach(d=>{
    const x0=d.x,y0=d.y,z0=d.z;if(airborne(d))d.vbat=Math.max(2.9,d.vbat-dt*0.00025);if(S.lowBatt&&d.id==="cf3")d.vbat=Math.min(d.vbat,3.15);
    d.lowT=d.vbat<BAT_LOW?(d.lowT||0)+dt:0;
    if(S.stopped||d.crashed){d.z=Math.max(0,d.z-dt*2.2);d.mvx=d.mvy=0;}
    else{
      if(d.zTarget!=null){const dz=d.zTarget-d.z,st=0.35*dt;if(Math.abs(dz)<=st){d.z=d.zTarget;d.zTarget=null;if(d.landing){d.landing=false;d.z=0;log(`${U(d.id)} landed`,"ok");}}else d.z+=Math.sign(dz)*st;}
      else if(airborne(d)&&isHeld(d)&&S.appliedRate)d.z=clamp(d.z+S.appliedRate*dt,Z.min,Z.max);
      d.clampMax=d.z>=Z.max-1e-3;d.clampMin=d.z<=Z.min+1e-3;
      if(airborne(d)){ // straight toward the operator's target (no route planning, §1.6.3), with inertia for smooth motion
        const dx=d.tx-d.x,dy=d.ty-d.y,hl=Math.hypot(dx,dy);let hold=false;
        if(d.dh){const u=dirVec(d,d.dh.dir);hold=!(hl>0.03&&(d.dh.dir==="up"||(dx*u[0]+dy*u[1])/hl<-0.2));}
        if(hold){d.mvx=d.mvy=0;}
        else{const sp=Math.min(CONFIG.hSpeed,hl*2.2),dvx=hl>0.002?dx/hl*sp:0,dvy=hl>0.002?dy/hl*sp:0,k=Math.min(1,dt*3.5);
          d.mvx=(d.mvx||0)+(dvx-(d.mvx||0))*k;d.mvy=(d.mvy||0)+(dvy-(d.mvy||0))*k;d.x+=d.mvx*dt;d.y+=d.mvy*dt;}
        checkHoops(d,x0,y0,z0);}
      if(d.z>0.02){const hit=collisionOf(d);if(hit){crash(d,hit.what);if(hit.other)crash(hit.other,U(d.id));}}
    }
    const a=Math.min(1,dt*6);d.vx+=((d.x-x0)/dt-d.vx)*a;d.vy+=((d.y-y0)/dt-d.vy)*a;d.vz+=((d.z-z0)/dt-d.vz)*a;
    const yr=d.yaw*Math.PI/180,fwd=d.vx*Math.sin(yr)+d.vy*Math.cos(yr),rgt=d.vx*Math.cos(yr)-d.vy*Math.sin(yr),air=airborne(d)?1:0;
    d.pitch=air*(-fwd*9+Math.sin(S.wob*1.3+d.x)*0.6);d.roll=air*(rgt*9+Math.cos(S.wob*1.1+d.y)*0.6);
  });
  const now=new Map();
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++){const a=drones[i],b=drones[j],dd=Math.hypot(a.x-b.x,a.y-b.y);
    if(airborne(a)&&airborne(b)&&dd<CONFIG.proxWarn){const key=a.id+"|"+b.id,was=S.prox.get(key);now.set(key,dd);
      if(was==null)log(`Proximity warning, ${U(a.id)} and ${U(b.id)} at ${dd.toFixed(2)} m`,"warn");
      else if(dd<CONFIG.proxCrit&&was>=CONFIG.proxCrit)log(`Collision risk, ${U(a.id)} and ${U(b.id)} at ${dd.toFixed(2)} m`,"crit");}}
  S.prox=now;
  drones.forEach(d=>{const T=d.trail,l=T[T.length-1];if(!l||Math.hypot(d.x-l[0],d.y-l[1])>0.006)T.push([d.x,d.y,S.t]);while(T.length&&S.t-T[0][2]>0.8)T.shift();});
  if(S.trial.running&&S.t-S.trial.t0>=CONFIG.timeLimit)endTrial("timeout");
  if(S.trial.running){const T=S.trial,n=CONFIG.hoops.length;
    drones.forEach(d=>{if(T.prog![d.id]!>=n&&d.z<=0.02&&atPad(d)&&!T.home![d.id]){T.home![d.id]=true;log(`${U(d.id)} landed on its start position`,"ok");}
      else if(T.home![d.id]&&(d.z>0.02||!atPad(d)))T.home![d.id]=false;});
    if(trialDone())endTrial("completed");}
}
function crash(d:Drone,what:string){if(d.crashed)return;d.crashed=true;d.tumbled=true;d.zTarget=null;d.landing=false;d.dh=null;d.pHeld=false;d.latched=false;d.tx=d.x;d.ty=d.y;
  log(`Collision: ${U(d.id)} hit ${what}`,"crit");
  S.alert=S.trial.running?`Collision: ${U(d.id)} hit ${what}. Trial ${trialId()} failed, so all drones are landing. Press Take off all to fly again.`
    :`Collision: ${U(d.id)} hit ${what} and is down. Take off ${U(d.id)} or Take off all to fly it again.`;
  if(S.trial.running)endTrial("collision");}
let last=performance.now(),acc=0,frames=0,fpsAcc=0;
let fN=0;
function frame(now:number){
  // one bad frame must never stop the loop: log the error once and keep going
  try{const dt=Math.min((now-last)/1000,0.05);last=now;update(dt);renderMap();fN++;if(fN%2===0){renderTapes();renderCam();}if(fN%3===0)renderFeeds();
    frames++;fpsAcc+=dt;acc+=dt;
    if(acc>=0.2){acc=0;renderSide();renderTop();renderTelemetry();renderAlert();}}
  catch(e){last=now;console.error(e);if(!S.frameErr){S.frameErr=true;log(`Display error: ${(e as Error).message}. The simulation keeps running.`,"crit");}}
  requestAnimationFrame(frame);}
// banner after a collision or timeout, so a grounded, unresponsive map is explained
function renderAlert(){const el=$("alertBar"),A=S.alert;el.hidden=!A;if(!A)return;$("alertTxt").textContent=A;}

/* =====================================================================
   INPUT
   ===================================================================== */
const svg=$("mapSvg") as unknown as SVGSVGElement;
function toM(e:PointerEvent):[number,number]{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM()!.inverse());return[(q.x-OX)/SC,(OY-q.y)/SC];}

svg.addEventListener("pointerdown",e=>{const g=(e.target as Element).closest<SVGElement>("[data-drone]");if(!g)return;const d=drones.find(x=>x.id===g.dataset.drone)!;
  if(d.crashed||S.stopped||connState(d)==="lost"){if(d.id!==S.video)setVideo(d.id,true);return;}  // a tap still selects it for Take off
  if([...pointers.values()].includes(d.id))return;
  e.preventDefault();pointers.set(e.pointerId,d.id);svg.setPointerCapture(e.pointerId);
  d.dragStart=[e.clientX,e.clientY];d.dragMoved=false;
  if(OPT.latch&&d.latched){/* tapping a latched drone releases it on pointerup (unless dragged) */}
  else{d.pHeld=true;if(OPT.latch)d.latched=true;log(airborne(d)?`${U(d.id)} held`:`${U(d.id)} held on its pad: raise an open palm to lift off`);S.holdOrder=S.holdOrder.filter(x=>x!==d.id);S.holdOrder.push(d.id);followVideo();}});
svg.addEventListener("pointermove",e=>{if(pointers.has(e.pointerId))e.preventDefault();const[mx,my]=toM(e),a=CONFIG.arena,inside=mx>=a.xMin&&mx<=a.xMax&&my>=a.yMin&&my<=a.yMax,t=inside?`${sg(mx)}, ${sg(my)} m`:"Offscreen";
  $("cursor").textContent=inside?t:"--";
  const id=pointers.get(e.pointerId);if(!id)return;const d=drones.find(x=>x.id===id)!,m=a.margin;if(d.landing||d.crashed||!airborne(d))return;if(Math.hypot(e.clientX-d.dragStart![0],e.clientY-d.dragStart![1])>6)d.dragMoved=true;if(!d.dragMoved)return;const cx=clamp(mx,a.xMin+m,a.xMax-m),cy=clamp(my,a.yMin+m,a.yMax-m),hit=dragPathBlocked(d,d.tx,d.ty,cx,cy);
  if(!hit){d.tx=cx;d.ty=cy;d.blocked=null;}
  else{ // reject the part of the drag that enters the restricted zone: the target stops at its edge
    let lo=0,hi=1;for(let i=0;i<14;i++){const t=(lo+hi)/2;if(dragPathBlocked(d,d.tx,d.ty,d.tx+(cx-d.tx)*t,d.ty+(cy-d.ty)*t))hi=t;else lo=t;}
    d.tx+=(cx-d.tx)*lo;d.ty+=(cy-d.ty)*lo;
    if(d.blocked!==hit){d.blocked=hit;if(S.trial.running)S.trial.restrict++;log(`${U(d.id)} drag rejected: ${/^DRONE/.test(hit)?`too close to ${hit}`:`${hit}`}`,"warn");}}
  d.blockPt=hit?[cx,cy]:null;});
svg.addEventListener("pointerleave",()=>{$("cursor").textContent="--";});
function release(e:PointerEvent){const id=pointers.get(e.pointerId);if(!id)return;pointers.delete(e.pointerId);const d=drones.find(x=>x.id===id)!;d.nfzFlag=false;d.blocked=null;d.blockPt=null;
  if(OPT.latch){ if(d.latched&&!d.pHeld&&!d.dragMoved){d.latched=false;log(`${U(d.id)} released`);} d.pHeld=false; if(d.dragMoved)log(`${U(d.id)} target ${sg(d.tx)}, ${sg(d.ty)} m`); followVideo(); return; }
  d.pHeld=false;log(`${U(d.id)} released, target ${sg(d.tx)}, ${sg(d.ty)} m`);followVideo();}
// The video feed follows touch: holding a drone selects it (§1.7.3.5), and the operator selects the feed (§1.6.3).
// With several drones held, the one touched most recently is shown. When it is released, the feed moves to the
// most recently touched drone still held; with none held it stays where it is. The 1 / 2 / 3 buttons still override.
function followVideo(){S.holdOrder=S.holdOrder.filter(id=>{const d=drones.find(x=>x.id===id)!;return d&&isHeld(d);});
  const id=S.holdOrder[S.holdOrder.length-1];if(id&&id!==S.video)setVideo(id,true);}
function setVideo(id:string,auto?:boolean){OPT.feed=id;S.video=id;Object.keys(OPT.feedSel).forEach(x=>OPT.feedSel[x]=x===id);
  document.querySelectorAll<HTMLElement>(".dfeed").forEach(t=>t.classList.toggle("off",!OPT.feedSel[t.dataset.f!]));placeFeeds();syncSettings();measure();renderSide();
  log(`Video: ${U(id)}${auto?"":" (manual)"}`);}
svg.addEventListener("pointerup",release);svg.addEventListener("pointercancel",release);

/* =====================================================================
   COMMANDS
   ===================================================================== */
function landOne(d:Drone,msg?:string){if(d.z<=0.02||S.stopped||d.crashed)return;d.landing=true;d.zTarget=0;d.tx=d.x;d.ty=d.y;log(msg||`${U(d.id)} landing`);}
function landAll(msg?:string){if(S.stopped)return;log(msg||"Land all");drones.forEach(d=>{if(d.z>0.02&&!d.crashed){d.landing=true;d.zTarget=0;d.tx=d.x;d.ty=d.y;d.pHeld=false;d.latched=false;}});}
function takeoffOne(d:Drone){if(S.stopped||d.z>0.05||d.zTarget!=null||connState(d)==="lost")return;if(d.crashed)S.alert=null;d.crashed=false;d.tumbled=false;d.landing=false;d.zTarget=CONFIG.takeoffZ;d.tx=d.x;d.ty=d.y;log(`${U(d.id)} taking off, target ${CONFIG.takeoffZ.toFixed(2)} m`);}
$("btnLandSel").addEventListener("click",()=>landOne(videoD()));
$("btnTakeoffSel").addEventListener("click",()=>takeoffOne(videoD()));
$("btnLand").addEventListener("click",()=>landAll());
$("btnTakeoff").addEventListener("click",()=>{
  if(S.stopped){if(drones.some(d=>d.z>0.02)){log("The emergency stop clears only when every drone is grounded","warn");return;}
    S.stopped=false;$("estop").classList.remove("fired");$("estopTitle").textContent="E-STOP";$("estopSub").textContent="Hold 1 s";log("Emergency stop cleared by operator","ok");}
  S.alert=null;const g=drones.filter(d=>d.z<=0.05);if(!g.length)return;log(`Take off all, target ${CONFIG.takeoffZ.toFixed(2)} m`);g.forEach(d=>{d.crashed=false;d.tumbled=false;d.landing=false;d.zTarget=CONFIG.takeoffZ;d.tx=d.x;d.ty=d.y;});});
// Trials (§1.7.4, §1.7.6): start on the ground; a collision or the time limit fails the trial and grounds the drones.
// Defensive hovers are counted separately and do not fail a trial.
// Simple IDs: one session per participant, S1, S2 ...; that participant's trials S1-T1, S1-T2 ...
// (SO5 "a fixed session of three trials per interface condition"; §1.7.7 logs "per participant and per trial")
const sessionId=()=>`S${S.session}`,trialId=()=>`${sessionId()}-T${S.trial.n}`;
function newSession(){if(S.trial.running){log("End the trial before moving to the next participant","warn");return;}
  S.session++;S.trial.n=1;S.trial.last=null;log(`Session ${sessionId()} started for the next participant`,"ok");}
// What keeps a trial from starting: each drone on its own start position, telemetry up, E-STOP clear (§1.4.2, §1.7.6)
const padOf=(d:Drone)=>CONFIG.drones.find(c=>c.id===d.id)!!,atPad=(d:Drone)=>{const p=padOf(d);return Math.hypot(d.x-p.x,d.y-p.y)<=CONFIG.padTol;};
function trialBlocker(){if(S.stopped)return"Clear the emergency stop before starting a trial";
  const a=drones.find(d=>d.z>0.02)!;if(a)return`Land ${U(a.id)} before starting a trial`;
  const p=drones.find(d=>!atPad(d));if(p)return`Place ${U(p.id)} on its start position before starting a trial`;
  const c=drones.find(d=>connState(d)==="lost");if(c)return`${U(c.id)} has no telemetry link, so the trial cannot start`;
  return null;}
function startTrial(){const T=S.trial;if(T.running)return;const why=trialBlocker();if(why){log(why,"warn");S.alert=why;renderAlert();return;}
  // "A trial starts with the system bringing up telemetry and the video feed" (§1.7.6): the clock starts here
  if(TAB!=="map")setTab("map");if(!OPT.feed||!drones.some(d=>d.id===OPT.feed))setVideo("cf1",true);
  Object.assign(T,{running:true,t0:S.t,dh:0,restrict:0,last:null,prog:Object.fromEntries(drones.map(d=>[d.id,0])),home:{}});S.curTrial=trialId();S.alert=null;buildMapStatic();
  log(`Trial ${trialId()} started: telemetry and video feed up`,"ok");}
// completed when every drone has passed H1, H2, H3 in order and is on the ground at its own start position
function trialDone(){const T=S.trial,n=CONFIG.hoops.length;
  return drones.every(d=>T.prog![d.id]!>=n&&d.z<=0.02&&d.zTarget==null&&!d.crashed&&atPad(d));}
function endTrial(outcome:Outcome){const T=S.trial;if(!T.running)return;T.running=false;const el=S.t-T.t0,fail=outcome==="collision"||outcome==="timeout";
  log(`Trial ${trialId()} ${outcome==="completed"?"completed, all drones back on their start positions,":outcome==="hardware_abort"?"voided for a hardware fault":"failed: "+outcome} at ${fmtMS(el)}, ${T.dh} defensive hover${T.dh===1?"":"s"}`,fail?"crit":outcome==="completed"?"ok":"warn");
  T.last={id:trialId(),session:sessionId(),t0:T.t0,t1:S.t,outcome,elapsed:el,dh:T.dh,restrict:T.restrict};S.trials.push(T.last);T.n++;S.curTrial="";buildMapStatic();
  if(outcome==="timeout")S.alert=`Time limit reached. Trial ${T.last.id} failed, so all drones are landing. Press Take off all to fly again.`;
  if(fail||outcome==="hardware_abort")landAll(fail?"Trial failed, grounding all drones":"Grounding all drones");}
/* ---------- Sync course layout with Motive (simulated) ----------
   Reflective markers on each box, hoop, restricted-zone corner and start pad are set up in Motive as rigid bodies
   named O1, O2, H1-H3, ZONE and D1-D3. In the real system the ground station reads them from Motive, converts
   Motive's y-up frame to the z-up course frame, and sends the new course to the tablet. The course must not change
   during a trial or with drones in the air, so sync runs only between trials with every drone grounded. */
function layoutItems():SyncItem[]{return[
  ...CONFIG.boxes.map(b=>({id:b.id,what:"Box",get:()=>[b.x,b.y,b.h],set:(v:number[])=>{b.x=v[0];b.y=v[1];b.h=v[2];}})),
  ...CONFIG.hoops.map(h=>({id:h.id,what:"Hoop",get:()=>[h.x,h.y,h.z],set:(v:number[])=>{h.x=v[0];h.y=v[1];h.z=v[2];}})),
  {id:"ZONE",what:"Restricted zone",get:()=>[CONFIG.nfz.x,CONFIG.nfz.y,0],set:(v:number[])=>{CONFIG.nfz.x=v[0];CONFIG.nfz.y=v[1];}},
  ...CONFIG.drones.map((c,i)=>({id:"D"+(i+1),what:"Start pad",get:()=>[c.x,c.y,0],set:(v:number[])=>{c.x=v[0];c.y=v[1];const d=drones[i];if(d.z<=0.02){d.x=d.tx=v[0];d.y=d.ty=v[1];}}}))];}
let SYNC:SyncRow[]|null=null,SIM_TRUE:Record<string,number[]>|null=null;
function syncLayout(){
  if(S.trial.running){log("Layout sync is only allowed between trials","warn");return;}
  if(drones.some(d=>d.z>0.02)){log("Land every drone before syncing the layout","warn");return;}
  toggleSettings(false);$("syncDlg").hidden=false;$<HTMLButtonElement>("syncApply").disabled=true;$("syncTable").innerHTML="";
  $("syncStatus").textContent="Reading rigid bodies from Motive…";
  setTimeout(()=>{ // simulated readings: each body sits at a fixed spot a few cm off Figure 5, read with about 5 mm of noise
    const n=(a:number)=>(Math.random()*2-1)*a;
    if(!SIM_TRUE){SIM_TRUE={};layoutItems().forEach(it=>{const v=it.get();SIM_TRUE![it.id]=[v[0]+n(0.03),v[1]+n(0.03),v[2]?v[2]+n(0.015):0];});}
    SYNC=layoutItems().map(it=>{const now=it.get(),t=SIM_TRUE![it.id]!,m=[t[0]+n(0.005),t[1]+n(0.005),t[2]?t[2]+n(0.005):0];return{...it,now,m,dcm:Math.hypot(m[0]-now[0],m[1]-now[1],m[2]-now[2])*100};});
    const f=(v:number[])=>v.map(x=>x.toFixed(2)).join(", "),big=SYNC.filter(r=>r.dcm>=5).length;
    $("syncTable").innerHTML=`<thead><tr><th>Body</th><th>Item</th><th>Now (x, y, z m)</th><th>Motive (x, y, z m)</th><th>Change</th></tr></thead><tbody>`+
      SYNC.map(r=>`<tr><td><b>${r.id}</b></td><td>${r.what}</td><td>${f(r.now)}</td><td>${f(r.m)}</td><td class="${r.dcm>=5?"warn":""}">${r.dcm.toFixed(1)} cm</td></tr>`).join("")+"</tbody>";
    $("syncStatus").textContent=`Found ${SYNC.length} of ${SYNC.length} rigid bodies. ${big?`${big} moved 5 cm or more: check the markers before applying.`:"All within 5 cm of the current map."}`;
    $<HTMLButtonElement>("syncApply").disabled=false;},900);}
function applySync(){if(!SYNC)return;SYNC.forEach(r=>r.set(r.m));const most=SYNC.reduce((a,r)=>r.dcm>a.dcm?r:a,SYNC[0]);
  CONFIG.layout={source:"Motive",synced:new Date().toISOString(),bodies:SYNC.length};
  buildMapStatic();buildSensorScene();renderMap();
  log(`Layout synced from Motive: ${SYNC.length} rigid bodies, largest change ${most.dcm.toFixed(1)} cm (${most.id})`,"ok");
  $("syncNote").textContent=`Motive, ${new Date().toLocaleTimeString()}`;
  SYNC=null;$("syncDlg").hidden=true;}
$("syncBtn").addEventListener("click",syncLayout);$("syncApply").addEventListener("click",applySync);
$("syncCancel").addEventListener("click",()=>{SYNC=null;$("syncDlg").hidden=true;});
function exportLog(){const last=S.trial.last,data={session:sessionId(),trial:last||{id:trialId(),outcome:S.trial.running?"running":null},
    config:{layout:CONFIG.layout||{source:"Figure 5"},room:CONFIG.arena,altitude:CONFIG.z,restricted_zone:CONFIG.nfz,obstacles:CONFIG.boxes,hoops:CONFIG.hoops,rate_max:CONFIG.rateMax,defensive_hover:{trigger_m:MR.trig,clear_m:MR.clear},time_limit_s:CONFIG.timeLimit},
    trials:S.trials.map(t=>({id:t.id,session:t.session,start_s:+t.t0.toFixed(3),end_s:+t.t1!.toFixed(3),outcome:t.outcome,elapsed_s:+t.elapsed.toFixed(3),defensive_hovers:t.dh,drag_restrictions:t.restrict})),
    events:S.log.map(e=>({t_s:+e.t.toFixed(3),session:e.ses,trial:e.tr||null,kind:e.k,text:e.text}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})),a=document.createElement("a");
  a.href=url;a.download=`log-${(last||{id:trialId()}).id}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);log("Trial log exported");}
const estop=$("estop"),ring=$("estopRing") as unknown as SVGCircleElement,CIRC=94.25;let hs:number|null=null,hr=0;
function tick(){const p=Math.min(1,(performance.now()-hs!)/1000);ring.style.strokeDashoffset=String(CIRC*(1-p));$("estopSub").textContent=`Arming ${p.toFixed(1)} s`;if(p>=1){fire();cancel();return;}hr=requestAnimationFrame(tick);}
function start(){if(S.stopped)return;hs=performance.now();hr=requestAnimationFrame(tick);}
function cancel(){cancelAnimationFrame(hr);hs=null;ring.style.strokeDashoffset=String(CIRC);if(!S.stopped)$("estopSub").textContent="Hold 1 s";}
function fire(){S.stopped=true;drones.forEach(d=>{d.zTarget=null;d.landing=false;d.tx=d.x;d.ty=d.y;});estop.classList.add("fired");$("estopTitle").textContent="MOTORS CUT";$("estopSub").textContent="Take off all to clear";log("Emergency stop, all motors cut","crit");}
estop.addEventListener("pointerdown",e=>{estop.setPointerCapture(e.pointerId);start();});
estop.addEventListener("pointerup",cancel);estop.addEventListener("pointercancel",cancel);
estop.addEventListener("keydown",e=>{if((e.key===" "||e.key==="Enter")&&!e.repeat&&hs==null){e.preventDefault();start();}});
estop.addEventListener("keyup",e=>{if(e.key===" "||e.key==="Enter")cancel();});

/* =====================================================================
   SIM CONTROLS (mockup only)
   ===================================================================== */
function syncSim(){document.querySelectorAll<HTMLElement>("#gestSeg button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.g===S.gesture)));document.querySelectorAll<HTMLElement>("#settings [data-t]").forEach(b=>b.setAttribute("aria-pressed",String(!!S[b.dataset.t as SimToggle])));}
function setGesture(g:Gesture){if(g===S.gesture)return;const was=S.gesture,wa=was==="climb"||was==="descend";if(g==="confirming")S.beforeConfirm=was;S.gesture=g;
  if((g==="climb"||g==="descend")&&!wa)log(was==="unrecognized"?"Open palm again, altitude control resumed":"Open palm confirmed, neutral point captured","ok");
  if(g==="confirming")log("Open palm seen, confirming");
  if(g==="locked")log("Closed fist, altitude locked, neutral point discarded");
  if(g==="lost")log("Hand tracking lost, held drones holding altitude","warn");
  if(g==="unrecognized")log("Hand pose not recognised, held drones holding altitude","warn");
  if(g==="idle")log("Gesture idle, waiting for open palm");syncSim();}
document.querySelectorAll<HTMLElement>("#gestSeg button").forEach(b=>b.addEventListener("click",()=>setGesture(b.dataset.g as Gesture)));
$("camBtn").addEventListener("click",toggleCamera);
document.querySelectorAll<HTMLElement>("#settings [data-t]").forEach(b=>b.addEventListener("click",()=>{const k=b.dataset.t as SimToggle;S[k]=!S[k];syncSim();
  if(k==="simHold")log(S.simHold?"DRONE 1 and DRONE 2 held (sim)":"DRONE 1 and DRONE 2 released (sim)");
  if(k==="degraded")log(S.degraded?"Link degraded, radio 61%, backend latency high":"Links nominal",S.degraded?"warn":"ok");
  if(k==="lowBatt"&&S.lowBatt)log("DRONE 3 battery at 3.15 V, below pm.lowVoltage 3.2 V","warn");if(k==="lowBatt"&&!S.lowBatt)drones[2].vbat=3.94;
  if(k==="motorFault")log(S.motorFault?"DRONE 2 motor M3 fault (sim): shows on the next health check":"DRONE 2 motor M3 fault cleared (sim)");
  if(k==="cf3Lost")log(S.cf3Lost?"DRONE 3 connection lost":"DRONE 3 reconnected",S.cf3Lost?"crit":"ok");
  if(k==="proximity"){const c2=drones[1],c3=drones[2];if(S.proximity){c3.tx=c2.x+0.17;c3.ty=c2.y+0.02;log("DRONE 3 target set near DRONE 2 (sim)");}else{c3.tx=2.95;c3.ty=0.45;}}}));
$("simReset").addEventListener("click",()=>{pointers.clear();resetScenario();});

/* =====================================================================
   SETTINGS
   ===================================================================== */
const OPT:{trails:boolean;feeds:boolean;mode:string;course:boolean;lefty:boolean;latch:boolean;light:boolean;feedSel:Record<string,boolean>;feed:string}={trails:true,feeds:false,mode:"course",course:true,lefty:false,latch:false,light:false,feedSel:{cf1:true,cf2:false,cf3:false},feed:"cf1"};
const feedCount=()=>1;
const STEP:Record<string,Step>={
  zmin:{get:()=>CONFIG.z.min,set:v=>CONFIG.z.min=v,step:0.05,lo:0.10,hi:()=>CONFIG.z.max-0.30,fmt:v=>v.toFixed(2)+" m",name:"Minimum altitude"},
  zmax:{get:()=>CONFIG.z.max,set:v=>CONFIG.z.max=v,step:0.05,lo:()=>CONFIG.z.min+0.30,hi:2.00,fmt:v=>v.toFixed(2)+" m",name:"Maximum altitude"},
  takeoff:{get:()=>CONFIG.takeoffZ,set:v=>CONFIG.takeoffZ=v,step:0.05,lo:()=>CONFIG.z.min,hi:()=>CONFIG.z.max,fmt:v=>v.toFixed(2)+" m",name:"Takeoff height"},
  rate:{get:()=>CONFIG.rateMax,set:v=>CONFIG.rateMax=v,step:0.05,lo:0.05,hi:0.40,fmt:v=>v.toFixed(2)+" m/s",name:"Maximum climb rate"},
  dhtrig:{get:()=>MR.trig,set:v=>{MR.trig=v;MR.clear=Math.round((v+0.05)*100)/100;},step:0.05,lo:0.10,hi:0.50,fmt:v=>v.toFixed(2)+" m",name:"Defensive hover distance"},
  tlim:{get:()=>CONFIG.timeLimit,set:v=>CONFIG.timeLimit=v,step:30,lo:60,hi:900,fmt:v=>fmtMS(v),name:"Trial time limit"},
  aw:{get:()=>CONFIG.arena.xMax-CONFIG.arena.xMin,set:v=>{CONFIG.arena.xMin=0;CONFIG.arena.xMax=v;},step:0.05,lo:2,hi:10,fmt:v=>v.toFixed(2)+" m",name:"Room width"},
  ad:{get:()=>CONFIG.arena.yMax-CONFIG.arena.yMin,set:v=>{CONFIG.arena.yMin=0;CONFIG.arena.yMax=v;},step:0.05,lo:2,hi:10,fmt:v=>v.toFixed(2)+" m",name:"Room depth"},
  nfzr:{get:()=>CONFIG.nfz.h*2,set:v=>CONFIG.nfz.h=v/2,step:0.10,lo:0.30,hi:1.60,fmt:v=>v.toFixed(2)+" m",name:"Restricted zone size"},
  prox:{get:()=>CONFIG.proxWarn,set:v=>CONFIG.proxWarn=v,step:0.05,lo:()=>CONFIG.proxCrit+0.05,hi:1.00,fmt:v=>v.toFixed(2)+" m",name:"Proximity warning"}
};
const val=(x:number|(()=>number))=>typeof x==="function"?x():x;
function syncSettings(){
  document.querySelectorAll<HTMLElement>(".stp").forEach(r=>{const c=STEP[r.dataset.k!]!;r.querySelector<HTMLElement>("b")!.textContent=c.fmt(c.get());});
  document.querySelectorAll<HTMLElement>("[data-o]").forEach(b=>b.setAttribute("aria-pressed",String(OPT[b.dataset.o as OptToggle])));
  document.querySelectorAll<HTMLElement>("[data-fs]").forEach(b=>b.setAttribute("aria-checked",String(b.dataset.fs===OPT.feed)));
}
document.querySelectorAll<HTMLElement>(".stp button").forEach(b=>b.addEventListener("click",()=>{
  const k=b.closest<HTMLElement>(".stp")!.dataset.k!,c=STEP[k]!,v=Math.round((c.get()+(+b.dataset.d!)*c.step)*100)/100,nv=clamp(v,val(c.lo),val(c.hi));
  if(nv!==c.get()){c.set(nv);log(`${c.name} set to ${c.fmt(nv)}`);}
  if(k==="zmin"||k==="zmax")CONFIG.takeoffZ=clamp(CONFIG.takeoffZ,CONFIG.z.min,CONFIG.z.max);
  if(k==="aw"||k==="ad")layout();else buildMapStatic();
  syncSettings();}));
document.querySelectorAll<HTMLElement>("[data-o]").forEach(b=>b.addEventListener("click",()=>{const k=b.dataset.o as OptToggle;OPT[k]=!OPT[k];
  if(k==="feeds"){$("app").classList.toggle("nofeeds",!OPT.feeds);layout();}if(k==="latch"){if(!OPT.latch)drones.forEach(d=>d.latched=false);log(OPT.latch?"Tap-to-hold on: tap drones to hold, tap again to release":"Tap-to-hold off");}if(k==="lefty"){$("app").classList.toggle("lefty",OPT.lefty);layout();log(OPT.lefty?"Left-handed layout":"Right-handed layout");}if(k==="light")applyTheme();if(k==="course"){buildMapStatic();buildSensorScene();log(OPT.course?"Boxes and hoops in the room":"Boxes and hoops removed");}syncSettings();}));

// Trial control: Start trial brings up telemetry and the video feed (§1.7.6). The trial ends by itself when every drone
// has flown H1, H2 and H3 in order and landed on its start position, or fails on a collision or at the time limit.
$("trGo").addEventListener("click",()=>{startTrial();renderTrialCtl();});
$("trVoid").addEventListener("click",()=>{endTrial("hardware_abort");renderTrialCtl();});
// the host detects a collision when a drone reports sys.isTumbled; the experimenter records any other contact here
$("trCol").addEventListener("click",()=>{if(!S.trial.running)return;log("Experimenter recorded a collision","crit");endTrial("collision");renderTrialCtl();});$("trExport").addEventListener("click",exportLog);$("hcBtn").addEventListener("click",runHealthCheck);$("trSession").addEventListener("click",newSession);
// A hidden page cannot keep streaming input, so release every contact and idle the altitude channel (protocol v1).
document.addEventListener("visibilitychange",()=>{if(!document.hidden)return;let n=0;
  drones.forEach(d=>{if(d.pHeld||d.latched)n++;d.pHeld=false;d.latched=false;d.blocked=null;d.blockPt=null;});pointers.clear();
  if(S.gesture!=="idle"){CAM.neutral=null;CAM.conf=null;setGesture("idle");}
  if(n)log(`Page hidden: ${n} drone${n>1?"s":""} released, altitude channel idle`,"warn");});
// 0–1 feeds: checkbox bar + the single feed sit under the CV camera (default).
// 2–3 feeds: bar and feeds move into their own column, sized to fill its height.
function placeFeeds(){
  const n=feedCount(),col=$("feeds"),tiles=drones.map(d=>document.querySelector<HTMLElement>(`.dfeed[data-f="${d.id}"]`)).filter((t):t is HTMLElement=>!!t);
  if(n>=2){col.prepend($("fhead"));tiles.forEach(t=>col.appendChild(t));}
  else{$("fheadSlot").appendChild($("fhead"));tiles.forEach(t=>{if(n===1&&OPT.feedSel[t.dataset.f!])$("sideFeed").appendChild(t);else col.appendChild(t);});}
}
function applyFeeds(){
  OPT.feeds=feedCount()>=2;
  document.querySelectorAll<HTMLElement>(".dfeed").forEach(t=>t.classList.toggle("off",!OPT.feedSel[t.dataset.f!]));
  $("feeds").classList.remove("few");
  placeFeeds();
  $("app").classList.toggle("nofeeds",!OPT.feeds);syncSettings();layout();
}
document.addEventListener("click",e=>{const b=(e.target as Element).closest<HTMLElement>("[data-fs]");if(!b)return;const k=b.dataset.fs!;if(k===OPT.feed)return;setVideo(k,false);});
$("fsBtn").addEventListener("click",()=>{const el=document.documentElement;(el.requestFullscreen||el.webkitRequestFullscreen||(()=>{})).call(el);setTimeout(layout,300);});
function applyTheme(){const light=!!OPT.light;document.documentElement.classList.toggle("light",light);Object.assign(K,light?PAL.light:PAL.dark);
  const m=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');if(m)m.content=light?"#EEF3FA":"#181C18";
  try{localStorage.setItem("tum-light",light?"1":"0");}catch(e){}
  if(window.__ready){buildMapStatic();renderMap();renderTapes();}}
function toggleSettings(open?:boolean){const o=open??$("settings").hidden;$("settings").hidden=!o;$("setBtn").setAttribute("aria-expanded",String(o));}
$("setBtn").addEventListener("click",()=>toggleSettings());$("setClose").addEventListener("click",()=>toggleSettings(false));

/* =====================================================================
   RESPONSIVE LAYOUT
   Landscape: size side columns so the map body is as close to square as
   possible (no dead bands); spare width is shared by the side columns.
   Portrait: map + altitude on top, unit panel + feeds below.
   Compact (phones): single scrolling column, controls pinned at bottom.
   ===================================================================== */
let SCALE=1;
let PORTRAIT=false;
function fitStage(){
  // the layout fills any landscape screen; portrait shows a prompt, because the tablet stays in landscape (REQ-01)
  SCALE=1;$("stage").style.transform="";PORTRAIT=innerWidth<innerHeight;
  const dpr=window.devicePixelRatio||1,el=$("dispInfo");
  if(el)el.innerHTML=`Target: Galaxy Tab S9, 11" 16:10 landscape<br>This window: ${innerWidth} × ${innerHeight} CSS px, DPR ${dpr}<br>The layout fills any screen. Portrait stacks the map above the panel; trials use the tablet in landscape.`;
}
function layout(){
  fitStage();
  const app=$("app");
  app.dataset.mode="landscape";
  const st=app.style;
  $("side").classList.remove("wide");
  st.gridTemplateRows="minmax(0,1fr)";
  // left panel (§1.7.3.5) with the hand camera, altitude beside it, and the video feed below (accepted deviation); the map fills the rest
  // everything but the map sits on the left: the panel (with trial, one-drone and all-drone controls under the video) and altitude; the map fills the right.
  // Left-handed use mirrors it. Portrait puts the map on top, full width.
  const SIDE="clamp(200px,22vw,310px)",ALT="clamp(56px,6vw,90px)";
  if(PORTRAIT){app.dataset.mode="portrait";st.gridTemplateRows="minmax(0,.8fr) minmax(0,1.2fr)";
    st.gridTemplateColumns=OPT.lefty?`minmax(0,1fr) ${ALT}`:`${ALT} minmax(0,1fr)`;
    st.gridTemplateAreas=OPT.lefty?`"main main" "side alt"`:`"main main" "alt side"`;}
  else{st.gridTemplateColumns=OPT.lefty?`minmax(0,1fr) ${ALT} ${SIDE}`:`${SIDE} ${ALT} minmax(0,1fr)`;
    st.gridTemplateAreas=OPT.lefty?`"main alt side"`:`"side alt main"`;}
  requestAnimationFrame(()=>{fitMap();measure();});
}
function measure(){
  const t=$("tapeSvg").getBoundingClientRect();TW=Math.max(60,t.width/SCALE);TH=Math.max(200,t.height/SCALE);
  drones.forEach(d=>{const e=$("fv-"+d.id);if(e){const r=e.getBoundingClientRect();FS[d.id]={w:Math.max(40,r.width/SCALE),h:Math.max(30,r.height/SCALE)};}});
}
const ro=new ResizeObserver(()=>{fitMap();measure();});
window.addEventListener("resize",layout);
window.addEventListener("orientationchange",()=>setTimeout(layout,150));

/* =====================================================================
   INIT
   ===================================================================== */
try{OPT.light=localStorage.getItem("tum-light")==="1";}catch(e){}applyTheme();resetScenario();syncSettings();applyFeeds();window.__ready=true;ro.observe(document.querySelector<HTMLElement>(".mapbody")!);ro.observe($("tapeSvg"));ro.observe($("side"));renderSide();renderTop();requestAnimationFrame(frame);autoCamera();
// Installed app: Android and desktop open fullscreen from the manifest. Where a browser still shows its bars,
// the first touch asks for fullscreen. iOS has no Fullscreen API for pages, so it runs standalone under the status bar.
const standalone=matchMedia("(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)").matches||navigator.standalone===true;
if(standalone&&!matchMedia("(display-mode: fullscreen)").matches){const el=document.documentElement,rq=el.requestFullscreen||el.webkitRequestFullscreen;
  if(rq){const go=()=>{if(!document.fullscreenElement&&!document.webkitFullscreenElement)Promise.resolve(rq.call(el,{navigationUI:"hide"})).catch(()=>{});};
    addEventListener("pointerdown",go,{capture:true});}}
if(screen.orientation&&screen.orientation.lock&&standalone)screen.orientation.lock("landscape").catch(()=>{});
// PWA: offline support + home-screen install
// production builds only: in development the cache would serve stale modules
if(import.meta.env.PROD&&"serviceWorker" in navigator&&location.protocol!=="file:")navigator.serviceWorker.register("sw.js").catch(e=>console.warn("Service worker not registered",e));
