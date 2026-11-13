import React from 'react';
import {
  AbsoluteFill, Img, Sequence, interpolate, Easing,
  staticFile, useCurrentFrame,
} from 'remotion';
import {Audio} from '@remotion/media';
import {ProviderMark} from './provider-logo';
import {SimulatedCursor} from './video-v7/remotionui/simulated-cursor';
import './video-v7.css';

/**
 * ReviewRouter V7 Lite: revised editorial cut.
 * - Less information per frame; show a state change before its outcome.
 * - Source of truth for logos is the product's own public/logo.png and
 *   provider-logo.tsx, not generic letter placeholders.
 * - No live account, repository changes or measured ReviewRouter benchmark.
 * - Independent of V6 and V7 for comparison.
 */
export const V7_LITE_FRAMES = 1005;
export const V7_LITE_PROOF_FRAMES = 216;
const FPS = 30;
const X = {left: 'clamp', right: 'clamp'} as const;
const t = (frame:number, a:number, b:number) =>
  interpolate(frame, [a, b], [0, 1], {
    extrapolateLeft:'clamp',extrapolateRight:'clamp',
    easing:Easing.bezier(0,0,0.2,1),
  });
const lerp = (a:number,b:number,p:number)=>a+(b-a)*p;
const BLACK='#070C16', SURF='#101B2C', BORDER='#2D4457',
      CYAN='#66E6E9', LIME='#B1F598', WHITE='#EFF8FF', MUTED='#91A6B5';
const body:React.CSSProperties={fontFamily:'"RR Space",Inter,sans-serif',color:WHITE};
const mono:React.CSSProperties={fontFamily:'"RR Mono",monospace'};

const canvas:React.CSSProperties={
  ...body,position:'absolute',inset:0,overflow:'hidden',
  background:'linear-gradient(112deg,#070C16 0%,#070C16 72%,#0C1A2B 100%)',
};
const panel:React.CSSProperties={
  borderRadius:23,border:'2px solid '+BORDER,
  background:SURF,boxShadow:'0 24px 80px #0006',
};
const brandIcon=(size:number):React.ReactElement=>
  <Img src={staticFile('logo.png')} style={{width:size,height:size,objectFit:'contain'}}/>;
const Bg:React.FC=()=> <AbsoluteFill style={canvas}>
  <div style={{position:'absolute',right:-410,top:-600,width:1160,height:1160,
    background:'radial-gradient(circle,#0A2B3970,transparent 65%)',borderRadius:'50%'}}/>
  <div style={{position:'absolute',bottom:145,left:80,right:80,height:2,background:'#2E48575C'}}/>
</AbsoluteFill>;
const Header:React.FC<{step:string}>=({step})=>
  <div style={{position:'absolute',left:86,top:70,right:86,display:'flex',justifyContent:'space-between',alignItems:'center',zIndex:30}}>
    <div style={{display:'flex',alignItems:'center',gap:14,opacity:.78}}>{brandIcon(46)}
      <b style={{fontSize:25,letterSpacing:'-.04em'}}>ReviewRouter</b></div>
    <div style={{...mono,fontSize:18,color:CYAN,opacity:.72}}>{step} / 07</div>
  </div>;
const Title:React.FC<{children:React.ReactNode;step:string}>=({children,step})=>{
  const f=useCurrentFrame();
  return <><Header step={step}/><h1 style={{position:'absolute',top:180,left:110,right:110,textAlign:'center',fontSize:96,
    margin:0,letterSpacing:'-.06em',opacity:t(f,4,21),transform:'translateY('+(1-t(f,4,22))*20+'px)'}}>{children}</h1></>;
};
const Line:React.FC<{from:number;to:number;width?:number;left?:number;top?:number}>=({from,to,width=420,left=750,top=640})=>{
  const f=useCurrentFrame();
  return <div style={{position:'absolute',left,top,width,height:4,borderRadius:2,background:'#23414C'}}>
    <div style={{height:4,background:CYAN,width:t(f,from,to)*100+'%',boxShadow:'0 0 16px #00e5ff45'}}/>
  </div>;
};
const show=(f:number,a:number,b:number)=>
  ({opacity:t(f,a,b),transform:'translateY('+(1-t(f,a,b))*32+'px)'} as React.CSSProperties);
const Logo:React.FC<{size:number;opacity?:number}>=({size,opacity=1})=>
  <div style={{opacity}}>{brandIcon(size)}</div>;

const Intro:React.FC=()=>{
  const f=useCurrentFrame();
  return <AbsoluteFill style={{...canvas,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column'}}>
    <div style={{transform:'translateY('+(1-t(f,4,34))*34+'px) scale('+lerp(.9,1,t(f,4,34))+')',
      opacity:t(f,4,26),filter:'drop-shadow(0 12px 28px #122e4a)'}}><Logo size={194}/></div>
    <div style={{fontSize:109,fontWeight:730,letterSpacing:'-.065em',marginTop:44,...show(f,15,40)}}>ReviewRouter</div>
    <div style={{fontSize:51,color:CYAN,marginTop:12,...show(f,41,64)}}>AI code review.</div>
  </AbsoluteFill>;
};

const Signin:React.FC=()=>{
  const f=useCurrentFrame();
  return <AbsoluteFill style={canvas}>
    <Title step="01">Connect GitHub</Title>
    <div style={{...panel,position:'absolute',left:500,top:433,width:920,height:196,
      display:'flex',alignItems:'center',justifyContent:'center',gap:31,...show(f,8,33)}}>
      <svg viewBox="0 0 24 24" width="68" height="68" fill={WHITE}><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      <b style={{fontSize:46,letterSpacing:'-.045em'}}>Continue with GitHub</b>
    </div>
    <SimulatedCursor points={[{x:66,y:77,frame:0},{x:55,y:50,frame:49,target:70}]} clickFrames={[49]} accent={CYAN} color={WHITE} size={42}/>
    {f>53&&<div style={{position:'absolute',top:720,width:'100%',textAlign:'center',color:LIME,
      fontSize:41,fontWeight:700,...show(f,53,65)}}>✓ Connected</div>}
  </AbsoluteFill>;
};

type ProviderId='openai'|'anthropic'|'mimo'|'openrouter'|'kimi'|'nvidia';
const PROVIDERS:{name:string,id:ProviderId,color:string}[]=[
  {name:'Codex',id:'openai',color:'#EFF9FB'},
  {name:'Claude Code',id:'anthropic',color:'#DBA78C'},
  {name:'MiMo',id:'mimo',color:'#C0C8FF'},
  {name:'OpenRouter',id:'openrouter',color:'#CBB9FF'},
  {name:'Kimi Code',id:'kimi',color:'#BFD7FF'},
  {name:'NVIDIA',id:'nvidia',color:'#76B900'},
];
const NVIDIA_PATH='M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z';
const ProviderGlyph:React.FC<{id:ProviderId;size?:number}> = ({id,size=120})=>
  <div style={{width:size,height:size,display:'grid',placeItems:'center',color:WHITE}}>
    {id==='nvidia'
      ? <svg viewBox="0 0 24 24" width={size} height={size} fill="#76B900"><path d={NVIDIA_PATH}/></svg>
      : <div style={{width:size,height:size,display:'grid',placeItems:'center'}}
        className="v7lite-provider-icon"><ProviderMark providerId={id}/></div>}
  </div>;
const Providers:React.FC=()=>{
  const f=useCurrentFrame(),secs=f/FPS;
  const overview=secs>=4.10;
  return <AbsoluteFill style={canvas}>
    <Title step="02">Choose your AI</Title>
    {!overview?PROVIDERS.slice(Math.min(2,Math.floor(secs/1.37))*2,Math.min(2,Math.floor(secs/1.37))*2+2).map((p,i)=>{
      const g=Math.min(2,Math.floor(secs/1.37));
      const alpha=t(f,g*41,g*41+16);
      return <div key={p.name} style={{...panel,position:'absolute',left:490+i*500,top:424,width:365,height:365,
        display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:30,
        opacity:alpha,transform:'translateY('+(1-alpha)*38+'px)'}}>
          <ProviderGlyph id={p.id} size={145}/>
          <b style={{fontSize:38,color:WHITE}}>{p.name}</b>
        </div>;
    }):<><div style={{display:'flex',gap:13,position:'absolute',left:190,top:434,width:1540}}>
      {PROVIDERS.map((p,i)=><div key={p.name} style={{...panel,width:240,height:289,
        borderColor:i===0?CYAN:BORDER,display:'flex',flexDirection:'column',gap:24,
        alignItems:'center',justifyContent:'center',background:i===0?'#153239':SURF,
        opacity:t(f,122,147)}}>
        <ProviderGlyph id={p.id} size={107}/>
        <b style={{fontSize:27,textAlign:'center'}}>{p.name}</b>
      </div>)}
    </div>
    <div style={{position:'absolute',top:769,left:0,right:0,textAlign:'center',fontSize:35,color:MUTED,opacity:t(f,142,161)}}>+ and more</div>
    <div style={{position:'absolute',top:851,left:0,right:0,textAlign:'center',fontSize:27,color:LIME,opacity:t(f,153,166)}}>✓ Codex selected</div></>}
  </AbsoluteFill>;
};
const STEPS=['Select repository','Create setup PR','Merge setup PR','Enable review','Reviews are on'];
const Repository:React.FC=()=>{
  const f=useCurrentFrame(),state=Math.min(4,Math.max(0,Math.floor((f-27)/23)));
  return <AbsoluteFill style={canvas}>
    <Title step="03">Enable reviews</Title>
    <div style={{...panel,position:'absolute',left:395,top:388,width:1130,height:182,
      display:'flex',alignItems:'center',gap:35,padding:'0 48px',...show(f,6,26)}}>
      <svg viewBox="0 0 24 24" width={83} height={83} fill={WHITE}><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      <div><div style={{fontSize:55,fontWeight:700,letterSpacing:'-.04em'}}>storefront</div>
        <div style={{fontSize:24,color:MUTED}}>GitHub repository</div></div>
    </div>
    {f>=27&&<div style={{position:'absolute',top:669,textAlign:'center',left:0,right:0,fontSize:63,fontWeight:700,
      color:state===4?LIME:WHITE,...show(f,27+state*23,33+state*23)}}>{STEPS[state]}</div>}
    <div style={{position:'absolute',top:791,left:0,right:0,display:'flex',justifyContent:'center',gap:53}}>
      {STEPS.map((s,i)=><div key={s} style={{width:16,height:16,borderRadius:'50%',
        background:i<=state?LIME:'#284354'}}/>)}
    </div>
    <div style={{...mono,position:'absolute',bottom:183,left:0,right:0,color:'#7B94A6',textAlign:'center',fontSize:19}}>Illustrative setup — no repository changed</div>
  </AbsoluteFill>;
};
const SOURCE=[
  'async function getUser(request) {',
  '  const session = readSession(request);',
  '  if (!session) return next();',
  '  return users.get(session.userId);',
];
const Review:React.FC=()=>{
  const f=useCurrentFrame();
  return <AbsoluteFill style={canvas}>
    <Title step="04">One finding. Exact line.</Title>
    <div style={{...panel,position:'absolute',left:165,top:363,width:1590,height:360,
      padding:'29px 45px',...show(f,4,23)}}>
      <div style={{...mono,fontSize:20,color:CYAN,marginBottom:28}}>src/server/auth.ts</div>
      {SOURCE.map((line,i)=><div key={line} style={{...mono,display:'flex',alignItems:'center',
        gap:37,height:56,fontSize:27,whiteSpace:'nowrap',padding:'0 18px',
        borderLeft:i===2&&f>33?'4px solid #FFB763':'4px solid transparent',
        background:i===2&&f>33?'#78591938':'transparent',
        color:i===2?WHITE:'#A5BBCA'}}>
          <span style={{color:'#668396',fontSize:21}}>{48+i}</span>{line}
        </div>)}
    </div>
    {f>67&&<div style={{...panel,position:'absolute',left:485,top:733,width:950,height:228,
      padding:'31px 42px',borderColor:'#62B9C6',
      ...show(f,67,85)}}>
      <div style={{display:'flex',alignItems:'center',gap:24}}>{brandIcon(70)}
        <b style={{fontSize:34}}>ReviewRouter</b></div>
      <b style={{display:'block',marginLeft:91,fontSize:34,color:LIME,marginTop:7}}>Missing authorization check</b>
      <p style={{margin:'10px 0 0 91px',fontSize:25,color:MUTED}}>Reject requests without a session.</p>
    </div>}
    <div style={{...mono,position:'absolute',bottom:172,left:0,right:0,fontSize:18,color:'#8497A7',textAlign:'center'}}>Illustrative PR and review comment</div>
  </AbsoluteFill>;
};
const BARS=[.27,.38,.32,.49,.55,.47,.64,.61,.80,.92];
const Stats:React.FC=()=>{
  const f=useCurrentFrame();
  return <AbsoluteFill style={canvas}>
    <Title step="05">See the impact</Title>
    <div style={{position:'absolute',top:390,left:385,width:400,textAlign:'center'}}>
      <div style={{fontSize:184,fontWeight:740,letterSpacing:'-.06em',color:LIME}}>{Math.round(128*t(f,12,44))}</div>
      <div style={{fontSize:43}}>Findings</div>
    </div>
    {f>54&&<div style={{position:'absolute',top:408,left:1130,width:400,textAlign:'center',opacity:t(f,54,71)}}>
      <div style={{fontSize:149,fontWeight:740,letterSpacing:'-.05em'}}>{Math.round(34*t(f,54,74))}</div>
      <div style={{fontSize:43}}>Reviews</div>
    </div>}
    <div style={{position:'absolute',top:803,left:426,width:1100,height:140,display:'flex',gap:23,alignItems:'flex-end'}}>
      {BARS.map((h,i)=><div key={i} style={{height:(h*140*t(f,65+i*4,101+i*4))+'px',
        flex:1,borderRadius:'6px 6px 0 0',background:CYAN}}/>)}
    </div>
    <div style={{...mono,position:'absolute',bottom:174,left:0,right:0,textAlign:'center',fontSize:20,color:MUTED}}>Illustrative usage and review data</div>
  </AbsoluteFill>;
};
const Benchmark:React.FC=()=>{
  const f=useCurrentFrame();
  return <AbsoluteFill style={canvas}>
    <Header step="06"/>
    <div style={{position:'absolute',top:269,left:0,right:0,textAlign:'center',
      fontSize:224,fontWeight:750,letterSpacing:'-.08em',color:CYAN,opacity:t(f,5,30)}}>≈9.5×</div>
    <div style={{position:'absolute',top:545,left:0,right:0,textAlign:'center',fontSize:70,
      fontWeight:650,opacity:t(f,22,41)}}>faster review*</div>
    <div style={{...mono,position:'absolute',top:722,left:440,fontSize:25}}>
      <div style={{marginBottom:38}}>OpenCodeReview     1:23 <div style={{display:'inline-block',
        width:530*.1056*t(f,43,64),height:24,background:CYAN,marginLeft:20}}/></div>
      <div style={{color:MUTED}}>Claude Code        13:06 <div style={{display:'inline-block',
        width:530*t(f,43,67),height:24,background:'#607187',marginLeft:20}}/></div>
    </div>
    <div style={{...mono,position:'absolute',bottom:175,left:0,right:0,textAlign:'center',
      fontSize:17,color:MUTED,opacity:t(f,38,54)}}>
      *OpenCodeReview upstream AACR-Bench, not measured by ReviewRouter
    </div>
  </AbsoluteFill>;
};
const Outro:React.FC=()=>{
  const f=useCurrentFrame();
  return <AbsoluteFill style={{...canvas,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
    <div style={{opacity:t(f,4,24),transform:'scale('+lerp(.85,1,t(f,4,35))+')'}}>{brandIcon(183)}</div>
    <div style={{fontSize:114,fontWeight:720,marginTop:39,letterSpacing:'-.065em',...show(f,18,40)}}>ReviewRouter</div>
    <div style={{fontSize:46,color:LIME,marginTop:10,...show(f,34,50)}}>Start free</div>
    <div style={{...mono,color:MUTED,fontSize:30,marginTop:20,...show(f,43,60)}}>reviewrouter.org</div>
  </AbsoluteFill>;
};
const CUTS=[
  {from:0,duration:99,component:Intro},
  {from:99,duration:84,component:Signin},
  {from:183,duration:177,component:Providers},
  {from:360,duration:156,component:Repository},
  {from:516,duration:165,component:Review},
  {from:681,duration:132,component:Stats},
  {from:813,duration:114,component:Benchmark},
  {from:927,duration:78,component:Outro},
] as const;
const Cue:React.FC<{at:number;filename:string;volume:number}> =({at,filename,volume})=>
  <Sequence from={at}><Audio src={staticFile('v7-sfx/'+filename)} volume={volume}/></Sequence>;
export const VideoV7Lite:React.FC =()=> <AbsoluteFill style={canvas}>
  <Bg/>
  <Audio src={staticFile('music.m4a')} volume={.30}/>
  <Cue at={146} filename="click.wav" volume={.48}/>
  <Cue at={350} filename="click.wav" volume={.33}/>
  <Cue at={494} filename="success.wav" volume={.39}/>
  <Cue at={600} filename="finding.wav" volume={.45}/>
  {CUTS.map(({from,duration,component:Component})=>
    <Sequence key={from} from={from} durationInFrames={duration}><Component/></Sequence>)}
</AbsoluteFill>;
/** Short proof of the new hierarchy: one provider pair → compact icon row → one finding. */
export const VideoV7LiteProof:React.FC =()=> <AbsoluteFill style={canvas}>
  <Bg/>
  <Sequence from={0} durationInFrames={121}><Providers/></Sequence>
  <Sequence from={121} durationInFrames={95}><Review/></Sequence>
</AbsoluteFill>;
