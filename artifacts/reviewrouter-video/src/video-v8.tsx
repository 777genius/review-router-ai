import React from 'react';
import {AbsoluteFill, Img, Sequence, Easing, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Audio} from '@remotion/media';
import {ArrowRight, Check, CheckCircle2, GitBranch, GitPullRequest, MousePointer2, ShieldCheck, CircleDollarSign, Zap, FileCode2, Layers3, Cloud, Server, LockKeyhole, AlertTriangle, PlugZap, Sparkles} from 'lucide-react';
import {ProviderMark} from './provider-logo';
import {SimulatedCursor} from './video-v7/remotionui/simulated-cursor';
import './video-v7.css';
import './video-v8.css';

export const V8_FRAMES = 1020; // 34.0s at 30fps; separate from V6/V7/V7Lite.
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const EASE = Easing.bezier(0.08, 0.62, 0.2, 1);
const p = (f: number, start: number, end: number) => interpolate(f, [start, end], [0, 1], {...CLAMP, easing: EASE});
const move = (f: number, start: number, end: number, delta = 40): React.CSSProperties =>
  ({opacity:p(f,start,end),transform:'translateY(' + ((1 - p(f,start,end)) * delta).toFixed(1) + 'px)'});
const C = {
  bg:'#050914',surface:'#101d2d',text:'#f1f8ff',
  soft:'#b0c6d2',muted:'#85a1b0',cyan:'#76eef1',
  lime:'#a6ff9a',amber:'#ffc36a',violet:'#b0a0ff',
} as const;
const fMono: React.CSSProperties={fontFamily:'"RR Mono", monospace'};
const fMain: React.CSSProperties={fontFamily:'"RR Space", sans-serif'};
const RR:React.FC<{size?:number}> = ({size=60})=><Img src={staticFile('logo.png')} style={{width:size,height:size,objectFit:'contain'}}/>;
const Navi:React.FC<{label:string;scene:number}> = ({label,scene})=>
  <div className="v8-nav"><div className="v8-brand"><RR size={46}/><span>ReviewRouter</span></div>
    <div className="v8-step">{String(scene).padStart(2,'0')} / 09 <span> {label}</span></div>
  </div>;
const Bg:React.FC =()=> <AbsoluteFill className="v8-root">
  <div className="v8-ambient"/><div className="v8-hairline"/>
</AbsoluteFill>;
const Scene:React.FC<{scene:number;name:string;children:React.ReactNode;first?:boolean}>=({scene,name,children,first})=>{
  const f=useCurrentFrame();
  return <AbsoluteFill style={{...fMain,color:C.text,opacity:first?1:p(f,0,9)}}>
    <Navi scene={scene} label={name}/>
    {children}
  </AbsoluteFill>;
};
const Tag:React.FC<{children:React.ReactNode;accent?:string}>=({children,accent=C.cyan})=>
  <div className="v8-tag" style={{color:accent,borderColor:accent+'55'}}>{children}</div>;
const ChapterTitle:React.FC<{eyebrow:string;title:string;sub?:string}>=({eyebrow,title,sub})=><>
  <div className="v8-title-eyebrow">{eyebrow}</div>
  <div className="v8-title">{title}</div>
  {sub&&<div className="v8-title-sub">{sub}</div>}
</>;
const Foot:React.FC<{children:React.ReactNode}>=({children})=><div className="v8-disclaimer">{children}</div>;

const Hero:React.FC=()=>{
  const f=useCurrentFrame();
  return <Scene first scene={1} name="WHY REVIEWROUTER">
    <div className="v8-center-hero">
      <div className="v8-open-source" style={{opacity:p(f,0,9)}}><span className="v8-open-dot"/>100% OPEN SOURCE <span className="v8-open-sep">/</span> FREE CONTROL PLANE</div>
      <div className="v8-dual">
        <div style={move(f,6,27,48)}><div className="v8-hero-number">9×</div><div className="v8-hero-label">FASTER</div></div>
        <div className="v8-dual-divider" style={{opacity:p(f,22,36)}}/>
        <div style={move(f,27,49,48)}><div className="v8-hero-number" style={{color:C.lime}}>9×</div><div className="v8-hero-label">LESS TOKEN USE</div></div>
      </div>
      <div className="v8-vs" style={{opacity:p(f,49,67)}}>OPEN CODE REVIEW ENGINE <span>VS CLAUDE CODE*</span></div>
    </div>
    <Foot>* Upstream OpenCodeReview AACR-Bench (Claude 4.6 Opus), not a separate ReviewRouter measurement. Token count is not a guaranteed bill.</Foot>
  </Scene>;
};

const SignIn:React.FC=()=>{
  const f=useCurrentFrame();
  return <Scene scene={2} name="SIGN IN">
    <div className="v8-single-title" style={move(f,0,11,18)}>Connect GitHub.</div>
    <div className="v8-signin-button" style={{opacity:p(f,2,13),transform:'scale('+(0.95+0.05*p(f,3,16))+')'}}>
      <svg width="51" height="51" viewBox="0 0 24 24" fill="#081a23"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      Continue with GitHub <ArrowRight size={38}/>
    </div>
    <SimulatedCursor points={[{x:69,y:74,frame:0},{x:53,y:56,frame:20,target:60}]} clickFrames={[22]} color="#f9ffff" accent={C.cyan} size={44}/>
  </Scene>;
};

const NVIDIA_LOGO='M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z';
const PROVIDERS = [
  {name:'Codex',id:'openai',tag:'SUBSCRIPTION'},
  {name:'Claude Code',id:'anthropic',tag:'SUBSCRIPTION'},
  {name:'MiMo',id:'mimo',tag:'TOKEN PLAN'},
  {name:'OpenRouter',id:'openrouter',tag:'API KEY'},
  {name:'Kimi Code',id:'kimi',tag:'API KEY'},
  {name:'NVIDIA',id:'nvidia',tag:'VIA OPENROUTER'},
] as const;
const ProviderGlyph:React.FC<{id:typeof PROVIDERS[number]['id']}>=({id})=>
  id==='nvidia'?<svg viewBox="0 0 24 24" width="92" height="92" fill="#76B900"><path d={NVIDIA_LOGO}/></svg>
    :<div className={'v8-agent-mark '+(id==='mimo'?'v8-mimo':'')}><ProviderMark providerId={id}/></div>;
const Providers:React.FC=()=>{
  const f=useCurrentFrame();
  return <Scene scene={3} name="YOUR AI">
    <ChapterTitle eyebrow="BRING YOUR OWN AI" title="Subscription or API key." sub="Use the AI you already have."/>
    <div className="v8-provider-row">
      {PROVIDERS.map((item,i)=><div key={item.name} className={'v8-provider-card'+(i===0&&f>=62?' v8-selected':'')} style={{opacity:i===0?1:f>=62?0.74:1}}>
        <div className="v8-provider-emblem"><ProviderGlyph id={item.id}/></div>
        <strong>{item.name}</strong><small>{item.tag}</small>
        {i===0&&f>=62&&<span className="v8-selection-check"><Check size={24}/></span>}
      </div>)}
    </div>
    <div className="v8-provider-bottom"><span style={move(f,10,25)}>Six real provider identities.</span><span style={{...move(f,72,87),color:C.cyan}}>Codex selected <Check size={24}/></span></div>
    <Foot>NVIDIA free model availability via OpenRouter can vary. More providers may be added.</Foot>
  </Scene>;
};

const STEPS=['Choose repository','Create setup PR','Merge setup PR','Enable review','Reviews are on'];
const Repository:React.FC=()=>{
  const f=useCurrentFrame();
  const idx=Math.min(4,Math.max(0,Math.floor((f-25)/18)));
  return <Scene scene={4} name="SET UP">
    <ChapterTitle eyebrow="YOUR GITHUB REPOSITORY" title="Review starts with one PR."/>
    <div className="v8-repository" style={move(f,4,18,24)}>
      <div className="v8-repo-icon"><GitBranch size={56}/></div>
      <div><small>DEMO / GITHUB</small><strong>storefront</strong></div>
      <div className="v8-repo-git"><GitPullRequest size={35}/> #42</div>
    </div>
    <div className="v8-progression">
      <div className="v8-stage" key={idx} style={{opacity:p(f,idx*18+24,idx*18+33)}}>{STEPS[idx]}</div>
      <div className="v8-progressline">
        {STEPS.map((_,i)=><span key={i} style={{background:i<=idx?C.lime:'#2b455b',boxShadow:i===idx?'0 0 26px #a6ff9a88':'none'}}/>)}
      </div>
    </div>
    <Foot>Illustrative setup; no repository is changed in this video.</Foot>
  </Scene>;
};

const LINES=[
  {line:48,code:'async function getUser(request) {'},
  {line:49,code:'  const session = await readSession(request);'},
  {line:50,code:'  if (!session) return next();'},
  {line:51,code:'  return users.get(session.userId);'},
  {line:52,code:'}'},
];
const Finding:React.FC=()=>{
  const f=useCurrentFrame();
  const focus=p(f,32,49);
  return <Scene scene={5} name="REVIEW CONTEXT">
    <ChapterTitle eyebrow="AUTOMATIC REVIEW" title="A finding. With full context."/>
    <div className="v8-code" style={move(f,4,22,28)}>
      <div className="v8-filehead"><FileCode2 size={24}/> src/server/auth.ts <span>PR #42 · +84 / −21</span></div>
      <div className="v8-lines">{LINES.map((l,i)=>
        <div className={'v8-codeline'+(i===2&&f>31?' v8-codeline-focus':'')} key={l.line}
          style={{opacity:i===2?1:(1-0.22*focus)}}><span>{l.line}</span>{l.code}</div>)}</div>
    </div>
    <div className="v8-finding-card" style={{opacity:p(f,60,81),transform:'translateY(' + (1-p(f,60,82))*40 + 'px)'}}>
      <div className="v8-finding-head"><RR size={51}/><b>ReviewRouter</b><Tag accent={C.amber}>MAJOR</Tag></div>
      <div className="v8-finding-main"><AlertTriangle size={31} color={C.amber}/> Missing authorization check</div>
      <div className="v8-finding-explain" style={{opacity:p(f,86,99)}}>Why: an absent session falls through to the next handler.</div>
      <div className="v8-finding-fix" style={{opacity:p(f,112,129)}}><CheckCircle2 size={25} color={C.lime}/> Fix: return an unauthorized response.</div>
    </div>
    <div className="v8-context-pill" style={{opacity:p(f,133,148)}}><PlugZap size={20}/> MCP context <span>+</span> <Sparkles size={20}/> Review skills</div>
    <Foot>Illustrative finding, line references and repository. Real review rules depend on your configuration.</Foot>
  </Scene>;
};

const Incremental:React.FC=()=>{
  const f=useCurrentFrame();
  const highlighted = p(f,29,47);
  return <Scene scene={6} name="NEW COMMITS">
    <ChapterTitle eyebrow="REVISION-AWARE OPTIMIZATION" title="New commit. Less repeat work."/>
    <div className="v8-incremental">
      <div className="v8-commit-source" style={move(f,5,20)}>
        <GitPullRequest size={44} color={C.cyan}/>
        <div><small>PR #42</small><strong>new commit</strong></div><span className="v8-commit-id">8f2a…</span>
      </div>
      <div className="v8-incremental-rule" style={{width:(highlighted*100)+'%'}}/>
      <div className="v8-commit-cards">
        <div className="v8-commit-card" style={{opacity:p(f,16,27)}}><div>16 <small>UNCHANGED</small></div><span><CheckCircle2 size={29} color={C.lime}/> Retain reviewed findings</span></div>
        <div className="v8-commit-card" style={{opacity:p(f,37,52),borderColor:C.cyan}}><div style={{color:C.cyan}}>2 <small>CHANGED</small></div><span><FileCode2 size={29} color={C.cyan}/> Review the delta</span></div>
      </div>
      <div className="v8-savings" style={{opacity:p(f,65,84)}}><Zap size={33}/> No needless re-review of unchanged paths.</div>
    </div>
    <Foot>Compatible completed snapshots (supported Codex rotating path); otherwise a safe full review. Numbers illustrative.</Foot>
  </Scene>;
};

const BARS=[21,31,25,43,40,55,48,69,58,83,72,91];
const Insights:React.FC=()=>{
  const f=useCurrentFrame();
  return <Scene scene={7} name="INSIGHTS">
    <ChapterTitle eyebrow="REVIEW STATISTICS" title="See the impact."/>
    <div className="v8-stat-kpis">
      <div style={move(f,10,26)}><strong style={{color:C.lime}}>{Math.round(128*p(f,8,45))}</strong><span>Findings</span></div>
      <div style={move(f,28,47)}><strong>{Math.round(34*p(f,25,66))}</strong><span>Reviews</span></div>
    </div>
    <div className="v8-chart">{BARS.map((h,i)=><span key={i} style={{height:(h*p(f,32+i*3,64+i*3))+'%',background:i%3===1?C.violet:C.cyan}}/>)}</div>
    <Foot>Sample statistics, not live customer activity or verified model bills.</Foot>
  </Scene>;
};

const Benchmark:React.FC=()=>{
  const f=useCurrentFrame();
  return <Scene scene={8} name="AACR-BENCH">
    <ChapterTitle eyebrow="UPSTREAM RESEARCH / SAME MODEL" title="More speed. Fewer tokens."/>
    <div className="v8-benchmark-grid">
      <div className="v8-benchmark-card" style={move(f,4,18)}>
        <div className="v8-bench-large">9.5×</div><strong>FASTER</strong>
        <div className="v8-bench-compare"><span>OpenCodeReview</span><b>1:23</b></div>
        <div className="v8-meter"><span style={{width:(p(f,23,48)*10.56)+'%'}}/></div>
        <div className="v8-bench-compare"><span>Claude Code</span><b>13:06</b></div>
        <div className="v8-meter"><span className="v8-baseline" style={{width:(p(f,23,48)*100)+'%'}}/></div>
      </div>
      <div className="v8-benchmark-card" style={move(f,19,34)}>
        <div className="v8-bench-large" style={{color:C.lime}}>14.7×</div><strong>FEWER TOKENS</strong>
        <div className="v8-bench-compare"><span>OpenCodeReview</span><b>385K</b></div>
        <div className="v8-meter"><span style={{width:(p(f,38,65)*6.8)+'%',background:C.lime}}/></div>
        <div className="v8-bench-compare"><span>Claude Code</span><b>5,664K</b></div>
        <div className="v8-meter"><span className="v8-baseline" style={{width:(p(f,38,65)*100)+'%'}}/></div>
      </div>
    </div>
    <div className="v8-cost-note" style={{opacity:p(f,75,92)}}><CircleDollarSign size={27} color={C.lime}/> Fewer tokens can lower model charges at comparable pricing.</div>
    <Foot>AACR-Bench, Claude 4.6 Opus; upstream OpenCodeReview, not ReviewRouter's own benchmark. Actual costs vary.</Foot>
  </Scene>;
};

const Outro:React.FC=()=>{
  const f=useCurrentFrame();
  return <Scene scene={9} name="START FREE">
    <div className="v8-outro-brand" style={move(f,3,23,30)}><RR size={102}/> <span>ReviewRouter</span></div>
    <div className="v8-outro-pitch" style={move(f,11,29)}>Free. Open source. Your control.</div>
    <div className="v8-deploy-choices">
      <div style={move(f,23,40)}><Cloud size={52} color={C.cyan}/><strong>Start online</strong><small>reviewrouter.org</small></div>
      <div style={move(f,40,58)}><Server size={52} color={C.lime}/><strong>Self-host</strong><small>Full control</small></div>
    </div>
    <Foot>Free ReviewRouter control plane; provider subscriptions, API usage and CI runners may have separate costs.</Foot>
  </Scene>;
};

/** Keep chapter intervals disjoint: crossfading fully composed scenes produced
 * overlapping headlines and navigation labels during the 7–9-frame transitions.
 * Each new scene now eases in over the ambient background, never above old text. */
const PARTS=[
  {from:0,dur:120},     // 0..119 hero
  {from:120,dur:38},    // 120..157 GitHub
  {from:158,dur:126},   // 158..283 providers
  {from:284,dur:117},   // 284..400 repository
  {from:401,dur:163},   // 401..563 finding
  {from:564,dur:126},   // 564..689 incremental
  {from:690,dur:100},   // 690..789 insights (allow last bar to complete)
  {from:790,dur:113},   // 790..902 benchmark
  {from:903,dur:117},   // 903..1019 CTA
] as const;
const Sfx:React.FC<{at:number;name:'click.wav'|'success.wav'|'finding.wav';gain?:number}> =({at,name,gain=.35})=>
  <Sequence from={at}><Audio src={staticFile('v7-sfx/'+name)} volume={gain}/></Sequence>;
export const ReviewRouterV8Video:React.FC=()=> <AbsoluteFill className="v8-root">
  <Bg/>
  <Audio src={staticFile('music.m4a')} volume={f=>.26*Math.max(0,Math.min(1,f/15,(V8_FRAMES-f)/25))}/>
  <Sfx at={144} name="click.wav" gain={.39}/>
  <Sfx at={224} name="click.wav" gain={.24}/>
  <Sfx at={375} name="success.wav" gain={.28}/>
  <Sfx at={475} name="finding.wav" gain={.32}/>
  <Sfx at={640} name="success.wav" gain={.18}/>
  <Sequence from={PARTS[0].from} durationInFrames={PARTS[0].dur}><Hero/></Sequence>
  <Sequence from={PARTS[1].from} durationInFrames={PARTS[1].dur}><SignIn/></Sequence>
  <Sequence from={PARTS[2].from} durationInFrames={PARTS[2].dur}><Providers/></Sequence>
  <Sequence from={PARTS[3].from} durationInFrames={PARTS[3].dur}><Repository/></Sequence>
  <Sequence from={PARTS[4].from} durationInFrames={PARTS[4].dur}><Finding/></Sequence>
  <Sequence from={PARTS[5].from} durationInFrames={PARTS[5].dur}><Incremental/></Sequence>
  <Sequence from={PARTS[6].from} durationInFrames={PARTS[6].dur}><Insights/></Sequence>
  <Sequence from={PARTS[7].from} durationInFrames={PARTS[7].dur}><Benchmark/></Sequence>
  <Sequence from={PARTS[8].from} durationInFrames={PARTS[8].dur}><Outro/></Sequence>
</AbsoluteFill>;
