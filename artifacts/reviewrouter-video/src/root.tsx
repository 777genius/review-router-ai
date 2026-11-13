import React from 'react';
import {Composition} from 'remotion';
import {Video} from './video';
import {RealFrontendVideo} from './video-real';
import {VideoV3} from './video-v3';
import {VideoV4, V4_FRAMES} from './video-v4';
import {VideoV5, V5_FRAMES} from './video-v5';
import {VideoV6, V6_FRAMES} from './video-v6';
import {VideoV7, VideoV7Proof, V7_FRAMES, V7_PROOF_FRAMES} from './video-v7';
import {VideoV7Lite, VideoV7LiteProof, V7_LITE_FRAMES, V7_LITE_PROOF_FRAMES} from './video-v7-lite';
import './style.css';

export const Root: React.FC = () => <><Composition id="ReviewRouter" component={Video} durationInFrames={1356} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterReal" component={RealFrontendVideo} durationInFrames={774} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterV3" component={VideoV3} durationInFrames={963} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterV4" component={VideoV4} durationInFrames={V4_FRAMES} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterV5" component={VideoV5} durationInFrames={V5_FRAMES} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterV6" component={VideoV6} durationInFrames={V6_FRAMES} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterV7" component={VideoV7} durationInFrames={V7_FRAMES} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterV7Proof" component={VideoV7Proof} durationInFrames={V7_PROOF_FRAMES} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterV7Lite" component={VideoV7Lite} durationInFrames={V7_LITE_FRAMES} fps={30} width={1920} height={1080} /><Composition id="ReviewRouterV7LiteProof" component={VideoV7LiteProof} durationInFrames={V7_LITE_PROOF_FRAMES} fps={30} width={1920} height={1080} /></>;
