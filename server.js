 'use strict';
const express=require('express');const cors=require('cors');const QRCode=require('qrcode');const {Client,LocalAuth}=require('whatsapp-web.js');const {createClient}=require('@supabase/supabase-js');const crypto=require('crypto');const path=require('path');
const required=['CORE_ORCA_TOKEN','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ALLOWED_ORIGIN','EMPRESA_ID'];for(const k of required)if(!process.env[k])throw Error('Variável obrigatória ausente: '+k);
const token=process.env.CORE_ORCA_TOKEN,empresa=process.env.EMPRESA_ID,origin=process.env.ALLOWED_ORIGIN;
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const app=express();app.use(cors({origin:(o,cb)=>cb(null,!o||o===origin),allowedHeaders:['Content-Type','X-CoreOrca-Token'],methods:['GET','POST','OPTIONS']}));app.use(express.json({limit:'32kb'}));
let qr=null,ready=false,authenticated=false,working=false;
const wa=new Client({authStrategy:new LocalAuth({dataPath:process.env.SESSION_DIR||path.join(__dirname,'.wa-session')}),puppeteer:{headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']}});
wa.on('qr',async s=>{ready=false;qr=await QRCode.toDataURL(s)});wa.on('authenticated',()=>authenticated=true);wa.on('ready',()=>{ready=true;qr=null});wa.on('disconnected',()=>{ready=false;authenticated=false;qr=null});wa.initialize().catch(e=>console.error('WhatsApp init:',e.message));
function auth(req,res,next){const supplied=req.get('X-CoreOrca-Token')||'';const a=Buffer.from(supplied),b=Buffer.from(token);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Acesso não autorizado'});next()}
app.get('/health',(req,res)=>res.json({ok:true}));app.use(auth);app.get('/status',(req,res)=>res.json({ready,authenticated,qr}));
const uuid=/^[a-f0-9-]{36}$/i;
async function sendOne(row){
 if(!ready)throw Error('WhatsApp desconectado');
 const phone=String(row.telefone||'').replace(/\D/g,'');if(!/^\d{12,15}$/.test(phone))throw Error('Telefone inválido');
 const number=await wa.getNumberId(phone.startsWith('55')?phone:'55'+phone);if(!number)throw Error('Número não cadastrado');
 let message=String(row.mensagem||'');if(row.pix)message+='\n\nPIX: '+row.pix;if(row.boleto_path)message+='\n\nBoleto disponível mediante solicitação.';
 if(!message.trim())throw Error('Mensagem vazia');
 const result=await wa.sendMessage(number._serialized,message);
 const {error}=await sb.from('cobrancas_whatsapp').update({status:'enviada',enviada_em:new Date().toISOString()}).eq('id',row.id).eq('empresa_id',empresa);if(error)console.error('ENVIADA MAS FALHOU REGISTRO:',row.id,error.message);
 return result.id._serialized;
}
app.post('/send',async(req,res)=>{const id=req.body?.id;if(!uuid.test(id||'')||req.body?.empresa_id!==empresa)return res.status(400).json({error:'Identificação inválida'});
 try{const {data,error}=await sb.from('cobrancas_whatsapp').select('*').eq('id',id).eq('empresa_id',empresa).single();if(error||!data)return res.status(404).json({error:'Cobrança não encontrada'});if(['enviada','cancelada'].includes(data.status))return res.status(409).json({error:'Cobrança já enviada ou cancelada'});const mid=await sendOne(data);res.json({ok:true,messageId:mid})}catch(e){console.error('Envio:',e.message);res.status(503).json({error:e.message})}});
// A fila é consultada no banco a cada minuto. Executar UMA instância do serviço.
async function tick(){if(working||!ready)return;working=true;try{const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const {data,error}=await sb.from('cobrancas_whatsapp').select('*').eq('empresa_id',empresa).eq('status','programada').lte('data_programada',date).order('data_programada').limit(25);if(error)throw error;
 for(const row of data||[]){const {data:pay}=row.recibo_pagamento_id?await sb.from('recibo_pagamentos').select('status').eq('id',row.recibo_pagamento_id).maybeSingle():{data:null};if(pay?.status==='pago'){await sb.from('cobrancas_whatsapp').update({status:'cancelada'}).eq('id',row.id).eq('empresa_id',empresa);continue}try{await sendOne(row)}catch(e){console.error('Cobrança',row.id,e.message);break}}
 }catch(e){console.error('Agenda:',e.message)}finally{working=false}}
setInterval(tick,60000);const port=Number(process.env.PORT||3000);app.listen(port,'0.0.0.0',()=>console.log('Servidor WhatsApp iniciado na porta',port));
