export const ATTACHMENT_LIMIT=16*1024*1024;
const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document',XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ATTACHMENT_MIMES=['application/pdf','image/jpeg','image/png','image/webp','audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/webm',
 'video/mp4',DOCX,'application/msword',XLSX,'application/vnd.ms-excel','image/vnd.dwg'];
export function attachmentMime(name:string,type:string){
 const mime=type.split(';')[0].trim().toLowerCase();
 const aliases:Record<string,string>={'audio/x-m4a':'audio/mp4','audio/mp3':'audio/mpeg','audio/x-wav':'audio/wav','application/ogg':'audio/ogg','application/acad':'image/vnd.dwg','application/x-dwg':'image/vnd.dwg','image/x-dwg':'image/vnd.dwg'};
 if(aliases[mime])return aliases[mime];
 if(ATTACHMENT_MIMES.includes(mime))return mime;
 const extensions:Record<string,string>={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',ogg:'audio/ogg',opus:'audio/ogg',mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav',webm:'audio/webm',
  mp4:'video/mp4',docx:DOCX,doc:'application/msword',xlsx:XLSX,xls:'application/vnd.ms-excel',dwg:'image/vnd.dwg'};
 return extensions[name.split('.').at(-1)?.toLowerCase()??'']??mime;
}
// DWG tem tipo image/vnd.dwg, mas vai como documento (o WhatsApp não mostra como foto).
export function attachmentKind(mime:string):'document'|'image'|'audio'|'video'{return mime==='image/vnd.dwg'?'document':mime.startsWith('image/')?'image':mime.startsWith('audio/')?'audio':mime.startsWith('video/')?'video':'document'}
export function attachmentLabel(mime:string,name:string){const k=attachmentKind(mime);return k==='document'?`[documento: ${name.replace(/[\[\]\n\r]/g,'_')}]`:k==='image'?'[foto]':k==='video'?'[vídeo]':'[áudio]'}
export function validateAttachment(name:string,mime:string,size:number){
 if(!name||name.length>200||!ATTACHMENT_MIMES.includes(mime))throw new Error('Envie PDF, Word, Excel, DWG, foto (JPG/PNG/WebP), vídeo (MP4) ou áudio (OGG/MP3/M4A/AAC/WAV/WebM).');
 if(!Number.isInteger(size)||size<=0||size>ATTACHMENT_LIMIT)throw new Error('O arquivo deve ter até 16 MB.');
}
/** Check signatures, so active HTML/SVG cannot be disguised as an accepted attachment. */
export function matchesAttachment(bytes:Uint8Array,mime:string){
 const b=Buffer.from(bytes);const at=(s:string,n=0)=>b.subarray(n,n+s.length).toString('latin1')===s;
 if(mime==='application/pdf')return at('%PDF-');
 if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
 if(mime==='image/png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/webp')return at('RIFF')&&at('WEBP',8);
 if(mime==='audio/ogg')return at('OggS');
 if(mime==='audio/wav')return at('RIFF')&&at('WAVE',8);
 if(mime==='audio/mp4')return at('ftyp',4);
 if(mime==='audio/webm')return b.subarray(0,4).equals(Buffer.from([26,69,223,163]));
 if(mime==='audio/aac')return b[0]===255&&(b[1]&0xf6)===0xf0;
 if(mime==='audio/mpeg')return at('ID3')||(b[0]===255&&(b[1]&0xe0)===0xe0);
 if(mime==='video/mp4')return at('ftyp',4);
 // Word/Excel novos são ZIP; os antigos (.doc/.xls) são OLE; DWG começa com a versão "AC10xx".
 if(mime===DOCX||mime===XLSX)return at('PK\x03\x04');
 if(mime==='application/msword'||mime==='application/vnd.ms-excel')return b.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
 if(mime==='image/vnd.dwg')return /^AC10\d\d$/.test(b.subarray(0,6).toString('latin1'));
 return false;
}
