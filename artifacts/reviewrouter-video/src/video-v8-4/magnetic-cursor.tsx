import React from 'react';
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

/**
 * A cinematic, frame-deterministic cursor for the V8.4 product video.
 * All path points, trail, hover, press and ripple depend solely on `frame`.
 * Cursor hotspot is the leading tip, not the SVG's center.
 */
type Point={x:number;y:number};
type Props={
  from?:Point;
  to?:Point;
  startAt?:number;
  arriveAt?:number;
  clickAt?:number;
  accent?:string;
};
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const pt=(a:Point,b:Point,t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const cubic=(a:Point,c1:Point,c2:Point,b:Point,t:number):Point=>{
  const x=pt(a,c1,t),y=pt(c1,c2,t),z=pt(c2,b,t);
  return pt(pt(x,y,t),pt(y,z,t),t);
};
const smooth=(v:number)=>Math.max(0,Math.min(1,v));
const EASE=Easing.bezier(.18,.78,.22,1);
export const MagneticCursor:React.FC<Props>=({
  from={x:1360,y:870},to={x:1009,y:576},
  startAt=0,arriveAt=20,clickAt=22,accent='#76eef1',
})=>{
  const frame=useCurrentFrame();
  const {fps}=useVideoConfig();
  const c1={x:from.x-18,y:from.y-177},c2={x:to.x+188,y:to.y-33};
  const sample=(f:number)=>{
    const linear=smooth((f-startAt)/Math.max(1,arriveAt-startAt));
    return cubic(from,c1,c2,to,EASE(linear));
  };
  const xy=sample(frame);
  const hop=sample(frame-2);
  const tail=sample(frame-5);
  const traveled=smooth((frame-startAt)/Math.max(1,arriveAt-startAt));
  const hover=interpolate(frame,[arriveAt-5,arriveAt+1],[0,1],clamp);
  const clickP=frame>=clickAt?spring({frame:frame-clickAt,fps,config:{damping:16,stiffness:190,mass:.6},durationInFrames:15}):0;
  const ringP=interpolate(frame,[clickAt,clickAt+16],[0,1],clamp);
  const pressing=frame>=clickAt&&frame<clickAt+5;
  const arriving=traveled<1;
  const angle=arriving?interpolate(traveled,[0,1],[8,-5],clamp):-5;
  const alpha=interpolate(frame,[startAt,startAt+4],[0,1],clamp);
  const trailAlpha=Math.max(0,Math.sin(Math.PI*traveled))*.40;
  const rippleAlpha=frame>=clickAt&&frame<=clickAt+16 ? .82*(1-ringP):0;
  return <div style={{position:'absolute',inset:0,zIndex:48,pointerEvents:'none',opacity:alpha}}>
    {arriving&&<svg viewBox="0 0 1920 1080" width="100%" height="100%"
      preserveAspectRatio="none" style={{position:'absolute',inset:0,overflow:'visible'}}>
      <defs><linearGradient id="v84-trail" x1={tail.x} y1={tail.y} x2={xy.x} y2={xy.y}
          gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={accent} stopOpacity="0"/>
        <stop offset="100%" stopColor={accent} stopOpacity={trailAlpha}/>
      </linearGradient></defs>
      <path d={`M ${tail.x.toFixed(1)} ${tail.y.toFixed(1)} Q ${hop.x.toFixed(1)} ${hop.y.toFixed(1)} ${xy.x.toFixed(1)} ${xy.y.toFixed(1)}`}
        stroke="url(#v84-trail)" strokeWidth="7" fill="none" strokeLinecap="round"
        style={{filter:'blur(2px)'}}/>
    </svg>}
    {hover>0&&<div style={{
      position:'absolute',left:to.x-39,top:to.y-39,width:78,height:78,borderRadius:'50%',
      border:`2px solid ${accent}`,opacity:hover*.34*(1-ringP*.4),
      boxShadow:`0 0 24px ${accent}45`,
    }}/>}
    {rippleAlpha>0&&<div style={{
      position:'absolute',
      left:to.x-(15+ringP*64)/2,top:to.y-(15+ringP*64)/2,
      width:15+ringP*64,height:15+ringP*64,borderRadius:'50%',
      border:`2px solid ${accent}`,opacity:rippleAlpha,
      boxShadow:`0 0 16px ${accent}66`,
    }}/>}
    <div style={{
      position:'absolute',left:xy.x,top:xy.y,transform:`rotate(${angle}deg) scale(${pressing?.89:1})`,
      transformOrigin:'7px 4px',filter:'drop-shadow(0 7px 7px #000c)',
    }}>
      <svg width="62" height="64" viewBox="0 0 62 64" fill="none">
        <path d="M6 3 L7 51 L20 39 L31 60 L43 54 L32 33 L53 30 Z"
          fill="#f4fbff" stroke="#09131e" strokeWidth="3.5" strokeLinejoin="round"/>
        <path d="M11 10 L11 38 L20 31" stroke="#ffffff" strokeOpacity=".86"
          strokeWidth="2.6" strokeLinecap="round"/>
        <path d="M32 33 L44 31" stroke={accent} strokeWidth="2.7" strokeLinecap="round"
          strokeOpacity={Math.max(.2,hover)}/>
      </svg>
    </div>
  </div>;
};
