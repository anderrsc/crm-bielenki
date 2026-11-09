export type AgendaDetails={address:string|null;phone:string|null;clientId:string|null;clientName:string|null;notes:string|null;relatedHref:string|null;relatedLabel:string|null};
export function agendaMapLinks(address:string|null){
 const q=address?.trim();if(!q)return null;
 const encoded=encodeURIComponent(q);
 return {google:`https://www.google.com/maps/search/?api=1&query=${encoded}`,waze:`https://waze.com/ul?q=${encoded}&navigate=yes`,apple:`https://maps.apple.com/?q=${encoded}`};
}
export function agendaContactLinks(phone:string|null){
 const digits=(phone??'').replace(/\D/g,'');if(digits.length<10||digits.length>15)return null;
 return {call:`tel:+${digits.length<=11?'55'+digits:digits}`,whatsapp:`https://wa.me/${digits.length<=11?'55'+digits:digits}`};
}
export function isAgendaDone(status:string){return ['concluido','concluida','medicao_concluida','finalizado'].includes(status)}
