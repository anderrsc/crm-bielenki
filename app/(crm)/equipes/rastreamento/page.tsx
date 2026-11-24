import {redirect} from 'next/navigation';
import {getRequestClient} from '@/lib/supabase/server';
import {loadTracking,type TrackingStatus} from '@/lib/tracking-view';
import {TrackingPage} from '@/components/tracking-page';
import {TrackingPortal} from '@/components/tracking-portal';
import {trackingPortalUrl} from '@/lib/tracking-portal-url';
export default async function Page({searchParams}:{searchParams:Promise<{erro?:string;salvo?:string;veiculo?:string;painel?:string}>}){
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL)return <p className="card p-6">Configure o Supabase para abrir o rastreamento.</p>;
 const db=await getRequestClient();const status=await db.rpc('trackceo_status');
 if(status.error||!status.data)redirect('/equipes?erro=Rastreamento+restrito+à+gerência');
 const search=await searchParams;
 if(search.painel==='1')return <TrackingPortal portalUrl={trackingPortalUrl()}/>;
 const data=await loadTracking(db,status.data as TrackingStatus);
 return <TrackingPage data={data} error={search.erro} saved={search.salvo==='1'} focus={search.veiculo}/>;
}
