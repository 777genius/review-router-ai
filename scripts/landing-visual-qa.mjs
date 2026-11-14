import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const dir="tmp/landing-visual-qa", port=3187, url="http://127.0.0.1:3187";
const shots=[], errors=[], logs=[];
await mkdir(dir,{recursive:true});
const child=spawn("pnpm",["--filter","@reviewrouter/web","exec","next","dev","--hostname","127.0.0.1","-p",String(port)],{
 env:{...process.env,NEXT_TELEMETRY_DISABLED:"1",NEXTAUTH_URL:url,REVIEW_ROUTER_WEB_URL:url,REVIEW_ROUTER_PUBLIC_WEB_URL:url},
 stdio:["ignore","pipe","pipe"]
});
child.stdout.on("data",x=>logs.push(String(x)));
child.stderr.on("data",x=>logs.push(String(x)));
let browser;
try{
 let ready=false;
 for(let n=0;n<300;n++){
   if(child.exitCode!==null)throw Error("Next exited "+child.exitCode);
   try{if((await fetch(url)).ok){ready=true;break}}catch{}
   await delay(400);
 }
 if(!ready)throw Error("Homepage startup timeout");
 browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 for(const theme of ["dark","light"])for(const width of [1440,768,390]){
   const ctx=await browser.newContext({viewport:{width,height:width===390?844:900},deviceScaleFactor:1,reducedMotion:"reduce",colorScheme:theme});
   try{
     const page=await ctx.newPage();
     page.on("pageerror",e=>errors.push(theme+"/"+width+": "+e.message));
     const res=await page.goto(url,{waitUntil:"domcontentloaded",timeout:90000});
     if(!res?.ok())throw Error("Homepage HTTP "+res?.status());
     await page.getByRole("heading",{level:1,name:/AI code review/i}).waitFor();
     await page.locator("html").evaluate((root,t)=>root.setAttribute("data-theme",t),theme);
     const major=page.getByRole("button",{name:"Preview Major finding"});
     await major.click();
     if((await major.getAttribute("aria-pressed"))!=="true")throw Error("Severity click failed");
     const minor=page.getByRole("button",{name:"Preview Minor finding"});
     await minor.focus();await page.keyboard.press("Space");
     if((await minor.getAttribute("aria-pressed"))!=="true")throw Error("Severity keyboard failed");
     if((await page.getByRole("heading",{level:1}).count())!==1)throw Error("H1 count");
     if(!(await page.locator('a[href="/compare"]').count()))throw Error("Compare link");
     const dims=await page.evaluate(()=>({viewport:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
     if(Math.max(dims.html,dims.body)>dims.viewport+2)throw Error("Horizontal overflow "+JSON.stringify(dims));
     const name="homepage-"+theme+"-"+width+".png";
     await page.screenshot({path:dir+"/"+name,fullPage:true,animations:"disabled"});
     shots.push(name);console.log("PASS "+name);
   }finally{await ctx.close()}
 }
 if(errors.length)throw Error("Runtime errors: "+errors.join("; "));
 if(shots.length!==6)throw Error("Incomplete screenshot matrix");
}catch(e){errors.push(String(e));throw e}
finally{
 await writeFile(dir+"/result.json",JSON.stringify({sha:process.env.GITHUB_SHA??null,shots,errors},null,2));
 await writeFile(dir+"/next.log",logs.join("").slice(-20000));
 await browser?.close();
 child.kill("SIGTERM");
}
