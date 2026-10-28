"""Copy source-owned native assembly test; preserve custody rules, add usage assertions."""
from pathlib import Path
import sys
source=Path(sys.argv[1]); target=Path(sys.argv[2])
s=(source/'services/account-gateway/test/native-runtime-assembly.test.ts').read_text()
s=s.replace("import { lstat, mkdir, open, readFile, readdir, rm }", "import { lstat, mkdir, open, readFile, readdir, rm, writeFile }")
s=s.replace("import { createFacade, FacadeBearers } from '../src/facade.ts';", "import { createFacade, FacadeBearers } from '../src/facade.ts';\nimport { PostgresUsageJournal } from '../src/usage.ts';")
s=s.replace("assert.equal(files.length, 6,", "assert.equal(files.length, 8,")
s=s.replace("const bearer = token();", "const bearer = token(), usageBearer=token();\n    const usage = new PostgresUsageJournal(kernelPool,randomBytes(32));")
s=s.replace("token: bearer, saved }]);", "token: bearer, saved },{role:'consumer-control',consumerId,token:usageBearer,profileIds:[profileId],limits,maxRunMs:30000}]);")
s=s.replace("      bearers,", "      bearers, usage,")
needle="      assert.equal(callbacks.admit, i); assert.equal(callbacks.closureAck, i);"
extra="""
      const usageResponse=await fetch(origin+'/v1/usage?limit=100',{headers:{authorization:'Bearer '+usageBearer,'content-type':'application/json',accept:'application/json'},signal:AbortSignal.timeout(5000)});
      assert.equal(usageResponse.status,200,'real consumer-control usage HTTP');
      const page=object(await usageResponse.json());
      assert.ok(Array.isArray(page.observations));
      const measured=page.observations.filter((fact:any)=>fact.requestRef===requestId&&fact.completeness==='complete');
      assert.ok(measured.some((fact:any)=>fact.inputTokens===3&&fact.outputTokens===2&&fact.cachedInputTokens===0&&fact.reasoningTokens===0),'Go-derived usage must survive privateHTTP and durableTS journal');
      const repeated=await usage.list(context,{limit:100});
      assert.equal(repeated.observations.length,page.observations.length,'HTTP returns durable journal observations');
      await writeFile('/opt/account-gateway-assembly/usage-observations.json',JSON.stringify(page));
"""
assert needle in s
s=s.replace(needle,needle+extra)
final_needle="    assert.equal(heldStatus.effect, 'effect_unknown');"
assert final_needle in s
s=s.replace(final_needle,final_needle+"""
    const finalUsage=await usage.list(context,{limit:100});
    const aborted=finalUsage.observations.filter(fact=>fact.requestRef===heldId);
    assert.ok(aborted.some(fact=>fact.effect==='effect_unknown'&&fact.inputTokens===null&&fact.outputTokens===null&&fact.completeness==='partial'),'aborted actual native request must remain consumed with unknown tokens');
    await writeFile('/opt/account-gateway-assembly/usage-observations.json',JSON.stringify(finalUsage));
""")
target.write_text(s)
