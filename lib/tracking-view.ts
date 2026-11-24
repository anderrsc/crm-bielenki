import type {SupabaseClient} from '@supabase/supabase-js';
import {todayISO} from '@/lib/utils';
import type {TrackingDevice,TrackingErrorCode} from '@/lib/trackceo';
export type TrackingRow=TrackingDevice&{id:string;vehicle_id:string|null;available:boolean;synced_at:string};
export type TrackingVehicle={id:string;name:string;plate:string|null;status:string};
export type TrackingStatus={company_id:string;account:string|null;active:boolean;configured:boolean;last_sync_at:string|null;last_error:TrackingErrorCode|null;busy:boolean};
export type TrackingData={status:TrackingStatus;devices:TrackingRow[];vehicles:TrackingVehicle[];days:{vehicle_id:string;team_name:string;driver_name:string}[]};
export function positionAge(gps:string|null,now=Date.now()){
 if(!gps)return 'unknown';const ms=Date.parse(gps);if(!Number.isFinite(ms)||ms>now+300000)return 'unknown';return now-ms>15*60000?'old':'recent';
}
export async function loadTracking(db:SupabaseClient,status:TrackingStatus):Promise<TrackingData>{
 const [devices,vehicles,days]=await Promise.all([
  status.active?db.from('trackceo_devices').select('id,imei,name,model,plate,vehicle_id,available,latitude,longitude,gps_at,heartbeat_at,speed,ignition,provider_status,synced_at').order('name'):{data:[],error:null},
  db.from('work_vehicles').select('id,name,plate,status').order('name'),
  db.from('work_days').select('vehicle_id,team_name,driver_name').eq('work_date',todayISO()).neq('status','cancelada'),
 ]);
 if([devices,vehicles,days].some(r=>r.error))throw new Error('Não foi possível carregar o rastreamento. Confira a conexão.');
 return {status,devices:(devices.data??[]) as TrackingRow[],vehicles:(vehicles.data??[]) as TrackingVehicle[],days:days.data??[]};
}
