import React from 'react';
import {AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Audio} from '@remotion/media';
import {ArrowRight, Check, GitPullRequest, MousePointer2} from 'lucide-react';
import {ProviderMark} from './provider-logo';
import './video-v3.css';

const clamp = {extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const p = (f:number,a:number,b:number)=>interpolate(f,[a,b],[0,1],clamp);
const asset = (name:string)=>staticFile(`captures/${name}.png`);
const Scene:React.FC<{duration:number;children:React.ReactNode}> = ({duration,children})=>{
  const f=useCurrentFrame();
  return <AbsoluteFill style={{opacity:Math.min(p(f,3,9),1-p(f,duration-9,duration-3)),transform:`translateY(${(1-p(f,0,18))*16}px)`}}>{children}</AbsoluteFill>;
};
const Rise:React.FC<{delay?:number;children:React.ReactNode;className?:string}> = ({delay=0,children,className})=>{
  const f=useCurrentFrame(),{fps}=useVideoConfig();
  const x=spring({frame:Math.max(0,f-delay),fps,config:{damping:200},durationInFrames:18});
  return <div className={className} style={{opacity:f<delay?0:x,transform:`translateY(${(1-x)*18}px)`}}>{children}</div>;
};
const Cursor:React.FC<{x:number;y:number;fromX:number;fromY:number;click:number;delay?:number}> = ({x,y,fromX,fromY,click,delay=12})=>{
  const f=useCurrentFrame(); const q=1-Math.pow(1-p(f,delay,delay+20),3); const tap=f>=click&&f<click+5;
  return <div className="v3-cursor" style={{left:fromX+(x-fromX)*q,top:fromY+(y-fromY)*q,opacity:p(f,delay,delay+5),transform:`scale(${tap?.82:1})`}}><MousePointer2 size={43} strokeWidth={1.6} fill="#f7fcff" color="#111723"/>{f>=click&&f<click+14&&<span style={{opacity:1-p(f,click,click+14),transform:`scale(${1+(f-click)*.085})`}}/>}</div>;
};
const Chip:React.FC<{children:React.ReactNode}> = ({children})=><div className="v3-chip">{children}</div>;

const Intro:React.FC = ()=> { const f=useCurrentFrame(); return <Scene duration={130}><div className="v3-intro"><Rise><div className="v3-brand"><Img src={staticFile('logo.png')} width={60}/> <b>ReviewRouter</b></div></Rise><Rise delay={7}><div className="v3-eyebrow">OPEN SOURCE / AI CODE REVIEW</div><h1>Your review<br/><em>control plane.</em></h1><p>Fast, efficient code review.<br/>Everything under your control.</p></Rise><Rise delay={22}><div className="v3-free">FREE FOR EVERYONE <span>·</span> BRING YOUR OWN AI</div><div className="v3-note">No review service fee. Your AI provider may charge for usage.</div></Rise></div><div className="v3-intro-visual"><div className="v3-orbit o1"/><div className="v3-orbit o2"/><div className="v3-orbit-dot" style={{left:330+270*Math.cos(f*.025),top:330+270*Math.sin(f*.025)}}/><div className="v3-orbit-dot v3-orbit-dot-two" style={{left:330+185*Math.cos(1.8-f*.032),top:330+185*Math.sin(1.8-f*.032)}}/><div className="v3-core"><Img src={staticFile('logo.png')} width={168}/></div><div className="v3-signal s1" style={{transform:`translateY(${Math.sin(f*.055)*6}px)`}}>PULL REQUEST <span>OPEN</span></div><div className="v3-signal s2" style={{transform:`translateY(${Math.sin(f*.055+1.4)*6}px)`}}><Check size={19}/> REVIEW READY</div></div></Scene>; };

const Signin:React.FC=()=> <Scene duration={84}><div className="v3-signin"><Rise><div className="v3-eyebrow">GET STARTED</div><h1>Sign in. Get reviewing.</h1><p>Use your GitHub account to get started.</p><div className="v3-login-crop"><Img src={asset('signin')} style={{position:'absolute',width:3200,left:-1746,top:-842,maxWidth:'none'}}/></div></Rise></div><Cursor x={960} y={525} fromX={1290} fromY={750} click={48}/></Scene>;

const providers = [
  {name:'Codex',kind:'openai',mode:'Subscription'},
  {name:'Claude Code',kind:'anthropic',mode:'Subscription / API'},
  {name:'MiMo',kind:'mimo',mode:'Token Plan'},
  {name:'OpenRouter',kind:'openrouter',mode:'API key'},
  {name:'Kimi Code',kind:'kimi',mode:'API key'},
] as const;
const Providers:React.FC=()=>{
  const f=useCurrentFrame();return <Scene duration={140}><div className="v3-provider"><Rise><div className="v3-eyebrow">AI PROVIDERS</div><h1>Bring the AI you already use.</h1></Rise><div className="v3-provider-list">{providers.map((provider,i)=><Rise key={provider.name} delay={10+i*4} className="v3-provider-reveal"><div className={'v3-provider-item '+(i===1&&f>=64?'active':'')}><div className="v3-provider-mark"><ProviderMark providerId={provider.kind}/></div><strong>{provider.name}</strong><small>{provider.mode}</small>{i===1&&f>=64&&<span className="v3-provider-check"><Check size={17}/></span>}</div></Rise>)}</div><Rise delay={37}><div className="v3-provider-more">And more models through OpenRouter <ArrowRight size={20}/></div></Rise></div><Cursor x={686} y={480} fromX={1050} fromY={680} delay={26} click={64}/></Scene>;
};

const Repo:React.FC=()=>{
  const f=useCurrentFrame(); const z=1+0.035*p(f,10,60);
  return <Scene duration={205}><Chip>EXAMPLE DATA</Chip><div className="v3-repo-shot" style={{transform:`scale(${z})`}}><Img src={asset('repo-v3-0')} style={{width:'100%',display:'block'}}/>{[55,79,103,127].map((start,index)=><Img key={start} src={asset(`repo-v3-${index+1}`)} style={{width:'100%',position:'absolute',left:0,top:0,opacity:p(f,start,start+5)}}/>)}</div><Cursor x={1683} y={490} fromX={1240} fromY={700} delay={10} click={55}/></Scene>;
};

const Review:React.FC=()=>{
  const f=useCurrentFrame();return <Scene duration={105}><Chip>ILLUSTRATIVE REVIEW</Chip><div className="v3-review"><Rise><div className="v3-eyebrow"><GitPullRequest size={23}/> PULL REQUEST #42</div><h1>Every PR, reviewed.</h1><div className="v3-code"><div className="v3-file">src/auth/session.ts</div><div className="v3-code-line"><span>41</span> if (!session) return null;</div><div className="v3-code-line changed"><span>42</span> return session.user;</div></div></Rise><div className="v3-comment" style={{opacity:p(f,32,43),transform:`translateY(${(1-p(f,32,43))*15}px)`}}><div className="v3-avatar"><Img src={staticFile('logo.png')} width={42}/></div><div className="v3-comment-body"><div className="v3-reviewer">ReviewRouter <span>bot</span> <small>reviewed just now</small></div><strong>Check whether the session has expired</strong><p>An expired session could still be treated as valid.</p></div></div></div></Scene>;
};

const bars=[19,23,22,30,26,40,27,34,26,37,29,33,43,32,35,41,29,36,32,45,24,31,28,35,30,33,27,29,36,35];
const Stats:React.FC=()=>{
  const f=useCurrentFrame(); const scale=(value:number)=>Math.round(value*p(f,15,55));
  return <Scene duration={180}><Chip>ILLUSTRATIVE DATA</Chip><div className="v3-usage"><Rise><div className="v3-usage-head"><div><h1>Usage &amp; review activity</h1><p>One place to see what your reviews find and use.</p></div><div className="v3-filter">Last 30 days <span>⌄</span></div></div><div className="v3-kpis"><div><span>Reviews</span><strong>{scale(34)}</strong><small>Published reviews</small></div><div><span>Issues caught</span><strong>{scale(128)}</strong><small>All severities</small></div><div><span>Known tokens</span><strong>{(2.84*p(f,15,55)).toFixed(2)}M</strong><small>Input and output</small></div><div><span>Provider requests</span><strong>{scale(243)}</strong><small>Across your accounts</small></div></div></Rise><div className="v3-charts"><div className="v3-chart-main"><div className="v3-chart-title">Daily token usage <span>LAST 30 DAYS</span></div><div className="v3-chart"><div className="v3-grid-lines"><span>300K</span><span>200K</span><span>100K</span><span>0</span></div><div className="v3-bars">{bars.map((h,i)=>{const grow=p(f,25+i*1.4,55+i*1.4);return <div key={i} className="v3-bar" style={{height:`${h*grow}%`}}><span className="cyan" style={{height:'50%'}}/><span className="purple" style={{height:'30%'}}/><span className="green" style={{height:'20%'}}/></div>})}</div></div><div className="v3-chart-bottom"><span>Oct 01</span><span>Oct 10</span><span>Oct 20</span><span>Oct 30</span></div><div className="v3-legend"><span><i className="cyan"/> Codex</span><span><i className="purple"/> MiMo</span><span><i className="green"/> Kimi</span></div></div><div className="v3-chart-side"><div className="v3-chart-title">Tokens by provider</div>{[['Codex','1.42M',100,'cyan'],['MiMo','850K',60,'purple'],['Kimi','570K',40,'green']].map(([name,value,width,color],i)=><div className="v3-side-row" key={name}><div>{name}<span>{value}</span></div><div className="v3-side-track"><div className={String(color)} style={{width:`${Number(width)*p(f,35+i*8,75+i*8)}%`}}/></div></div>)}</div></div><div className="v3-usage-foot">Illustrative sample · Usage coverage depends on reported data</div></div></Scene>;
};

const Benchmark:React.FC=()=> <Scene duration={100}><div className="v3-benchmark"><Rise><div className="v3-eyebrow">POWERED BY OPENCODEREVIEW</div><h1>Built for focused review.</h1><div className="v3-benchmark-stats"><div><strong>9×+</strong><span>fewer tokens</span></div><div><strong>9×</strong><span>faster</span></div></div><p>OpenCodeReview vs. Claude Code · Claude 4.6 Opus · AACR-Bench<br/>385K vs. 5,664K tokens · 1:23 vs. 13:06 per review · Results vary<br/><span>arxiv.org/abs/2608.09290</span></p></Rise></div></Scene>;
const Outro:React.FC=()=> <Scene duration={75}><div className="v3-outro"><Rise><Img src={staticFile('logo.png')} width={82}/><h1>ReviewRouter</h1><p>Your review control plane.</p><div>reviewrouter.org <ArrowRight size={22}/></div></Rise></div></Scene>;

export const VideoV3:React.FC=()=> <AbsoluteFill className="v3-canvas"><Audio src={staticFile('music.m4a')} volume={(f)=>.65*Math.max(0,Math.min(1,f/25,(963-f)/30))}/><div className="v3-grid"/><Sequence from={0} durationInFrames={130}><Intro/></Sequence><Sequence from={122} durationInFrames={84}><Signin/></Sequence><Sequence from={198} durationInFrames={140}><Providers/></Sequence><Sequence from={330} durationInFrames={205}><Repo/></Sequence><Sequence from={527} durationInFrames={105}><Review/></Sequence><Sequence from={624} durationInFrames={180}><Stats/></Sequence><Sequence from={796} durationInFrames={100}><Benchmark/></Sequence><Sequence from={888} durationInFrames={75}><Outro/></Sequence></AbsoluteFill>;
