import {test,expect} from '@playwright/test'
import {handleSession,executionConfig} from './ui-fixtures.js'
const pods=[{name:'deployforge-healthy',namespace:'deployforge-gitops',uid:'1',ready:true,restarts:0,demo:false},{name:'deployforge-incident-demo',namespace:'deployforge-gitops',uid:'2',ready:false,restarts:3,demo:true,reason:'CrashLoopBackOff'}]
async function setup(page,{enabled=true,failure=false,local=false}={}){
 const posts=[]
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname
  if(path==='/api/incidents')return route.fulfill({json:{pods,namespace:'deployforge-gitops',ai:{enabled,provider:local?'Local analysis':'OpenAI',model:local?'Evidence rules v1':'gpt-5-mini'}}})
  if(handleSession(route))return
  if(path==='/api/deploy/config')return route.fulfill({json:executionConfig})
  if(path==='/api/kubernetes/history')return route.fulfill({json:[]})
  if(req.method()==='POST'){
   posts.push(path);expect(req.headers()['x-csrf-token']).toBe('test-csrf')
   if(path.endsWith('/evidence'))return route.fulfill({json:{id:'evidence-1',pod:pods[1],collectedAt:new Date().toISOString(),sections:[{id:'pod',title:'Pod status',content:'CrashLoopBackOff'},{id:'logs-startup',title:'Startup logs',content:'ERROR missing demo configuration'}]}})
   if(path.endsWith('/analyze'))return route.fulfill(failure?{status:429,json:{message:'OpenAI quota reached'}}:{json:{provider:local?'Local analysis':'OpenAI',model:local?'Evidence rules v1':'gpt-5-mini',generatedAt:new Date().toISOString(),diagnosis:{summary:'Demo startup failure',likelyCause:'Missing demo configuration',confidence:'high',evidenceIds:['logs-startup'],checks:['Inspect config'],remediation:['Correct demo config'],caveats:['Intentional demo only']}}})
   throw Error('Unexpected operation write '+path)
  }
  return route.fulfill({json:{}})
 })
 await page.goto('/');await page.getByRole('link',{name:'AI Troubleshooting',exact:true}).click();return posts
}
test('mixed healthy/demo pods collect preview then require consent before read-only AI',async({page})=>{
 const posts=await setup(page)
 await expect(page.locator('.incident-pods').getByText('CrashLoopBackOff',{exact:true})).toBeVisible();await page.getByRole('button',{name:/All \(2\)/}).click();await expect(page.getByText('Ready',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Collect pod evidence'}).click()
 await expect(page.locator('.incident-sections details[open]')).toHaveCount(0)
 await page.getByText('Startup logs', { exact: true }).click()
 await expect(page.getByText('ERROR missing demo configuration')).toBeVisible()
 await expect(page.getByRole('button',{name:'Analyze with OpenAI'})).toBeDisabled()
 expect(posts).toEqual(['/api/incidents/evidence'])
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Analyze with OpenAI'}).click()
 await expect(page.getByRole('heading',{name:'AI diagnosis',exact:true})).toBeVisible()
 await expect(page.getByRole('link',{name:'Evidence: logs-startup'})).toHaveAttribute('href','#evidence-logs-startup')
 expect(posts).toEqual(['/api/incidents/evidence','/api/incidents/analyze'])
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
test('missing API setup never fabricates an AI answer',async({page})=>{
 await setup(page,{enabled:false});await page.getByRole('button',{name:'Collect pod evidence'}).click();await page.getByRole('checkbox').check();await expect(page.getByRole('button',{name:'Analyze with OpenAI'})).toBeDisabled();await expect(page.getByRole('heading',{name:'AI diagnosis',exact:true})).toHaveCount(0)
})
test('provider errors remain explicit and never execute remediation',async({page})=>{
 const posts=await setup(page,{failure:true});await page.getByRole('button',{name:'Collect pod evidence'}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Analyze with OpenAI'}).click();await expect(page.getByRole('alert')).toContainText('quota');expect(posts).toHaveLength(2)
})
test('Overview recent detections link a specific demo pod to troubleshooting',async({page})=>{
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/incidents')return route.fulfill({json:{pods,recent:[{id:'incident-1',title:'ReadinessProbeFailed',pod:pods[1].name,demo:true,source:'Kubernetes',state:'active',detail:'Probe returned HTTP 404',firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString()}],namespace:'deployforge-gitops',ai:{enabled:false}}});
  if(handleSession(route))return;
  if(path==='/api/kubernetes/history')return route.fulfill({json:[]});
  if(path==='/api/deploy/config')return route.fulfill({json:executionConfig});
  if(path==='/api/kubernetes/status')return route.fulfill({json:{readyReplicas:3,desiredReplicas:3,pods:[]}});
  return route.fulfill({json:{}});
 });
 await page.goto('/');await expect(page.getByRole('heading',{name:'Recently detected',exact:true})).toBeVisible();await expect(page.getByText('Recently detected',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Troubleshoot →',exact:true}).click();await expect(page.getByRole('heading',{name:'AI Troubleshooting',exact:true})).toBeVisible();await expect(page.locator('.incident-pod.selected')).toContainText(pods[1].name);
});

test('local analysis preserves approval and displays its actual source',async({page})=>{
 const posts=await setup(page,{local:true})
 await expect(page.getByText('Local analysis',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Collect pod evidence'}).click()
 await expect(page.getByRole('button',{name:'Analyze workload',exact:true})).toBeDisabled()
 await expect(page.getByText('I reviewed this snapshot and approve local analysis.')).toBeVisible()
 await page.getByRole('checkbox').check()
 await page.getByRole('button',{name:'Analyze workload',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Workload diagnosis',exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'AI diagnosis',exact:true})).toHaveCount(0)
 expect(posts).toEqual(['/api/incidents/evidence','/api/incidents/analyze'])
})
