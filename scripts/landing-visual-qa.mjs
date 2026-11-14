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
     await ctx.addInitScript((selectedTheme) => { try { localStorage.setItem("reviewrouter-theme", selectedTheme); } catch { /* Storage unavailable. */ } }, theme);
   const page=await ctx.newPage();
     page.on("pageerror",e=>errors.push(theme+"/"+width+": "+e.message));
     const res=await page.goto(url,{waitUntil:"domcontentloaded",timeout:90000});
     if(!res?.ok())throw Error("Homepage HTTP "+res?.status());
     await page.getByRole("heading",{level:1,name:/AI code review/i}).waitFor();
     const resolvedTheme=await page.locator("html").getAttribute("data-theme");
     if(resolvedTheme!==theme)throw Error("Expected "+theme+" theme, got "+resolvedTheme);
     await page.getByRole("button",{name:(theme==="dark"?"Dark":"Light")+" theme"}).waitFor({timeout:10000});
     const major=page.getByRole("button",{name:"Preview Major finding"});
     await major.click();
     if((await major.getAttribute("aria-pressed"))!=="true")throw Error("Severity click failed");
     const minor=page.getByRole("button",{name:"Preview Minor finding"});
     await minor.focus();await page.keyboard.press("Space");
     if((await minor.getAttribute("aria-pressed"))!=="true")throw Error("Severity keyboard failed");
     if((await page.getByRole("heading",{level:1}).count())!==1)throw Error("H1 count");

     // SEO must match the real Next.js response, including the free control-plane offer.
     const seo=await page.evaluate(()=>{
       const graph=[...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(el=>{
         const value=JSON.parse(el.textContent||"{}");
         return Array.isArray(value["@graph"])?value["@graph"]:[value];
       });
       return {
         title:document.title,
         description:document.querySelector('meta[name="description"]')?.getAttribute("content")||"",
         canonical:document.querySelector('link[rel="canonical"]')?.getAttribute("href")||"",
         graph:graph.map(n=>({type:n["@type"],price:n.offers?.price,currency:n.offers?.priceCurrency})),
       };
     });
     if(!seo.title.includes("Open-source AI code review"))throw Error("SEO title missing: "+seo.title);
     if(!seo.description.includes("self-hosted"))throw Error("SEO description missing");
     if(!seo.canonical.startsWith("https://"))throw Error("SEO canonical missing: "+seo.canonical);
     if(!seo.graph.some(n=>n.type==="Organization")||!seo.graph.some(n=>n.type==="WebSite"))throw Error("SEO organization/website schema missing");
     if(!seo.graph.some(n=>n.type==="WebApplication"&&n.price==="0"&&n.currency==="USD"))throw Error("Free control-plane offer schema missing");
     if(!(await page.getByText("Lower recall in this comparison.",{exact:false}).count()))throw Error("Benchmark recall caveat missing");
     if(!(await page.getByText("UI PREVIEW / NOT LIVE DATA",{exact:true}).count()))throw Error("Dashboard preview disclaimer missing");
     for(const href of ["/getting-started","/security","/fair-use"]){
       if(!(await page.locator('a[href="'+href+'"]').count()))throw Error("Missing navigation link "+href);
     }
     const heroCopy=page.locator('section[aria-labelledby="home-title"] > div').first();
     const reducedAnimation=await heroCopy.evaluate(el=>getComputedStyle(el).animationName);
     if(reducedAnimation!=="none")throw Error("Reduced-motion animation still enabled: "+reducedAnimation);
     if(width===1440){
       await page.emulateMedia({reducedMotion:"no-preference"});
       const normalAnimation=await heroCopy.evaluate(el=>getComputedStyle(el).animationName);
       if(!normalAnimation.includes("homeEnter"))throw Error("Normal-motion entrance animation missing: "+normalAnimation);
       await page.emulateMedia({reducedMotion:"reduce"});
     }
     if(!(await page.locator('a[href="/compare"]').count()))throw Error("Compare link");
     if(!(await page.locator('a[href="https://github.com/777genius/review-router-ai"]').count()))throw Error("Application source link");
     if(!(await page.getByText("Install GitHub App",{exact:true}).count()))throw Error("Install CTA");
     const dims=await page.evaluate(()=>({viewport:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
     if(Math.max(dims.html,dims.body)>dims.viewport+2)throw Error("Horizontal overflow "+JSON.stringify(dims));
     const name="homepage-"+theme+"-"+width+".png";
     await page.screenshot({path:dir+"/"+name,fullPage:true,animations:"disabled"});
     shots.push(name);console.log("PASS "+name);

     // Follow the anonymous CTA rather than trusting only its label; do not open external GitHub.
     if(theme==="dark"&&width===1440){
       const cta=page.getByText("Install GitHub App",{exact:true}).first();
       const href=await cta.evaluate(el=>el.closest("a")?.getAttribute("href")||null);
       if(href==="/setup"){
         await cta.click();
         await page.waitForURL("**/setup",{timeout:30000});
         if(!(await page.getByRole("heading",{name:/Set up ReviewRouter/i}).count()))throw Error("GitHub CTA did not reach setup");
       }
       for(const route of ["/compare","/getting-started","/security","/fair-use","/support"]){
         const response=await page.request.get(url+route,{timeout:30000});
         if(!response.ok())throw Error("Linked route "+route+" HTTP "+response.status());
       }
     }
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
