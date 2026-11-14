"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowDownLeft, ArrowLeft, Bell, BriefcaseBusiness, Building2,
  CalendarDays, Check, ChevronLeft, CircleHelp, Clock3, FileText, Filter,
  LayoutDashboard, LogOut, Plus, Search, Settings, Sparkles, Target,
  TrendingUp, UploadCloud, UserRound, Users, X
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Job={id:number;title:string;company:string;location:string;match:number;status:string;date:string};
const initialJobs:Job[]=[
{id:1,title:"Frontend Developer",company:"Wix",location:"תל אביב · היברידי",match:96,status:"חדש",date:"היום"},
{id:2,title:"Full Stack Engineer",company:"Monday.com",location:"תל אביב",match:92,status:"ממתין לבדיקה",date:"אתמול"},
{id:3,title:"React Developer",company:"MELIO",location:"רמת גן · היברידי",match:88,status:"הוגשה מועמדות",date:"12 בנוב׳"},
{id:4,title:"Junior Software Engineer",company:"רפאל",location:"חיפה",match:84,status:"חדש",date:"11 בנוב׳"},
{id:5,title:"Web Developer",company:"Similarweb",location:"תל אביב",match:81,status:"בתהליך",date:"10 בנוב׳"}
];
const nav=[["overview","סקירה כללית",LayoutDashboard],["jobs","משרות מתאימות",BriefcaseBusiness],["applications","המועמדויות שלי",Activity],["resumes","קורות החיים שלי",FileText],["profile","הפרופיל שלי",UserRound],["settings","הגדרות",Settings]] as const;
export default function Home(){
 const router=useRouter();
 const [tab,setTab]=useState("overview");
 const [jobs,setJobs]=useState<Job[]>(initialJobs);
 const [query,setQuery]=useState("");
 const [modal,setModal]=useState(false);
 const [toast,setToast]=useState("");
 const [newTitle,setNewTitle]=useState("");
 const [newCompany,setNewCompany]=useState("");
 const [newLocation,setNewLocation]=useState("");
 const [demo,setDemo]=useState(true);
 const [userEmail,setUserEmail]=useState("מצב הדגמה");
 const [resume,setResume]=useState("");
 useEffect(()=>{
   const isDemo=sessionStorage.getItem("jh-demo")==="1";
   const supabase=createSupabaseBrowserClient();
   if(supabase&&!isDemo){supabase.auth.getUser().then(({data})=>{if(data.user){setDemo(false);setUserEmail(data.user.email||"החשבון שלי");}else{router.replace("/login");}});}
   else setDemo(true);
   try{const saved=localStorage.getItem("jh-jobs");if(saved)setJobs(JSON.parse(saved));const r=localStorage.getItem("jh-resume");if(r)setResume(r);}catch{}
 },[router]);
 const filtered=useMemo(()=>jobs.filter(j=>(j.title+" "+j.company+" "+j.location).toLowerCase().includes(query.toLowerCase())),[jobs,query]);
 function notify(s:string){setToast(s);window.setTimeout(()=>setToast(""),2600);}
 function addJob(e:React.FormEvent){e.preventDefault();if(!newTitle.trim()||!newCompany.trim())return;const next=[{id:Date.now(),title:newTitle,company:newCompany,location:newLocation||"לא צוין",match:0,status:"חדש",date:"הרגע"},...jobs];setJobs(next);localStorage.setItem("jh-jobs",JSON.stringify(next));setNewTitle("");setNewCompany("");setNewLocation("");setModal(false);setTab("jobs");notify("המשרה נוספה לרשימה");}
 async function logout(){const supabase=createSupabaseBrowserClient();if(supabase&&!demo)await supabase.auth.signOut();sessionStorage.removeItem("jh-demo");router.push("/login");}
 function selectTab(id:string){setTab(id);}
 const title=nav.find(n=>n[0]===tab)?.[1]||"סקירה כללית";
 return <div className="app-shell">
  <aside className="sidebar">
   <Link href="/" className="brand"><span className="brand-mark"><BriefcaseBusiness size={21}/></span><span>Job<span className="brand-accent">Hunter</span></span></Link>
   <div className="side-label">סביבת העבודה</div>
   <nav className="nav-list">{nav.map(([id,label,Icon])=><button key={id} onClick={()=>selectTab(id)} className={"nav-item "+(tab===id?"active":"")}><Icon size={17}/>{label}{id==="jobs"&&<span className="nav-count">{jobs.length}</span>}</button>)}</nav>
   <div className="sidebar-bottom"><div className="plan-card"><strong><Sparkles size={14} style={{display:"inline",verticalAlign:"middle",marginLeft:5}}/> עוזר ה-AI שלך</strong><p>נכין יחד את הצעד הבא בקריירה שלך. בקרוב: התאמת קורות חיים אוטומטית.</p><button onClick={()=>notify("עוזר ה-AI יופעל בשלב הבא")}>בקרוב אצלך</button></div><div className="user-mini"><div className="avatar">ח</div><div style={{flex:1,minWidth:0}}><strong>חשבון משתמש</strong><small>{userEmail}</small></div><button className="icon-btn" aria-label="התנתקות" onClick={logout}><LogOut size={15}/></button></div></div>
  </aside>
  <main className="main">
   <header className="topbar"><div className="breadcrumb">סביבת העבודה <ChevronLeft size={12} style={{display:"inline",verticalAlign:"middle"}}/> {title}</div><div className="top-actions"><button className="icon-btn" onClick={()=>notify("אין התראות חדשות")} aria-label="התראות"><Bell size={17}/></button><div className="avatar">ח</div></div></header>
   {demo&&<div className="preview-banner">אתה צופה במצב הדגמה — הנתונים לדוגמה נשמרים בדפדפן שלך בלבד. כדי להפעיל חשבון אישי יש להשלים חיבור Supabase.</div>}
   {tab==="overview"&&<><div className="page-title"><div><h1>בוקר טוב! 👋</h1><p>הנה תמונת המצב שלך. כל צעד קטן מקרב אותך לעבודה הבאה.</p></div><button className="btn btn-primary" onClick={()=>setModal(true)}><Plus size={17}/> הוסף משרה</button></div>
    <section className="stats-grid">
     <Stat icon={<BriefcaseBusiness size={17}/>}label="משרות במעקב"value={jobs.length.toString()}foot="משרות שנאספו ונשמרו"/>
     <Stat icon={<Target size={17}/>}label="התאמות גבוהות"value={jobs.filter(j=>j.match>=85).length.toString()}foot="ציון התאמה 85% ומעלה"/>
     <Stat icon={<FileText size={17}/>}label="מועמדויות שהוגשו"value={jobs.filter(j=>j.status==="הוגשה מועמדות").length.toString()}foot="נמשיך לעקוב אחר התשובות"/>
     <Stat icon={<TrendingUp size={17}/>}label="ציון התאמה ממוצע"value={Math.round(jobs.filter(j=>j.match>0).reduce((a,j)=>a+j.match,0)/(jobs.filter(j=>j.match>0).length||1))+"%"}foot="לפי המשרות לדוגמה"/>
    </section>
    <div className="dashboard-grid"><div>
     <section className="panel"><div className="panel-head"><div><h3>משרות שכדאי לך לבדוק</h3><p>הזדמנויות עם התאמה גבוהה לפרופיל שלך</p></div><button className="text-link" onClick={()=>setTab("jobs")}>לכל המשרות ←</button></div><div className="job-list">{jobs.slice(0,4).map(j=><JobRow key={j.id}job={j}/>)}</div></section>
     <section className="panel"><div className="panel-head"><div><h3>המסע שלך עד עכשיו</h3><p>התקדמות חיפוש העבודה</p></div><Activity size={18} color="#8d83ed"/></div><div className="progress-line"><span style={{width:Math.min(100,jobs.length*12)+"%"}}/></div><div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--muted)"}}><span>איסוף הזדמנויות</span><strong>{Math.min(100,jobs.length*12)}%</strong></div></section>
    </div><div>
     <section className="panel"><div className="panel-head"><div><h3>פעילות אחרונה</h3><p>מה חדש באזור שלך</p></div><Clock3 size={17} color="#929bad"/></div><div className="activity"><ActivityItem title="נוספו משרות חדשות למעקב"sub="5 הזדמנויות זמינות לבדיקה"time="היום"/><ActivityItem title="פרופיל המועמד שלך מוכן לעריכה"sub="השלם פרטים כדי לשפר התאמות" time="היום"/><ActivityItem title="אזור קורות החיים נפתח"sub="אפשר להעלות קובץ PDF" time="השבוע"/></div></section>
     <section className="panel"><div className="panel-head"><div><h3>קורות החיים שלך</h3><p>הבסיס להתאמות מדויקות</p></div><FileText size={17} color="#8b82e8"/></div>{resume?<div className="job-row"><FileText color="#6558e8"/><div className="job-info"><strong>{resume}</strong><span>נשמר בדפדפן</span></div><Check color="#16845b"/></div>:<div className="resume-card"><div className="resume-icon"><UploadCloud size={24}/></div><h3>עוד לא העלית קורות חיים</h3><p>הוסף קובץ PDF כדי להתחיל להתקדם.</p><button className="btn btn-light" onClick={()=>setTab("resumes")}>העלאת קורות חיים</button></div>}</section>
    </div></div></>}
   {tab==="jobs"&&<><div className="page-title"><div><h1>משרות מתאימות</h1><p>כל ההזדמנויות שלך במקום אחד. הוסף משרות ועקוב אחריהן.</p></div><button className="btn btn-primary" onClick={()=>setModal(true)}><Plus size={17}/> הוסף משרה</button></div><section className="panel content-panel"><div className="searchbar"><input placeholder="חיפוש לפי תפקיד, חברה או מיקום..." value={query} onChange={e=>setQuery(e.target.value)}/><button className="btn btn-light"><Filter size={15}/> סינון</button></div><table className="table"><thead><tr><th>תפקיד וחברה</th><th>מיקום</th><th>התאמה</th><th>סטטוס</th><th>נוסף</th></tr></thead><tbody>{filtered.map(j=><tr key={j.id}><td><strong>{j.title}</strong><br/><span style={{color:"var(--muted)"}}>{j.company}</span></td><td>{j.location}</td><td>{j.match?<span className="match">{j.match}%</span>:"—"}</td><td><Status status={j.status}/></td><td>{j.date}</td></tr>)}</tbody></table>{filtered.length===0&&<div className="empty-state">לא נמצאו משרות שמתאימות לחיפוש.</div>}</section></>}
   {tab==="applications"&&<><div className="page-title"><div><h1>המועמדויות שלי</h1><p>מעקב אחר התהליך, מהגשה ועד קבלת תשובה.</p></div></div><section className="panel content-panel"><table className="table"><thead><tr><th>תפקיד</th><th>חברה</th><th>תאריך</th><th>סטטוס</th></tr></thead><tbody>{jobs.filter(j=>j.status==="הוגשה מועמדות"||j.status==="בתהליך").map(j=><tr key={j.id}><td>{j.title}</td><td>{j.company}</td><td>{j.date}</td><td><Status status={j.status}/></td></tr>)}</tbody></table><div className="empty-state">הגשת מועמדות חדשה תופיע כאן. בשלב זה ניתן לעדכן משרות לדוגמה.</div></section></>}
   {tab==="resumes"&&<><div className="page-title"><div><h1>קורות החיים שלי</h1><p>העלה את קורות החיים שלך כדי שנוכל להתאים לך משרות.</p></div></div><section className="panel"><div className="resume-card"><div className="resume-icon"><UploadCloud size={25}/></div><h3>{resume||"העלאת קורות חיים"}</h3><p>קובץ PDF בלבד, עד 10MB. במצב הדגמה נשמר רק שם הקובץ.</p><label className="btn btn-primary" style={{display:"inline-flex",cursor:"pointer"}}>בחירת קובץ<input type="file" accept="application/pdf,.pdf" hidden onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.type!=="application/pdf"||f.size>10*1024*1024){notify("יש לבחור קובץ PDF עד 10MB");return;}setResume(f.name);localStorage.setItem("jh-resume",f.name);notify("שם הקובץ נשמר במצב הדגמה");}}/></label></div></section></>}
   {tab==="profile"&&<><div className="page-title"><div><h1>הפרופיל שלי</h1><p>פרטים שיעזרו לנו למצוא הזדמנויות מתאימות יותר.</p></div><button className="btn btn-primary" onClick={()=>notify("הפרופיל יישמר לאחר חיבור החשבון")}>שמירת שינויים</button></div><section className="panel"><div className="settings-grid"><Field label="שם מלא"placeholder="השם שלך"/><Field label="תפקיד מבוקש"placeholder="לדוגמה: Frontend Developer"/><Field label="מיקום"placeholder="עיר או אזור"/><Field label="קישור LinkedIn"placeholder="https://linkedin.com/in/..."/></div></section></>}
   {tab==="settings"&&<><div className="page-title"><div><h1>הגדרות</h1><p>ניהול החשבון והעדפות המערכת.</p></div></div><section className="panel"><h3 style={{marginTop:0}}>חשבון</h3><p style={{fontSize:13,color:"var(--muted)"}}>{userEmail}</p><button className="btn btn-light" onClick={logout}><LogOut size={16}/> יציאה מהחשבון</button><hr style={{border:0,borderTop:"1px solid var(--line)",margin:"22px 0"}}/><h3>מצב המוצר</h3><p style={{fontSize:12,color:"var(--muted)"}}>זוהי גרסת Preview. חיבור מקורות משרות, עיבוד AI ושליחת מועמדויות יתווספו לאחר בדיקת חוויית המשתמש.</p></section></>}
  </main>
  {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(false)}}><div className="modal"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h2>הוספת משרה למעקב</h2><button className="icon-btn" onClick={()=>setModal(false)}><X size={17}/></button></div><form className="modal-form" onSubmit={addJob}><label className="field-label">שם התפקיד<input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="לדוגמה: Frontend Developer" required/></label><label className="field-label">שם החברה<input value={newCompany} onChange={e=>setNewCompany(e.target.value)} placeholder="שם החברה" required/></label><label className="field-label">מיקום<input value={newLocation} onChange={e=>setNewLocation(e.target.value)} placeholder="עיר / היברידי / מרחוק"/></label><div className="modal-actions"><button type="button" className="btn btn-light" onClick={()=>setModal(false)}>ביטול</button><button className="btn btn-primary"><Plus size={15}/> הוספת משרה</button></div></form></div></div>}
  {toast&&<div className="toast">{toast}</div>}
 </div>
}
function Stat({icon,label,value,foot}:{icon:React.ReactNode;label:string;value:string;foot:string}){return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot">{foot}</div></div>}
function JobRow({job}:{job:Job}){return <div className="job-row"><div className="company-logo">{job.company.slice(0,1)}</div><div className="job-info"><strong>{job.title}</strong><span>{job.company} · {job.location}</span></div><div className="job-meta"><strong className="match">{job.match?job.match+"%":"חדש"}</strong><small>התאמה</small></div></div>}
function Status({status}:{status:string}){const c=status==="הוגשה מועמדות"||status==="בתהליך"?"green":status==="ממתין לבדיקה"?"amber":"purple";return <span className={"tag "+c}>{status}</span>}
function ActivityItem({title,sub,time}:{title:string;sub:string;time:string}){return <div className="activity-item"><span className="activity-dot"/><div><strong>{title}</strong><span>{sub} · {time}</span></div></div>}
function Field({label,placeholder}:{label:string;placeholder:string}){return <label className="field-label">{label}<input placeholder={placeholder}/></label>}
