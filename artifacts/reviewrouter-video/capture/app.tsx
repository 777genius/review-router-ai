import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProviderSecretSetupChooser} from '../../../apps/web/app/dashboard/provider-secret-setup-chooser';
import {RepositoryLiveSearch} from '../../../apps/web/app/dashboard/repository-live-search';
import {RepositorySetupDisclosureToggle} from '../../../apps/web/app/dashboard/repository-setup-optimistic-status';
import {Badge} from '../../../packages/ui/src/badge/badge';
import {SourceProviderLogo} from '../../../apps/web/app/source-provider-logo';
import './capture.css';

const guidance = (secretName: string) => ({
  provider: 'codex_oauth_rotating', recommendedScope: 'repository', warnings: [],
  commands: [{scope:'repository',title:'Repository secret',description:'Illustrative setup.',command:'',storesSecretIn:'github_repository_secret',targetLabel:'Example repository',secretNames:[secretName],selectedRepositories:['sample/storefront'],validatesBeforeWrite:false,failureRecovery:'',sendsSecretToReviewRouter:false}]
}) as never;
const repos = [
  {id:'storefront',name:'storefront',visibility:'Private',step:1 as const},
  {id:'api-service',name:'api-service',visibility:'Private',step:4 as const},
  {id:'design-system',name:'design-system',visibility:'Public',step:4 as const},
];
const searchIndex = repos.map((repo)=>({id:repo.id,searchText:repo.name,visibility:repo.visibility.toLowerCase(),readiness:repo.step===4?'ready' as const:'needs_setup' as const}));

function Providers() {
  return <main className="capture capture-provider"><div className="mx-auto max-w-[1180px]"><p className="font-mono text-base tracking-[.18em] text-cyan-200">MODEL CREDENTIALS</p><h1 className="mt-5 mb-9 text-5xl font-semibold tracking-tight text-cyan-50">Choose your provider</h1><div className="provider-crop"><ProviderSecretSetupChooser workspaceId="demo" repositoryId="demo" repositoryFullName="sample/storefront" repositoryVisibility="private" organizationLogin={null} organizationSecretPolicy={null} codexOAuthRotatingGuidance={guidance('REVIEWROUTER_CODEX_AUTH_JSON')} codexOAuthGuidance={guidance('CODEX_AUTH_JSON')} codexApiKeyGuidance={guidance('OPENAI_API_KEY')} claudeCodeOAuthGuidance={guidance('CLAUDE_CODE_OAUTH_TOKEN')} openRouterApiKeyGuidance={guidance('OPENROUTER_API_KEY')} /></div><p className="mt-8 text-base text-slate-400">Your account, your model. <span className="text-cyan-200">And more.</span></p></div></main>;
}
function Repositories() {
  const stage = Math.max(0, Math.min(4, Number(new URLSearchParams(location.search).get("stage") ?? 0)));
  const [opened,setOpened]=useState(stage > 0);
  return <main className="capture"><div className="mx-auto max-w-[1220px]"><div className="mb-6 flex items-center gap-4"><img src="/review-router-icon.png" width="45" height="45"/><strong className="text-2xl text-cyan-50">ReviewRouter</strong></div><h1 className="mt-8 mb-7 text-5xl font-semibold tracking-tight text-cyan-50">Repositories</h1><div data-repository-table className="rounded-[1.5rem] border border-cyan-200/10 bg-slate-950/60"><RepositoryLiveSearch workspaceKey="demo" selectedRepositoryFullName={null} initialQuery="" initialFilter="all" searchIndex={searchIndex} totalRepositoryCount={3} renderedRepositoryCount={3} rowLimit={24}/><div data-repository-results className="grid text-slate-200">{repos.map((repo,i)=><div key={repo.id} data-repository-row-id={repo.id} className={`border-t border-cyan-200/10 px-6 py-6 ${i%2?'bg-cyan-300/[0.035]':'bg-slate-950/20'}`}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-200/15 bg-cyan-300/[0.07]"><SourceProviderLogo provider="github" className="h-[1.125rem] w-[1.125rem]"/></span><strong className="text-2xl text-cyan-50">{repo.name}</strong><Badge tone="neutral">GitHub</Badge></div><div className="flex items-center gap-3"><Badge tone="neutral">{repo.visibility}</Badge><input id={`repo-${repo.id}`} type="checkbox" className="sr-only" onChange={()=>setOpened(!opened)}/><RepositorySetupDisclosureToggle repositoryId={repo.id} disclosureId={`repo-${repo.id}`} currentStep={i === 0 && stage > 0 ? Math.min(stage, 4) as 1 | 2 | 3 | 4 : repo.step}/></div></div>{opened && i===0 && <div className="mt-5 border-t border-cyan-200/10 pt-5 pb-1"><div className="grid grid-cols-4 gap-3">{["Create setup PR", "Merge setup PR", "Enable review", "Ready"].map((label, index) => <div key={label} className="flex items-center gap-2"><span className={"grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono text-xs " + (index < stage ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-200" : "border-slate-600 text-slate-400")}>{index < stage ? "✓" : index+1}</span><span className={"text-sm font-semibold " + (index < stage ? "text-emerald-100" : "text-slate-400")}>{label}</span></div>)}</div></div>}</div>)}</div></div></div></main>;
}
const query = new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(query.get('scene')==='providers' ? <Providers/> : <Repositories/>);
