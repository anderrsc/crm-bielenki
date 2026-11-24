'use client';
import {useEffect,useRef,useState} from 'react';
import type {Map as LeafletMap} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import styles from './tracking-map.module.css';
export type TrackingPoint={id:string;name:string;latitude:number;longitude:number;label:string};
export function TrackingMap({points,focus}:{points:TrackingPoint[];focus?:string}){
 const element=useRef<HTMLDivElement>(null),map=useRef<LeafletMap|null>(null);const [failed,setFailed]=useState(false);
 useEffect(()=>{
  if(!element.current||!points.length)return;let disposed=false;
  void import('leaflet').then(L=>{
   if(disposed||!element.current)return;
   const instance=L.map(element.current,{scrollWheelZoom:false,zoomControl:false});map.current=instance;
   L.control.zoom({zoomInTitle:'Aproximar',zoomOutTitle:'Afastar'}).addTo(instance);
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(instance);
   const bounds:L.LatLngTuple[]=[];
   for(const point of points){
    const popup=document.createElement('div');const title=document.createElement('strong');title.textContent=point.name;
    const detail=document.createElement('p');detail.textContent=point.label;popup.append(title,detail);
    L.circleMarker([point.latitude,point.longitude],{radius:9,color:'#ffffff',weight:2,fillColor:'#bd1020',fillOpacity:1}).bindPopup(popup).addTo(instance);
    bounds.push([point.latitude,point.longitude]);
   }
   const selected=points.find(p=>p.id===focus);
   if(selected)instance.setView([selected.latitude,selected.longitude],15);
   else if(points.length===1)instance.setView(bounds[0],15);
   else instance.fitBounds(bounds,{padding:[32,32],maxZoom:15});
   const resize=new ResizeObserver(()=>instance.invalidateSize());resize.observe(element.current);
   instance.once('unload',()=>resize.disconnect());
  }).catch(()=>{if(!disposed)setFailed(true);});
  return()=>{disposed=true;map.current?.remove();map.current=null;};
 },[points,focus]);
 if(!points.length)return <p className="rounded-xl bg-cream p-6 text-sm text-ink/65">Vincule um rastreador com posição GPS a um veículo para exibi-lo no mapa.</p>;
 return <div>{failed&&<p role="alert" className="mb-2 text-sm">Não foi possível abrir o mapa. As posições continuam disponíveis na lista.</p>}<div ref={element} role="region" aria-label="Mapa da última localização dos veículos" data-testid="tracking-map" className={`${styles.map} relative z-0 h-[360px] w-full overflow-hidden rounded-2xl border border-sand sm:h-[440px]`}/><p className="mt-2 text-xs text-ink/55">Mapa: OpenStreetMap. Mostra a última posição recebida pelo TrackCEO.</p></div>;
}
