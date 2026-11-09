import {test,expect,vi,afterEach} from 'vitest';
import {attachmentLabel,attachmentKind,matchesAttachment,validateAttachment,ATTACHMENT_LIMIT} from '@/lib/whatsapp/attachments';
import {sendWhatsAppMedia,type WhatsAppCredentials} from '@/lib/whatsapp/send';
const c:WhatsAppCredentials={provider:'evolution',phoneNumberId:'pnid',metaToken:'token',evolutionUrl:'https://evo.example.com',evolutionKey:'secret',evolutionInstance:'crm'};
afterEach(()=>vi.unstubAllGlobals());
test('rejects active content, oversized and empty uploads; validates file signatures',()=>{
 expect(()=>validateAttachment('x.svg','image/svg+xml',20)).toThrow();
 expect(()=>validateAttachment('x.pdf','application/pdf',0)).toThrow();
 expect(()=>validateAttachment('x.pdf','application/pdf',ATTACHMENT_LIMIT+1)).toThrow();
 expect(()=>validateAttachment('x.pdf','application/pdf',500)).not.toThrow();
 expect(matchesAttachment(Buffer.from('<html>evil</html>'),'application/pdf')).toBe(false);
 expect(matchesAttachment(Buffer.from('%PDF-1.7'),'application/pdf')).toBe(true);
 expect(matchesAttachment(Buffer.from('OggS123'),'audio/ogg')).toBe(true);
 expect(attachmentLabel('application/pdf','bad\n[name].pdf')).toBe('[documento: bad__name_.pdf]');
 expect(attachmentKind('audio/mp4')).toBe('audio');
});
test('Evolution receives private PDF bytes with filename; requires confirmed message id',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({key:{id:'wa-1'}})));vi.stubGlobal('fetch',fetcher);
 const payload={bytes:Buffer.from('%PDF-1.7'),mime:'application/pdf',name:'Orcamento.pdf',caption:'*Rose:*',kind:'document' as const};
 expect(await sendWhatsAppMedia(c,'5547999999999',payload)).toBe('wa-1');
 const [url,init]=fetcher.mock.calls[0];expect(url).toBe('https://evo.example.com/message/sendMedia/crm');
 expect(JSON.parse(init.body)).toMatchObject({mediatype:'document',fileName:'Orcamento.pdf',media:payload.bytes.toString('base64')});
 expect(init.redirect).toBe('error');
 fetcher.mockResolvedValue(new Response('{}'));await expect(sendWhatsAppMedia(c,'5547999999999',payload)).rejects.toThrow(/confirmou/);
});
test('Meta uploads media then sends by media id and propagates the 24h restriction',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({id:'media-id'}))).mockResolvedValueOnce(new Response(JSON.stringify({messages:[{id:'wa-meta'}]})));
 vi.stubGlobal('fetch',fetcher);const payload={bytes:Buffer.from('%PDF-1.7'),mime:'application/pdf',name:'Orcamento.pdf',caption:'*Rose:*',kind:'document' as const};
 expect(await sendWhatsAppMedia({...c,provider:'meta'},'5547999999999',payload)).toBe('wa-meta');
 expect(fetcher.mock.calls[0][1].body).toBeInstanceOf(FormData);
 expect(JSON.parse(fetcher.mock.calls[1][1].body).document).toEqual({id:'media-id',filename:'Orcamento.pdf',caption:'*Rose:*'});
 fetcher.mockResolvedValueOnce(new Response(JSON.stringify({id:'media-2'}))).mockResolvedValueOnce(new Response(JSON.stringify({error:{code:131047}}),{status:400}));
 await expect(sendWhatsAppMedia({...c,provider:'meta'},'5547999999999',payload)).rejects.toThrow(/24h/);
});
