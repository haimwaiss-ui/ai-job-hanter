import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const runtime="nodejs";
export async function GET(){
 const supabase=await createSupabaseServerClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const db=supabase as any;
 const [{data:events,error:eventsError},{data:profile},{data:resumes},{data:jobs}] = await Promise.all([
  db.from("user_activity_events").select("event_type,payload,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(250),
  db.from("profiles").select("full_name,headline,skills,preferred_locations").eq("user_id",user.id).maybeSingle(),
  db.from("resumes").select("id").eq("user_id",user.id).limit(1),
  db.from("jobs").select("id,title,company_name,location").eq("user_id",user.id).eq("is_active",true).limit(100)
 ]);
 if(eventsError)return NextResponse.json({error:eventsError.message},{status:400});
 const counts:Record<string,number>={};for(const e of events??[])counts[e.event_type]=(counts[e.event_type]??0)+1;
 const terms:Record<string,number>={};for(const e of events??[]){if(["job_opened","job_saved","job_dismissed"].includes(e.event_type)){const title=String(e.payload?.title??"").toLowerCase();for(const w of title.split(/[^a-zא-ת0-9+#.]+/).filter((x:string)=>x.length>2)){terms[w]=(terms[w]??0)+(e.event_type==="job_dismissed"?-1:1)}}}
 const learned=Object.entries(terms).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([term,weight])=>({term,weight}));
 const actions:string[]=[];if(!profile?.headline)actions.push("השלם כותרת מקצועית בפרופיל כדי לשפר התאמות");if(!profile?.skills?.length)actions.push("הוסף מיומנויות מקצועיות לפרופיל");if(!(resumes??[]).length)actions.push("העלה קורות חיים כדי לאפשר התאמה מדויקת");if(!(jobs??[]).length)actions.push("הוסף משרות או חבר מקור חיפוש כדי להתחיל לבנות מעקב");if((counts.job_saved??0)>0)actions.push("בדוק משרות ששמרת והעבר מועמדויות מתאימות לשלב הבא");if(!actions.length)actions.push("בדוק את המשרות בעלות ציון ההתאמה הגבוה ביותר ועדכן סטטוסים");
 const confidence=Math.min(0.75,(events?.length??0)/40);
 const result={learned_preferences:{top_job_terms:learned,event_counts:counts,profile_skills:profile?.skills??[],preferred_locations:profile?.preferred_locations??[]},next_best_actions:actions,confidence};
 await db.from("user_insights").upsert({user_id:user.id,...result,generated_at:new Date().toISOString()},{onConflict:"user_id"});
 return NextResponse.json({insights:result,events_analyzed:events?.length??0,explanation:"המלצות מבוססות כללים ופעילות שנשמרה; עדיין לא מודל למידת מכונה."});
}
