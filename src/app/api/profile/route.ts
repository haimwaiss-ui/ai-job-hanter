import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const runtime="nodejs";
const allowed=["full_name","phone","location","linkedin_url","portfolio_url","headline","professional_summary","skills","preferred_locations","preferred_employment_types","min_salary","salary_currency","remote_preference","onboarding_completed"] as const;
export async function GET(){
 const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const db=supabase as any;
 const {data,error}=await db.from("profiles").select("*").eq("user_id",user.id).maybeSingle();
 if(error)return NextResponse.json({error:error.message},{status:400});
 return NextResponse.json({profile:data});
}
export async function PATCH(req:Request){
 const supabase=await createSupabaseServerClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await req.json().catch(()=>null); if(!body||typeof body!=="object")return NextResponse.json({error:"Invalid body"},{status:400});
 const patch:any={}; for(const key of allowed)if(key in body)patch[key]=(body as any)[key];
 patch.email=user.email??null; patch.user_id=user.id; patch.updated_at=new Date().toISOString();
 const db=supabase as any;
 const {data,error}=await db.from("profiles").upsert(patch,{onConflict:"user_id"}).select().single();
 if(error)return NextResponse.json({error:error.message},{status:400});
 await db.from("user_activity_events").insert({user_id:user.id,event_type:"profile_updated",payload:{fields:Object.keys(patch).filter(k=>k!=="email"&&k!=="user_id"&&k!=="updated_at")}});
 return NextResponse.json({profile:data});
}
