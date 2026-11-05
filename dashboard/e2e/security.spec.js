import { test, expect } from '@playwright/test'
import { handleSession, executionConfig } from './ui-fixtures.js'
const sha = 'a'.repeat(40)
const platform = arch => ({ arch, status:'available', policy:'passed', counts:{CRITICAL:0,HIGH:0,MEDIUM:0,LOW:0,UNKNOWN:0}, total:0, findings:[], scannedAt:'2026-11-06T00:00:00Z', image:`ghcr.io/harmohanjeetkaur/deployforge:${sha}`, imageId:null })
async function setup(page, { policy='passed', missing=false, error=false, empty=false }={}) {
 const writes=[]
 await page.route('**/api/**',route=>{
  if(handleSession(route))return
  const req=route.request(), path=new URL(req.url()).pathname
  if(req.method()!=='GET')writes.push(path)
  if(path==='/api/deploy/config')return route.fulfill({json:executionConfig})
  if(path==='/api/kubernetes/history')return route.fulfill({json:[]})
  if(path==='/api/releases')return route.fulfill({json:{releases:empty?[]:[{id:'release-1',tag:'v1.2.0',repository:'deployforge',sha}]}})
  if(path.startsWith('/api/security/releases/')){
   if(error)return route.fulfill({status:502,json:{message:'Unavailable'}})
   const platforms=[platform('amd64'),platform('arm64')]
   if(policy==='failed'){Object.assign(platforms[0],{policy:'failed',total:1,counts:{...platforms[0].counts,HIGH:1},findings:[{id:'CVE-2026-1234',severity:'HIGH',package:'stdlib',installed:'1.0',fixed:'1.1',title:'Example finding',target:'api'}]})}
   if(missing)platforms[1]={arch:'arm64',status:'unavailable',policy:'unknown',findings:[]}
   return route.fulfill({json:{policy:missing?'unknown':policy,sha,tag:'v1.2.0',run:{id:123,attempt:2},digest:null,platforms,scope:'Blocking HIGH/CRITICAL including unfixed'}})
  }
  return route.fulfill({json:{}})
 })
 await page.goto('/');await page.getByRole('link',{name:'Security',exact:true}).click();return writes
}
test('both platform reports display policy evidence and exact run without writes',async({page})=>{
 const writes=await setup(page)
 await expect(page.getByText('Policy passed',{exact:true})).toHaveCount(3)
 await expect(page.getByRole('heading',{name:'linux/amd64'})).toBeVisible()
 await expect(page.getByRole('heading',{name:'linux/arm64'})).toBeVisible()
 await expect(page.getByRole('link',{name:/Open scan run/})).toHaveAttribute('href',/runs\/123\/attempts\/2/)
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 expect(writes).toEqual([])
})
test('failed scan lists real vulnerabilities and fixes',async({page})=>{
 await setup(page,{policy:'failed'})
 await expect(page.getByText('Policy failed',{exact:true})).toHaveCount(2)
 await expect(page.getByRole('link',{name:'CVE-2026-1234'})).toHaveAttribute('href','https://nvd.nist.gov/vuln/detail/CVE-2026-1234')
 await expect(page.getByRole('cell',{name:/stdlib/})).toBeVisible()
})
test('missing platform cannot display overall success',async({page})=>{
 await setup(page,{missing:true});await expect(page.getByText('Evidence incomplete')).toBeVisible();await expect(page.getByText('Report missing or expired. Policy unknown.')).toBeVisible()
})
test('GitHub failure is actionable and never displays policy success',async({page})=>{
 await setup(page,{error:true});await expect(page.getByRole('alert')).toContainText('Actions read permission');await expect(page.getByText('Policy passed',{exact:true})).toHaveCount(0)
})
test('no releases shows empty state without fabricated counts',async({page})=>{
 await setup(page,{empty:true});await expect(page.getByText('No release scan reports yet.',{exact:false})).toBeVisible()
})
