import React from 'react';
import {
  AbsoluteFill, Img, Sequence, Interactive, interpolate, Easing,
  staticFile, useCurrentFrame,
} from 'remotion';
import {Audio} from '@remotion/media';
import {
  ArrowRight, Check, GitBranch, GitPullRequest, ShieldCheck,
  MousePointer2, Zap, PlugZap, Sparkles, Eye, Code2,
  CircleCheck, Search, AlertTriangle,
} from 'lucide-react';
import {ProviderMark} from './provider-logo';
import {SimulatedCursor} from './video-v7/remotionui/simulated-cursor';
import {ConnectorLines} from './video-v7/remotionui/connector-lines';
import './video-v7.css';

/** V7 is deliberately independent from V6. All animation is a pure function of the current frame. */
const C = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0, 0, 0.2, 1);
const prog = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], {...C, easing: ease});
const exit = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], {...C, easing: Easing.bezier(0.4, 0, 1, 1)});
const lift = (f: number, start: number, distance = 36) =>
  `translateY(\${(1 - prog(f, start, start + 19)) * distance}px)`;
const fmt = (s: string) => s;
const COLOR = {cyan: '#00e5ff', lime: '#a6ff00', magenta: '#ff2bd6', mute: '#8ea4b8'} as const;

const SECTIONS = [
  {from: 0, frames: 106, name: 'INTRO'},
  {from: 99, frames: 68, name: 'SIGN IN'},
  {from: 160, frames: 119, name: 'PROVIDERS'},
  {from: 271, frames: 161, name: 'REPOSITORY'},
  {from: 424, frames: 153, name: 'FINDING'},
  {from: 569, frames: 82, name: 'CONTEXT'},
  {from: 644, frames: 137, name: 'INSIGHTS'},
  {from: 774, frames: 142, name: 'BENCHMARK'},
  {from: 908, frames: 94, name: 'OUTRO'},
] as const;
export const V7_FRAMES = 1002;
export const V7_PROOF_FRAMES = 216;

const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  return <AbsoluteFill className="v7">
    <div className="v7-grid"/>
    <div className="v7-glow" style={{transform: `translateX(\${Math.sin(f / 85) * 100}px)`}}/>
    <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 14, background: 'linear-gradient(90deg, #00e5ff 0%, #7a99e8 51%, #ff2bd6 100%)', opacity: .35}}/>
  </AbsoluteFill>;
};

const Brand: React.FC<{small?: boolean}> = ({small = false}) =>
  <div className="v7-brand">
    <Img src={staticFile('logo.png')} style={{width: small ? 31 : 42, height: small ? 31 : 42}}/>
    <span>ReviewRouter</span>
  </div>;

const TopBar: React.FC<{count: string; caption: string}> = ({count, caption}) =>
  <>
    <div className="v7-top"><Brand/><div className="v7-top-right">{count} / 09 <span style={{color: '#7ee3e9'}}>●</span> {caption}</div></div>
    <div className="v7-top-rule"/>
  </>;

const Title: React.FC<{n: string; headline: string; description?: string; compact?: boolean}> =
  ({n, headline, description, compact = false}) =>
    <div className="v7-title" style={compact ? {top: 162} : undefined}>
      <div className="v7-number">{n}</div>
      <h1 className="v7-h1" style={compact ? {fontSize: 89, marginTop: 15} : undefined}>{headline}</h1>
      {description && <div className="v7-sub">{description}</div>}
    </div>;

const Footer: React.FC<{detail?: string}> = ({detail = 'ILLUSTRATIVE DEMO · NO REPOSITORY CHANGED'}) =>
  <div className="v7-footer">
    <span><i className="bar"/> CODE STAYS IN YOUR CI</span>
    <span>{detail}</span>
  </div>;

const Scene: React.FC<{length: number; children: React.ReactNode; label: string}> = ({length, children, label}) => {
  const f = useCurrentFrame();
  const alpha = Math.min(prog(f, 0, 9), 1 - exit(f, length - 9, length));
  return <AbsoluteFill style={{opacity: alpha}}>
    <TopBar count={String(Math.max(1, SECTIONS.findIndex(s => s.name === label) + 1)).padStart(2, '0')} caption={label}/>
    {children}
  </AbsoluteFill>;
};

const BrowserHeader: React.FC<{url: string}> = ({url}) =>
  <div className="v7-browser-top">
    <span className="v7-browser-dot" style={{background: '#d96678'}}/><span className="v7-browser-dot" style={{background: '#efbd5c'}}/><span className="v7-browser-dot" style={{background: '#64c99a'}}/>
    <div className="v7-browser-address">{url}</div>
    <span style={{color: '#71899c', fontSize: 16}}>⌘</span>
  </div>;

const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const p = prog(f, 9, 51);
  return <>
    <div style={{position: 'absolute', left: 125, top: 260, zIndex: 8, width: 920}}>
      <div className="v7-number" style={{opacity: prog(f, 3, 14)}}>CODE REVIEW / REIMAGINED</div>
      <h1 style={{fontSize: 119, lineHeight: 1.03, letterSpacing: '-.073em', margin: '28px 0 26px', fontWeight: 720, transform: lift(f, 7, 55)}}>
        AI code review.<br/><span style={{color: '#82eff1'}}>On your terms.</span>
      </h1>
      <div className="v7-sub" style={{maxWidth: 690, opacity: prog(f, 37, 57)}}>Your models. Your repositories. Your CI.</div>
      <div style={{marginTop: 56, display: 'flex', gap: 17, opacity: prog(f, 44, 63)}}>
        <div className="v7-mini-chip"><ShieldCheck size={21} color={COLOR.lime}/> Open source</div>
        <div className="v7-mini-chip"><GitBranch size={21} color={COLOR.cyan}/> CI-native</div>
      </div>
    </div>
    <div style={{position: 'absolute', right: 80, top: 235, width: 800, height: 590, perspective: 1350}}>
      <div className="v7-hero-glass" style={{width: 720, height: 450, top: 90, left: 45, opacity: p * .5, transform: `rotateY(\${-11 + p * 2}deg) rotateX(8deg) translate(-52px, 44px)`}}/>
      <div className="v7-hero-glass" style={{width: 720, height: 450, top: 66, left: 24, opacity: p * .74, transform: `rotateY(\${-10 + p * 2}deg) rotateX(7deg) translate(-22px, 24px)`}}/>
      <div className="v7-hero-glass" style={{
        width: 720, height: 450, top: 43, left: 10,
        transform: `rotateY(\${-15 + p * 9}deg) rotateX(\${8 - p * 4}deg) translateY(\${(1 - p) * 125}px)`,
        opacity: prog(f, 13, 38), boxShadow: '0 45px 120px #000b, 0 0 100px #00e5ff1a',
      }}>
        <BrowserHeader url="reviewrouter.org / pull requests"/>
        <div style={{padding: 28}}>
          <div style={{font: '15px "RR Mono",monospace', color: '#7de2e7'}}>PULL REQUEST #42 / REVIEW COMPLETE</div>
          <div style={{fontSize: 34, fontWeight: 700, marginTop: 15}}>Improve authentication flow</div>
          <div style={{borderBottom: '1px solid #385367', marginTop: 22, marginBottom: 28}}/>
          <div style={{fontSize: 17, color: '#90afbb', marginBottom: 12}}>REVIEW RESULTS</div>
          {[
            ['01','Authorization check', '#ffb000'],
            ['02','Missing error handling', '#00e5ff'],
            ['03','Unsafe fallback', '#ff2bd6'],
          ].map(([n, text, c], i) => <div key={n} style={{borderLeft: `3px solid \${c}`, background: '#182536', marginBottom: 12, padding: '14px 17px', fontSize: 19, opacity: prog(f, 38 + i * 8, 53 + i * 8)}}>{n} <span style={{marginLeft: 17}}>{text}</span><span style={{float: 'right', color: c}}>●</span></div>)}
        </div>
      </div>
      <div style={{position: 'absolute', top: 4, right: 9, font: '15px "RR Mono",monospace', color: COLOR.cyan, opacity: prog(f, 52, 72)}}>REVIEW SIGNAL / ACTIVE</div>
    </div>
    <Footer detail="FREE SERVICE · YOUR AI PROVIDER MAY CHARGE"/>
  </>;
};

const Signin: React.FC = () => {
  const f = useCurrentFrame();
  return <>
    <Title n="01 / SECURE ENTRY" headline="Start with GitHub." description="One click to connect your workspace."/>
    <div className="v7-panel" style={{position: 'absolute', left: 408, top: 470, width: 1100, height: 325, textAlign: 'center', paddingTop: 57, transform: lift(f, 3, 45)}}>
      <div className="v7-micro" style={{fontSize: 15, color: '#81a9b8'}}>SIGN IN TO REVIEWROUTER</div>
      <div style={{margin: '28px auto', width: 660, height: 91, background: '#d8f9f5', color: '#081820', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, fontSize: 35, fontWeight: 700}}>
        <GitBranch size={38}/> Continue with GitHub <ArrowRight size={36}/>
      </div>
      <div style={{font: '17px "RR Mono",monospace', color: '#7c9aa9'}}>GITHUB-BASED AUTHENTICATION</div>
    </div>
    <SimulatedCursor points={[{x: 66,y: 84,frame: 0},{x: 54,y: 60,frame: 35,target: 76}]} clickFrames={[36]} size={41} color="#e6f7ff" accent="#00e5ff"/>
    <div style={{position: 'absolute', left: 780, top: 824, display: 'flex', alignItems: 'center', gap: 16, fontSize: 27, color: '#a6ffcc', opacity: prog(f, 44, 59)}}><Check size={33}/> You're in.</div>
    <Footer detail="AUTHENTICATION STEP / CONCEPT PREVIEW"/>
  </>;
};

const PROVIDERS = [
  {name: 'Codex', kind: 'openai', mode: 'Subscription', color: '#54e3ee'},
  {name: 'Claude Code', kind: 'anthropic', mode: 'Subscription', color: '#cb9c80'},
  {name: 'MiMo', kind: 'mimo', mode: 'Token plan', color: '#b6ccf9'},
  {name: 'OpenRouter', kind: 'openrouter', mode: 'API key', color: '#cbb0ff'},
  {name: 'Kimi Code', kind: 'kimi', mode: 'API key', color: '#85b9fa'},
  {name: 'NVIDIA', kind: 'nvidia', mode: 'Via OpenRouter', color: '#9bf06f'},
] as const;

const Providers: React.FC<{compact?: boolean}> = ({compact = false}) => {
  const f = useCurrentFrame();
  const selected = compact ? 29 : 60;
  const point = compact ? 27 : 58;
  return <>
    <Title n="02 / AI PROVIDERS" headline="Choose your AI." description="Use existing subscriptions and API keys." compact={compact}/>
    <div className="v7-provider-row" style={{top: compact ? 460 : 478}}>
      {PROVIDERS.map((v, i) => {
        const inc = prog(f, 8 + i * (compact ? 3 : 5), 18 + i * (compact ? 3 : 5));
        const active = i === 0 && f >= selected;
        return <div className={`v7-provider \${active ? 'active' : ''}`} key={v.name} style={{
          opacity: inc * (f >= selected && i !== 0 ? .4 : 1),
          transform: `translateY(\${(1 - inc) * 45 - (active ? 8 : 0)}px)`,
        }}>
          <div className="v7-provider-icon" style={{borderColor: v.color + '88'}}>{v.kind === 'nvidia' ? <b style={{color: v.color, fontSize: 41}}>N</b> : <ProviderMark providerId={v.kind}/>}</div>
          <strong>{v.name}</strong><small>{v.mode}</small>{active && <div className="v7-provider-selected"><Check size={30}/></div>}
        </div>;
      })}
    </div>
    <div style={{position: 'absolute', top: 777, left: 118, width: 1685, display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
      <div style={{color: '#d8eaf2', fontSize: 29, opacity: prog(f, compact ? 22 : 48, compact ? 40 : 68)}}>+ And more <span style={{fontSize: 18, color: '#849bad'}}>coming</span></div>
      <div className="v7-mini-chip" style={{opacity: prog(f, compact ? 31 : 67, compact ? 49 : 86), color: '#a6ffca'}}><Check size={21}/> CODEX SELECTED</div>
    </div>
    <SimulatedCursor
      points={[{x: 70,y: 84,frame: 0},{x: 13.5,y: 53.5,frame: point,target: 78}]}
      clickFrames={[selected]}
      color="#f3ffff" accent="#00e5ff" size={39}/>
    <div style={{position: 'absolute', left: 305, top: 740, width: 920, height: 4, borderRadius: 4, background: '#244b57', opacity: prog(f, selected + 7, selected + 14)}}>
      <div style={{height: 4, width: `\${prog(f, selected + 7, compact ? 53 : 112) * 100}%`, background: '#00e5ff', boxShadow: '0 0 23px #00e5ff'}}/>
    </div>
    <Footer detail="DEMONSTRATION · FREE MODEL LIMITS MAY CHANGE"/>
  </>;
};

const STAGES = [
  'Select repository',
  'Create setup PR',
  'Merge setup PR',
  'Enable review',
  'Ready',
] as const;

const Repository: React.FC<{compact?: boolean}> = ({compact = false}) => {
  const f = useCurrentFrame();
  const first = compact ? 16 : 37;
  const step = compact ? 13 : 24;
  const phase = Math.min(4, Math.max(0, Math.floor((f - first) / step)));
  const done = Math.max(0, Math.min(4, (f - first) / step));
  return <>
    <Title n="03 / GITHUB REPOSITORIES" headline="Turn reviews on." description="Your repository. A small setup PR." compact={compact}/>
    <div className="v7-panel v7-repo-wrap" style={{transform: lift(f, 3, 58)}}>
      <BrowserHeader url="reviewrouter.org / repositories"/>
      <div className="v7-repo-main">
        <div style={{display: 'flex', gap: 16, marginBottom: 23}}>
          <div style={{padding: '14px 26px', borderRadius: 8, background: '#0d1c2b', border: '1px solid #2d5667', color: '#86b5c8', font: '17px "RR Mono",monospace', flex: 1}}><Search size={20} style={{verticalAlign: 'middle', marginRight: 15}}/> Search repositories</div>
          <div className="v7-mini-chip">GitHub <GitBranch size={18}/></div>
        </div>
        <div className="v7-repo-select">
          <span className="v7-repo-icon"><GitBranch size={47}/></span>
          <div className="v7-repo-name"><strong>storefront</strong><small>DEMO / GITHUB REPOSITORY</small></div>
          <div className="v7-repo-ready" style={{opacity: prog(f, first + 4 * step, first + 4 * step + 8)}}>✓ REVIEW ACTIVE</div>
        </div>
        <div className="v7-repo-stages">{STAGES.map((label, i) => <div key={label} className={'v7-repo-stage ' + (i < phase ? 'done' : i === phase ? 'current' : '')}>
          <span className="circle">{i < phase ? <Check size={24}/> : i + 1}</span><span>{label}</span>
        </div>)}</div>
        <div style={{height: 4, marginTop: 28, background: '#29475b', borderRadius: 4}}><div style={{height: '100%', background: 'linear-gradient(90deg,#59e8ef,#a6ff00)', boxShadow: '0 0 21px #00e5ff55', width: `\${Math.max(0,done) / 4 * 100}%`}}/></div>
        <div className="v7-stage-caption" style={{color: phase === 4 ? '#a6ff00' : '#e1f5f8'}}>{phase + 1} / 5 — {STAGES[phase]}</div>
      </div>
    </div>
    <div style={{position: 'absolute', left: 420, top: 850, font: '18px "RR Mono",monospace', color: '#7aa1af', opacity: 1 - prog(f, first + 4 * step, first + 4 * step + 15)}}>No repository is changed in this demo</div>
    <Footer/>
  </>;
};

const code = [
  {n: 48, text: 'async function getUser(request) {'},
  {n: 49, text: '  const session = await readSession(request);'},
  {n: 50, text: '  if (!session) return next();', flagged: true},
  {n: 51, text: '  return database.users.get(session.userId);'},
  {n: 52, text: '}'},
  {n: 53, text: '// Private endpoint should reject missing sessions'},
];
const Review: React.FC<{compact?: boolean}> = ({compact = false}) => {
  const f = useCurrentFrame();
  const annotation = compact ? 16 : 42;
  return <>
    <Title n="04 / PULL REQUEST REVIEW" headline="Issues. With evidence." description="Precise, actionable comments where they belong." compact={compact}/>
    <div className="v7-code-wrap" style={{transform: `translateY(\${(1 - prog(f, 1, 17)) * 60}px)`, opacity: prog(f, 0, 15)}}>
      <div className="v7-panel" style={{overflow: 'hidden', borderRadius: 18}}>
        <BrowserHeader url="github.com / demo / storefront / pull / 42"/>
        <div className="v7-code-screen">
          <div style={{display: 'flex', alignItems: 'center', gap: 16, height: 49, color: '#a7d5e5', marginBottom: 16}}>
            <Code2 size={25}/><b style={{font: '21px "RR Mono",monospace'}}>src/server/auth.ts</b>
            <span style={{marginLeft: 'auto', color: '#88a9b9', font: '15px "RR Mono",monospace'}}>PR #42 · +84 −21</span>
          </div>
          {code.map(row => <div key={row.n} className={'v7-code-row ' + (row.flagged && f >= annotation - 6 ? 'highlight' : '')}
            style={{opacity: row.flagged ? 1 : .78}}><span className="n">{row.n}</span>{row.text}</div>)}
          {f >= annotation && <div className="v7-review-comment" style={{opacity: prog(f, annotation, annotation + 12), transform: `translateY(\${(1 - prog(f, annotation, annotation + 20)) * 36}px)`}}>
            <div className="v7-review-comment-head"><span className="v7-review-avatar"><Img src={staticFile('logo.png')}/></span> ReviewRouter <span>reviewer · suggested finding</span></div>
            <strong><AlertTriangle size={25} color="#ffb000" style={{verticalAlign: 'middle', marginRight: 10}}/> Missing authorization check</strong>
            <p>Return an explicit unauthorized response when the session is missing. The current branch continues without authentication.</p>
            <div style={{marginTop: 15, color: '#ffcf76', font: '15px "RR Mono",monospace'}}>MAJOR · line 50 · ILLUSTRATIVE</div>
          </div>}
        </div>
      </div>
    </div>
    <Footer detail="ILLUSTRATIVE PR AND FINDING · NOT A LIVE REVIEW"/>
  </>;
};

const Tools: React.FC = () => {
  const f = useCurrentFrame();
  return <>
    <Title n="05 / MORE CONTEXT" headline="Connect more context." description="Bring the right tools into the review flow."/>
    <div style={{position: 'absolute', left: 155, top: 420, width: 1560, height: 375}}>
      <ConnectorLines width={1560} height={375} stroke={COLOR.cyan} strokeWidth={4} delayInFrames={9} durationInFrames={24} staggerInFrames={14}
        anchors={[{id:'mcp',x:.12,y:.20},{id:'skills',x:.12,y:.82},{id:'review',x:.84,y:.51}]}
        edges={[{from:'mcp',to:'review',shape:'curve',bow:.12,dot:true,color:'#67e8ef'},
          {from:'skills',to:'review',shape:'curve',bow:-.12,dot:true,color:'#b09aff'}]}/>
      <div className="v7-route-node" style={{top: 24, left: 5, opacity: prog(f, 4, 18), transform: lift(f, 4)}}><PlugZap size={49}/> MCP tools</div>
      <div className="v7-route-node" style={{top: 246, left: 5, opacity: prog(f, 10, 24), transform: lift(f, 10)}}><Sparkles size={49}/> Review skills</div>
      <div className="v7-route-node" style={{top: 126, right: 0, opacity: prog(f, 35, 53), transform: lift(f, 32)}}><Img src={staticFile('logo.png')} width={51}/> ReviewRouter</div>
    </div>
    <div className="v7-mini-chip" style={{position: 'absolute', left: 742, top: 850, opacity: prog(f, 54, 69)}}><CircleCheck size={21} color="#a6ff00"/> RICHER CONTEXT</div>
    <Footer detail="TOOLS AND SKILLS · DEMONSTRATION"/>
  </>;
};

const BARS = [42,62,46,80,57,68,74,55,87,69,82,98,77,84,64,92,76,100,83,96,89,106,93,118];
const Stats: React.FC = () => {
  const f = useCurrentFrame();
  const metrics = [['34','Reviews'],['128','Findings'],['2.84M','Known tokens'],['243','AI requests']];
  return <>
    <Title n="06 / INSIGHTS" headline="See the impact." description="Usage, reviews and trends in one place."/>
    <div className="v7-stat-kpis">{metrics.map(([num,label],i) => <div key={label} className="v7-panel v7-kpi" style={{opacity: prog(f, 4 + i * 5, 21 + i * 5), transform: lift(f, 5 + i * 4)}}>
      <small>{label.toUpperCase()}</small><strong style={{color: i === 1 ? '#a6ff00' : '#e8f9ff'}}>{num}</strong></div>)}</div>
    <div className="v7-panel v7-stats-chart">
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, fontSize: 23, fontWeight: 650}}>Daily token usage <span className="v7-micro" style={{fontSize: 13}}>30 DAYS</span></div>
      <div className="v7-chart-bars">{BARS.map((h,i) => <span key={i} style={{height: `\${h / 1.2 * prog(f, 21 + i * 1.4, 54 + i * 1.4)}%`}}/>)}</div>
      <div style={{display: 'flex', gap: 30, marginTop: 15, color: '#92b8c7', font: '16px "RR Mono",monospace'}}><span style={{color: '#59e9ee'}}>● Codex</span><span style={{color: '#b79afa'}}>● MiMo</span><span style={{color: '#a6ffba'}}>● Kimi</span></div>
    </div>
    <div className="v7-panel v7-stats-aside">
      <div style={{fontSize: 23, fontWeight: 650}}>Tokens by provider</div>
      {[['Codex',94,'1.42M'],['MiMo',58,'850K'],['Kimi',39,'570K']].map(([name,percentage,value],i) => <div className="v7-aside-row" key={name}>
        <div style={{display: 'flex', justifyContent: 'space-between'}}><span>{name}</span><span style={{color: '#94b2bf'}}>{value}</span></div>
        <span className="track"><b style={{width: `\${Number(percentage) * prog(f, 35 + i * 11, 80 + i * 11)}%`, background: ['#59e9ee','#ac9bf5','#a6ffab'][i]}}/></span>
      </div>)}
    </div>
    <Footer detail="SAMPLE DATA · PROVIDER REPORTING COVERAGE VARIES"/>
  </>;
};

const Bench: React.FC = () => {
  const f = useCurrentFrame();
  const groups = [
    {title:'Time per review',left:'1:23',right:'13:06',pct:10.56,accent:'≈9.5× faster'},
    {title:'Tokens per review',left:'385K',right:'5,664K',pct:6.80,accent:'≈14.7× fewer tokens'},
  ];
  return <>
    <Title n="07 / UPSTREAM RESEARCH" headline="Speed, with evidence." description="OpenCodeReview vs Claude Code · Claude 4.6 Opus"/>
    <div className="v7-bench-grid">{groups.map((g,i) => <div className="v7-panel v7-bench-card" key={g.title}>
      <h3>{g.title}</h3>
      <div className="v7-bench-row"><span>OpenCodeReview</span><span>{g.left}</span></div>
      <div className="v7-track"><b style={{width: `\${g.pct * prog(f, 17 + i * 8, 55 + i * 8)}%`, minWidth: 8}}/></div>
      <div className="v7-bench-row"><span>Claude Code</span><span>{g.right}</span></div>
      <div className="v7-track"><b className="agent" style={{width: `\${100 * prog(f, 18 + i * 8, 56 + i * 8)}%`}}/></div>
      <div className="v7-bench-badge" style={{opacity: prog(f, 68 + i * 9, 82 + i * 9)}}>{g.accent}</div>
    </div>)}</div>
    <Footer detail="UPSTREAM AACR-BENCH · arxiv.org/abs/2608.09290 · NOT A REVIEWROUTER BENCHMARK"/>
  </>;
};

const Outro: React.FC = () => {
  const f = useCurrentFrame();
  return <>
    <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',textAlign:'center'}}>
      <div style={{opacity: prog(f, 4, 22), transform: `scale(\${.75 + .25 * prog(f, 3, 40)})`, filter:'drop-shadow(0 0 80px #00e5ff3d)'}}><Img src={staticFile('logo.png')} width={138}/></div>
      <h1 className="v7-outro-title" style={{marginTop: 30, opacity: prog(f, 15, 36), transform: lift(f, 16, 44)}}>ReviewRouter.</h1>
      <div className="v7-outro-sub" style={{opacity: prog(f, 31, 47)}}>Your AI. Your CI. Better reviews.</div>
      <div className="v7-outro-link" style={{opacity: prog(f, 47, 59)}}>Get started free <ArrowRight size={32} style={{marginLeft: 18}}/></div>
      <div style={{marginTop: 25, font: '19px "RR Mono",monospace', color: '#77e9e9', opacity: prog(f, 53, 65)}}>reviewrouter.org</div>
    </div>
    <Footer detail="FREE SERVICE · MODEL COSTS MAY APPLY"/>
  </>;
};

const MusicAndSfx: React.FC<{duration: number}> = ({duration}) => {
  const f = useCurrentFrame();
  const volume = .36 * Math.min(1, f / 18, (duration - f) / 30);
  return <>
    <Audio src={staticFile('music.m4a')} volume={Math.max(0, volume)}/>
    <Audio src={staticFile('v7-sfx/click.wav')} from={198} volume={.4}/>
    <Audio src={staticFile('v7-sfx/click.wav')} from={305} volume={.25}/>
    <Audio src={staticFile('v7-sfx/success.wav')} from={406} volume={.45}/>
    <Audio src={staticFile('v7-sfx/finding.wav')} from={466} volume={.4}/>
  </>;
};

export const VideoV7: React.FC = () => <AbsoluteFill className="v7">
  <Backdrop/>
  <MusicAndSfx duration={V7_FRAMES}/>
  <Sequence from={SECTIONS[0].from} durationInFrames={SECTIONS[0].frames}><Scene length={SECTIONS[0].frames} label="INTRO"><Intro/></Scene></Sequence>
  <Sequence from={SECTIONS[1].from} durationInFrames={SECTIONS[1].frames}><Scene length={SECTIONS[1].frames} label="SIGN IN"><Signin/></Scene></Sequence>
  <Sequence from={SECTIONS[2].from} durationInFrames={SECTIONS[2].frames}><Scene length={SECTIONS[2].frames} label="PROVIDERS"><Providers/></Scene></Sequence>
  <Sequence from={SECTIONS[3].from} durationInFrames={SECTIONS[3].frames}><Scene length={SECTIONS[3].frames} label="REPOSITORY"><Repository/></Scene></Sequence>
  <Sequence from={SECTIONS[4].from} durationInFrames={SECTIONS[4].frames}><Scene length={SECTIONS[4].frames} label="FINDING"><Review/></Scene></Sequence>
  <Sequence from={SECTIONS[5].from} durationInFrames={SECTIONS[5].frames}><Scene length={SECTIONS[5].frames} label="CONTEXT"><Tools/></Scene></Sequence>
  <Sequence from={SECTIONS[6].from} durationInFrames={SECTIONS[6].frames}><Scene length={SECTIONS[6].frames} label="INSIGHTS"><Stats/></Scene></Sequence>
  <Sequence from={SECTIONS[7].from} durationInFrames={SECTIONS[7].frames}><Scene length={SECTIONS[7].frames} label="BENCHMARK"><Bench/></Scene></Sequence>
  <Sequence from={SECTIONS[8].from} durationInFrames={SECTIONS[8].frames}><Scene length={SECTIONS[8].frames} label="OUTRO"><Outro/></Scene></Sequence>
</AbsoluteFill>;

/** A small, real 216-frame Remotion composition to verify semantic motion before full video. */
export const VideoV7Proof: React.FC = () => <AbsoluteFill className="v7">
  <Backdrop/>
  <Sequence from={0} durationInFrames={55}><Scene length={55} label="PROVIDERS"><Providers compact/></Scene></Sequence>
  <Sequence from={55} durationInFrames={95}><Scene length={95} label="REPOSITORY"><Repository compact/></Scene></Sequence>
  <Sequence from={150} durationInFrames={66}><Scene length={66} label="FINDING"><Review compact/></Scene></Sequence>
</AbsoluteFill>;
