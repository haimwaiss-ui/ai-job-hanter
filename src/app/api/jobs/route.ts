import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const runtime="nodejs";
export async function GET(){
 const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const db=supabase as any; const {data,error}=await db.from("jobs").select("*").eq("user_id",user.id).eq("is_active",true).order("created_at",{ascending:false});
 if(error)return NextResponse.json({error:error.message},{status:400}); return NextResponse.json({jobs:data??[]});
}
export async function POST(req:Request){
 const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const b=await req.json().catch(()=>null);
 if(!b||typeof b.title!=="string"||!b.title.trim()||typeof b.company_name!=="string"||!b.company_name.trim())return NextResponse.json({error:"יש להזין תפקיד וחברה"},{status:422});
 const safeUrl=(v:any)=>{if(!v)return null;try{const u=new URL(v);return ["http:","https:"].includes(u.protocol)?u.toString():null}catch{return null}};
 const sourceUrl=safeUrl(b.source_url??b.application_url)??"";
 const row={user_id:user.id,source:"manual",source_url:sourceUrl,application_url:safeUrl(b.application_url??b.source_url),title:b.title.trim().slice(0,200),company_name:b.company_name.trim().slice(0,200),location:typeof b.location==="string"?b.location.slice(0,200):null,description:typeof b.description==="string"?b.description.slice(0,12000):null};
 const db=supabase as any; const {data,error}=await db.from("jobs").insert(row).select("*").single();
 if(error)return NextResponse.json({error:error.message},{status:400});
 await db.from("user_activity_events").insert({user_id:user.id,event_type:"job_added",entity_type:"job",entity_id:data.id,payload:{source:"manual"}});
 return NextResponse.json({job:data},{status:201});
}
